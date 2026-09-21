// api/webhook.js
import { getOrder, updateOrder, listOrders, ORDER_STATUS, normalizePhone } from './_lib/orders.js';

const BOT_TOKEN = process.env.MAX_BOT_TOKEN;
const BOT_API = 'https://platform-api2.max.ru';
const WEBHOOK_SECRET = process.env.MAX_WEBHOOK_SECRET;

/**
 * Отправляет сообщение пользователю от имени бота.
 */
async function sendMessage(userId, text, attachments = null) {
    if (!BOT_TOKEN || !userId) return { ok: false };

    const body = { text, format: 'markdown' };
    if (attachments) body.attachments = attachments;

    try {
        const res = await fetch(`${BOT_API}/messages?user_id=${userId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: BOT_TOKEN,
            },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            console.error('sendMessage failed:', res.status, await res.text());
            return { ok: false };
        }
        return { ok: true };
    } catch (err) {
        console.error('sendMessage error:', err);
        return { ok: false };
    }
}

/**
 * Кнопка "Поделиться номером".
 */
async function sendContactRequest(userId, orderId) {
    const attachments = [{
        type: 'inline_keyboard',
        payload: {
            buttons: [[
                { type: 'request_contact', text: '📱 Поделиться номером' },
            ]],
        },
    }];
    return sendMessage(
        userId,
        `Здравствуйте! Вы назначены водителем на заказ \`${orderId}\`.\n\nДля продолжения поделитесь своим номером телефона — он должен совпадать с тем, что указал диспетчер.`,
        attachments
    );
}

/**
 * Кнопка "Заполнить форму" — открывает мини-приложение.
 */
async function sendFormButton(userId, orderId) {
    const botUsername = process.env.BOT_USERNAME;
    if (!botUsername) {
        console.error('BOT_USERNAME не задан');
        return { ok: false };
    }

    const attachments = [{
        type: 'inline_keyboard',
        payload: {
            buttons: [[
                {
                    type: 'open_app',
                    text: '📝 Заполнить форму осмотра',
                    web_app: botUsername,
                },
            ]],
        },
    }];

    return sendMessage(
        userId,
        `✅ Номер подтверждён.\n\nТеперь заполните форму осмотра груза по заказу \`${orderId}\`.`,
        attachments
    );
}

/**
 * Парсит vCard-строку и достаёт из неё номер телефона.
 * Пример vcf_info:
 *   "BEGIN:VCARD\r\nVERSION:3.0\r\nPRODID:ez-vcard 0.10.3\r\nTEL;TYPE=cell:79086010130\r\nFN:Роман Герасимов\r\nEND:VCARD\r\n"
 */
function parsePhoneFromVcard(vcfInfo) {
    if (!vcfInfo) return '';

    // Ищем строку с TEL. Варианты: "TEL:...", "TEL;TYPE=cell:...", "TEL;TYPE=VOICE:..."
    const match = vcfInfo.match(/^TEL[^:]*:(.+)$/m);
    if (!match) return '';

    return normalizePhone(match[1].trim());
}

function extractContact(message) {
    const attachments = message?.body?.attachments || [];
    const contactAttachment = attachments.find((a) => a.type === 'contact');
    if (!contactAttachment) return null;

    const payload = contactAttachment.payload || {};
    const maxInfo = payload.max_info || {};

    // Приоритет 1: отдельное поле vcf_phone (если MAX когда-нибудь добавит)
    // Приоритет 2: парсим vCard из vcf_info
    let phone = '';
    if (payload.vcf_phone) {
        phone = normalizePhone(payload.vcf_phone);
    } else if (payload.vcf_info) {
        phone = parsePhoneFromVcard(payload.vcf_info);
    }

    return {
        phone,
        vcf_info: payload.vcf_info || null,
        // MAX присылает данные пользователя в max_info — используем их для имени/username
        first_name: maxInfo.first_name || null,
        last_name: maxInfo.last_name || null,
        username: maxInfo.username || null,
        max_user_id: maxInfo.user_id || null,
    };
}

export async function POST(request) {
    // Проверка секрета (если задан)
    if (WEBHOOK_SECRET) {
        const secret = request.headers.get('x-max-bot-api-secret');
        if (secret !== WEBHOOK_SECRET) {
            console.warn('Webhook secret mismatch:', secret);
            return new Response('Forbidden', { status: 403 });
        }
    }

    let update;
    try {
        update = await request.json();
    } catch {
        return new Response('Bad Request', { status: 400 });
    }

    console.log('Webhook update:', JSON.stringify(update));

    const updateType = update.update_type;

    // === 1. Пользователь запустил бота по ссылке ===
    if (updateType === 'bot_started') {
        const userId = update.user?.user_id;
        const payload = update.payload; // ord_xxxx из ?start=

        console.log('bot_started:', { userId, payload });

        if (!payload || !payload.startsWith('ord_')) {
            await sendMessage(userId, '❌ Не удалось определить заказ. Свяжитесь с диспетчером.');
            return new Response('OK', { status: 200 });
        }

        const order = await getOrder(payload);
        if (!order) {
            await sendMessage(userId, '❌ Заказ не найден. Возможно, ссылка устарела.');
            return new Response('OK', { status: 200 });
        }

        // Запоминаем user_id в заказе, чтобы потом связать контакт
        await updateOrder(payload, {
            status: ORDER_STATUS.AWAITING_PHONE,
            loader: { max_user_id: userId },
        }, 'bot_started', 'loader');

        await sendContactRequest(userId, payload);
        return new Response('OK', { status: 200 });
    }

    // === 2. Пользователь прислал сообщение (возможно, контакт) ===
    if (updateType === 'message_created') {
        const message = update.message;
        if (!message) return new Response('OK', { status: 200 });

        const userId = message.sender?.user_id;
        const contact = extractContact(message);

        if (!contact) {
            // Обычный текст — игнорируем
            return new Response('OK', { status: 200 });
        }

        console.log('Contact received:', { userId, phone: contact.phone });

        // Ищем заказ, где этот user_id уже привязан, в статусе awaiting_phone
        const pending = await listOrders({ status: ORDER_STATUS.AWAITING_PHONE });
        const target = pending.find((o) => o.loader?.max_user_id === userId);

        if (!target) {
            await sendMessage(userId, '❌ Не нашли активный заказ для вас. Откройте ссылку от диспетчера заново.');
            return new Response('OK', { status: 200 });
        }

        // Сверяем номер с тем, что указал диспетчер
        const expected = normalizePhone(target.loader.phone_expected);
        if (expected && expected !== contact.phone) {
            await sendMessage(
                userId,
                `❌ Номер \`${contact.phone}\` не совпадает с тем, что указал диспетчер.\n\nПопробуйте поделиться тем номером, на который оформлен заказ.`
            );
            return new Response('OK', { status: 200 });
        }

        // Всё ок — сохраняем и показываем кнопку формы
        await updateOrder(target.id, {
            status: ORDER_STATUS.AWAITING_FORM,
            loader: {
                phone_received: contact.phone,
                first_name: message.sender?.first_name || null,
                last_name: message.sender?.last_name || null,
                username: message.sender?.username || null,
            },
        }, 'contact_confirmed', 'loader');

        await sendFormButton(userId, target.id);
        return new Response('OK', { status: 200 });
    }

    // Остальные события игнорируем
    return new Response('OK', { status: 200 });
}

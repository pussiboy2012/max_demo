// api/webhook.js
import { getOrder, updateOrder, ORDER_STATUS, normalizePhone } from './_lib/orders.js';

const BOT_TOKEN = process.env.MAX_BOT_TOKEN;
const BOT_API = 'https://platform-api2.max.ru';
const WEBHOOK_SECRET = process.env.MAX_WEBHOOK_SECRET;

/**
 * Отправляет сообщение пользователю от имени бота.
 */
async function sendMessage(userId, text, attachments = null) {
    if (!BOT_TOKEN || !userId) return { ok: false, error: 'Нет токена или userId' };

    const body = { text, format: 'markdown' };
    if (attachments) body.attachments = attachments;

    try {
        const res = await fetch(`${BOT_API}/messages?user_id=${userId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: BOT_TOKEN, // без "Bearer "
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
 * Отправляет кнопку "Поделиться номером".
 */
async function sendContactRequest(userId) {
    const attachments = [{
        type: 'inline_keyboard',
        payload: {
            buttons: [[
                { type: 'request_contact', text: '📱 Поделиться номером' },
            ]],
        },
    }];
    return sendMessage(userId, 'Здравствуйте! Для продолжения поделитесь своим номером телефона.', attachments);
}

/**
 * Отправляет кнопку "Заполнить форму" (открывает мини-приложение).
 */
async function sendFormButton(userId, orderId) {
    const botUsername = process.env.BOT_USERNAME;
    const attachments = [{
        type: 'inline_keyboard',
        payload: {
            buttons: [[
                { type: 'open_app', text: '📝 Заполнить форму', web_app: botUsername },
            ]],
        },
    }];
    return sendMessage(
        userId,
        `Номер подтверждён. Теперь заполните форму осмотра для заказа \`${orderId}\`.`,
        attachments
    );
}

/**
 * Извлекает контакт из вложения сообщения.
 */
function extractContact(message) {
    const attachments = message?.body?.attachments || [];
    const contactAttachment = attachments.find((a) => a.type === 'contact');
    if (!contactAttachment) return null;

    const payload = contactAttachment.payload || {};
    return {
        phone: normalizePhone(payload.vcf_phone || payload.phone || ''),
        vcf_info: payload.vcf_info || null,
        contact_id: payload.contact_id || null,
    };
}

export async function POST(request) {
    // Проверка секрета (если задан)
    if (WEBHOOK_SECRET) {
        const secret = request.headers.get('x-max-bot-api-secret');
        if (secret !== WEBHOOK_SECRET) {
            console.warn('Webhook secret mismatch');
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
        const chatId = update.chat_id;
        const payload = update.payload; // сюда приходит ord_xxxx

        console.log('bot_started:', { userId, chatId, payload });

        if (!payload || !payload.startsWith('ord_')) {
            await sendMessage(userId, 'Не удалось определить заказ. Свяжитесь с администратором.');
            return new Response('OK', { status: 200 });
        }

        const order = await getOrder(payload);
        if (!order) {
            await sendMessage(userId, 'Заказ не найден. Возможно, ссылка устарела.');
            return new Response('OK', { status: 200 });
        }

        // Переводим заказ в статус "ждём номер"
        await updateOrder(payload, { status: ORDER_STATUS.AWAITING_PHONE }, 'bot_started', 'loader');
        await sendContactRequest(userId);
        return new Response('OK', { status: 200 });
    }

    // === 2. Пользователь отправил контакт ===
    if (updateType === 'message_created') {
        const message = update.message;
        if (!message) return new Response('OK', { status: 200 });

        const userId = message.sender?.user_id;
        const chatId = message.recipient?.chat_id || userId;
        const contact = extractContact(message);

        if (!contact) {
            // Обычное текстовое сообщение — игнорируем
            return new Response('OK', { status: 200 });
        }

        console.log('Contact received:', contact);

        // Находим заказ, который ждёт номер от этого пользователя.
        // Простой подход: ищем по loader.max_user_id (если уже привязан) — но пока его нет.
        // Поэтому ищем среди заказов в статусе awaiting_phone, у которых phone_received ещё не заполнен.
        // В демо можно ограничиться поиском по последнему созданному заказу с этим телефоном.
        // Для надёжности в реальном приложении стоит хранить маппинг user_id → order_id.

        // Временное решение для демо: пробегаем по всем заказам в статусе awaiting_phone.
        const { listOrders } = await import('./_lib/orders.js');
        const pending = await listOrders({ status: ORDER_STATUS.AWAITING_PHONE });
        const target = pending.find((o) => normalizePhone(o.loader.phone_expected) === contact.phone);

        if (!target) {
            await sendMessage(userId, 'Не нашли заказ с таким номером. Проверьте, что вы открыли правильную ссылку.');
            return new Response('OK', { status: 200 });
        }

        // Сохраняем данные грузчика
        await updateOrder(target.id, {
            status: ORDER_STATUS.AWAITING_FORM,
            loader: {
                phone_received: contact.phone,
                max_user_id: userId,
                first_name: message.sender?.first_name || null,
                last_name: message.sender?.last_name || null,
                username: message.sender?.username || null,
            },
        }, 'contact_received', 'loader');

        await sendFormButton(userId, target.id);
        return new Response('OK', { status: 200 });
    }

    // Остальные события игнорируем
    return new Response('OK', { status: 200 });
}

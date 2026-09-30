import { getOrder, updateOrder, listOrders, ORDER_STATUS, normalizePhone } from './_lib/orders.js';

const BOT_TOKEN = process.env.MAX_BOT_TOKEN;
const BOT_API = 'https://platform-api2.max.ru';
const WEBHOOK_SECRET = process.env.MAX_WEBHOOK_SECRET;

async function sendMessage(userId, text, attachments = null) {
    if (!BOT_TOKEN || !userId) return { ok: false };
    const body = { text, format: 'markdown' };
    if (attachments) body.attachments = attachments;
    try {
        const res = await fetch(`${BOT_API}/messages?user_id=${userId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: BOT_TOKEN },
            body: JSON.stringify(body),
        });
        return { ok: res.ok };
    } catch { return { ok: false }; }
}

async function sendContactRequest(userId, orderNumber) {
    return sendMessage(
        userId,
        `Здравствуйте! Вы назначены на заказ *${orderNumber}*.\n\nПоделитесь номером телефона, чтобы открыть форму осмотра.`,
        [{
            type: 'inline_keyboard',
            payload: { buttons: [[{ type: 'request_contact', text: '📱 Поделиться номером' }]] },
        }]
    );
}

async function sendFormButton(userId, orderId) {
    const botUsername = process.env.BOT_USERNAME;
    return sendMessage(
        userId,
        `✅ Номер подтверждён. Откройте форму осмотра груза по заказу \`${orderId}\`.`,
        [{
            type: 'inline_keyboard',
            payload: {
                buttons: [[{
                    type: 'open_app',
                    text: '📝 Открыть форму осмотра',
                    web_app: botUsername,
                    payload: orderId,
                }]],
            },
        }]
    );
}

function extractContact(message) {
    const attachments = message?.body?.attachments || [];
    const c = attachments.find(a => a.type === 'contact');
    if (!c) return null;
    const p = c.payload || {};
    const raw = p.vcf_phone || p.phone || p.phone_number || '';
    return { phone: normalizePhone(raw), raw };
}

export async function POST(request) {
    if (WEBHOOK_SECRET) {
        const secret = request.headers.get('x-max-bot-api-secret');
        if (secret !== WEBHOOK_SECRET) return new Response('Forbidden', { status: 403 });
    }

    let update;
    try { update = await request.json(); } catch { return new Response('Bad Request', { status: 400 }); }
    console.log('Webhook:', JSON.stringify(update));

    const type = update.update_type;

    if (type === 'bot_started') {
        const userId = update.user?.user_id;
        const payload = update.payload;
        if (!payload || !payload.startsWith('ord_')) {
            await sendMessage(userId, '❌ Ссылка неверна. Запросите новую у диспетчера.');
            return new Response('OK');
        }
        const order = await getOrder(payload);
        if (!order) {
            await sendMessage(userId, '❌ Заказ не найден.');
            return new Response('OK');
        }
        await updateOrder(payload, {
            status: ORDER_STATUS.AWAITING_PHONE,
            loader: { max_user_id: userId },
        }, 'bot_started', 'loader');
        await sendContactRequest(userId, order.number || payload);
        return new Response('OK');
    }

    if (type === 'message_created') {
        const message = update.message;
        if (!message) return new Response('OK');
        const userId = message.sender?.user_id;
        const contact = extractContact(message);
        if (!contact) return new Response('OK');

        const pending = await listOrders({ status: ORDER_STATUS.AWAITING_PHONE });
        const target = pending.find(o => o.loader?.max_user_id === userId);
        if (!target) {
            await sendMessage(userId, '❌ Нет активного заказа. Откройте ссылку заново.');
            return new Response('OK');
        }

        const expected = normalizePhone(target.loader.phone_expected);
        if (expected && contact.phone && expected !== contact.phone) {
            await sendMessage(userId, `❌ Номер \`${contact.phone}\` не совпадает с указанным диспетчером.`);
            return new Response('OK');
        }

        await updateOrder(target.id, {
            status: ORDER_STATUS.AWAITING_FORM,
            loader: {
                phone_received: contact.phone || expected,
                first_name: message.sender?.first_name || null,
                last_name: message.sender?.last_name || null,
                username: message.sender?.username || null,
            },
        }, 'contact_confirmed', 'loader');

        await sendFormButton(userId, target.id);
        return new Response('OK');
    }

    return new Response('OK');
}

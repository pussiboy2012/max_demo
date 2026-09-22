import { checkAdminAuth } from './_lib/auth.js';
import { getOrder, updateOrder } from './_lib/orders.js';
import { generateInspectionHTML, generateSummaryText } from './_lib/documents.js';

const BOT_TOKEN = process.env.MAX_BOT_TOKEN;
const BOT_API = 'https://platform-api2.max.ru';

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

async function sendBotMessage(userId, text) {
    if (!BOT_TOKEN || !userId) return { ok: false, error: 'Нет токена или userId' };
    try {
        const res = await fetch(`${BOT_API}/messages?user_id=${userId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: BOT_TOKEN,
            },
            body: JSON.stringify({ text, format: 'markdown' }),
        });
        if (!res.ok) {
            const t = await res.text();
            return { ok: false, error: `${res.status}: ${t}` };
        }
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

export async function GET(request) {
    const auth = checkAdminAuth(request);
    if (!auth.ok) return jsonResponse({ error: auth.error }, 401);

    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    const action = url.searchParams.get('action') || 'generate';

    if (!id) return jsonResponse({ error: 'Не указан id заказа' }, 400);
    const order = await getOrder(id);
    if (!order) return jsonResponse({ error: 'Заказ не найден' }, 404);

    if (!order.inspection) {
        return jsonResponse({ error: 'Водитель ещё не заполнил форму осмотра' }, 400);
    }

    if (action === 'generate') {
        const html = generateInspectionHTML(order);
        await updateOrder(id, { document_generated_at: new Date().toISOString() }, 'document_generated', 'admin');
        return new Response(html, {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
    }

    return jsonResponse({ error: 'Неизвестное действие' }, 400);
}

export async function POST(request) {
    const auth = checkAdminAuth(request);
    if (!auth.ok) return jsonResponse({ error: auth.error }, 401);

    let body;
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: 'Некорректный JSON' }, 400);
    }

    const { id, action } = body;
    if (!id) return jsonResponse({ error: 'Не указан id заказа' }, 400);

    const order = await getOrder(id);
    if (!order) return jsonResponse({ error: 'Заказ не найден' }, 404);

    if (action === 'send') {
        if (!order.inspection) {
            return jsonResponse({ error: 'Водитель ещё не заполнил форму осмотра' }, 400);
        }

        const userId = order.loader?.max_user_id;
        if (!userId) {
            return jsonResponse({ error: 'Водитель ещё не поделился контактом — нет MAX user_id' }, 400);
        }

        const text = generateSummaryText(order);
        const result = await sendBotMessage(userId, text);
        if (!result.ok) {
            return jsonResponse({ error: 'Не удалось отправить: ' + result.error }, 500);
        }

        await updateOrder(id, { document_sent_at: new Date().toISOString() }, 'document_sent', 'admin');
        return jsonResponse({ success: true, sent_to: userId });
    }

    return jsonResponse({ error: 'Неизвестное действие' }, 400);
}

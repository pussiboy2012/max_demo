import { checkAdminAuth } from './_lib/auth.js';
import { getOrder, updateOrder } from './_lib/orders.js';
import { generateInspectionHTML, generateSummaryText } from './_lib/documents.js';

const BOT_TOKEN = process.env.MAX_BOT_TOKEN;
const BOT_API = 'https://platform-api2.max.ru';

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function sendBotMessage(userId, text) {
    if (!BOT_TOKEN || !userId) return { ok: false, error: 'Нет токена или userId' };
    try {
        const res = await fetch(`${BOT_API}/messages?user_id=${userId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: BOT_TOKEN },
            body: JSON.stringify({ text, format: 'markdown' }),
        });
        return res.ok ? { ok: true } : { ok: false, error: `${res.status}` };
    } catch (e) { return { ok: false, error: e.message }; }
}

export async function GET(request) {
    const auth = checkAdminAuth(request);
    if (!auth.ok) return jsonResponse({ error: auth.error }, 401);

    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    const version = parseInt(url.searchParams.get('version'), 10) || null;

    if (!id) return jsonResponse({ error: 'Не указан id' }, 400);
    const order = await getOrder(id);
    if (!order) return jsonResponse({ error: 'Заказ не найден' }, 404);
    if (!order.inspections?.length) return jsonResponse({ error: 'Осмотров нет' }, 400);

    const targetVersion = version || order.current_inspection;
    const html = generateInspectionHTML(order, targetVersion);

    await updateOrder(id, {
        // отметим только последнюю версию
        [`inspections`]: (order.inspections || []).map(i =>
            i.version === targetVersion
                ? { ...i, document_generated_at: new Date().toISOString() }
                : i
        ),
    }, 'document_generated', 'admin');

    return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export async function POST(request) {
    const auth = checkAdminAuth(request);
    if (!auth.ok) return jsonResponse({ error: auth.error }, 401);

    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: 'Некорректный JSON' }, 400); }

    const { id, version } = body;
    if (!id) return jsonResponse({ error: 'Не указан id' }, 400);

    const order = await getOrder(id);
    if (!order) return jsonResponse({ error: 'Заказ не найден' }, 404);
    if (!order.inspections?.length) return jsonResponse({ error: 'Осмотров нет' }, 400);

    const targetVersion = version || order.current_inspection;
    const userId = order.loader?.max_user_id;
    if (!userId) return jsonResponse({ error: 'Водитель ещё не в MAX' }, 400);

    const text = generateSummaryText(order, targetVersion);
    const result = await sendBotMessage(userId, text);
    if (!result.ok) return jsonResponse({ error: 'Не удалось отправить: ' + result.error }, 500);

    await updateOrder(id, {
        [`inspections`]: (order.inspections || []).map(i =>
            i.version === targetVersion
                ? { ...i, document_sent_at: new Date().toISOString() }
                : i
        ),
    }, 'document_sent', 'admin');

    return jsonResponse({ success: true, sent_to: userId, version: targetVersion });
}
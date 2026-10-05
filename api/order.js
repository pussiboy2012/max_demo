import { checkAdminAuth } from './_lib/auth.js';
import { getOrder, updateOrder, deleteOrder, ORDER_STATUS, buildLoaderLink } from './_lib/orders.js';

const MAX_BOT_TOKEN = process.env.MAX_BOT_TOKEN;
const MAX_BOT_API = 'https://platform-api2.max.ru';

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

async function sendRecheckRequest(order, comment) {
    const userId = order.loader?.max_user_id;
    const botUsername = process.env.BOT_USERNAME;

    if (!userId) return { ok: false, error: 'У водителя нет MAX user_id. Сначала водитель должен открыть бота по ссылке заказа.' };
    if (!MAX_BOT_TOKEN) return { ok: false, error: 'На сервере не задан MAX_BOT_TOKEN.' };
    if (!botUsername) return { ok: false, error: 'На сервере не задан BOT_USERNAME.' };

    const details = String(comment || '').trim();
    const text = [
        `Назначен повторный осмотр груза по заказу ${order.number || order.id}.`,
        details ? `Комментарий диспетчера: ${details}` : '',
        'Нажмите кнопку ниже, чтобы открыть форму повторного осмотра.',
    ].filter(Boolean).join('\n\n');

    try {
        const response = await fetch(`${MAX_BOT_API}/messages?user_id=${encodeURIComponent(userId)}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: MAX_BOT_TOKEN,
            },
            body: JSON.stringify({
                text,
                attachments: [{
                    type: 'inline_keyboard',
                    payload: {
                        buttons: [[{
                            type: 'open_app',
                            text: '↻ Открыть форму повторного осмотра',
                            web_app: botUsername,
                            payload: order.id,
                        }]],
                    },
                }],
            }),
        });

        if (!response.ok) {
            const details = await response.text();
            console.error('MAX recheck message failed:', response.status, details);
            return { ok: false, error: `MAX не принял сообщение (HTTP ${response.status}).` };
        }
        return { ok: true };
    } catch (error) {
        console.error('MAX recheck message request failed:', error);
        return { ok: false, error: 'Не удалось связаться с MAX API.' };
    }
}

export async function GET(request) {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return jsonResponse({ error: 'Не указан id' }, 400);

    const order = await getOrder(id);
    if (!order) return jsonResponse({ error: 'Заказ не найден' }, 404);

    // Генерируем сокращённую ссылку на лету (не сохраняем — чтобы не устаревала)
    const loader_link = await buildLoaderLink(order.id);

    return jsonResponse({ success: true, order, loader_link });
}

/**
 * PATCH — обновление заказа. Поддерживает:
 *   { id, status }                  — смена статуса
 *   { id, action: 'accept' }         — принять результат осмотра
 *   { id, action: 'recheck', comment }— назначить повторный осмотр
 *   { id, action: 'reject', comment }— отклонить
 */
export async function PATCH(request) {
    const auth = checkAdminAuth(request);
    if (!auth.ok) return jsonResponse({ error: auth.error }, 401);

    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: 'Некорректный JSON' }, 400); }

    const { id, status, action, comment } = body;
    if (!id) return jsonResponse({ error: 'Не указан id' }, 400);

    const order = await getOrder(id);
    if (!order) return jsonResponse({ error: 'Заказ не найден' }, 404);

    // Обработка резолюций диспетчера
    if (action === 'accept') {
        const updated = await updateOrder(id, {
            status: ORDER_STATUS.COMPLETED,
            resolution: {
                status: 'accepted',
                comment: comment || '',
                resolved_at: new Date().toISOString(),
                resolved_by: 'admin',
            },
        }, 'resolution_accepted', 'admin');
        return jsonResponse({ success: true, order: updated });
    }

    if (action === 'recheck') {
        const delivery = await sendRecheckRequest(order, comment);
        if (!delivery.ok) {
            return jsonResponse({ error: delivery.error }, 502);
        }

        const resolvedAt = new Date().toISOString();
        const updated = await updateOrder(id, {
            status: ORDER_STATUS.RECHECK,
            resolution: {
                status: 'recheck',
                comment: comment || '',
                resolved_at: resolvedAt,
                resolved_by: 'admin',
                notification_sent_at: resolvedAt,
            },
        }, 'recheck_assigned', 'admin');
        return jsonResponse({ success: true, order: updated, notification_sent: true });
    }

    if (action === 'reject') {
        const updated = await updateOrder(id, {
            status: ORDER_STATUS.CANCELLED,
            resolution: {
                status: 'rejected',
                comment: comment || '',
                resolved_at: new Date().toISOString(),
                resolved_by: 'admin',
            },
        }, 'resolution_rejected', 'admin');
        return jsonResponse({ success: true, order: updated });
    }

    // Обычная смена статуса
    if (status) {
        const valid = Object.values(ORDER_STATUS);
        if (!valid.includes(status)) return jsonResponse({ error: `Недопустимый статус: ${status}` }, 422);
        const updated = await updateOrder(id, { status }, `status → ${status}`, 'admin');
        return jsonResponse({ success: true, order: updated });
    }

    return jsonResponse({ error: 'Не передано действие' }, 400);
}

export async function DELETE(request) {
    const auth = checkAdminAuth(request);
    if (!auth.ok) return jsonResponse({ error: auth.error }, 401);

    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return jsonResponse({ error: 'Не указан id' }, 400);

    try {
        const ok = await deleteOrder(id);
        if (!ok) return jsonResponse({ error: 'Заказ не найден' }, 404);
        return jsonResponse({ success: true, deleted: id });
    } catch (err) {
        console.error('deleteOrder error:', err);
        return jsonResponse({ error: 'Не удалось удалить' }, 500);
    }
}

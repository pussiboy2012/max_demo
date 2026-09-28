import { checkAdminAuth } from './_lib/auth.js';
import { getOrder, updateOrder, deleteOrder, ORDER_STATUS, buildLoaderLink } from './_lib/orders.js';

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
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
        const updated = await updateOrder(id, {
            status: ORDER_STATUS.RECHECK,
            resolution: {
                status: 'recheck',
                comment: comment || '',
                resolved_at: new Date().toISOString(),
                resolved_by: 'admin',
            },
        }, 'recheck_assigned', 'admin');
        return jsonResponse({ success: true, order: updated });
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
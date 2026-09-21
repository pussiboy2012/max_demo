// api/order.js
import { checkAdminAuth } from './_lib/auth.js';
import { getOrder, updateOrder, ORDER_STATUS } from './_lib/orders.js';

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

/**
 * GET /api/order?id=ord_xxxx
 */
export async function GET(request) {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return jsonResponse({ error: 'Не указан id заказа' }, 400);

    const order = await getOrder(id);
    if (!order) return jsonResponse({ error: 'Заказ не найден' }, 404);

    return jsonResponse({ success: true, order });
}

/**
 * PATCH /api/order — обновление заказа администратором.
 * Body: { id, status?, note? }
 */
export async function PATCH(request) {
    const auth = checkAdminAuth(request);
    if (!auth.ok) {
        return jsonResponse({ error: auth.error }, 401);
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: 'Некорректный JSON' }, 400);
    }

    const { id, status } = body;
    if (!id) return jsonResponse({ error: 'Не указан id заказа' }, 400);

    const patch = {};
    if (status) {
        const validStatuses = Object.values(ORDER_STATUS);
        if (!validStatuses.includes(status)) {
            return jsonResponse({ error: `Недопустимый статус: ${status}` }, 422);
        }
        patch.status = status;
    }

    const updated = await updateOrder(id, patch, `status → ${status}`, 'admin');
    if (!updated) return jsonResponse({ error: 'Заказ не найден' }, 404);

    return jsonResponse({ success: true, order: updated });
}

import { checkAdminAuth } from './_lib/auth.js';
import { getOrder, updateOrder, deleteOrder, ORDER_STATUS } from './_lib/orders.js';

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export async function GET(request) {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return jsonResponse({ error: 'Не указан id заказа' }, 400);

    const order = await getOrder(id);
    if (!order) return jsonResponse({ error: 'Заказ не найден' }, 404);
    return jsonResponse({ success: true, order });
}

export async function PATCH(request) {
    const auth = checkAdminAuth(request);
    if (!auth.ok) return jsonResponse({ error: auth.error }, 401);

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
        const valid = Object.values(ORDER_STATUS);
        if (!valid.includes(status)) {
            return jsonResponse({ error: `Недопустимый статус: ${status}` }, 422);
        }
        patch.status = status;
    }

    try {
        const updated = await updateOrder(id, patch, `status → ${status}`, 'admin');
        if (!updated) return jsonResponse({ error: 'Заказ не найден' }, 404);
        return jsonResponse({ success: true, order: updated });
    } catch (err) {
        console.error('updateOrder error:', err);
        return jsonResponse({ error: 'Не удалось обновить заказ' }, 500);
    }
}

export async function DELETE(request) {
    const auth = checkAdminAuth(request);
    if (!auth.ok) return jsonResponse({ error: auth.error }, 401);

    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return jsonResponse({ error: 'Не указан id заказа' }, 400);

    try {
        const ok = await deleteOrder(id);
        if (!ok) return jsonResponse({ error: 'Заказ не найден' }, 404);
        return jsonResponse({ success: true, deleted: id });
    } catch (err) {
        console.error('deleteOrder error:', err);
        return jsonResponse({ error: 'Не удалось удалить заказ' }, 500);
    }
}

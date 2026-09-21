// api/my-order.js
import { validateInitData } from './_lib/auth.js';
import { listOrders, ORDER_STATUS } from './_lib/orders.js';

const BOT_TOKEN = process.env.MAX_BOT_TOKEN;

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

/**
 * POST /api/my-order
 * Body: { initData }
 * Возвращает активный заказ для текущего пользователя MAX.
 */
export async function POST(request) {
    let body;
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: 'Некорректный JSON' }, 400);
    }

    const { initData } = body;
    const { data: userData, error: initError } = validateInitData(initData, BOT_TOKEN);

    if (initError) {
        return jsonResponse({ error: initError }, 403);
    }

    const userId = userData?.user?.id;
    if (!userId) return jsonResponse({ error: 'Не удалось определить пользователя' }, 400);

    // Ищем заказ, привязанный к этому пользователю, в статусе awaiting_form
    const orders = await listOrders({ status: ORDER_STATUS.AWAITING_FORM });
    const order = orders.find((o) => o.loader?.max_user_id === userId);

    if (!order) {
        return jsonResponse({ error: 'Активный заказ не найден' }, 404);
    }

    // Отдаём водителю только то, что ему нужно
    return jsonResponse({
        success: true,
        order: {
            id: order.id,
            cargo: order.cargo,
            route: order.route,
            loader: {
                first_name: order.loader.first_name,
                last_name: order.loader.last_name,
            },
        },
    });
}

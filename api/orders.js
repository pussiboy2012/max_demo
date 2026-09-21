// api/orders.js
import { checkAdminAuth } from './_lib/auth.js';
import { createOrder, listOrders, buildLoaderLink } from './_lib/orders.js';

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

/**
 * POST /api/orders — создание заказа администратором.
 */
export async function POST(request) {
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

    const { cargo, route, loader } = body;

    // Минимальная валидация на сервере
    const errors = [];
    if (!cargo?.name) errors.push('Наименование груза обязательно');
    if (!cargo?.weight || parseFloat(cargo.weight) <= 0) errors.push('Вес должен быть > 0');
    if (!cargo?.places || parseInt(cargo.places, 10) <= 0) errors.push('Количество мест > 0');
    if (!route?.from) errors.push('Пункт отправления обязателен');
    if (!route?.to) errors.push('Пункт назначения обязателен');
    if (!route?.ship_date) errors.push('Дата отправки обязательна');
    if (!loader?.phone_expected) errors.push('Телефон грузчика обязателен');

    if (errors.length) {
        return jsonResponse({ error: 'Ошибка валидации', details: errors }, 422);
    }

    try {
        const order = await createOrder({ cargo, route, loader });
        const loaderLink = buildLoaderLink(order.id);

        return jsonResponse({
            success: true,
            order,
            loader_link: loaderLink,
        }, 201);
    } catch (err) {
        console.error('createOrder error:', err);
        return jsonResponse({ error: 'Не удалось создать заказ' }, 500);
    }
}

/**
 * GET /api/orders — список заказов для админки.
 * Query: ?status=awaiting_docs
 */
export async function GET(request) {
    const auth = checkAdminAuth(request);
    if (!auth.ok) {
        return jsonResponse({ error: auth.error }, 401);
    }

    const url = new URL(request.url);
    const status = url.searchParams.get('status') || undefined;

    try {
        const orders = await listOrders({ status });
        return jsonResponse({ success: true, orders, total: orders.length });
    } catch (err) {
        console.error('listOrders error:', err);
        return jsonResponse({ error: 'Не удалось получить список заказов' }, 500);
    }
}

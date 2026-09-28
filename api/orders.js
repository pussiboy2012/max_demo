import { checkAdminAuth } from './_lib/auth.js';
import { createOrder, listOrders, buildLoaderLink, buildSmsText, CHECKLIST } from './_lib/orders.js';

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export async function POST(request) {
    const auth = checkAdminAuth(request);
    if (!auth.ok) return jsonResponse({ error: auth.error }, 401);

    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: 'Некорректный JSON' }, 400); }

    const { number, cargo, route, carrier, vehicle, loader } = body;
    const errors = [];
    if (!number) errors.push('Номер поручения обязателен');
    if (!cargo?.name) errors.push('Наименование груза обязательно');
    if (!cargo?.places || parseInt(cargo.places, 10) <= 0) errors.push('Количество мест > 0');
    if (!route?.from) errors.push('Пункт отправления обязателен');
    if (!route?.to) errors.push('Пункт назначения обязателен');
    if (!route?.loading_time) errors.push('Время погрузки обязательно');
    if (!loader?.phone_expected) errors.push('Телефон водителя обязателен');

    if (errors.length) return jsonResponse({ error: 'Ошибка валидации', details: errors }, 422);

    try {
        const order = await createOrder({ number, cargo, route, carrier, vehicle, loader });
        const link = await buildLoaderLink(order.id);
        return jsonResponse({
            success: true,
            order,
            loader_link: link,
            sms_text: buildSmsText(order, link),
        }, 201);
    } catch (err) {
        console.error('createOrder error:', err);
        return jsonResponse({ error: 'Не удалось создать заказ' }, 500);
    }
}

export async function GET(request) {
    const auth = checkAdminAuth(request);
    if (!auth.ok) return jsonResponse({ error: auth.error }, 401);

    const url = new URL(request.url);
    const status = url.searchParams.get('status') || undefined;

    try {
        const orders = await listOrders({ status });
        return jsonResponse({ success: true, orders, total: orders.length, checklist: CHECKLIST });
    } catch (err) {
        console.error('listOrders error:', err);
        return jsonResponse({ error: 'Не удалось получить список' }, 500);
    }
}
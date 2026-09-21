// api/submit.js
import { validateInitData } from './_lib/auth.js';
import { listOrders, updateOrder, ORDER_STATUS } from './_lib/orders.js';

const BOT_TOKEN = process.env.MAX_BOT_TOKEN;
const BOT_API = 'https://platform-api2.max.ru';

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

/**
 * Отправляет сообщение водителю от имени бота.
 */
async function sendBotMessage(userId, text) {
    if (!BOT_TOKEN || !userId) return { ok: false };
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
            console.error('sendMessage failed:', res.status, await res.text());
            return { ok: false };
        }
        return { ok: true };
    } catch (err) {
        console.error('sendMessage error:', err);
        return { ok: false };
    }
}

/**
 * Проверяет чек-лист, который заполнил водитель.
 */
function validateInspection(formData) {
    const errors = [];

    const checklistFields = [
        ['check_packaging', 'Упаковка целая'],
        ['check_marking', 'Маркировка читаемая'],
        ['check_weight_actual', 'Вес совпадает'],
        ['check_no_damage', 'Повреждения отсутствуют'],
        ['check_no_odor', 'Посторонние запахи отсутствуют'],
        ['check_docs', 'Документы в наличии'],
    ];

    for (const [field, label] of checklistFields) {
        if (formData[field] !== true) {
            errors.push(`Чек-лист: «${label}»`);
        }
    }

    if (formData.confirm !== true) {
        errors.push('Подтверждение достоверности данных');
    }

    return { valid: errors.length === 0, errors };
}

export async function POST(request) {
    let body;
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: 'Некорректный JSON' }, 400);
    }

    const { formData, initData } = body;

    // 1. Валидируем initData
    const { data: userData, error: initError } = validateInitData(initData, BOT_TOKEN);
    if (initError) {
        return jsonResponse({ error: initError }, 403);
    }

    const userId = userData?.user?.id;
    if (!userId) return jsonResponse({ error: 'Не удалось определить пользователя' }, 400);

    // 2. Ищем заказ водителя
    const orders = await listOrders({ status: ORDER_STATUS.AWAITING_FORM });
    const order = orders.find((o) => o.loader?.max_user_id === userId);

    if (!order) {
        return jsonResponse({ error: 'Активный заказ не найден' }, 404);
    }

    // 3. Проверяем чек-лист
    const { valid, errors } = validateInspection(formData);
    if (!valid) {
        return jsonResponse({ error: 'Чек-лист заполнен не полностью', details: errors }, 422);
    }

    // 4. Сохраняем осмотр в заказ
    const inspection = {
        check_packaging: formData.check_packaging === true,
        check_marking: formData.check_marking === true,
        check_weight_actual: formData.check_weight_actual === true,
        check_no_damage: formData.check_no_damage === true,
        check_no_odor: formData.check_no_odor === true,
        check_docs: formData.check_docs === true,
        comment: (formData.comment || '').trim(),
        confirmed_at: new Date().toISOString(),
        confirmed_by_user_id: userId,
    };

    await updateOrder(order.id, {
        status: ORDER_STATUS.AWAITING_DOCS,
        inspection,
    }, 'inspection_completed', 'loader');

    // 5. Отправляем водителю подтверждение
    const confirmation =
        `✅ *Осмотр груза принят*\n\n` +
        `Заказ: \`${order.id}\`\n` +
        `Груз: ${order.cargo.name}\n` +
        `Маршрут: ${order.route.from} → ${order.route.to}\n\n` +
        `Ожидайте документы для загрузки. Диспетчер свяжется с вами.`;

    const sendResult = await sendBotMessage(userId, confirmation);

    return jsonResponse({
        success: true,
        order_id: order.id,
        notification_sent: sendResult.ok,
    });
}

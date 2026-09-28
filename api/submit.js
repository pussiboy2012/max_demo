import { getOrder, addInspection, normalizePhone, CHECKLIST } from './_lib/orders.js';
import { validateInitData } from './_lib/auth.js';

const BOT_TOKEN = process.env.MAX_BOT_TOKEN;

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export async function POST(request) {
    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: 'Некорректный JSON' }, 400); }

    const { orderId, initData, type, answers, overall_comment, impossible_reason } = body;

    if (!orderId) return jsonResponse({ error: 'Не указан заказ' }, 400);

    const { data: userData, error } = validateInitData(initData, BOT_TOKEN);
    if (error) return jsonResponse({ error }, 403);

    const order = await getOrder(orderId);
    if (!order) return jsonResponse({ error: 'Заказ не найден' }, 404);

    // Проверяем, что водитель именно тот
    const userId = userData?.user?.id;
    if (order.loader?.max_user_id && order.loader.max_user_id !== userId) {
        return jsonResponse({ error: 'Вы не назначены на этот заказ' }, 403);
    }

    // Форма осмотра
    if (type === 'inspection') {
        if (!Array.isArray(answers) || !answers.length) {
            return jsonResponse({ error: 'Пустой список ответов' }, 400);
        }

        // Валидация: при match=false обязателен комментарий
        for (const a of answers) {
            const known = CHECKLIST.find(c => c.key === a.key);
            if (!known) return jsonResponse({ error: `Неизвестный пункт: ${a.key}` }, 400);
            if (typeof a.match !== 'boolean') {
                return jsonResponse({ error: `Не указан ответ для «${known.label}»` }, 400);
            }
            if (a.match === false && (!a.comment || !a.comment.trim())) {
                return jsonResponse({ error: `Комментарий обязателен для «${known.label}»` }, 400);
            }
        }

        const updated = await addInspection(orderId, {
            type: 'inspection',
            inspector: {
                user_id: userId,
                first_name: userData.user.first_name,
                last_name: userData.user.last_name,
                phone: order.loader.phone_received || order.loader.phone_expected,
            },
            answers: answers.map(a => {
                const known = CHECKLIST.find(c => c.key === a.key);
                return {
                    key: a.key,
                    label: known.label,
                    match: a.match,
                    comment: (a.comment || '').trim(),
                };
            }),
            overall_comment: (overall_comment || '').trim(),
        });

        return jsonResponse({ success: true, version: updated.current_inspection });
    }

    // Осмотр невозможен
    if (type === 'impossible') {
        if (!impossible_reason || !impossible_reason.trim()) {
            return jsonResponse({ error: 'Укажите причину' }, 400);
        }
        const updated = await addInspection(orderId, {
            type: 'impossible',
            inspector: {
                user_id: userId,
                first_name: userData.user.first_name,
                last_name: userData.user.last_name,
                phone: order.loader.phone_received || order.loader.phone_expected,
            },
            impossible_reason: impossible_reason.trim(),
        });
        return jsonResponse({ success: true, version: updated.current_inspection });
    }

    return jsonResponse({ error: 'Неизвестный тип' }, 400);
}
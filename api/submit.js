import crypto from 'node:crypto';

const BOT_TOKEN = process.env.MAX_BOT_TOKEN;
const BOT_API = 'https://botapi.max.ru';

/**
 * Валидирует initData по официальному алгоритму MAX.
 */
function validateInitData(initData, botToken) {
    if (!initData || !botToken) {
        return { data: null, error: 'Отсутствуют initData или токен бота' };
    }

    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return { data: null, error: 'В initData отсутствует hash' };

    params.delete('hash');

    const sortedKeys = [...params.keys()].sort();
    const launchParams = sortedKeys
        .map((key) => `${key}=${params.get(key)}`)
        .join('\n');

    const secretKey = crypto
        .createHmac('sha256', 'WebAppData')
        .update(botToken)
        .digest();

    const computedHash = crypto
        .createHmac('sha256', secretKey)
        .update(launchParams)
        .digest('hex');

    if (computedHash !== hash) {
        return { data: null, error: 'Неверная подпись initData' };
    }

    const data = {};
    for (const [key, value] of params) {
        if (key === 'user' || key === 'chat') {
            try {
                data[key] = JSON.parse(value);
            } catch {
                data[key] = value;
            }
        } else {
            data[key] = value;
        }
    }

    return { data, error: null };
}

/**
 * Проверяет обязательные поля формы на сервере.
 */
function validateCargoForm(formData) {
    const errors = [];

    const requiredTextFields = [
        ['cargo_name', 'Наименование груза'],
        ['from', 'Пункт отправления'],
        ['to', 'Пункт назначения'],
        ['ship_date', 'Дата отправки'],
    ];

    for (const [field, label] of requiredTextFields) {
        if (!formData[field] || String(formData[field]).trim() === '') {
            errors.push(`${label}: поле обязательно`);
        }
    }

    const requiredNumberFields = [
        ['weight', 'Вес'],
        ['places', 'Количество мест'],
        ['length', 'Длина'],
        ['width', 'Ширина'],
        ['height', 'Высота'],
    ];

    for (const [field, label] of requiredNumberFields) {
        const value = parseFloat(formData[field]);
        if (isNaN(value) || value <= 0) {
            errors.push(`${label}: должно быть > 0`);
        }
    }

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

/**
 * Отправляет сообщение в чат от имени бота.
 */
async function sendBotMessage(userId, text, botToken) {
    if (!botToken) return { ok: false, error: 'Не задан MAX_BOT_TOKEN' };
    if (!userId) return { ok: false, error: 'Нет user_id' };

    const url = `${BOT_API}/messages?user_id=${userId}`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${botToken}`,
            },
            body: JSON.stringify({ text, format: 'markdown' }),
        });

        const responseText = await response.text();

        if (!response.ok) {
            console.error('Bot API error:', response.status, responseText);
            return { ok: false, error: `Bot API ${response.status}: ${responseText}` };
        }

        console.log('Bot API success:', responseText);
        return { ok: true };
    } catch (err) {
        console.error('Bot API fetch error:', err);
        return { ok: false, error: err.message };
    }
}

/**
 * Формирует текст уведомления для бота.
 */
function buildNotificationText(user, userData, formData) {
    const lines = [];

    lines.push('✅ *Груз принят на проверку*');
    lines.push('');
    lines.push('👤 *Отправитель*');
    lines.push(`• Имя: ${user?.first_name || '—'} ${user?.last_name || ''}`.trim());
    if (user?.username) lines.push(`• Username: @${user.username}`);
    if (user?.id) lines.push(`• ID: ${user.id}`);
    if (user?.language_code) lines.push(`• Язык: ${user.language_code}`);
    if (userData?.chat?.id) lines.push(`• Chat ID: ${userData.chat.id}`);

    lines.push('');
    lines.push('📦 *Данные груза*');
    lines.push(`• Наименование: ${formData.cargo_name}`);
    lines.push(`• Вес: ${formData.weight} кг`);
    lines.push(`• Мест: ${formData.places} шт`);
    lines.push(`• Габариты: ${formData.length} × ${formData.width} × ${formData.height} см`);

    lines.push('');
    lines.push('🗺 *Маршрут*');
    lines.push(`• Откуда: ${formData.from}`);
    lines.push(`• Куда: ${formData.to}`);
    lines.push(`• Дата отправки: ${formData.ship_date}`);

    lines.push('');
    lines.push('📋 *Чек-лист осмотра*');
    lines.push(`• Упаковка целая: ${formData.check_packaging ? 'да' : 'нет'}`);
    lines.push(`• Маркировка: ${formData.check_marking ? 'да' : 'нет'}`);
    lines.push(`• Вес совпадает: ${formData.check_weight_actual ? 'да' : 'нет'}`);
    lines.push(`• Без повреждений: ${formData.check_no_damage ? 'да' : 'нет'}`);
    lines.push(`• Без запахов: ${formData.check_no_odor ? 'да' : 'нет'}`);
    lines.push(`• Документы: ${formData.check_docs ? 'да' : 'нет'}`);

    if (formData.comment && formData.comment.trim()) {
        lines.push('');
        lines.push('💬 *Примечание*');
        lines.push(formData.comment);
    }

    return lines.join('\n');
}

// 👇 ВОТ ЭТА СТРОКА ИЗМЕНИЛАСЬ
export async function POST(request) {
    let body;
    try {
        body = await request.json();
    } catch {
        return new Response(JSON.stringify({ error: 'Некорректный JSON' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const { formData, initData } = body;

    // 1. Валидация initData
    const { data: userData, error: initError } = validateInitData(initData, BOT_TOKEN);
    if (initError) {
        console.error('initData validation failed:', initError);
        return new Response(JSON.stringify({ error: initError }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const user = userData.user;
    const userId = user?.id;

    // 2. Серверная валидация формы
    const { valid, errors } = validateCargoForm(formData);
    if (!valid) {
        return new Response(
            JSON.stringify({ error: 'Форма заполнена некорректно', details: errors }),
            { status: 422, headers: { 'Content-Type': 'application/json' } }
        );
    }

    console.log('Form accepted:', { userId, cargo: formData.cargo_name });

    // 3. Отправляем уведомление в чат
    const notificationText = buildNotificationText(user, userData, formData);
    const sendResult = await sendBotMessage(userId, notificationText, BOT_TOKEN);

    if (!sendResult.ok) {
        console.error('Notification failed:', sendResult.error);
    }

    // 4. Возвращаем результат
    return new Response(
        JSON.stringify({
            success: true,
            notification_sent: sendResult.ok,
            notification_error: sendResult.error || null,
            user: { id: userId, name: user?.first_name || 'Пользователь' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
}

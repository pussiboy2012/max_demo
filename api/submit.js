import crypto from 'node:crypto';

// Токен бота берём из переменных окружения Vercel (Settings → Environment Variables)
const BOT_TOKEN = process.env.MAX_BOT_TOKEN;

/**
 * Валидирует initData по официальному алгоритму MAX.
 * @see https://dev.max.ru/docs/webapps/validation
 * @param {string} initData — сырая строка из window.WebApp.initData
 * @param {string} botToken — токен бота
 * @returns {{ data: object | null, error: string | null }}
 */
function validateInitData(initData, botToken) {
    if (!initData || !botToken) {
        return { data: null, error: 'Отсутствуют initData или токен бота' };
    }

    // 1. Разбираем строку на пары key=value
    const params = new URLSearchParams(initData);

    // 2. Извлекаем hash
    const hash = params.get('hash');
    if (!hash) {
        return { data: null, error: 'В initData отсутствует hash' };
    }

    // 3. Удаляем hash из параметров
    params.delete('hash');

    // 4. Сортируем ключи и формируем launch_params
    const sortedKeys = [...params.keys()].sort();
    const launchParams = sortedKeys
        .map((key) => `${key}=${params.get(key)}`)
        .join('\n');

    // 5. Вычисляем secret_key: HMAC-SHA256("WebAppData", BOT_TOKEN)
    const secretKey = crypto
        .createHmac('sha256', 'WebAppData')
        .update(botToken)
        .digest();

    // 6. Вычисляем подпись: HMAC-SHA256(secret_key, launch_params)
    const computedHash = crypto
        .createHmac('sha256', secretKey)
        .update(launchParams)
        .digest('hex');

    // 7. Сравниваем
    if (computedHash !== hash) {
        return { data: null, error: 'Неверная подпись initData' };
    }

    // 8. Возвращаем распарсенные данные
    const data = {};
    for (const [key, value] of params) {
        // user и chat приходят как JSON-строки
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
 * @param {object} formData — объект с данными из формы
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateCargoForm(formData) {
    const errors = [];

    // --- Обязательные текстовые поля ---
    const requiredTextFields = [
        ['cargo_name', 'Наименование груза'],
        ['from', 'Пункт отправления'],
        ['to', 'Пункт назначения'],
        ['ship_date', 'Дата отправки'],
    ];

    for (const [field, label] of requiredTextFields) {
        if (!formData[field] || String(formData[field]).trim() === '') {
            errors.push(`${label}: поле обязательно для заполнения`);
        }
    }

    // --- Обязательные числовые поля (должны быть > 0) ---
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
            errors.push(`${label}: должно быть положительным числом`);
        }
    }

    // --- Все пункты чек-листа должны быть отмечены ---
    const checklistFields = [
        ['check_packaging', 'Упаковка целая'],
        ['check_marking', 'Маркировка читаемая'],
        ['check_weight_actual', 'Вес совпадает с заявленным'],
        ['check_no_damage', 'Повреждения отсутствуют'],
        ['check_no_odor', 'Посторонние запахи отсутствуют'],
        ['check_docs', 'Документы в наличии'],
    ];

    for (const [field, label] of checklistFields) {
        if (formData[field] !== true) {
            errors.push(`Чек-лист: «${label}» не отмечен`);
        }
    }

    // --- Подтверждение достоверности ---
    if (formData.confirm !== true) {
        errors.push('Подтверждение достоверности данных обязательно');
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Отправляет уведомление в чат с пользователем от имени бота.
 * @param {number} userId — ID пользователя MAX
 * @param {string} text — текст сообщения
 */
async function sendNotification(userId, text) {
    if (!BOT_TOKEN || !userId) return;

    try {
        const response = await fetch(
            `https://botapi.max.ru/messages?user_id=${userId}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${BOT_TOKEN}`,
                },
                body: JSON.stringify({ text }),
            }
        );

        if (!response.ok) {
            console.error('Не удалось отправить уведомление:', await response.text());
        }
    } catch (err) {
        // Ошибка уведомления не должна ломать основной ответ пользователю
        console.error('Ошибка при отправке уведомления:', err);
    }
}

export default async function handler(request) {
    // Разрешаем только POST
    if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: { 'Content-Type': 'application/json' },
        });
    }

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

    // 1. Валидируем initData
    const { data: userData, error: initError } = validateInitData(initData, BOT_TOKEN);

    if (initError) {
        console.error('Ошибка валидации initData:', initError);
        return new Response(JSON.stringify({ error: initError }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    // 2. Проверяем данные формы на сервере
    const { valid, errors } = validateCargoForm(formData);

    if (!valid) {
        return new Response(
            JSON.stringify({ error: 'Форма заполнена некорректно', details: errors }),
            {
                status: 422,
                headers: { 'Content-Type': 'application/json' },
            }
        );
    }

    // 3. Данные доверенные — можно обрабатывать
    const user = userData.user;
    const userId = user?.id;
    const userName = user?.first_name || 'Пользователь';

    console.log('Проверка груза пройдена:', {
        userId,
        userName,
        cargo: formData.cargo_name,
        weight: formData.weight,
        route: `${formData.from} → ${formData.to}`,
        shipDate: formData.ship_date,
    });

    // 4. Отправляем уведомление пользователю от имени бота
    const notificationText =
        `✅ Груз «${formData.cargo_name}» принят на проверку.\n\n` +
        `📍 Маршрут: ${formData.from} → ${formData.to}\n` +
        `📅 Дата отправки: ${formData.ship_date}\n` +
        `⚖️ Вес: ${formData.weight} кг\n` +
        `📦 Мест: ${formData.places}`;

    await sendNotification(userId, notificationText);

    // 5. Возвращаем успех
    return new Response(
        JSON.stringify({
            success: true,
            user: { id: userId, name: userName },
            message: 'Груз принят на проверку',
        }),
        {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }
    );
}

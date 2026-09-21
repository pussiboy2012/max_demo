import crypto from 'node:crypto';

const BOT_TOKEN = process.env.MAX_BOT_TOKEN;

/**
 * Валидирует initData по алгоритму MAX.
 * @param {string} initData — сырая строка из window.WebApp.initData
 * @param {string} botToken — токен бота
 * @returns {{ data: object | null, error: string | null }}
 */
function validateInitData(initData, botToken) {
    if (!initData || !botToken) {
        return { data: null, error: 'Missing initData or botToken' };
    }

    // 1. Разбираем строку на пары key=value
    const params = new URLSearchParams(initData);

    // 2. Извлекаем hash
    const hash = params.get('hash');
    if (!hash) {
        return { data: null, error: 'No hash in initData' };
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
        return { data: null, error: 'Invalid hash' };
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

export default async function handler(request) {
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
        return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const { formData, initData } = body;

    const { data: userData, error } = validateInitData(initData, BOT_TOKEN);

    if (error) {
        console.error('Validation error:', error);
        return new Response(JSON.stringify({ error }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    // Здесь userData — доверенные данные пользователя MAX
    console.log('Verified user:', userData.user?.id, userData.user?.first_name);
    console.log('Form data:', formData);

    // Твоя логика: сохранить в БД, отправить уведомление и т.д.

    return new Response(JSON.stringify({
        success: true,
        user: {
            id: userData.user?.id,
            name: userData.user?.first_name,
        },
    }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}

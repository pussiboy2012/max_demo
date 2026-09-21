// api/_lib/auth.js
import crypto from 'node:crypto';

/**
 * Валидирует initData по официальному алгоритму MAX.
 */
export function validateInitData(initData, botToken) {
    if (!initData || !botToken) {
        return { data: null, error: 'Отсутствуют initData или токен бота' };
    }

    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return { data: null, error: 'В initData отсутствует hash' };

    params.delete('hash');

    const sortedKeys = [...params.keys()].sort();
    const launchParams = sortedKeys.map((k) => `${k}=${params.get(k)}`).join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
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
 * Проверяет админский пароль из заголовка X-Admin-Password.
 */
export function checkAdminAuth(request) {
    const password = request.headers.get('x-admin-password');
    const expected = process.env.ADMIN_PASSWORD;
    if (!expected) {
        return { ok: false, error: 'ADMIN_PASSWORD не задан на сервере' };
    }
    if (!password || password !== expected) {
        return { ok: false, error: 'Неверный пароль администратора' };
    }
    return { ok: true };
}

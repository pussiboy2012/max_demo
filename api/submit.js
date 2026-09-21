import { validateInitData } from 'max-validate-init-data';

// Токен бота берём из переменных окружения Vercel (не храни в коде!)
const BOT_TOKEN = process.env.MAX_BOT_TOKEN;

export default async function handler(request) {
    // Проверяем, что это POST
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

    if (!initData) {
        return new Response(JSON.stringify({ error: 'No initData' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    // Валидация initData
    const { data, error } = validateInitData({ initData, botToken: BOT_TOKEN });

    if (error) {
        console.error('Validation error:', error);
        return new Response(JSON.stringify({ error: 'Invalid initData' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const user = data.user;
    console.log('Verified user:', user.id, user.first_name);
    console.log('Form data:', formData);

    // Здесь твоя логика: сохранить в БД, отправить уведомление и т.д.

    return new Response(JSON.stringify({ success: true, user: { id: user.id, name: user.first_name } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}

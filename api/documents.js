import { checkAdminAuth } from './_lib/auth.js';
import { getOrder, updateOrder } from './_lib/orders.js';
import { generateInspectionPDF } from './_lib/documents.js';

const BOT_TOKEN = process.env.MAX_BOT_TOKEN;
const BOT_API = 'https://platform-api2.max.ru';

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function reportFilename(order, version) {
    const label = String(order.number || order.id).replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60);
    return `otchet-${label}-v${version}.pdf`;
}

async function sendReportFile(userId, pdf, filename, orderLabel) {
    if (!BOT_TOKEN || !userId) return { ok: false, error: 'Нет токена или userId' };

    try {
        const uploadInit = await fetch(`${BOT_API}/uploads?type=file`, {
            method: 'POST',
            headers: { Authorization: BOT_TOKEN, Accept: 'application/json' },
        });
        if (!uploadInit.ok) return { ok: false, error: `Ошибка подготовки файла: ${uploadInit.status} ${await uploadInit.text()}` };

        const uploadData = await uploadInit.json();
        if (!uploadData.url) return { ok: false, error: 'MAX не вернул адрес загрузки файла' };

        const form = new FormData();
        form.append('data', new Blob([pdf], { type: 'application/pdf' }), filename);
        const uploaded = await fetch(uploadData.url, { method: 'POST', body: form });
        if (!uploaded.ok) return { ok: false, error: `Ошибка загрузки файла: ${uploaded.status} ${await uploaded.text()}` };

        const uploadedData = await uploaded.json();
        if (!uploadedData.token) return { ok: false, error: 'MAX не вернул токен загруженного файла' };

        const messageBody = {
            text: `Отчёт по заказу ${orderLabel} во вложении.`,
            attachments: [{ type: 'file', payload: { token: uploadedData.token } }],
        };
        for (let attempt = 0; attempt < 3; attempt++) {
            const res = await fetch(`${BOT_API}/messages?user_id=${encodeURIComponent(userId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: BOT_TOKEN },
                body: JSON.stringify(messageBody),
            });
            if (res.ok) return { ok: true };
            const error = await res.text();
            if (attempt === 2 || !error.includes('attachment.not.ready')) {
                return { ok: false, error: `${res.status} ${error}` };
            }
            await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
    } catch (e) {
        return { ok: false, error: e.message };
    }
    return { ok: false, error: 'Не удалось отправить файл' };
}

export async function GET(request) {
    const auth = checkAdminAuth(request);
    if (!auth.ok) return jsonResponse({ error: auth.error }, 401);

    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    const version = parseInt(url.searchParams.get('version'), 10) || null;

    if (!id) return jsonResponse({ error: 'Не указан id' }, 400);
    const order = await getOrder(id);
    if (!order) return jsonResponse({ error: 'Заказ не найден' }, 404);
    if (!order.inspections?.length) return jsonResponse({ error: 'Осмотров нет' }, 400);

    const targetVersion = version || order.current_inspection;
    const pdf = await generateInspectionPDF(order, targetVersion);
    if (!pdf) return jsonResponse({ error: 'Осмотр не найден' }, 404);

    await updateOrder(id, {
        // отметим только последнюю версию
        [`inspections`]: (order.inspections || []).map(i =>
            i.version === targetVersion
                ? { ...i, document_generated_at: new Date().toISOString() }
                : i
        ),
    }, 'document_generated', 'admin');

    const filename = reportFilename(order, targetVersion);
    return new Response(pdf, {
        status: 200,
        headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="inspection-report.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        },
    });
}

export async function POST(request) {
    const auth = checkAdminAuth(request);
    if (!auth.ok) return jsonResponse({ error: auth.error }, 401);

    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: 'Некорректный JSON' }, 400); }

    const { id, version } = body;
    if (!id) return jsonResponse({ error: 'Не указан id' }, 400);

    const order = await getOrder(id);
    if (!order) return jsonResponse({ error: 'Заказ не найден' }, 404);
    if (!order.inspections?.length) return jsonResponse({ error: 'Осмотров нет' }, 400);

    const targetVersion = version || order.current_inspection;
    const userId = order.loader?.max_user_id;
    if (!userId) return jsonResponse({ error: 'Водитель ещё не в MAX' }, 400);

    const pdf = await generateInspectionPDF(order, targetVersion);
    if (!pdf) return jsonResponse({ error: 'Осмотр не найден' }, 404);
    const orderLabel = String(order.number || order.id);
    const result = await sendReportFile(
        userId,
        pdf,
        reportFilename(order, targetVersion),
        orderLabel
    );
    if (!result.ok) return jsonResponse({ error: 'Не удалось отправить: ' + result.error }, 500);

    await updateOrder(id, {
        [`inspections`]: (order.inspections || []).map(i =>
            i.version === targetVersion
                ? { ...i, document_sent_at: new Date().toISOString() }
                : i
        ),
    }, 'document_sent', 'admin');

    return jsonResponse({ success: true, sent_to: userId, version: targetVersion });
}

const WATERMARK_TEXT = 'ДЕМО-ОТЧЁТ · НЕ ЯВЛЯЕТСЯ ЭТрН ИЛИ ЭКСПЕДИТОРСКОЙ РАСПИСКОЙ';

export function generateInspectionHTML(order, version) {
    const cargo = order.cargo || {};
    const route = order.route || {};
    const vehicle = order.vehicle || {};
    const carrier = order.carrier || '—';

    const insp = (order.inspections || []).find(i => i.version === version) || (order.inspections || [])[0];
    if (!insp) return '<html><body>Осмотр не найден</body></html>';

    const fio = `${insp.inspector.first_name || ''} ${insp.inspector.last_name || ''}`.trim() || '—';
    const createdDate = (order.created_at || '').slice(0, 10);
    const confirmedDate = (insp.confirmed_at || '').slice(0, 16).replace('T', ' ');

    const answersHTML = (insp.answers || []).map(a => `
        <tr>
            <td>${esc(a.label)}</td>
            <td class="${a.match ? 'ok' : 'bad'}">${a.match ? 'Соответствует' : 'Не совпало'}</td>
            <td class="comment">${esc(a.comment || '')}</td>
        </tr>
    `).join('');

    const impossibleHTML = insp.type === 'impossible' ? `
        <div class="alert">
            <strong>Осмотр невозможен.</strong><br>
            Причина: ${esc(insp.impossible_reason || '—')}
        </div>
    ` : '';

    return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>Отчёт осмотра — ${order.id}</title>
<style>
    * { box-sizing: border-box; }
    body { font-family: 'Times New Roman', serif; max-width: 900px; margin: 30px auto; padding: 30px; color: #000; line-height: 1.5; }
    .watermark { position: fixed; top: 40%; left: 0; right: 0; text-align: center; font-size: 40px; color: rgba(220,38,38,0.10); transform: rotate(-20deg); pointer-events: none; font-weight: bold; letter-spacing: 2px; }
    h1 { text-align: center; font-size: 20px; margin: 0 0 4px; }
    .demo { text-align: center; font-size: 12px; color: #b00; font-weight: bold; letter-spacing: 1px; margin-bottom: 6px; }
    .sub { text-align: center; font-size: 13px; color: #555; margin-bottom: 24px; }
    h2 { font-size: 13px; border-bottom: 2px solid #000; padding-bottom: 5px; margin: 22px 0 10px; text-transform: uppercase; letter-spacing: 0.5px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    td, th { padding: 8px 8px; vertical-align: top; border-bottom: 1px solid #ddd; text-align: left; }
    th { background: #f5f5f5; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
    td.ok { color: #080; font-weight: 600; }
    td.bad { color: #c00; font-weight: 600; }
    td.comment { color: #444; font-style: italic; }
    .alert { background: #fef2f2; border-left: 4px solid #dc2626; padding: 12px 14px; margin: 12px 0; font-size: 13px; }
    .signature { margin-top: 50px; display: flex; justify-content: space-between; gap: 40px; }
    .sig-block { flex: 1; font-size: 12px; }
    .sig-line { border-top: 1px solid #000; padding-top: 5px; color: #555; margin-top: 40px; }
    .meta { font-size: 11px; color: #888; text-align: right; margin-top: 30px; font-family: monospace; }
    @media print { body { margin: 0; padding: 15px; } .watermark { font-size: 34px; } }
</style>
</head>
<body>
    <div class="watermark">${WATERMARK_TEXT}</div>

    <h1>ОТЧЁТ ОБ ОСМОТРЕ ГРУЗА</h1>
    <div class="demo">${WATERMARK_TEXT}</div>
    <div class="sub">Заказ ${esc(order.number || order.id)} · версия ${insp.version} от ${esc(confirmedDate)}</div>

    ${impossibleHTML}

    <h2>Данные поручения</h2>
    <table>
        <tr><td style="width:35%">Номер поручения</td><td>${esc(order.number || '—')}</td></tr>
        <tr><td>Перевозчик</td><td>${esc(carrier)}</td></tr>
        <tr><td>Груз</td><td>${esc(cargo.name)}, ${cargo.places} мест, ${cargo.weight} кг</td></tr>
        <tr><td>Габариты</td><td>${cargo.length} × ${cargo.width} × ${cargo.height} см</td></tr>
        <tr><td>Маршрут</td><td>${esc(route.from)} → ${esc(route.to)}</td></tr>
        <tr><td>Время погрузки</td><td>${esc(route.loading_time || '—')}</td></tr>
        <tr><td>ТС</td><td>${esc(vehicle.brand || '—')}, ${esc(vehicle.plate || '—')}${vehicle.trailer ? ', прицеп ' + esc(vehicle.trailer) : ''}</td></tr>
    </table>

    <h2>Водитель</h2>
    <table>
        <tr><td style="width:35%">ФИО</td><td>${esc(fio)}</td></tr>
        <tr><td>Телефон</td><td>${esc(insp.inspector.phone || '—')}</td></tr>
        <tr><td>MAX user_id</td><td>${insp.inspector.user_id || '—'}</td></tr>
        <tr><td>Подтверждено</td><td>${esc(confirmedDate)}</td></tr>
    </table>

    ${insp.type !== 'impossible' ? `
    <h2>Результаты сравнения</h2>
    <table>
        <tr><th>Пункт</th><th style="width:22%">Результат</th><th>Комментарий водителя</th></tr>
        ${answersHTML}
    </table>
    ${insp.overall_comment ? `<h2>Общий комментарий</h2><div style="font-size:13px;">${esc(insp.overall_comment)}</div>` : ''}
    ` : ''}

    <div class="signature">
        <div class="sig-block">
            <div>Водитель:</div>
            <div class="sig-line">${esc(fio)}</div>
        </div>
        <div class="sig-block">
            <div>Дата:</div>
            <div class="sig-line">${esc(confirmedDate)}</div>
        </div>
    </div>

    <div class="meta">
        Заказ ${order.id} · Версия ${insp.version} · Сгенерировано ${new Date().toISOString()}
    </div>

    <script>window.addEventListener('load', () => setTimeout(() => window.print(), 400));</script>
</body>
</html>`;
}

export function generateSummaryText(order, version) {
    const insp = (order.inspections || []).find(i => i.version === version);
    if (!insp) return 'Осмотр не найден';
    const fio = `${insp.inspector.first_name || ''} ${insp.inspector.last_name || ''}`.trim() || '—';

    if (insp.type === 'impossible') {
        return [
            `⚠️ *Осмотр невозможен*`,
            `Заказ \`${order.number || order.id}\`, версия ${insp.version}`,
            ``,
            `Водитель: ${fio}`,
            `Причина: ${insp.impossible_reason || '—'}`,
            ``,
            `_Это демо-отчёт. Не является ЭТрН или экспедиторской распиской._`,
        ].join('\n');
    }

    const mismatches = (insp.answers || []).filter(a => !a.match);
    const header = mismatches.length
        ? `⚠️ *Обнаружены расхождения* (${mismatches.length})`
        : `✅ *Всё соответствует*`;

    const lines = [
        header,
        `Заказ \`${order.number || order.id}\`, версия ${insp.version}`,
        ``,
        `Водитель: ${fio}`,
        `Груз: ${order.cargo.name}, ${order.cargo.places} мест`,
        `Маршрут: ${order.route.from} → ${order.route.to}`,
    ];

    if (mismatches.length) {
        lines.push('');
        lines.push('*Расхождения:*');
        mismatches.forEach(m => lines.push(`• ${m.label}: ${m.comment}`));
    }

    lines.push('');
    lines.push('_Это демо-отчёт. Не является ЭТрН или экспедиторской распиской._');

    return lines.join('\n');
}

function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
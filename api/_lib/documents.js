/**
 * Генерирует HTML-документ "Акт осмотра груза" для печати/сохранения в PDF.
 */
export function generateInspectionHTML(order) {
    const cargo = order.cargo || {};
    const route = order.route || {};
    const loader = order.loader || {};
    const ins = order.inspection || {};

    const mark = (v) => v ? '✓' : '✗';
    const cls = (v) => v ? 'yes' : 'no';
    const fio = `${loader.first_name || ''} ${loader.last_name || ''}`.trim() || '—';
    const createdDate = (order.created_at || '').slice(0, 10);

    return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>Акт осмотра — ${order.id}</title>
<style>
    * { box-sizing: border-box; }
    body { font-family: 'Times New Roman', serif; max-width: 800px; margin: 40px auto; padding: 30px; color: #000; line-height: 1.5; }
    h1 { text-align: center; font-size: 20px; margin: 0 0 4px; }
    .sub { text-align: center; font-size: 13px; color: #555; margin-bottom: 30px; }
    h2 { font-size: 14px; border-bottom: 2px solid #000; padding-bottom: 5px; margin: 24px 0 10px; text-transform: uppercase; letter-spacing: 0.5px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    td { padding: 8px 6px; vertical-align: top; border-bottom: 1px solid #ddd; }
    td:first-child { width: 45%; color: #333; }
    td:last-child { font-weight: 500; }
    .check { font-size: 16px; font-weight: bold; }
    .check.yes { color: #080; }
    .check.no { color: #c00; }
    .comment { background: #f5f5f5; padding: 12px; border-left: 3px solid #888; font-size: 14px; margin-top: 10px; }
    .signature { margin-top: 60px; display: flex; justify-content: space-between; }
    .sig-block { text-align: center; font-size: 13px; }
    .sig-line { border-top: 1px solid #000; width: 220px; padding-top: 6px; color: #555; }
    @media print { body { margin: 0; padding: 20px; } }
</style>
</head>
<body>
    <h1>АКТ ОСМОТРА ГРУЗА</h1>
    <div class="sub">к заказу № ${order.id} от ${createdDate}</div>

    <h2>Сведения о грузе</h2>
    <table>
        <tr><td>Наименование груза</td><td>${esc(cargo.name)}</td></tr>
        <tr><td>Вес, кг</td><td>${cargo.weight || '—'}</td></tr>
        <tr><td>Количество мест, шт</td><td>${cargo.places || '—'}</td></tr>
        <tr><td>Габариты (Д × Ш × В), см</td><td>${cargo.length || 0} × ${cargo.width || 0} × ${cargo.height || 0}</td></tr>
    </table>

    <h2>Маршрут</h2>
    <table>
        <tr><td>Пункт отправления</td><td>${esc(route.from)}</td></tr>
        <tr><td>Пункт назначения</td><td>${esc(route.to)}</td></tr>
        <tr><td>Плановая дата отправки</td><td>${esc(route.ship_date)}</td></tr>
    </table>

    <h2>Водитель</h2>
    <table>
        <tr><td>ФИО</td><td>${esc(fio)}</td></tr>
        <tr><td>Телефон</td><td>${esc(loader.phone_received || loader.phone_expected || '—')}</td></tr>
        <tr><td>MAX User ID</td><td>${loader.max_user_id || '—'}</td></tr>
    </table>

    <h2>Результаты осмотра</h2>
    <table>
        <tr><td>Упаковка целая</td><td class="check ${cls(ins.check_packaging)}">${mark(ins.check_packaging)}</td></tr>
        <tr><td>Маркировка читаемая</td><td class="check ${cls(ins.check_marking)}">${mark(ins.check_marking)}</td></tr>
        <tr><td>Вес совпадает с заявленным</td><td class="check ${cls(ins.check_weight_actual)}">${mark(ins.check_weight_actual)}</td></tr>
        <tr><td>Видимые повреждения отсутствуют</td><td class="check ${cls(ins.check_no_damage)}">${mark(ins.check_no_damage)}</td></tr>
        <tr><td>Посторонние запахи отсутствуют</td><td class="check ${cls(ins.check_no_odor)}">${mark(ins.check_no_odor)}</td></tr>
        <tr><td>Сопроводительные документы в наличии</td><td class="check ${cls(ins.check_docs)}">${mark(ins.check_docs)}</td></tr>
    </table>

    ${ins.comment ? `<h2>Примечание</h2><div class="comment">${esc(ins.comment)}</div>` : ''}

    <div class="signature">
        <div class="sig-block">
            <div class="sig-line">Водитель</div>
            <div style="margin-top:6px;">${esc(fio)}</div>
        </div>
        <div class="sig-block">
            <div class="sig-line">Дата</div>
            <div style="margin-top:6px;">${ins.confirmed_at ? ins.confirmed_at.slice(0, 10) : '—'}</div>
        </div>
    </div>

    <script>window.addEventListener('load', () => setTimeout(() => window.print(), 400));</script>
</body>
</html>`;
}

export function generateSummaryText(order) {
    const cargo = order.cargo || {};
    const route = order.route || {};
    const loader = order.loader || {};
    const ins = order.inspection || {};
    const mark = (v) => v ? '✅' : '❌';
    const fio = `${loader.first_name || ''} ${loader.last_name || ''}`.trim() || '—';

    return [
        `📄 *Акт осмотра груза*`,
        `Заказ \`${order.id}\``,
        ``,
        `*Груз:* ${cargo.name}`,
        `*Вес:* ${cargo.weight} кг · *Мест:* ${cargo.places}`,
        `*Габариты:* ${cargo.length} × ${cargo.width} × ${cargo.height} см`,
        ``,
        `*Маршрут:*`,
        `${route.from} → ${route.to}`,
        `Дата отправки: ${route.ship_date}`,
        ``,
        `*Водитель:* ${fio}`,
        `Телефон: ${loader.phone_received || loader.phone_expected || '—'}`,
        ``,
        `*Результаты осмотра:*`,
        `${mark(ins.check_packaging)} Упаковка целая`,
        `${mark(ins.check_marking)} Маркировка читаемая`,
        `${mark(ins.check_weight_actual)} Вес совпадает`,
        `${mark(ins.check_no_damage)} Без повреждений`,
        `${mark(ins.check_no_odor)} Без посторонних запахов`,
        `${mark(ins.check_docs)} Документы в наличии`,
        ins.comment ? `\n💬 ${ins.comment}` : '',
    ].filter(Boolean).join('\n');
}

function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

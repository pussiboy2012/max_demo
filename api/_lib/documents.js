import PDFDocument from 'pdfkit';
import { readFileSync } from 'node:fs';

const WATERMARK_TEXT = 'ДЕМО-ОТЧЁТ · НЕ ЯВЛЯЕТСЯ ЭТрН ИЛИ ЭКСПЕДИТОРСКОЙ РАСПИСКОЙ';
const FONT_REGULAR = readFileSync(new URL('./fonts/NotoSans-Regular.ttf', import.meta.url));
const FONT_BOLD = readFileSync(new URL('./fonts/NotoSans-Bold.ttf', import.meta.url));

export function generateInspectionPDF(order, version) {
    const insp = (order.inspections || []).find(i => i.version === version);
    if (!insp) return null;

    const cargo = order.cargo || {};
    const route = order.route || {};
    const vehicle = order.vehicle || {};
    const fio = `${insp.inspector?.first_name || ''} ${insp.inspector?.last_name || ''}`.trim() || '—';
    const title = `Отчёт об осмотре — ${order.number || order.id}`;
    const date = (insp.confirmed_at || '').slice(0, 16).replace('T', ' ') || '—';

    return new Promise((resolve, reject) => {
        const chunks = [];
        const doc = new PDFDocument({ size: 'A4', margin: 42, bufferPages: true, info: { Title: title, Author: 'Cargo' } });
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        doc.registerFont('Noto', FONT_REGULAR);
        doc.registerFont('Noto-Bold', FONT_BOLD);

        const left = 42;
        const width = doc.page.width - left * 2;
        const bottom = doc.page.height - 42;
        const colors = { ink: '#111111', muted: '#555555', border: '#d6d6d6', red: '#b00000', redBg: '#fef2f2', tableHead: '#f5f5f5' };

        function newPageIfNeeded(height) {
            if (doc.y + height > bottom) doc.addPage();
        }

        function sectionHeading(text) {
            newPageIfNeeded(34);
            doc.moveDown(0.6);
            doc.font('Noto-Bold').fontSize(11).fillColor(colors.ink).text(text.toLocaleUpperCase('ru-RU'), left, doc.y, { characterSpacing: 0.5 });
            doc.moveDown(0.25);
            doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(1.5).strokeColor(colors.ink).stroke();
            doc.moveDown(0.45);
        }

        function tableRow(label, rawValue) {
            const value = String(rawValue ?? '—') || '—';
            const labelWidth = width * 0.35;
            const valueWidth = width - labelWidth - 16;
            doc.font('Noto').fontSize(10);
            const valueHeight = doc.heightOfString(value, { width: valueWidth, lineGap: 2 });
            const rowHeight = Math.max(25, valueHeight + 12);
            newPageIfNeeded(rowHeight + 2);
            const y = doc.y;
            doc.font('Noto').fontSize(10).fillColor(colors.ink).text(label, left + 8, y + 7, { width: labelWidth - 16 });
            doc.font('Noto').fontSize(10).fillColor(colors.ink).text(value, left + labelWidth + 8, y + 7, { width: valueWidth, lineGap: 2 });
            doc.moveTo(left, y + rowHeight).lineTo(left + width, y + rowHeight).lineWidth(0.6).strokeColor(colors.border).stroke();
            doc.y = y + rowHeight;
        }

        function reportParagraph(text, options = {}) {
            const { color = colors.ink, background = null, leftBorder = null, font = 'Noto', fontSize = 10, italic = false } = options;
            doc.font(font).fontSize(fontSize);
            const padX = background ? 13 : 0;
            const textHeight = doc.heightOfString(String(text), { width: width - padX * 2, lineGap: 3 });
            const boxHeight = textHeight + (background ? 20 : 8);
            newPageIfNeeded(boxHeight + 3);
            const y = doc.y;
            if (background) doc.rect(left, y, width, boxHeight).fill(background);
            if (leftBorder) doc.rect(left, y, 4, boxHeight).fill(leftBorder);
            doc.font(font).fontSize(fontSize).fillColor(color).text(String(text), left + padX, y + (background ? 10 : 4), { width: width - padX * 2, lineGap: 3, oblique: italic });
            doc.y = y + boxHeight + 3;
        }

        // This is the single manager report used for both administrator downloads and MAX delivery.
        doc.font('Noto-Bold').fontSize(18).fillColor(colors.ink).text('ОТЧЁТ ОБ ОСМОТРЕ ГРУЗА', left, doc.y, { width, align: 'center' });
        doc.moveDown(0.25);
        doc.font('Noto-Bold').fontSize(8).fillColor(colors.red).text(WATERMARK_TEXT, left, doc.y, { width, align: 'center' });
        doc.moveDown(0.25);
        doc.font('Noto').fontSize(9).fillColor(colors.muted).text(`Заказ ${order.number || order.id} · версия ${insp.version} от ${date}`, left, doc.y, { width, align: 'center' });
        doc.moveDown(1.1);

        if (insp.type === 'impossible') {
            reportParagraph(`Осмотр невозможен.\nПричина: ${insp.impossible_reason || '—'}`, { background: colors.redBg, leftBorder: colors.red });
        }

        sectionHeading('Данные поручения');
        tableRow('Номер поручения', order.number || '—');
        tableRow('Перевозчик', order.carrier || '—');
        tableRow('Груз', `${cargo.name || '—'}, ${cargo.places ?? '—'} мест, ${cargo.weight ?? '—'} кг`);
        tableRow('Габариты', `${cargo.length ?? '—'} × ${cargo.width ?? '—'} × ${cargo.height ?? '—'} см`);
        tableRow('Маршрут', `${route.from || '—'} → ${route.to || '—'}`);
        tableRow('Время погрузки', route.loading_time || '—');
        tableRow('ТС', `${vehicle.brand || '—'}, ${vehicle.plate || '—'}${vehicle.trailer ? `, прицеп ${vehicle.trailer}` : ''}`);

        sectionHeading('Водитель');
        tableRow('ФИО', fio);
        tableRow('Телефон', insp.inspector?.phone || '—');
        tableRow('MAX user_id', insp.inspector?.user_id || '—');
        tableRow('Подтверждено', date);

        if (insp.type !== 'impossible') {
            sectionHeading('Результаты сравнения');
            const col1 = width * 0.48;
            const col2 = width * 0.22;
            const col3 = width - col1 - col2;
            const headerY = doc.y;
            doc.rect(left, headerY, width, 25).fill(colors.tableHead);
            doc.font('Noto-Bold').fontSize(8).fillColor(colors.ink)
                .text('Пункт', left + 8, headerY + 8, { width: col1 - 12 })
                .text('Результат', left + col1 + 4, headerY + 8, { width: col2 - 8 })
                .text('Комментарий водителя', left + col1 + col2 + 4, headerY + 8, { width: col3 - 8 });
            doc.y = headerY + 25;

            for (const answer of insp.answers || []) {
                const label = String(answer.label || answer.key || '—');
                const result = answer.match ? 'Соответствует' : 'Не совпало';
                const comment = String(answer.comment || '');
                doc.font('Noto').fontSize(9);
                const rowHeight = Math.max(
                    28,
                    doc.heightOfString(label, { width: col1 - 16 }) + 14,
                    doc.heightOfString(result, { width: col2 - 8 }) + 14,
                    doc.heightOfString(comment, { width: col3 - 8 }) + 14
                );
                newPageIfNeeded(rowHeight + 2);
                const y = doc.y;
                doc.font('Noto').fontSize(9).fillColor(colors.ink).text(label, left + 8, y + 7, { width: col1 - 16 });
                doc.font('Noto-Bold').fontSize(8.5).fillColor(answer.match ? '#087a2e' : colors.red).text(result, left + col1 + 4, y + 7, { width: col2 - 8 });
                doc.font('Noto').fontSize(8.5).fillColor(colors.muted).text(comment, left + col1 + col2 + 4, y + 7, { width: col3 - 8 });
                doc.moveTo(left, y + rowHeight).lineTo(left + width, y + rowHeight).lineWidth(0.6).strokeColor(colors.border).stroke();
                doc.y = y + rowHeight;
            }

            if (insp.overall_comment) {
                sectionHeading('Общий комментарий');
                reportParagraph(insp.overall_comment);
            }
        }

        newPageIfNeeded(105);
        doc.moveDown(2.3);
        const signatureY = doc.y;
        const sigGap = 30;
        const sigWidth = (width - sigGap) / 2;
        doc.font('Noto').fontSize(9).fillColor(colors.ink).text('Водитель:', left, signatureY, { width: sigWidth });
        doc.text('Дата:', left + sigWidth + sigGap, signatureY, { width: sigWidth });
        doc.moveDown(3.3);
        const lineY = doc.y;
        doc.moveTo(left, lineY).lineTo(left + sigWidth, lineY).lineWidth(0.7).strokeColor(colors.ink).stroke();
        doc.moveTo(left + sigWidth + sigGap, lineY).lineTo(left + width, lineY).lineWidth(0.7).strokeColor(colors.ink).stroke();
        doc.font('Noto').fontSize(8).fillColor(colors.muted).text(fio, left, lineY + 5, { width: sigWidth });
        doc.text(date, left + sigWidth + sigGap, lineY + 5, { width: sigWidth });
        doc.y = lineY + 25;

        doc.font('Noto').fontSize(7).fillColor(colors.muted).text(`Заказ ${order.id} · Версия ${insp.version} · Сгенерировано ${new Date().toISOString()}`, left, doc.y + 12, { width, align: 'right' });

        const pages = doc.bufferedPageRange();
        for (let page = pages.start; page < pages.start + pages.count; page++) {
            doc.switchToPage(page);
            doc.save();
            doc.translate(doc.page.width / 2, doc.page.height * 0.42);
            doc.rotate(-20);
            doc.font('Noto-Bold').fontSize(25).fillColor('#dc2626').fillOpacity(0.1)
                .text(WATERMARK_TEXT, -270, 0, { width: 540, align: 'center', lineBreak: false });
            doc.restore();
        }
        doc.end();
    });
}

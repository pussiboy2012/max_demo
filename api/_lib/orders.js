import crypto from 'node:crypto';
import { redis } from './redis.js';

const ORDERS_INDEX = 'orders:all';

export const ORDER_STATUS = {
    CREATED: 'created',
    AWAITING_PHONE: 'awaiting_phone',
    AWAITING_FORM: 'awaiting_form',
    AWAITING_REVIEW: 'awaiting_review',   // осмотр получен, диспетчер рассматривает
    RECHECK: 'recheck',                    // назначен повторный осмотр
    IMPOSSIBLE: 'impossible',              // водитель сообщил, что осмотр невозможен
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
};

export const CHECKLIST = [
    { key: 'cargo_name',    label: 'Наименование груза',     positive: 'Соответствует', negative: 'Не совпало' },
    { key: 'places',        label: 'Количество мест',        positive: 'Соответствует', negative: 'Не совпало' },
    { key: 'weight',        label: 'Вес груза',              positive: 'Соответствует', negative: 'Не совпало' },
    { key: 'dimensions',    label: 'Габариты',               positive: 'Соответствует', negative: 'Не совпало' },
    { key: 'packaging',     label: 'Состояние упаковки',     positive: 'Целая',         negative: 'Повреждена' },
    { key: 'marking',       label: 'Маркировка',             positive: 'Читаемая',      negative: 'Нечитаемая' },
    { key: 'docs',          label: 'Документы на груз',      positive: 'В наличии',     negative: 'Отсутствуют' },
    { key: 'vehicle_plate', label: 'Номер ТС',               positive: 'Совпадает',     negative: 'Не совпадает' },
    { key: 'trailer',       label: 'Прицеп/полуприцеп',      positive: 'Совпадает',     negative: 'Не совпадает' },
];

function generateOrderId() {
    return 'ord_' + crypto.randomBytes(4).toString('hex');
}

export async function createOrder({ number, cargo, route, carrier, vehicle, loader }) {
    const id = generateOrderId();
    const now = new Date().toISOString();

    const order = {
        id,
        number: number || '',
        status: ORDER_STATUS.CREATED,
        created_at: now,
        updated_at: now,

        cargo: {
            name: cargo.name || '',
            weight: parseFloat(cargo.weight) || 0,
            places: parseInt(cargo.places, 10) || 0,
            length: parseFloat(cargo.length) || 0,
            width: parseFloat(cargo.width) || 0,
            height: parseFloat(cargo.height) || 0,
        },

        route: {
            from: route.from || '',
            to: route.to || '',
            loading_time: route.loading_time || '',
        },

        carrier: carrier || '',

        vehicle: {
            brand: vehicle?.brand || '',
            plate: vehicle?.plate || '',
            trailer: vehicle?.trailer || '',
        },

        loader: {
            phone_expected: normalizePhone(loader.phone_expected || ''),
            phone_received: null,
            max_user_id: null,
            first_name: null,
            last_name: null,
            username: null,
        },

        inspections: [],          // массив версий осмотра
        current_inspection: 0,    // номер последней версии
        resolution: null,         // резолюция диспетчера

        history: [{ at: now, event: 'created', by: 'admin' }],
    };

    await redis.set(`order:${id}`, order);
    await redis.sadd(ORDERS_INDEX, id);
    return order;
}

export async function getOrder(id) {
    if (!id) return null;
    return await redis.get(`order:${id}`);
}

export async function updateOrder(id, patch, historyEvent = null, by = 'system') {
    const order = await getOrder(id);
    if (!order) return null;
    const now = new Date().toISOString();

    for (const key of Object.keys(patch)) {
        if (patch[key] && typeof patch[key] === 'object' && !Array.isArray(patch[key])) {
            order[key] = { ...(order[key] || {}), ...patch[key] };
        } else {
            order[key] = patch[key];
        }
    }
    order.updated_at = now;
    if (historyEvent) {
        order.history = order.history || [];
        order.history.push({ at: now, event: historyEvent, by });
    }
    await redis.set(`order:${id}`, order);
    return order;
}

/**
 * Добавляет новую версию осмотра. Первая версия — 1, следующая — 2 и т.д.
 */
export async function addInspection(id, inspection) {
    const order = await getOrder(id);
    if (!order) return null;

    const now = new Date().toISOString();
    const nextVersion = (order.current_inspection || 0) + 1;

    const record = {
        version: nextVersion,
        type: inspection.type || 'inspection', // 'inspection' | 'impossible'
        started_at: inspection.started_at || now,
        confirmed_at: now,
        inspector: {
            user_id: inspection.inspector?.user_id || null,
            first_name: inspection.inspector?.first_name || null,
            last_name: inspection.inspector?.last_name || null,
            phone: inspection.inspector?.phone || null,
        },
        answers: inspection.answers || [],
        overall_comment: inspection.overall_comment || '',
        impossible_reason: inspection.impossible_reason || '',
        has_mismatch: (inspection.answers || []).some(a => a.match === false),
        document_generated_at: null,
        document_sent_at: null,
    };

    order.inspections = order.inspections || [];
    order.inspections.push(record);
    order.current_inspection = nextVersion;

    // статус зависит от типа
    if (record.type === 'impossible') {
        order.status = ORDER_STATUS.IMPOSSIBLE;
    } else {
        order.status = ORDER_STATUS.AWAITING_REVIEW;
    }

    order.updated_at = now;
    order.history = order.history || [];
    order.history.push({ at: now, event: `inspection_v${nextVersion}_received`, by: 'loader' });

    await redis.set(`order:${id}`, order);
    return order;
}

export async function deleteOrder(id) {
    if (!id) return false;
    const exists = await redis.exists(`order:${id}`);
    if (!exists) return false;
    await redis.del(`order:${id}`);
    await redis.srem(ORDERS_INDEX, id);
    return true;
}

export async function listOrders({ status } = {}) {
    const ids = (await redis.smembers(ORDERS_INDEX)) || [];
    if (!ids.length) return [];
    const orders = [];
    for (const id of ids) {
        const order = await getOrder(id);
        if (!order) continue;
        if (status && order.status !== status) continue;
        orders.push(order);
    }
    orders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return orders;
}

export function normalizePhone(input) {
    if (!input) return '';
    const digits = String(input).replace(/\D/g, '');
    return digits ? '+' + digits : '';
}


/**
 * Текст SMS для водителя (диспетчер копирует и отправляет вручную).
 */
export function buildSmsText(order, shortLink) {
    if (!shortLink) return null;
    const cargo = order.cargo || {};
    const route = order.route || {};
    return [
        `Заказ ${order.number || order.id}.`,
        `${route.from} → ${route.to}.`,
        `${cargo.name}, ${cargo.places} мест, погрузка ${route.loading_time || '—'}.`,
        `Откройте в MAX: ${shortLink}`,
    ].join(' ');
}

/**
 * Генерирует «длинный» deep-link на бота.
 */
export function buildLoaderLinkRaw(orderId) {
    const botUsername = process.env.BOT_USERNAME;
    if (!botUsername) return null;
    const clean = botUsername.replace('@', '');
    return `https://max.ru/${clean}?start=${orderId}`;
}

/**
 * Сокращает ссылку через Яндекс.Кликер (clck.ru).
 * Если сократить не удалось — возвращает исходную длинную ссылку.
 */
export async function shortenUrl(url) {
    if (!url) return null;
    try {
        const res = await fetch('https://clck.ru/--', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'text/plain',
            },
            body: new URLSearchParams({ url }),
        });
        if (!res.ok) {
            console.error('clck.ru error:', res.status, await res.text());
            return url;
        }
        const short = (await res.text()).trim();
        let shortUrl;
        try { shortUrl = new URL(short); } catch {}
        if (!shortUrl || !['clck.ru', 'www.clck.ru'].includes(shortUrl.hostname)) {
            console.error('clck.ru unexpected response:', short);
            return url;
        }
        return short;
    } catch (err) {
        console.error('clck.ru fetch failed:', err);
        return url;
    }
}

/**
 * Генерирует сокращённый deep-link на бота.
 */
export async function buildLoaderLink(orderId) {
    const raw = buildLoaderLinkRaw(orderId);
    if (!raw) return null;
    return await shortenUrl(raw);
}

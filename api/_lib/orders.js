import crypto from 'node:crypto';
import { redis } from './redis.js';

const ORDERS_INDEX = 'orders:all';

export const ORDER_STATUS = {
    CREATED: 'created',
    AWAITING_PHONE: 'awaiting_phone',
    AWAITING_FORM: 'awaiting_form',
    AWAITING_DOCS: 'awaiting_docs',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
};

function generateOrderId() {
    return 'ord_' + crypto.randomBytes(4).toString('hex');
}

export async function createOrder({ cargo, route, loader }) {
    const id = generateOrderId();
    const now = new Date().toISOString();

    const order = {
        id,
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
            ship_date: route.ship_date || '',
        },
        loader: {
            phone_expected: normalizePhone(loader.phone_expected || ''),
            phone_received: null,
            max_user_id: null,
            first_name: null,
            last_name: null,
            username: null,
        },
        inspection: null,
        document_generated_at: null,
        document_sent_at: null,
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

export function buildLoaderLink(orderId) {
    const botUsername = process.env.BOT_USERNAME;
    if (!botUsername) return null;
    const clean = botUsername.replace('@', '');
    return `https://max.ru/${clean}?start=${orderId}`;
}

// api/_lib/redis.js

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

if (!REDIS_URL || !REDIS_TOKEN) {
    console.error('❌ Не заданы переменные окружения для Upstash Redis!');
}

/**
 * Выполняет произвольную команду Redis через REST API Upstash.
 * @param {string[]} command — [CMD, ...args]
 */
export async function command(cmdArray) {
    const [cmdName, ...args] = cmdArray;
    const encoded = args.map((a) => encodeURIComponent(a)).join('/');
    const url = `${REDIS_URL}/${cmdName}/${encoded}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${REDIS_TOKEN}`,
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Redis ${cmdName} failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    return data.result;
}

export const redis = {
    get: async (key) => {
        const raw = await command(['GET', key]);
        if (raw === null || raw === undefined) return null;
        try {
            return JSON.parse(raw);
        } catch {
            return raw;
        }
    },

    set: (key, value) => {
        const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
        return command(['SET', key, str]);
    },

    del: (key) => command(['DEL', key]),
    exists: (key) => command(['EXISTS', key]),

    // Множества — для индекса заказов
    sadd: (key, member) => command(['SADD', key, member]),
    srem: (key, member) => command(['SREM', key, member]),
    smembers: (key) => command(['SMEMBERS', key]),
};

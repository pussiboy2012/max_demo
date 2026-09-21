// api/_lib/redis.js

// Эти переменные окружения автоматически добавляются интеграцией Vercel
// или задаются вручную в настройках проекта.
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

if (!REDIS_URL || !REDIS_TOKEN) {
    console.error('❌ Не заданы переменные окружения для Upstash Redis!');
    // В реальном приложении лучше выбросить ошибку, чтобы деплой упал сразу.
}

/**
 * Выполняет команду Redis через REST API Upstash.
 * @param {string[]} command — массив, где первый элемент — имя команды, остальные — аргументы.
 * @returns {Promise<any>} — результат выполнения команды.
 */
async function redisCommand(command) {
    const [cmdName, ...args] = command;
    // Формируем URL по правилам Upstash REST API: /COMMAND/arg1/arg2/...
    const url = `${REDIS_URL}/${cmdName}/${args.join('/')}`;

    const response = await fetch(url, {
        method: 'POST', // Используем POST для команд, изменяющих данные, но GET тоже подойдёт для простых чтений.
        headers: {
            Authorization: `Bearer ${REDIS_TOKEN}`,
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Redis command failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    return data.result; // Upstash возвращает результат в поле "result"
}

// Экспортируем удобные обёртки для основных команд
export const redis = {
    /**
     * Получить значение по ключу.
     */
    get: (key) => redisCommand(['GET', key]),

    /**
     * Установить значение по ключу.
     */
    set: (key, value) => {
        // Значение должно быть строкой. Если это объект, его нужно сериализовать.
        const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
        return redisCommand(['SET', key, stringValue]);
    },

    /**
     * Удалить ключ.
     */
    del: (key) => redisCommand(['DEL', key]),

    /**
     * Проверить существование ключа.
     */
    exists: (key) => redisCommand(['EXISTS', key]),
};

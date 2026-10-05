import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as orders from './api/orders.js';
import * as order from './api/order.js';
import * as documents from './api/documents.js';
import * as submit from './api/submit.js';
import * as myOrder from './api/my-order.js';
import * as webhook from './api/webhook.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const API_ROUTES = new Map([
    ['/api/orders', orders],
    ['/api/order', order],
    ['/api/documents', documents],
    ['/api/submit', submit],
    ['/api/my-order', myOrder],
    ['/api/webhook', webhook],
]);

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
};

function sendJson(res, status, body, extraHeaders = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders });
    res.end(JSON.stringify(body));
}

async function readBody(req, maxBytes = 2 * 1024 * 1024) {
    const chunks = [];
    let length = 0;
    for await (const chunk of req) {
        length += chunk.length;
        if (length > maxBytes) throw Object.assign(new Error('Request body is too large'), { status: 413 });
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

async function toWebRequest(req) {
    const proto = req.headers['x-forwarded-proto']?.split(',')[0] || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
    const url = new URL(req.url || '/', `${proto}://${host}`).toString();
    const headers = new Headers();

    for (const [name, rawValue] of Object.entries(req.headers)) {
        if (['connection', 'transfer-encoding', 'upgrade', 'host', 'content-length'].includes(name.toLowerCase())) continue;
        if (Array.isArray(rawValue)) rawValue.forEach(value => headers.append(name, value));
        else if (rawValue !== undefined) headers.set(name, rawValue);
    }

    const method = (req.method || 'GET').toUpperCase();
    const init = { method, headers };
    if (!['GET', 'HEAD'].includes(method)) {
        init.body = await readBody(req);
        // Node.js requires this when constructing a Fetch Request with a body.
        init.duplex = 'half';
    }
    return new Request(url, init);
}

async function handleApi(req, res, pathname) {
    const route = API_ROUTES.get(pathname);
    if (!route) return sendJson(res, 404, { error: 'API-маршрут не найден' });

    const handler = route[(req.method || 'GET').toUpperCase()];
    if (!handler) {
        const allowed = Object.keys(route).filter(key => ['GET', 'POST', 'PATCH', 'DELETE'].includes(key));
        return sendJson(res, 405, { error: 'Метод не поддерживается' }, { Allow: allowed.join(', ') });
    }

    try {
        const request = await toWebRequest(req);
        const response = await handler(request);
        const headers = Object.fromEntries(response.headers.entries());
        res.writeHead(response.status, headers);
        if (!response.body || response.status === 204 || response.status === 304) return res.end();
        res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
        console.error(`API ${req.method} ${pathname} failed:`, error);
        sendJson(res, error.status || 500, { error: error.status === 413 ? error.message : 'Внутренняя ошибка сервера' });
    }
}

async function handleStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' });
        return res.end();
    }

    if (pathname === '/favicon.ico') {
        res.writeHead(204);
        return res.end();
    }

    const requestedFile = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!['index.html', 'admin.html'].includes(requestedFile)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Not found');
    }

    try {
        const body = await readFile(path.join(ROOT, requestedFile));
        res.writeHead(200, {
            'Content-Type': MIME_TYPES[path.extname(requestedFile)] || 'application/octet-stream',
            'Content-Length': body.length,
            'Cache-Control': 'no-cache',
        });
        res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) {
        console.error(`Static file ${requestedFile} failed:`, error);
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Не удалось загрузить страницу');
    }
}

const server = http.createServer((req, res) => {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    if (pathname === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify({ status: 'ok' }));
    }
    if (pathname.startsWith('/api/')) return void handleApi(req, res, pathname);
    return void handleStatic(req, res, pathname);
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, '0.0.0.0', () => {
    console.log(`Cargo app listening on 0.0.0.0:${port}`);
    const missing = [];
    if (!(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL)) missing.push('UPSTASH_REDIS_REST_URL');
    if (!(process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN)) missing.push('UPSTASH_REDIS_REST_TOKEN');
    if (!process.env.ADMIN_PASSWORD) missing.push('ADMIN_PASSWORD');
    if (!process.env.MAX_BOT_TOKEN) missing.push('MAX_BOT_TOKEN');
    if (!process.env.BOT_USERNAME) missing.push('BOT_USERNAME');
    if (missing.length) console.error(`Missing required environment variables: ${missing.join(', ')}`);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
        console.log(`${signal} received; closing HTTP server`);
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(1), 10_000).unref();
    });
}

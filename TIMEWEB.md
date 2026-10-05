# Деплой Next.js на Timeweb Cloud

## Настройки приложения

Проект работает на Next.js App Router: Next.js отдаёт страницы и обрабатывает API. В App Platform выберите frontend-фреймворк **Next.js** и обязательно включите **SSR**. Без SSR платформа отдаёт только статические файлы, и `/api/*` не работает.

В расширенных настройках укажите корень репозитория как директорию проекта и проверьте команды:

- Сборка: `npm run build`
- Запуск: `npm start`
- Проверка состояния: `/healthz`
- Версия Node.js: 22

`npm start` запускает `next start` на `0.0.0.0`; Next.js использует порт `PORT`, заданный платформой, или `3000` локально. Для Next.js на Timeweb включите SSR и настройте сервер приложения отдельно от статической сборки. См. [инструкцию Timeweb](https://timeweb.cloud/docs/apps/deploying-frontend-apps) и [документацию Next.js по Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers).

## Переменные окружения

Добавьте их в настройках приложения Timeweb, не в репозиторий:

| Переменная | Для чего нужна |
| --- | --- |
| `UPSTASH_REDIS_REST_URL` | HTTPS URL базы Upstash Redis |
| `UPSTASH_REDIS_REST_TOKEN` | Токен Upstash с правом чтения и записи |
| `ADMIN_PASSWORD` | Пароль входа в панель администратора |
| `MAX_BOT_TOKEN` | Токен MAX бота |
| `MAX_WEBHOOK_SECRET` | Секрет webhook; если задан, он должен совпадать с настройкой webhook в MAX |
| `BOT_USERNAME` | Имя бота для формирования ссылок |

Для обратной совместимости Redis также читает `KV_REST_API_URL` и `KV_REST_API_TOKEN`.

## После деплоя

1. Дождитесь успешной сборки и запуска SSR-приложения.
2. Откройте `https://<домен>/healthz`: ответ должен быть `{"status":"ok"}`.
3. Проверьте `/`, `/admin.html` и API. `GET /api/orders` без пароля администратора должен вернуть JSON-ошибку `401`, а не HTML.
4. Установите webhook MAX на `https://<домен>/api/webhook`.

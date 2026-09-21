const express = require('express');
const bodyParser = require('body-parser');
const { validateInitData } = require('max-validate-init-data');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ВАЖНО: Замени на токен твоего бота из настроек на платформе MAX для партнёров
const BOT_TOKEN = 'ТВОЙ_ТОКЕН_БОТА_ЗДЕСЬ'; 

app.use(bodyParser.json());
// Раздаём статические файлы (index.html) из текущей папки
app.use(express.static(path.join(__dirname, 'public'))); 

app.post('/api/submit', (req, res) => {
    const { formData, initData } = req.body;

    if (!initData) {
        return res.status(400).json({ error: 'Отсутствуют данные для валидации' });
    }

    // 1. Проверяем подлинность данных с помощью библиотеки
    const { data, error } = validateInitData({ initData, botToken: BOT_TOKEN });

    if (error) {
        console.error('Ошибка валидации:', error);
        return res.status(403).json({ error: 'Недействительные данные пользователя' });
    }

    // 2. Если проверка пройдена, у нас есть доверенные данные пользователя
    const user = data.user;
    console.log('Пользователь:', user.first_name, user.id);
    console.log('Данные из формы:', formData);

    // 3. Здесь твоя логика: сохранить в БД, отправить уведомление и т.д.
    // Например, можно отправить сообщение пользователю от имени бота через Bot API.

    res.json({ success: true, message: 'Данные получены и проверены' });
});

app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
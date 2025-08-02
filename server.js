const express = require('express');
const cors = require('cors');
const redis = require('redis');
const app = express();
require('dotenv').config();

const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json({ strict: true }));

const redisClient = redis.createClient({
  url: process.env.REDIS_URL
});

redisClient.on('error', (err) => {
  console.log('Redis Client Error', err);
});

(async () => {
  try {
    await redisClient.connect();
    console.log('Connected to Redis successfully');
  } catch (err) {
    console.error('Failed to connect to Redis:', err);
  }
})();

function generateUniqueKey(length = 16) {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const getRandomKey = () => {
    let result = '';
    for (let i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
  };

  return new Promise((resolve, reject) => {
    let attempt = 0;
    const maxAttempts = 5;
    async function tryGenerate() {
      const newKey = getRandomKey();
      const exists = await redisClient.exists(newKey);
      if (!exists && attempt < maxAttempts) return resolve(newKey);
      if (++attempt >= maxAttempts) return reject(new Error('Не удалось сгенерировать уникальный ключ'));
      tryGenerate();
    }
    tryGenerate();
  });
}

app.get('/ping', (req, res) => {
  res.send('pong');
});

app.post('/verify', async (req, res) => {
  const { key } = req.body || {};
  if (!key || typeof key !== 'string') {
    return res.status(400).json({ isValid: false, message: 'Неверный формат ключа' });
  }
  try {
    const keyData = await redisClient.get(key);
    if (!keyData) {
      return res.json({ isValid: false, message: 'Неверный ключ' });
    }
    const { username, expiresAt } = JSON.parse(keyData);
    const now = new Date();
    if (expiresAt && new Date(expiresAt) <= now) {
      await redisClient.del(key);
      return res.json({ isValid: false, message: 'Ключ истек' });
    }
    res.json({ isValid: true, message: 'Доступ разрешен', username });
  } catch (err) {
    console.error('Ошибка проверки ключа:', err.message);
    return res.status(500).json({ isValid: false, message: 'Ошибка сервера' });
  }
});

app.post('/add-key', async (req, res) => {
  const { key, username, expiresIn } = req.body || {};
  const apiKey = req.headers['x-api-key'] || process.env.API_KEY;
  if (!key || !username || typeof key !== 'string' || typeof username !== 'string') {
    return res.status(400).json({ message: 'Неверный формат данных' });
  }
  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ message: 'Недостаточно прав' });
  }
  let expiresAt = null;
  if (expiresIn) {
    if (typeof expiresIn === 'number' && expiresIn > 0) {
      expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    } else if (typeof expiresIn === 'string' && !isNaN(Date.parse(expiresIn))) {
      expiresAt = new Date(expiresIn).toISOString();
    } else {
      return res.status(400).json({ message: 'Неверный формат expiresIn' });
    }
  }
  try {
    await redisClient.set(key, JSON.stringify({ username, createdAt: new Date().toISOString(), expiresAt }));
    if (expiresAt) {
      await redisClient.expire(key, Math.floor((new Date(expiresAt) - new Date()) / 1000));
    }
    res.json({ message: 'Ключ добавлен', key, expiresAt });
  } catch (err) {
    console.error('Ошибка добавления ключа:', err.message);
    return res.status(500).json({ message: 'Ошибка добавления ключа: ' + err.message });
  }
});

app.post('/delete-key', async (req, res) => {
  const { key } = req.body || {};
  const apiKey = req.headers['x-api-key'] || process.env.API_KEY;
  if (!key || typeof key !== 'string') {
    return res.status(400).json({ message: 'Неверный формат ключа' });
  }
  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ message: 'Недостаточно прав' });
  }
  try {
    const deleted = await redisClient.del(key);
    res.json({ message: deleted ? 'Ключ удален' : 'Ключ не найден', success: !!deleted });
  } catch (err) {
    console.error('Ошибка удаления ключа:', err.message);
    return res.status(500).json({ message: 'Ошибка удаления ключа' });
  }
});

app.get('/get-keys', async (req, res) => {
  const apiKey = req.headers['x-api-key'] || process.env.API_KEY;
  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ message: 'Недостаточно прав' });
  }
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;

  try {
    const keys = await redisClient.keys('*');
    const total = keys.length;
    const totalPages = Math.ceil(total / limit);
    const start = offset;
    const end = Math.min(offset + limit, total);
    const paginatedKeys = keys.slice(start, end).map(async key => {
      const data = await redisClient.get(key);
      return { key, ...JSON.parse(data) };
    });
    const resolvedKeys = await Promise.all(paginatedKeys);

    res.set('Content-Type', 'application/json');
    res.send(JSON.stringify({
      keys: resolvedKeys,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    }, null, 2));
  } catch (err) {
    console.error('Ошибка получения ключей:', err.message);
    return res.status(500).json({ message: 'Ошибка сервера' });
  }
});

app.post('/generate-key', async (req, res) => {
  const { username, expiresIn } = req.body || {};
  const apiKey = req.headers['x-api-key'] || process.env.API_KEY;
  if (!username || typeof username !== 'string') {
    return res.status(400).json({ message: 'Укажите username' });
  }
  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ message: 'Недостаточно прав' });
  }

  try {
    const newKey = await generateUniqueKey();
    let expiresAt = null;
    if (expiresIn) {
      if (typeof expiresIn === 'number' && expiresIn > 0) {
        expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
      } else if (typeof expiresIn === 'string' && !isNaN(Date.parse(expiresIn))) {
        expiresAt = new Date(expiresIn).toISOString();
      } else {
        return res.status(400).json({ message: 'Неверный формат expiresIn' });
      }
    }
    await redisClient.set(newKey, JSON.stringify({ username, createdAt: new Date().toISOString(), expiresAt }));
    if (expiresAt) {
      await redisClient.expire(newKey, Math.floor((new Date(expiresAt) - new Date()) / 1000));
    }
    res.json({ message: 'Ключ сгенерирован и добавлен', key: newKey, expiresAt });
  } catch (err) {
    console.error('Ошибка генерации ключа:', err.message);
    res.status(500).json({ message: err.message });
  }
});

setInterval(() => {
  console.log('Keep-alive ping at', new Date().toISOString());
}, 300000);

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Внутренняя ошибка сервера' });
});

app.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));
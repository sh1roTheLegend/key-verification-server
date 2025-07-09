const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const app = express();
require('dotenv').config();

const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json({ strict: true }));

const db = new sqlite3.Database('./keys.db', (err) => {
  if (err) {
    console.error('Ошибка инициализации базы данных:', err.message);
  } else {
    db.run(`CREATE TABLE IF NOT EXISTS keys (
      key TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      createdAt TEXT NOT NULL
    )`);
  }
});

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
    function tryGenerate() {
      const newKey = getRandomKey();
      db.get('SELECT key FROM keys WHERE key = ?', [newKey], (err, row) => {
        if (err) return reject(err);
        if (!row && attempt < maxAttempts) return resolve(newKey);
        if (++attempt >= maxAttempts) return reject(new Error('Не удалось сгенерировать уникальный ключ'));
        tryGenerate();
      });
    }
    tryGenerate();
  });
}

app.post('/verify', (req, res) => {
  const { key } = req.body || {};
  if (!key || typeof key !== 'string') {
    return res.status(400).json({ isValid: false, message: 'Неверный формат ключа' });
  }
  db.get('SELECT key FROM keys WHERE key = ?', [key], (err, row) => {
    if (err) return res.status(500).json({ isValid: false, message: 'Ошибка сервера' });
    res.json({ isValid: !!row, message: row ? 'Доступ разрешен' : 'Неверный ключ' });
  });
});

app.post('/add-key', (req, res) => {
  const { key, userId } = req.body || {};
  const apiKey = req.headers['x-api-key'] || process.env.API_KEY;
  if (!key || !userId || typeof key !== 'string' || typeof userId !== 'string') {
    return res.status(400).json({ message: 'Неверный формат данных' });
  }
  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ message: 'Недостаточно прав' });
  }
  db.run(
    'INSERT INTO keys (key, userId, createdAt) VALUES (?, ?, ?)',
    [key, userId, new Date().toISOString()],
    (err) => {
      if (err) return res.status(500).json({ message: 'Ошибка добавления ключа' });
      res.json({ message: 'Ключ добавлен', key });
    }
  );
});

app.post('/delete-key', (req, res) => {
  const { key } = req.body || {};
  const apiKey = req.headers['x-api-key'] || process.env.API_KEY;
  if (!key || typeof key !== 'string') {
    return res.status(400).json({ message: 'Неверный формат ключа' });
  }
  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ message: 'Недостаточно прав' });
  }
  db.run('DELETE FROM keys WHERE key = ?', [key], (err) => {
    if (err) return res.status(500).json({ message: 'Ошибка удаления ключа' });
    db.get('SELECT key FROM keys WHERE key = ?', [key], (err, row) => {
      res.json({ message: row ? 'Ключ не удален' : 'Ключ удален', success: !row });
    });
  });
});

app.get('/get-keys', (req, res) => {
  const apiKey = req.headers['x-api-key'] || process.env.API_KEY;
  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ message: 'Недостаточно прав' });
  }
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;

  db.all('SELECT * FROM keys LIMIT ? OFFSET ?', [limit, offset], (err, rows) => {
    if (err) return res.status(500).json({ message: 'Ошибка сервера' });
    db.get('SELECT COUNT(*) as total FROM keys', (err, countRow) => {
      if (err) return res.status(500).json({ message: 'Ошибка сервера' });
      const total = countRow.total;
      const totalPages = Math.ceil(total / limit);
      res.set('Content-Type', 'application/json');
      res.send(JSON.stringify({
        keys: rows,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      }, null, 2));
    });
  });
});

app.post('/generate-key', (req, res) => {
  const { userId } = req.body || {};
  const apiKey = req.headers['x-api-key'] || process.env.API_KEY;
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ message: 'Укажите userId' });
  }
  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ message: 'Недостаточно прав' });
  }

  generateUniqueKey()
    .then(newKey => {
      db.run(
        'INSERT INTO keys (key, userId, createdAt) VALUES (?, ?, ?)',
        [newKey, userId, new Date().toISOString()],
        (err) => {
          if (err) return res.status(500).json({ message: 'Ошибка добавления сгенерированного ключа' });
          res.json({ message: 'Ключ сгенерирован и добавлен', key: newKey });
        }
      );
    })
    .catch(err => res.status(500).json({ message: err.message }));
});

app.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));
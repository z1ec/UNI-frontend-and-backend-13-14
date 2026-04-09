const express = require('express');
const fs = require('fs');
const http = require('http');
const https = require('https');
const socketIo = require('socket.io');
const webpush = require('web-push');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

const PORT = Number(process.env.PORT || 3001);
const PUBLIC_VAPID_KEY = process.env.PUBLIC_VAPID_KEY || 'BLvYYpVmFG_E4IyLb0xkZtcPHCnuqZi2fYP6Dl8TUNWl2PyyxaL-LRYRzaf8vFBtBPa-d-HOTXXU-S6R_RSPDR0';
const PRIVATE_VAPID_KEY = process.env.PRIVATE_VAPID_KEY || 'LDmI_F8NV3UWtCdsQ82Hxx0SXJ-6n4vLnhbkXlOoq3k';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:student@example.com';
const SSL_KEY_PATH = process.env.SSL_KEY_PATH || path.join(__dirname, 'localhost-key.pem');
const SSL_CERT_PATH = process.env.SSL_CERT_PATH || path.join(__dirname, 'localhost.pem');
const isVapidConfigured =
  !PUBLIC_VAPID_KEY.startsWith('PASTE_YOUR_') &&
  !PRIVATE_VAPID_KEY.startsWith('PASTE_YOUR_');

if (isVapidConfigured) {
  webpush.setVapidDetails(VAPID_SUBJECT, PUBLIC_VAPID_KEY, PRIVATE_VAPID_KEY);
} else {
  console.warn('VAPID keys are not configured. Push notifications will be disabled.');
}

const app = express();
const hasLocalCertificates = fs.existsSync(SSL_KEY_PATH) && fs.existsSync(SSL_CERT_PATH);
const server = hasLocalCertificates
  ? https.createServer(
    {
      key: fs.readFileSync(SSL_KEY_PATH),
      cert: fs.readFileSync(SSL_CERT_PATH)
    },
    app
  )
  : http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

let subscriptions = [];

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, './')));

app.post('/subscribe', (req, res) => {
  const subscription = req.body;

  if (!subscription || !subscription.endpoint) {
    res.status(400).json({ message: 'Некорректная подписка' });
    return;
  }

  const alreadyExists = subscriptions.some((item) => item.endpoint === subscription.endpoint);
  if (!alreadyExists) {
    subscriptions.push(subscription);
  }

  res.status(201).json({ message: 'Подписка сохранена' });
});

app.post('/unsubscribe', (req, res) => {
  const { endpoint } = req.body || {};
  subscriptions = subscriptions.filter((subscription) => subscription.endpoint !== endpoint);
  res.status(200).json({ message: 'Подписка удалена' });
});

io.on('connection', (socket) => {
  console.log(`Клиент подключён: ${socket.id}`);

  socket.on('newTask', (task) => {
    io.emit('taskAdded', task);

    if (!isVapidConfigured) {
      return;
    }

    const payload = JSON.stringify({
      title: 'Новая задача',
      body: task.text
    });

    subscriptions.forEach((subscription) => {
      webpush.sendNotification(subscription, payload).catch((error) => {
        console.error('Push error:', error.message);
      });
    });
  });

  socket.on('disconnect', () => {
    console.log(`Клиент отключён: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  const protocol = hasLocalCertificates ? 'https' : 'http';
  console.log(`Сервер запущен на ${protocol}://localhost:${PORT}`);
});

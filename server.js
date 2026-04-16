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
const reminders = new Map();

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

function sendPush(payload) {
  if (!isVapidConfigured) {
    return;
  }

  subscriptions.forEach((subscription) => {
    webpush.sendNotification(subscription, JSON.stringify(payload)).catch((error) => {
      console.error('Push error:', error.message);
    });
  });
}

function scheduleReminder({ id, text, reminderTime }, title = 'Напоминание') {
  const reminderId = Number(id);
  const targetTime = Number(reminderTime);
  const delay = targetTime - Date.now();

  if (!reminderId || !text || Number.isNaN(targetTime) || delay <= 0) {
    return false;
  }

  const existingReminder = reminders.get(reminderId);
  if (existingReminder && existingReminder.timeoutId) {
    clearTimeout(existingReminder.timeoutId);
  }

  const timeoutId = setTimeout(() => {
    sendPush({
      title,
      body: text,
      reminderId
    });

    reminders.set(reminderId, {
      timeoutId: null,
      text,
      reminderTime: targetTime,
      sentAt: Date.now()
    });
  }, delay);

  reminders.set(reminderId, {
    timeoutId,
    text,
    reminderTime: targetTime
  });

  return true;
}

function cancelReminder(id) {
  const reminderId = Number(id);
  const reminder = reminders.get(reminderId);

  if (!reminder) {
    return false;
  }

  if (reminder.timeoutId) {
    clearTimeout(reminder.timeoutId);
  }
  reminders.delete(reminderId);
  return true;
}

app.post('/snooze', (req, res) => {
  const reminderId = Number(req.query.reminderId);
  const reminder = reminders.get(reminderId);

  if (!reminder) {
    res.status(404).json({ error: 'Reminder not found' });
    return;
  }

  const snoozeDelay = 5 * 60 * 1000;
  scheduleReminder({
    id: reminderId,
    text: reminder.text,
    reminderTime: Date.now() + snoozeDelay
  }, 'Напоминание отложено');

  res.status(200).json({ message: 'Reminder snoozed for 5 minutes' });
});

io.on('connection', (socket) => {
  console.log(`Клиент подключён: ${socket.id}`);

  socket.on('newTask', (task) => {
    io.emit('taskAdded', task);
    sendPush({
      title: 'Новая задача',
      body: task.text
    });
  });

  socket.on('newReminder', (reminder) => {
    const isScheduled = scheduleReminder(reminder);

    if (isScheduled) {
      io.emit('taskAdded', {
        text: reminder.text,
        timestamp: Date.now()
      });
      console.log(`Напоминание ${reminder.id} запланировано на ${new Date(reminder.reminderTime).toLocaleString('ru-RU')}`);
    }
  });

  socket.on('cancelReminder', ({ id } = {}) => {
    if (cancelReminder(id)) {
      console.log(`Напоминание ${id} отменено`);
    }
  });

  socket.on('disconnect', () => {
    console.log(`Клиент отключён: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  const protocol = hasLocalCertificates ? 'https' : 'http';
  console.log(`Сервер запущен на ${protocol}://localhost:${PORT}`);
});

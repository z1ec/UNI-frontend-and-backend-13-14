const contentDiv = document.getElementById('app-content');
const homeBtn = document.getElementById('home-btn');
const aboutBtn = document.getElementById('about-btn');
const enablePushBtn = document.getElementById('enable-push');
const disablePushBtn = document.getElementById('disable-push');
const statusLine = document.getElementById('status-line');

const SERVER_URL = `${window.location.protocol}//${window.location.hostname}:3001`;
const PUBLIC_VAPID_KEY = window.PUBLIC_VAPID_KEY || 'BLvYYpVmFG_E4IyLb0xkZtcPHCnuqZi2fYP6Dl8TUNWl2PyyxaL-LRYRzaf8vFBtBPa-d-HOTXXU-S6R_RSPDR0';
const socket = typeof io === 'function' ? io(SERVER_URL) : null;

function setStatus(message) {
  statusLine.textContent = message;
}

function setActiveButton(activeId) {
  [homeBtn, aboutBtn].forEach((btn) => btn.classList.remove('active'));
  document.getElementById(activeId).classList.add('active');
}

function escapeHtml(str) {
  return str.replace(/[&<>"]/g, (char) => {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;'
    };
    return map[char] || char;
  });
}

function formatDate(dateValue) {
  if (!dateValue) {
    return 'Без напоминания';
  }

  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return 'Без напоминания';
  }

  return date.toLocaleString('ru-RU');
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

async function loadContent(page) {
  try {
    const response = await fetch(`/content/${page}.html`);
    if (!response.ok) {
      throw new Error(`Не удалось загрузить страницу ${page}`);
    }

    contentDiv.innerHTML = await response.text();

    if (page === 'home') {
      initNotes();
    }
  } catch (error) {
    contentDiv.innerHTML = '<div class="loading-state">Ошибка загрузки страницы.</div>';
    console.error(error);
  }
}

function loadNotes() {
  const list = document.getElementById('notes-list');
  const counter = document.getElementById('notes-counter');
  const notes = JSON.parse(localStorage.getItem('notes') || '[]').map((note) => {
    if (typeof note === 'string') {
      return {
        id: Date.now() + Math.random(),
        text: note,
        datetime: ''
      };
    }

    return note;
  });

  if (!list) {
    return;
  }

  if (!notes.length) {
    list.innerHTML = '<li class="empty-state">Пока нет заметок. Добавьте первую запись.</li>';
  } else {
    list.innerHTML = notes.map((note) => `
      <li class="note-item">
        <div class="note-row">
          <div>
            <p class="note-text">${escapeHtml(note.text)}</p>
            <span class="note-meta">${formatDate(note.datetime)}</span>
          </div>
          <button class="action-btn action-btn-danger delete-btn" type="button" data-id="${note.id}">
            Удалить
          </button>
        </div>
      </li>
    `).join('');
  }

  if (counter) {
    counter.textContent = `${notes.length} ${notes.length === 1 ? 'запись' : notes.length < 5 ? 'записи' : 'записей'}`;
  }

  document.querySelectorAll('.delete-btn').forEach((button) => {
    button.addEventListener('click', () => {
      deleteNote(Number(button.dataset.id));
    });
  });
}

function deleteNote(id) {
  const notes = JSON.parse(localStorage.getItem('notes') || '[]').map((note) => (
    typeof note === 'string'
      ? { id: Date.now() + Math.random(), text: note, datetime: '' }
      : note
  ));
  const filteredNotes = notes.filter((note) => note.id !== id);
  localStorage.setItem('notes', JSON.stringify(filteredNotes));
  loadNotes();
}

function addNote(text, datetime) {
  const notes = JSON.parse(localStorage.getItem('notes') || '[]').map((note) => (
    typeof note === 'string'
      ? { id: Date.now() + Math.random(), text: note, datetime: '' }
      : note
  ));
  const newNote = {
    id: Date.now(),
    text,
    datetime: datetime || ''
  };

  notes.push(newNote);
  localStorage.setItem('notes', JSON.stringify(notes));
  loadNotes();

  if (socket) {
    socket.emit('newTask', {
      text,
      datetime: newNote.datetime,
      timestamp: Date.now()
    });
  }
}

function initNotes() {
  const form = document.getElementById('note-form');
  const input = document.getElementById('note-input');
  const datetimeInput = document.getElementById('note-datetime');

  if (!form || !input || !datetimeInput) {
    return;
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value.trim();
    const datetime = datetimeInput.value;

    if (!text) {
      return;
    }

    addNote(text, datetime);
    input.value = '';
    datetimeInput.value = '';
    setStatus('Заметка сохранена локально.');
  });

  loadNotes();
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }

  return outputArray;
}

async function subscribeToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    setStatus('Push-уведомления не поддерживаются в этом браузере.');
    return;
  }

  if (PUBLIC_VAPID_KEY === 'PASTE_YOUR_PUBLIC_VAPID_KEY_HERE') {
    setStatus('Укажите PUBLIC_VAPID_KEY в app.js или через window.PUBLIC_VAPID_KEY.');
    return;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const existingSubscription = await registration.pushManager.getSubscription();
    const subscription = existingSubscription || await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(PUBLIC_VAPID_KEY)
    });

    await fetch(`${SERVER_URL}/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(subscription)
    });

    enablePushBtn.classList.add('hidden');
    disablePushBtn.classList.remove('hidden');
    setStatus('Push-уведомления включены.');
  } catch (error) {
    console.error('Ошибка подписки на push:', error);
    setStatus('Не удалось включить push-уведомления.');
  }
}

async function unsubscribeFromPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (subscription) {
      await fetch(`${SERVER_URL}/unsubscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          endpoint: subscription.endpoint
        })
      });

      await subscription.unsubscribe();
    }

    disablePushBtn.classList.add('hidden');
    enablePushBtn.classList.remove('hidden');
    setStatus('Push-уведомления отключены.');
  } catch (error) {
    console.error('Ошибка отписки от push:', error);
    setStatus('Не удалось отключить push-уведомления.');
  }
}

async function syncPushButtons(registration) {
  if (!enablePushBtn || !disablePushBtn || !registration.pushManager) {
    return;
  }

  const subscription = await registration.pushManager.getSubscription();

  if (subscription) {
    enablePushBtn.classList.add('hidden');
    disablePushBtn.classList.remove('hidden');
  } else {
    disablePushBtn.classList.add('hidden');
    enablePushBtn.classList.remove('hidden');
  }
}

homeBtn.addEventListener('click', () => {
  setActiveButton('home-btn');
  loadContent('home');
});

aboutBtn.addEventListener('click', () => {
  setActiveButton('about-btn');
  loadContent('about');
});

enablePushBtn.addEventListener('click', async () => {
  if (Notification.permission === 'denied') {
    setStatus('Уведомления запрещены в настройках браузера.');
    return;
  }

  if (Notification.permission === 'default') {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      setStatus('Необходимо разрешить уведомления.');
      return;
    }
  }

  await subscribeToPush();
});

disablePushBtn.addEventListener('click', async () => {
  await unsubscribeFromPush();
});

if (socket) {
  socket.on('connect', () => {
    setStatus(`WebSocket подключён: ${socket.id}`);
  });

  socket.on('taskAdded', (task) => {
    showToast(`Новая задача: ${task.text}`);
    setStatus(`Получена задача от другого клиента: ${task.text}`);
  });
}

loadContent('home');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      await syncPushButtons(registration);
      setStatus('Service Worker зарегистрирован.');
    } catch (error) {
      console.error('Ошибка регистрации Service Worker:', error);
      setStatus('Не удалось зарегистрировать Service Worker.');
    }
  });
}

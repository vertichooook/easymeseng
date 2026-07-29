const state = {
  me: null,
  socket: null,
  rooms: [],
  users: [],
  onlineIds: new Set(),
  chat: { type: 'room', id: 1, title: 'general' },
  typing: new Map(),
  recorder: null,
  chunks: []
};

const el = {
  sidebar: document.querySelector('#sidebar'),
  rooms: document.querySelector('#roomsList'),
  users: document.querySelector('#usersList'),
  messages: document.querySelector('#messages'),
  title: document.querySelector('#chatTitle'),
  status: document.querySelector('#connectionStatus'),
  form: document.querySelector('#messageForm'),
  input: document.querySelector('#messageInput'),
  fileInput: document.querySelector('#fileInput'),
  attachButton: document.querySelector('#attachButton'),
  voiceButton: document.querySelector('#voiceButton'),
  videoButton: document.querySelector('#videoButton'),
  typing: document.querySelector('#typing'),
  toast: document.querySelector('#toast')
};

const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
}[char]));

async function api(path, options = {}) {
  const headers = options.body instanceof FormData ? options.headers || {} : { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const response = await fetch(path, { headers, ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Ошибка запроса.');
  return payload;
}

function toast(message) {
  el.toast.textContent = message;
  el.toast.classList.add('show');
  setTimeout(() => el.toast.classList.remove('show'), 2600);
}

function initials(user) {
  return escapeHtml((user?.username || '?').slice(0, 2).toUpperCase());
}

function avatar(user, size = '') {
  const cls = `avatar ${size}`;
  if (user?.avatar_url) return `<img class="${cls}" src="${escapeHtml(user.avatar_url)}" alt="">`;
  return `<span class="${cls}">${initials(user)}</span>`;
}

function formatTime(value) {
  return new Date(`${value}Z`).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
}

function renderLists() {
  el.rooms.innerHTML = state.rooms.map((room) => `
    <button class="list-item ${state.chat.type === 'room' && state.chat.id === room.id ? 'active' : ''}" data-room="${room.id}">
      <span># ${escapeHtml(room.name)}</span>
    </button>
  `).join('');
  el.users.innerHTML = state.users.map((user) => `
    <button class="list-item ${state.chat.type === 'private' && state.chat.id === user.id ? 'active' : ''}" data-user="${user.id}">
      ${avatar(user, 'small')}
      <span>${escapeHtml(user.username)}</span>
      <small><i class="dot ${state.onlineIds.has(user.id) ? 'online' : ''}"></i>${state.onlineIds.has(user.id) ? 'online' : 'offline'}</small>
    </button>
  `).join('');
}

function attachmentHtml(message) {
  if (!message.attachment_url) return '';
  const url = escapeHtml(message.attachment_url);
  const name = escapeHtml(message.attachment_name || 'media');
  if (message.attachment_type === 'image') return `<img class="media image-media" src="${url}" alt="${name}">`;
  if (message.attachment_type === 'video') return `<video class="media" src="${url}" controls playsinline></video>`;
  if (message.attachment_type === 'audio') return `<audio class="media audio-media" src="${url}" controls></audio>`;
  return `<a href="${url}" target="_blank" rel="noopener">${name}</a>`;
}

function renderMessage(message, type = state.chat.type) {
  const mine = type === 'room' ? message.user_id === state.me.id : message.sender_id === state.me.id;
  const author = type === 'room' ? message.username : message.sender_username;
  const authorAvatar = type === 'room'
    ? { username: message.username, avatar_url: message.avatar_url }
    : { username: message.sender_username, avatar_url: message.sender_avatar_url };
  return `
    <article class="message ${mine ? 'mine' : ''} ${message.deleted_at ? 'deleted' : ''}" data-message-id="${message.id}" data-message-type="${type}">
      ${avatar(authorAvatar, 'small')}
      <div class="message-content">
        <div class="meta">
          <strong>${escapeHtml(author)}</strong>
          <time>${formatTime(message.created_at)}</time>
          <button class="message-action" type="button" data-delete-self="${message.id}" title="Удалить у меня">у меня</button>
          ${mine && !message.deleted_at ? `<button class="message-action danger" type="button" data-delete-all="${message.id}" title="Удалить у всех">у всех</button>` : ''}
        </div>
        ${message.deleted_at ? '<p class="deleted-text">Сообщение удалено</p>' : `${message.body ? `<p>${escapeHtml(message.body)}</p>` : ''}${attachmentHtml(message)}`}
      </div>
    </article>
  `;
}

function addMessage(message, type) {
  el.messages.insertAdjacentHTML('beforeend', renderMessage(message, type));
  el.messages.scrollTop = el.messages.scrollHeight;
}

function replaceMessage(message, type) {
  const current = document.querySelector(`[data-message-type="${type}"][data-message-id="${message.id}"]`);
  if (current) current.outerHTML = renderMessage(message, type);
}

function removeMessage(messageId, type) {
  document.querySelector(`[data-message-type="${type}"][data-message-id="${messageId}"]`)?.remove();
}

async function openRoom(room) {
  if (!room) return;
  if (state.chat.type === 'room' && state.socket) state.socket.emit('room:leave', { roomId: state.chat.id });
  state.chat = { type: 'room', id: room.id, title: room.name };
  el.title.textContent = `# ${room.name}`;
  renderLists();
  const data = await api(`/api/rooms/${room.id}/messages`);
  el.messages.innerHTML = data.messages.map((msg) => renderMessage(msg, 'room')).join('');
  state.socket?.emit('room:join', { roomId: room.id }, (ack) => ack?.error && toast(ack.error));
  el.messages.scrollTop = el.messages.scrollHeight;
}

async function openPrivate(user) {
  if (!user) return;
  state.chat = { type: 'private', id: user.id, title: user.username };
  el.title.textContent = `@ ${user.username}`;
  renderLists();
  const data = await api(`/api/private/${user.id}/messages`);
  el.messages.innerHTML = data.messages.map((msg) => renderMessage(msg, 'private')).join('');
  el.messages.scrollTop = el.messages.scrollHeight;
}

async function refreshData() {
  const [rooms, users] = await Promise.all([api('/api/rooms'), api('/api/users')]);
  state.rooms = rooms.rooms;
  state.users = users.users;
  renderLists();
}

async function uploadFile(file) {
  const form = new FormData();
  form.append('file', file);
  const data = await api('/api/uploads', { method: 'POST', body: form });
  return data.attachment;
}

function sendMessage(body, attachment = null) {
  const eventName = state.chat.type === 'room' ? 'message:send' : 'private:send';
  const payload = state.chat.type === 'room'
    ? { roomId: state.chat.id, body, attachment }
    : { receiverId: state.chat.id, body, attachment };
  state.socket.emit(eventName, payload, (ack) => {
    if (ack?.error) toast(ack.error);
    else el.input.value = '';
  });
}

function setupSocket() {
  state.socket = io({ path: '/socket.io' });
  state.socket.on('connect', () => {
    el.status.textContent = 'online';
    if (state.chat.type === 'room') state.socket.emit('room:join', { roomId: state.chat.id });
  });
  state.socket.on('disconnect', () => { el.status.textContent = 'offline'; });
  state.socket.on('connect_error', (error) => toast(error.message));
  state.socket.on('presence:update', (users) => {
    state.onlineIds = new Set(users.map((user) => user.id));
    renderLists();
  });
  state.socket.on('room:created', (room) => {
    if (!state.rooms.some((item) => item.id === room.id)) {
      state.rooms.push(room);
      renderLists();
    }
  });
  state.socket.on('user:updated', (user) => {
    if (state.me.id === user.id) state.me = user;
    state.users = state.users.map((item) => item.id === user.id ? user : item);
    document.querySelector('#profileButton').innerHTML = `${avatar(state.me, 'small')}<span>@${escapeHtml(state.me.username)}</span>`;
    renderLists();
  });
  state.socket.on('user:created', (user) => {
    if (user.id !== state.me.id && !state.users.some((item) => item.id === user.id)) {
      state.users.push(user);
      state.users.sort((a, b) => a.username.localeCompare(b.username));
      renderLists();
    }
  });
  state.socket.on('message:new', (message) => {
    if (state.chat.type === 'room' && state.chat.id === message.room_id) addMessage(message, 'room');
  });
  state.socket.on('private:new', (message) => {
    const otherId = message.sender_id === state.me.id ? message.receiver_id : message.sender_id;
    if (state.chat.type === 'private' && state.chat.id === otherId) addMessage(message, 'private');
    else toast(`Новое личное сообщение от ${message.sender_username}`);
  });
  state.socket.on('message:deleted', (event) => {
    if (event.chatType === 'room' && state.chat.type === 'room' && state.chat.id === event.message.room_id) {
      replaceMessage(event.message, 'room');
    }
    if (event.chatType === 'private' && state.chat.type === 'private') {
      const otherId = event.message.sender_id === state.me.id ? event.message.receiver_id : event.message.sender_id;
      if (state.chat.id === otherId) replaceMessage(event.message, 'private');
    }
  });
  state.socket.on('typing:update', (event) => {
    const key = `${event.chatType}:${event.chatId}:${event.user.id}`;
    if (event.typing) state.typing.set(key, event.user.username);
    else state.typing.delete(key);
    el.typing.textContent = Array.from(state.typing.values()).slice(0, 2).join(', ');
    if (el.typing.textContent) el.typing.textContent += ' печатает...';
  });
}

document.addEventListener('click', async (event) => {
  const selfDelete = event.target.closest('[data-delete-self]');
  const allDelete = event.target.closest('[data-delete-all]');
  if (selfDelete || allDelete) {
    const message = event.target.closest('[data-message-id]');
    const messageId = Number(message.dataset.messageId);
    const chatType = message.dataset.messageType;
    state.socket.emit('message:delete', {
      chatType,
      messageId,
      mode: allDelete ? 'all' : 'self'
    }, (ack) => {
      if (ack?.error) toast(ack.error);
      if (ack?.hidden) removeMessage(messageId, chatType);
    });
    return;
  }

  const roomButton = event.target.closest('[data-room]');
  const userButton = event.target.closest('[data-user]');
  if (roomButton) await openRoom(state.rooms.find((room) => room.id === Number(roomButton.dataset.room)));
  if (userButton) await openPrivate(state.users.find((user) => user.id === Number(userButton.dataset.user)));
  if (innerWidth < 760 && (roomButton || userButton)) el.sidebar.classList.remove('open');
});

el.input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    el.form.requestSubmit();
  }
});

el.form.addEventListener('submit', (event) => {
  event.preventDefault();
  const body = el.input.value.trim();
  if (!body) return toast('Сообщение не может быть пустым.');
  if (body.length > 1000) return toast('Сообщение слишком длинное.');
  sendMessage(body);
});

el.attachButton.onclick = () => el.fileInput.click();
el.fileInput.addEventListener('change', async () => {
  const file = el.fileInput.files[0];
  if (!file) return;
  try {
    const attachment = await uploadFile(file);
    sendMessage(el.input.value.trim(), attachment);
  } catch (error) {
    toast(error.message);
  } finally {
    el.fileInput.value = '';
  }
});

async function toggleRecording(kind) {
  if (state.recorder?.state === 'recording') {
    state.recorder.stop();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia(kind === 'video' ? { audio: true, video: true } : { audio: true });
    state.chunks = [];
    state.recorder = new MediaRecorder(stream);
    state.recorder.ondataavailable = (event) => event.data.size && state.chunks.push(event.data);
    state.recorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      const type = kind === 'video' ? 'video/webm' : 'audio/webm';
      const file = new File([new Blob(state.chunks, { type })], `${kind}-${Date.now()}.webm`, { type });
      const attachment = await uploadFile(file);
      sendMessage('', attachment);
      el.voiceButton.classList.remove('recording');
      el.videoButton.classList.remove('recording');
    };
    state.recorder.start();
    (kind === 'video' ? el.videoButton : el.voiceButton).classList.add('recording');
    toast(kind === 'video' ? 'Запись видео началась. Нажмите ещё раз для отправки.' : 'Запись голоса началась. Нажмите ещё раз для отправки.');
  } catch (_error) {
    toast('Браузер не дал доступ к микрофону или камере.');
  }
}

el.voiceButton.onclick = () => toggleRecording('audio');
el.videoButton.onclick = () => toggleRecording('video');

let typingSent = false;
let typingTimeout;
el.input.addEventListener('input', () => {
  if (!typingSent) {
    typingSent = true;
    state.socket.emit('typing:start', { chatType: state.chat.type, chatId: state.chat.id });
  }
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    typingSent = false;
    state.socket.emit('typing:stop', { chatType: state.chat.type, chatId: state.chat.id });
  }, 900);
});

document.querySelector('#themeButton').onclick = () => {
  document.body.classList.toggle('dark');
  localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
};

document.querySelector('#openRoomModal').onclick = () => document.querySelector('#roomModal').showModal();
document.querySelector('#cancelRoom').onclick = () => document.querySelector('#roomModal').close();
document.querySelector('#roomForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const data = Object.fromEntries(new FormData(event.target).entries());
    const { room } = await api('/api/rooms', { method: 'POST', body: JSON.stringify(data) });
    document.querySelector('#roomModal').close();
    event.target.reset();
    await openRoom(room);
  } catch (error) { toast(error.message); }
});

document.querySelector('#logoutButton').onclick = async () => {
  await api('/api/auth/logout', { method: 'POST' });
  location.href = '/login.html';
};

document.querySelector('#profileButton').onclick = () => {
  document.querySelector('#profileForm').username.value = state.me.username;
  document.querySelector('#profileAvatar').innerHTML = avatar(state.me, 'large');
  document.querySelector('#profileModal').showModal();
};
document.querySelector('#closeProfile').onclick = () => document.querySelector('#profileModal').close();
document.querySelector('#profileForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const form = event.target;
    let avatarUrl = state.me.avatar_url || null;
    if (document.querySelector('#avatarInput').files[0]) {
      const uploaded = await uploadFile(document.querySelector('#avatarInput').files[0]);
      avatarUrl = uploaded.url;
    }
    const data = await api('/api/users/me', {
      method: 'PATCH',
      body: JSON.stringify({ username: form.username.value, avatar_url: avatarUrl })
    });
    state.me = data.user;
    document.querySelector('#profileButton').innerHTML = `${avatar(state.me, 'small')}<span>@${escapeHtml(state.me.username)}</span>`;
    document.querySelector('#profileModal').close();
    toast('Профиль обновлён.');
  } catch (error) { toast(error.message); }
});
document.querySelector('#openSidebar').onclick = () => el.sidebar.classList.add('open');
document.querySelector('#closeSidebar').onclick = () => el.sidebar.classList.remove('open');

(async function boot() {
  try {
    if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark');
    const me = await api('/api/auth/me');
    state.me = me.user;
    document.querySelector('#profileButton').innerHTML = `${avatar(state.me, 'small')}<span>@${escapeHtml(state.me.username)}</span>`;
    await refreshData();
    setupSocket();
    await openRoom(state.rooms[0]);
  } catch (_error) {
    location.href = '/login.html';
  }
}());

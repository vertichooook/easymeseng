const state = {
  me: null,
  socket: null,
  rooms: [],
  users: [],
  onlineIds: new Set(),
  chat: { type: 'room', id: 1, title: 'general' },
  typing: new Map()
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
  typing: document.querySelector('#typing'),
  toast: document.querySelector('#toast')
};

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
}[char]));

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Ошибка запроса.');
  return payload;
}

function toast(message) {
  el.toast.textContent = message;
  el.toast.classList.add('show');
  setTimeout(() => el.toast.classList.remove('show'), 2600);
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
      <span class="dot ${state.onlineIds.has(user.id) ? 'online' : ''}"></span>
      <span>${escapeHtml(user.username)}</span>
      <small>${state.onlineIds.has(user.id) ? 'online' : 'offline'}</small>
    </button>
  `).join('');
}

function renderMessage(message, type = state.chat.type) {
  const mine = type === 'room' ? message.user_id === state.me.id : message.sender_id === state.me.id;
  const author = type === 'room' ? message.username : message.sender_username;
  return `
    <article class="message ${mine ? 'mine' : ''}">
      <div class="meta"><strong>${escapeHtml(author)}</strong><time>${formatTime(message.created_at)}</time></div>
      <p>${escapeHtml(message.body)}</p>
    </article>
  `;
}

function addMessage(message, type) {
  el.messages.insertAdjacentHTML('beforeend', renderMessage(message, type));
  el.messages.scrollTop = el.messages.scrollHeight;
}

async function openRoom(room) {
  if (state.chat.type === 'room') state.socket.emit('room:leave', { roomId: state.chat.id });
  state.chat = { type: 'room', id: room.id, title: room.name };
  el.title.textContent = `# ${room.name}`;
  renderLists();
  const data = await api(`/api/rooms/${room.id}/messages`);
  el.messages.innerHTML = data.messages.map((msg) => renderMessage(msg, 'room')).join('');
  state.socket.emit('room:join', { roomId: room.id }, (ack) => ack?.error && toast(ack.error));
  el.messages.scrollTop = el.messages.scrollHeight;
}

async function openPrivate(user) {
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
  state.socket.on('message:new', (message) => {
    if (state.chat.type === 'room' && state.chat.id === message.room_id) addMessage(message, 'room');
  });
  state.socket.on('private:new', (message) => {
    const otherId = message.sender_id === state.me.id ? message.receiver_id : message.sender_id;
    if (state.chat.type === 'private' && state.chat.id === otherId) addMessage(message, 'private');
    else toast(`Новое личное сообщение от ${message.sender_username}`);
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
  const roomButton = event.target.closest('[data-room]');
  const userButton = event.target.closest('[data-user]');
  if (roomButton) await openRoom(state.rooms.find((room) => room.id === Number(roomButton.dataset.room)));
  if (userButton) await openPrivate(state.users.find((user) => user.id === Number(userButton.dataset.user)));
  if (innerWidth < 760 && (roomButton || userButton)) el.sidebar.classList.remove('open');
});

el.form.addEventListener('submit', (event) => {
  event.preventDefault();
  const body = el.input.value.trim();
  if (!body) return toast('Сообщение не может быть пустым.');
  if (body.length > 1000) return toast('Сообщение слишком длинное.');
  const eventName = state.chat.type === 'room' ? 'message:send' : 'private:send';
  const payload = state.chat.type === 'room' ? { roomId: state.chat.id, body } : { receiverId: state.chat.id, body };
  state.socket.emit(eventName, payload, (ack) => {
    if (ack?.error) toast(ack.error);
    else el.input.value = '';
  });
});

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

document.querySelector('#openRoomModal').onclick = () => document.querySelector('#roomModal').showModal();
document.querySelector('#cancelRoom').onclick = () => document.querySelector('#roomModal').close();
document.querySelector('#roomForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const data = Object.fromEntries(new FormData(event.target).entries());
    const { room } = await api('/api/rooms', { method: 'POST', body: JSON.stringify(data) });
    document.querySelector('#roomModal').close();
    event.target.reset();
    await refreshData();
    await openRoom(room);
  } catch (error) { toast(error.message); }
});

document.querySelector('#logoutButton').onclick = async () => {
  await api('/api/auth/logout', { method: 'POST' });
  location.href = '/login.html';
};
document.querySelector('#profileButton').onclick = () => {
  document.querySelector('#profileText').textContent = `Вы вошли как ${state.me.username}`;
  document.querySelector('#profileModal').showModal();
};
document.querySelector('#closeProfile').onclick = () => document.querySelector('#profileModal').close();
document.querySelector('#openSidebar').onclick = () => el.sidebar.classList.add('open');
document.querySelector('#closeSidebar').onclick = () => el.sidebar.classList.remove('open');

(async function boot() {
  try {
    const me = await api('/api/auth/me');
    state.me = me.user;
    document.querySelector('#profileButton').textContent = `@${state.me.username}`;
    await refreshData();
    setupSocket();
    await openRoom(state.rooms[0]);
  } catch (_error) {
    location.href = '/login.html';
  }
}());

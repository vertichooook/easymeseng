const config = require('../config');

function normalizeUsername(username) {
  return String(username || '').trim().replace(/\s+/g, '_').toLowerCase();
}

function validateUsername(username) {
  const value = normalizeUsername(username);
  if (!/^[a-z0-9_]{3,32}$/.test(value)) {
    return { ok: false, message: 'Имя пользователя: 3-32 символа, латиница, цифры или _.' };
  }
  return { ok: true, value };
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return { ok: false, message: 'Пароль должен быть от 8 до 128 символов.' };
  }
  return { ok: true };
}

function validateRoomName(name) {
  const value = String(name || '').trim().replace(/\s+/g, ' ');
  if (value.length < 2 || value.length > config.maxRoomNameLength) {
    return { ok: false, message: 'Название комнаты должно быть от 2 до 60 символов.' };
  }
  if (!/^[\p{L}\p{N}_ .-]+$/u.test(value)) {
    return { ok: false, message: 'Название комнаты содержит недопустимые символы.' };
  }
  return { ok: true, value };
}

function validateDisplayName(name) {
  const value = String(name || '').trim().replace(/\s+/g, ' ');
  if (value.length < 2 || value.length > 48) {
    return { ok: false, message: 'Имя должно быть от 2 до 48 символов.' };
  }
  return { ok: true, value };
}

function validateMessage(body) {
  const value = String(body || '').trim();
  if (!value) return { ok: false, message: 'Сообщение не может быть пустым.' };
  if (value.length > config.maxMessageLength) {
    return { ok: false, message: `Сообщение не длиннее ${config.maxMessageLength} символов.` };
  }
  return { ok: true, value };
}

module.exports = { normalizeUsername, validateUsername, validatePassword, validateRoomName, validateMessage, validateDisplayName };

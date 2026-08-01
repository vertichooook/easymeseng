const q = require('../database/queries');
const { decorateMessage } = require('./reactions');

function privateChatKey(a, b) {
  const left = Number(a);
  const right = Number(b);
  return [Math.min(left, right), Math.max(left, right)].join(':');
}

function pinnedPayload(chatType, chatKey, userId) {
  const pin = q.findPinnedMessage.get(chatType, chatKey);
  if (!pin) return null;
  const message = chatType === 'room'
    ? q.findMessageById.get(pin.message_id)
    : q.findPrivateMessageById.get(pin.message_id);
  if (!message || message.deleted_at) {
    q.deletePinnedMessage.run(chatType, chatKey);
    return null;
  }
  return {
    ...pin,
    message: decorateMessage(message, chatType, userId)
  };
}

module.exports = { privateChatKey, pinnedPayload };

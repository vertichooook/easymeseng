const q = require('../database/queries');

const allowedReactions = new Set(['heart', 'like', 'fire', 'cry', 'angry', 'dislike']);

function reactionPayload(type, messageId, userId = null) {
  const counts = {};
  for (const row of q.listMessageReactions.all(type, messageId)) {
    counts[row.reaction] = row.count;
  }
  const myReaction = userId ? q.findMyMessageReaction.get(userId, type, messageId)?.reaction || null : null;
  return { reactions: counts, my_reaction: myReaction };
}

function decorateMessage(message, type, userId) {
  if (!message) return message;
  return { ...message, ...reactionPayload(type, message.id, userId) };
}

function decorateMessages(messages, type, userId) {
  return messages.map((message) => decorateMessage(message, type, userId));
}

module.exports = { allowedReactions, decorateMessage, decorateMessages, reactionPayload };

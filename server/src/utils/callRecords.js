const q = require('../database/queries');
const calls = require('./calls');
const { decorateMessage } = require('./reactions');

function callBody(call, status) {
  return `__nexus_call__${JSON.stringify({
    callId: call.callId,
    callerId: call.callerId,
    receiverId: call.receiverId,
    kind: call.kind,
    status
  })}`;
}

function emitPrivate(io, userId, targetId, message) {
  io.to(`user:${userId}`).to(`user:${targetId}`).emit('private:new', message);
}

function emitCallLog(io, call, status) {
  if (!call || call.logged) return null;
  call.logged = true;
  const result = q.insertPrivateMessage.run(call.callerId, call.receiverId, callBody(call, status), null, null, null, null, null, null, null, null);
  const saved = decorateMessage(q.findPrivateMessageById.get(result.lastInsertRowid), 'private', null);
  emitPrivate(io, call.callerId, call.receiverId, saved);
  return saved;
}

function finishCall(io, callId, status) {
  const call = calls.getCall(callId);
  if (!call) return null;
  const finalStatus = status === 'completed' && call.status !== 'accepted' ? 'missed' : status;
  const saved = emitCallLog(io, call, finalStatus);
  calls.deleteCall(callId);
  return { call, saved };
}

module.exports = { callBody, emitCallLog, finishCall };

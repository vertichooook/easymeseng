const pendingCalls = new Map();

function createCall({ callId, callerId, receiverId, kind }) {
  const call = {
    callId,
    callerId: Number(callerId),
    receiverId: Number(receiverId),
    kind: kind === 'video' ? 'video' : 'audio',
    status: 'ringing',
    startedAt: Date.now(),
    timer: null
  };
  pendingCalls.set(callId, call);
  return call;
}

function getCall(callId) {
  return pendingCalls.get(callId) || null;
}

function getIncomingCall(userId) {
  const id = Number(userId);
  return Array.from(pendingCalls.values()).find((call) => call.receiverId === id && call.status === 'ringing') || null;
}

function markCall(callId, status) {
  const call = getCall(callId);
  if (!call) return null;
  call.status = status;
  return call;
}

function setTimer(callId, timer) {
  const call = getCall(callId);
  if (!call) return null;
  if (call.timer) clearTimeout(call.timer);
  call.timer = timer;
  return call;
}

function clearTimer(callId) {
  const call = getCall(callId);
  if (!call?.timer) return;
  clearTimeout(call.timer);
  call.timer = null;
}

function deleteCall(callId) {
  clearTimer(callId);
  pendingCalls.delete(callId);
}

module.exports = { clearTimer, createCall, deleteCall, getCall, getIncomingCall, markCall, setTimer };

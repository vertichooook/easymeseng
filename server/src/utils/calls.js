const pendingCalls = new Map();

function createCall({ callId, callerId, receiverId, kind }) {
  const call = {
    callId,
    callerId: Number(callerId),
    receiverId: Number(receiverId),
    kind: kind === 'video' ? 'video' : 'audio',
    status: 'ringing',
    startedAt: Date.now()
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

function deleteCall(callId) {
  pendingCalls.delete(callId);
}

module.exports = { createCall, deleteCall, getCall, getIncomingCall, markCall };

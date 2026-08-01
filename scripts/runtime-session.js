let sessionId = null;

export function initializeRuntimeSession() {
  if (sessionId) return sessionId;
  const suffix = globalThis.foundry?.utils?.randomID?.(16) ?? globalThis.crypto?.randomUUID?.() ?? "local-session";
  sessionId = `nelflow-session-${suffix}`;
  return sessionId;
}

export function getRuntimeSessionId() {
  return sessionId ?? initializeRuntimeSession();
}

export function sessionOwns(operation) {
  return Boolean(operation?.sessionId && operation.sessionId === getRuntimeSessionId());
}

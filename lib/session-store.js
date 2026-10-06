// Sessions have to survive a new Vercel instance. Memory covers the warm
// instance. The runtime cache is shared in a region when the app is deployed.

const memory = globalThis.__novaSessions ||= {
  sessions: new Map(),
  voices: new Map(),
};

function cache() {
  return import("@vercel/functions")
    .then(({ getCache }) => getCache({ namespace: "nova" }))
    .catch(() => null);
}

async function cacheGet(key) {
  try {
    const store = await cache();
    if (!store) return null;
    return (await store.get(key)) ?? null;
  } catch {
    return null;
  }
}

async function cacheSet(key, value) {
  try {
    const store = await cache();
    if (!store) return;
    await store.set(key, value, { ttl: 60 * 60 * 6, name: key.slice(0, 40) });
  } catch {
    // The local server keeps the memory copy.
  }
}

export async function readSession(id) {
  if (!id) return null;
  if (memory.sessions.has(id)) return memory.sessions.get(id);
  const cached = await cacheGet(`session:${id}`);
  if (!cached) return null;
  memory.sessions.set(id, cached);
  return cached;
}

export async function writeSession(session) {
  if (!session?.id) return;
  memory.sessions.set(session.id, session);
  await cacheSet(`session:${session.id}`, session);
}

export async function readVoiceSessionId(token) {
  if (!token) return "";
  if (memory.voices.has(token)) return memory.voices.get(token);
  const cached = await cacheGet(`voice:${token}`);
  if (!cached) return "";
  memory.voices.set(token, cached);
  return cached;
}

export async function writeVoiceToken(token, sessionId) {
  if (!token || !sessionId) return;
  memory.voices.set(token, sessionId);
  await cacheSet(`voice:${token}`, sessionId);
}

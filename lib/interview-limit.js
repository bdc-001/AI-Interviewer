// Ten interviews is the spend cap. A session counts once, on the candidate's
// first reply, so opening the page or changing role does not use a slot.

const memory = globalThis.__novaInterviewLimit ||= {
  usedIds: new Set(),
  tokens: 0,
};

function cache() {
  return import("@vercel/functions")
    .then(({ getCache }) => getCache({ namespace: "nova" }))
    .catch(() => null);
}

export function interviewLimit() {
  const parsed = Number(process.env.INTERVIEW_LIMIT);
  if (!Number.isFinite(parsed) || parsed < 1) return 10;
  return Math.min(1000, Math.round(parsed));
}

async function loadUsage() {
  try {
    const store = await cache();
    const cached = store ? await store.get("interview-limit") : null;
    if (cached?.usedIds) {
      for (const id of cached.usedIds) memory.usedIds.add(id);
      memory.tokens = Math.max(memory.tokens, Number(cached.tokens) || 0);
    }
  } catch {
    // Memory still holds the count for this process.
  }
}

async function saveUsage() {
  try {
    const store = await cache();
    if (!store) return;
    await store.set(
      "interview-limit",
      { usedIds: [...memory.usedIds], tokens: memory.tokens },
      { ttl: 60 * 60 * 24 * 90, name: "interview-limit" }
    );
  } catch {
    // The local server keeps the memory copy.
  }
}

export async function interviewUsage() {
  await loadUsage();
  return {
    used: memory.usedIds.size,
    limit: interviewLimit(),
    tokens: memory.tokens,
    remaining: Math.max(0, interviewLimit() - memory.usedIds.size),
  };
}

export async function reserveInterview(sessionId) {
  if (!sessionId) return { allowed: false, ...(await interviewUsage()) };
  await loadUsage();
  if (memory.usedIds.has(sessionId)) {
    return { allowed: true, ...(await publicUsage()) };
  }
  if (memory.usedIds.size >= interviewLimit()) {
    return { allowed: false, ...(await publicUsage()) };
  }
  memory.usedIds.add(sessionId);
  await saveUsage();
  return { allowed: true, ...(await publicUsage()) };
}

function publicUsage() {
  return {
    used: memory.usedIds.size,
    limit: interviewLimit(),
    tokens: memory.tokens,
    remaining: Math.max(0, interviewLimit() - memory.usedIds.size),
  };
}

export async function recordInterviewTokens(count) {
  const tokens = Number(count);
  if (!Number.isFinite(tokens) || tokens <= 0) return;
  await loadUsage();
  memory.tokens += Math.round(tokens);
  await saveUsage();
}

export function resetInterviewLimit() {
  memory.usedIds.clear();
  memory.tokens = 0;
}

export function interviewLimitMessage(usage) {
  const limit = usage?.limit || interviewLimit();
  return `This screen allows ${limit} interviews. That limit has been reached, so a new one cannot start.`;
}

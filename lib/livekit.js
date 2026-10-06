import { createHmac, randomUUID } from "node:crypto";

const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

export function normalizeVoiceProvider(value) {
  return value === "vapi" || value === "livekit" ? value : "";
}

export function isLiveKitConfigured(env = process.env) {
  return Boolean(env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET);
}

export function liveKitClientUrl(value = "") {
  try {
    const url = new URL(value);
    if (url.protocol !== "wss:" && url.protocol !== "ws:") return "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

export function liveKitApiUrl(value = "") {
  const clientUrl = liveKitClientUrl(value);
  if (!clientUrl) return "";
  return clientUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
}

export function signLiveKitToken({ apiKey, apiSecret, identity, room, grants, ttlSeconds = 300, now = Math.floor(Date.now() / 1000) }) {
  if (!apiKey || !apiSecret || !identity || !room) throw new Error("LiveKit credentials and room identity are required.");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    iss: apiKey,
    sub: identity,
    nbf: now - 5,
    exp: now + ttlSeconds,
    jti: randomUUID(),
    video: { room, ...grants },
  });
  const unsigned = `${header}.${payload}`;
  const signature = createHmac("sha256", apiSecret).update(unsigned).digest("base64url");
  return `${unsigned}.${signature}`;
}

export function createLiveKitAccessToken({ apiKey, apiSecret, identity, room, ttlSeconds = 300 }) {
  return signLiveKitToken({
    apiKey,
    apiSecret,
    identity,
    room,
    ttlSeconds,
    grants: { roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true },
  });
}

export async function dispatchLiveKitAgent({
  url,
  apiKey,
  apiSecret,
  room,
  agentName,
  metadata,
  fetchImpl = globalThis.fetch,
  now = Math.floor(Date.now() / 1000),
}) {
  const apiUrl = liveKitApiUrl(url);
  if (!apiUrl || !apiKey || !apiSecret) throw new Error("LiveKit is not configured on the server.");
  const token = signLiveKitToken({
    apiKey,
    apiSecret,
    identity: `nova-backend-${randomUUID()}`,
    room,
    grants: { roomAdmin: true },
    ttlSeconds: 60,
    now,
  });
  const response = await fetchImpl(`${apiUrl}/twirp/livekit.AgentDispatchService/CreateDispatch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      agent_name: agentName,
      room,
      metadata: JSON.stringify(metadata),
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`LiveKit agent dispatch failed (HTTP ${response.status}).`);
  return response.json();
}

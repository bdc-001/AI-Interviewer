import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  createLiveKitAccessToken,
  dispatchLiveKitAgent,
  isLiveKitConfigured,
  liveKitApiUrl,
  liveKitClientUrl,
  normalizeVoiceProvider,
} from "../lib/livekit.js";

function decodeToken(token) {
  const [header, payload, signature] = token.split(".");
  return {
    header: JSON.parse(Buffer.from(header, "base64url").toString("utf8")),
    payload: JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    signature,
    unsigned: `${header}.${payload}`,
  };
}

test("LiveKit participant token grants one room and is signed with the server secret", () => {
  const secret = "local-test-secret";
  const token = createLiveKitAccessToken({
    apiKey: "local-test-key",
    apiSecret: secret,
    identity: "candidate-test",
    room: "nova-test-room",
    ttlSeconds: 180,
    now: 1_800_000_000,
  });
  const decoded = decodeToken(token);
  const expected = createHmac("sha256", secret).update(decoded.unsigned).digest("base64url");

  assert.deepEqual(decoded.header, { alg: "HS256", typ: "JWT" });
  assert.equal(decoded.payload.iss, "local-test-key");
  assert.equal(decoded.payload.sub, "candidate-test");
  assert.equal(decoded.payload.video.room, "nova-test-room");
  assert.equal(decoded.payload.video.roomJoin, true);
  assert.equal(decoded.payload.video.canPublish, true);
  assert.equal(decoded.payload.video.canSubscribe, true);
  assert.equal(decoded.payload.exp - decoded.payload.nbf, 185);
  assert.equal(decoded.signature, expected);
  assert.equal(token.includes(secret), false);
});

test("LiveKit readiness and provider selection never expose a credential", () => {
  assert.equal(normalizeVoiceProvider("livekit"), "livekit");
  assert.equal(normalizeVoiceProvider("vapi"), "vapi");
  assert.equal(normalizeVoiceProvider("other"), "");
  assert.equal(isLiveKitConfigured({ LIVEKIT_URL: "wss://example.livekit.cloud", LIVEKIT_API_KEY: "key", LIVEKIT_API_SECRET: "secret" }), true);
  assert.equal(isLiveKitConfigured({ LIVEKIT_URL: "wss://example.livekit.cloud", LIVEKIT_API_KEY: "key" }), false);
  assert.equal(liveKitClientUrl("wss://example.livekit.cloud/"), "wss://example.livekit.cloud");
  assert.equal(liveKitApiUrl("wss://example.livekit.cloud"), "https://example.livekit.cloud");
  assert.equal(liveKitClientUrl("https://example.livekit.cloud"), "");
});

test("LiveKit dispatch signs a room-scoped admin request and passes session metadata", async () => {
  let request;
  await dispatchLiveKitAgent({
    url: "wss://example.livekit.cloud",
    apiKey: "local-test-key",
    apiSecret: "local-test-secret",
    room: "nova-test-room",
    agentName: "nova-interviewer",
    metadata: { sessionId: "session-test", sessionToken: "opaque-session-token" },
    fetchImpl: async (url, options) => {
      request = { url, ...options };
      return { ok: true, json: async () => ({ id: "dispatch-test" }) };
    },
    now: 1_800_000_000,
  });

  assert.equal(request.url, "https://example.livekit.cloud/twirp/livekit.AgentDispatchService/CreateDispatch");
  const adminToken = request.headers.Authorization.slice("Bearer ".length);
  const { payload } = decodeToken(adminToken);
  assert.equal(payload.video.room, "nova-test-room");
  assert.equal(payload.video.roomAdmin, true);
  assert.deepEqual(JSON.parse(request.body), {
    agent_name: "nova-interviewer",
    room: "nova-test-room",
    metadata: JSON.stringify({ sessionId: "session-test", sessionToken: "opaque-session-token" }),
  });
});

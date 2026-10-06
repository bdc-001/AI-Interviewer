// The screen rules live in lib/engine.js.
// A plugged-in key lets lib/speak.js write the line from retrieved knowledge.
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { applyTurn, createSession, endSession, restoreSession, snapshot } from "./lib/engine.js";
import { loadEnv } from "./lib/env.js";
import { getLlmConfig, probeModel, publicLlmStatus, setLlmConfig } from "./lib/llm.js";
import { buildPrompt } from "./lib/prompt.js";
import { clearEmbeddings, indexEmbeddings, retrievalMode } from "./lib/rag.js";
import { getRole, publicRoles } from "./lib/roles.js";
import { maybeSpeak } from "./lib/speak.js";
import { createLiveKitAccessToken, dispatchLiveKitAgent, isLiveKitConfigured, liveKitClientUrl, normalizeVoiceProvider } from "./lib/livekit.js";
import { buildVapiPrompt, countVoiceUserTurns, isNewVoiceTurn } from "./lib/voice.js";
import { getVoiceSettings, publicVoiceSettings, setVoiceSettings } from "./lib/voice-settings.js";
import { readSession, readVoiceSessionId, writeSession, writeVoiceToken } from "./lib/session-store.js";

const root = existsSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "public"))
  ? path.dirname(fileURLToPath(import.meta.url))
  : process.cwd();
loadEnv(path.join(root, ".env"));
loadEnv(path.join(process.cwd(), ".env"));
const port = Number(process.env.PORT) || 4173;
const livekitDispatches = new Map();

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
};

const staticRoots = [
  { prefix: "/design-system/", dir: path.join(root, "design-system") },
  { prefix: "/brand/", dir: path.join(root, "public", "brand") },
  { prefix: "/", dir: path.join(root, "public") },
];

async function route(req, res) {
  const url = new URL(req.originalUrl || req.url, `http://${req.headers.host || "localhost"}`);
  if (req.method === "GET" && url.pathname === "/api/roles") {
    return json(res, 200, publicRoles());
  }
  if (req.method === "GET" && url.pathname === "/api/prompt") {
    const role = getRole(url.searchParams.get("roleId") || "engineer");
    return json(res, 200, {
      roleId: role.id,
      roleLabel: role.label,
      roleTitle: role.roleTitle,
      company: role.company,
      toneName: role.toneName,
      goals: role.goals.map((goal) => goal.title),
      prompt: buildPrompt(role.id),
    });
  }
  if (req.method === "POST" && url.pathname === "/api/session") {
    const body = await readJson(req);
    if (body.resume) {
      const session = await loadCarried(body.session?.id, body.session);
      if (!session) return json(res, 404, { error: "That screen is gone. Start it again." });
      await ensureVoiceToken(session);
      return json(res, 200, snapshot(session));
    }
    const session = createSession({ roleId: body.roleId, mode: body.mode });
    await ensureVoiceToken(session);
    await writeSession(session);
    return json(res, 200, snapshot(session));
  }
  if (req.method === "GET" && url.pathname === "/api/session") {
    const session = await readSession(url.searchParams.get("id"));
    if (!session) return json(res, 404, { error: "That solution session is gone. Start it again." });
    return json(res, 200, snapshot(session));
  }
  if (req.method === "GET" && url.pathname === "/api/voice/config") {
    const sessionId = url.searchParams.get("sessionId");
    const session = await readSession(sessionId);
    if (!session) return json(res, 404, { error: "Start a solution session before using voice." });
    await ensureVoiceToken(session);
    await writeSession(session);
      const llm = getLlmConfig();
      const role = getRole(session.roleId);
      const voiceSettings = getVoiceSettings();
      const provider = normalizeVoiceProvider(url.searchParams.get("provider")) || voiceSettings.provider;
      const livekitReady = isLiveKitConfigured();
      const vapiReady = Boolean(process.env.VAPI_PUBLIC_KEY);
      return json(res, 200, {
        provider,
        defaultProvider: voiceSettings.provider,
        ready: provider === "livekit" ? livekitReady : vapiReady,
        livekitReady,
        vapiReady,
        livekitUrl: livekitReady ? liveKitClientUrl(process.env.LIVEKIT_URL) : "",
        publicKey: process.env.VAPI_PUBLIC_KEY || "",
        voiceId: voiceSettings.vapi.voiceId,
        model: llm.configured ? (llm.chatModel || llm.model) : "muse-spark-1.3-contributor",
        role: {
          title: role.roleTitle,
          company: role.company,
          tone: role.toneGuide,
        },
        prompt: buildVapiPrompt(role, session.mode),
        sessionToken: session.voiceToken || "",
        settings: voiceSettings,
        defaults: publicVoiceSettings().defaults,
      });
    }
    if (req.method === "GET" && url.pathname === "/api/settings") {
      return json(res, 200, { llm: publicLlmStatus(), voice: publicVoiceSettings() });
    }
    if (req.method === "POST" && url.pathname === "/api/settings") {
      const body = await readJson(req);
      if (body.voice) setVoiceSettings(body.voice);
      return json(res, 200, { llm: publicLlmStatus(), voice: publicVoiceSettings() });
    }
    if (req.method === "POST" && url.pathname === "/api/livekit/session") {
      return await createLiveKitSession(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/livekit/dispatch") {
      return await dispatchLiveKitSession(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/livekit/turn") {
      return await liveKitTurn(req, res);
    }
    if (req.method === "POST" && url.pathname.startsWith("/api/voice/completions")) {
      return await voiceCompletion(req, res, url);
    }
    if (req.method === "GET" && url.pathname === "/api/llm") {
      return json(res, 200, publicLlmStatus({ retrieval: retrievalMode() }));
    }
    if (req.method === "POST" && url.pathname === "/api/llm") {
      const body = await readJson(req);
      return saveLlm(body, res);
    }
  if (req.method === "POST" && url.pathname === "/api/turn") {
    const body = await readJson(req);
    const session = await loadCarried(body.id, body.session);
    if (!session) return json(res, 404, { error: "That screen is gone. Start it again." });
    applyTurn(session, body.text || "");
    await maybeSpeak(session);
    await writeSession(session);
    return json(res, 200, snapshot(session));
  }
  if (req.method === "POST" && url.pathname === "/api/end") {
    const body = await readJson(req);
    const session = await loadCarried(body.id, body.session);
    if (!session) return json(res, 404, { error: "That screen is gone. Start it again." });
    endSession(session);
    await writeSession(session);
    return json(res, 200, snapshot(session));
  }
  if (req.method === "GET") return serveStatic(url.pathname, res);
  return json(res, 405, { error: "Not allowed" });
}

async function voiceCompletion(req, res, url) {
  const token = url.searchParams.get("token");
  const body = await readJson(req);
  const candidateText = lastUserText(body.messages);
  if (!candidateText) return json(res, 400, { error: "The voice turn did not include a transcript." });

  let sessionId = await readVoiceSessionId(token);
  let session = sessionId ? await readSession(sessionId) : null;
  if (!session) {
    session = createSession({
      roleId: url.searchParams.get("roleId") || "engineer",
      mode: url.searchParams.get("mode") || "listening",
    });
    const prior = userTexts(body.messages).slice(0, -1);
    for (const text of prior) {
      if (!session.done) applyTurn(session, text);
    }
    session.voiceUserCount = prior.length;
    if (token) {
      session.voiceToken = token;
      await writeVoiceToken(token, session.id);
    }
    sessionId = session.id;
  }

  const incomingUserCount = countVoiceUserTurns(body.messages);
  const isNewTurn = isNewVoiceTurn(body.messages, session.voiceUserCount || 0);
  if (isNewTurn && !session.done) {
    applyTurn(session, candidateText);
    await maybeSpeak(session);
    session.voiceUserCount = incomingUserCount;
  }
  await writeSession(session);

  const latest = session.messages.at(-1);
  const reply = latest?.role === "user"
    ? "Take your time. I'm listening."
    : latest?.text || "Thanks. Let's continue when you're ready.";
  return openAICompletion(res, body.model || "muse-spark-1.3-contributor", reply, Boolean(body.stream));
}

async function createLiveKitSession(req, res) {
  const body = await readJson(req);
  const session = await loadCarried(body.sessionId, body.session);
  if (!session) return json(res, 404, { error: "Start a solution session before using voice." });
  const expectedToken = session.voiceToken || "";
  if (!sameSecret(body.sessionToken, expectedToken)) {
    return json(res, 401, { error: "This voice session has expired. Start voice again." });
  }
  if (!isLiveKitConfigured()) {
    return json(res, 503, { error: "LiveKit is not configured on the server." });
  }

  const roomName = `nova-${session.id}`;
  const clientUrl = liveKitClientUrl(process.env.LIVEKIT_URL);
  const token = createLiveKitAccessToken({
    apiKey: process.env.LIVEKIT_API_KEY,
    apiSecret: process.env.LIVEKIT_API_SECRET,
    identity: `candidate-${randomUUID()}`,
    room: roomName,
  });
  return json(res, 200, { url: clientUrl, roomName, token });
}

async function dispatchLiveKitSession(req, res) {
  const body = await readJson(req);
  const session = await loadCarried(body.sessionId, body.session);
  if (!session) return json(res, 404, { error: "Start a solution session before using voice." });
  const expectedToken = session.voiceToken || "";
  if (!sameSecret(body.sessionToken, expectedToken)) {
    return json(res, 401, { error: "This voice session has expired. Start voice again." });
  }
  if (!isLiveKitConfigured()) {
    return json(res, 503, { error: "LiveKit is not configured on the server." });
  }

  const roomName = `nova-${session.id}`;
  if (body.roomName !== roomName) return json(res, 403, { error: "This room does not belong to the current solution session." });
  const pending = livekitDispatches.get(session.id);
  if (pending) {
    try {
      await pending;
      return json(res, 200, { dispatched: true });
    } catch {
      livekitDispatches.delete(session.id);
    }
  }

  const appUrl = (process.env.NOVA_APP_URL || `http://127.0.0.1:${port}`).replace(/\/$/, "");
  const opening = session.messages.find((message) => message.role === "assistant")?.text || "";
  const voiceSettings = getVoiceSettings();
  const dispatch = dispatchLiveKitAgent({
    url: process.env.LIVEKIT_URL,
    apiKey: process.env.LIVEKIT_API_KEY,
    apiSecret: process.env.LIVEKIT_API_SECRET,
    room: roomName,
    agentName: process.env.LIVEKIT_AGENT_NAME || "nova-interviewer",
    metadata: {
      sessionId: session.id,
      sessionToken: expectedToken,
      appUrl,
      opening,
      voiceSettings,
    },
  });
  livekitDispatches.set(session.id, dispatch);
  session.livekitDispatched = true;
  await writeSession(session);
  try {
    await dispatch;
  } catch (error) {
    livekitDispatches.delete(session.id);
    const detail = error.message?.startsWith("LiveKit agent dispatch failed")
      ? error.message
      : "The LiveKit server could not dispatch Nova.";
    return json(res, 502, { error: `${detail} Check that the LiveKit worker is running.` });
  }
  return json(res, 200, { dispatched: true });
}

async function liveKitTurn(req, res) {
  const token = bearerToken(req);
  const sessionId = await readVoiceSessionId(token);
  const body = await readJson(req);
  const session = sessionId && sessionId === body.sessionId ? await readSession(sessionId) : null;
  if (!session) return json(res, 401, { error: "This voice session has expired. Start voice again." });
  if (typeof body.turnId !== "string" || !body.turnId || typeof body.text !== "string") {
    return json(res, 400, { error: "The voice turn needs a transcript." });
  }
  if (body.text.length > 8000 || body.turnId.length > 240) {
    return json(res, 413, { error: "That voice turn is too long." });
  }

  if (!session.turnResults) session.turnResults = {};
  if (session.turnResults[body.turnId]) return json(res, 200, session.turnResults[body.turnId]);

  if (!session.done) {
    applyTurn(session, body.text);
    await maybeSpeak(session);
  }
  const latest = session.messages.at(-1);
  const reply = latest?.role === "assistant" ? latest.text : "Take your time. I'm listening.";
  const result = { reply, session: snapshot(session) };
  session.turnResults[body.turnId] = result;
  await writeSession(session);
  return json(res, 200, result);
}

async function loadCarried(id, carried) {
  const existing = id ? await readSession(id) : null;
  if (existing) return existing;
  const restored = restoreSession(carried);
  if (!restored || (id && restored.id !== id)) return null;
  await ensureVoiceToken(restored);
  await writeSession(restored);
  return restored;
}

async function ensureVoiceToken(session) {
  if (session.voiceToken) return session.voiceToken;
  const voiceToken = randomBytes(24).toString("base64url");
  session.voiceToken = voiceToken;
  session.voiceUserCount = session.voiceUserCount || 0;
  await writeVoiceToken(voiceToken, session.id);
  return voiceToken;
}

function userTexts(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((message) => message?.role === "user")
    .map((message) => {
      if (typeof message.content === "string") return message.content.trim();
      if (Array.isArray(message.content)) {
        return message.content
          .filter((part) => part?.type === "text" && typeof part.text === "string")
          .map((part) => part.text)
          .join(" ")
          .trim();
      }
      return "";
    })
    .filter(Boolean);
}

function bearerToken(req) {
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || "");
  return match?.[1] || "";
}

function sameSecret(received, expected) {
  if (typeof received !== "string" || !expected) return false;
  const first = Buffer.from(received);
  const second = Buffer.from(expected);
  return first.length === second.length && timingSafeEqual(first, second);
}

function lastUserText(messages) {
  if (!Array.isArray(messages)) return "";
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    if (typeof message.content === "string") return message.content.trim();
    if (Array.isArray(message.content)) {
      return message.content
        .filter((part) => part?.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join(" ")
        .trim();
    }
  }
  return "";
}

function openAICompletion(res, model, content, streaming) {
  const id = `chatcmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  if (!streaming) {
    return json(res, 200, {
      id,
      object: "chat.completion",
      created,
      model,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const emit = (delta, finishReason = null) => res.write(`data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`);
  emit({ role: "assistant" });
  for (let offset = 0; offset < content.length; offset += 36) {
    emit({ content: content.slice(offset, offset + 36) });
  }
  emit({}, "stop");
  res.end("data: [DONE]\n\n");
}

async function saveLlm(body, res) {
  try {
    if (body.clear) {
      setLlmConfig({ clear: true });
      clearEmbeddings();
      return json(res, 200, publicLlmStatus({ retrieval: "keyword", checkError: "" }));
    }
    setLlmConfig(body);
    const config = getLlmConfig();
    let checkError = "";
    let retrieval = "keyword";
    if (config.configured) {
      try {
        await probeModel(config);
        retrieval = await indexEmbeddings(config);
      } catch (error) {
        checkError = error.message || "The key was refused.";
        clearEmbeddings();
      }
    } else {
      clearEmbeddings();
    }
    return json(res, 200, publicLlmStatus({ retrieval, checkError }));
  } catch (error) {
    return json(res, 400, { error: error.message || "Could not save that model." });
  }
}

function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  if (req.method === "GET" || req.method === "HEAD") return {};
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function serveStatic(pathname, res) {
  const requestPath = pathname === "/" ? "/index.html" : pathname;
  for (const rootMap of staticRoots) {
    if (rootMap.prefix !== "/" && !requestPath.startsWith(rootMap.prefix)) continue;
    const rel = (rootMap.prefix === "/" ? requestPath : requestPath.slice(rootMap.prefix.length)).replace(/^[/\\]+/, "");
    const filePath = path.normalize(path.join(rootMap.dir, rel));
    if (!filePath.startsWith(rootMap.dir)) continue;
    try {
      const body = await readFile(filePath);
      const ext = path.extname(filePath);
      res.writeHead(200, {
        "Content-Type": types[ext] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(body);
      return;
    } catch {
      if (rootMap.prefix !== "/") return json(res, 404, { error: "Not found" });
    }
  }
  return json(res, 404, { error: "Not found" });
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
app.use("/design-system", express.static(path.join(root, "design-system")));
app.use(express.static(path.join(root, "public")));
app.use(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    if (!res.headersSent) json(res, 500, { error: error.message || "Something broke" });
  }
});

export default app;

const llmConfig = getLlmConfig();
if (llmConfig.configured) indexEmbeddings(llmConfig).catch(() => {});

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Nova screen at http://localhost:${port}`);
  });
}

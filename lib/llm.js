import { recordInterviewTokens } from "./interview-limit.js";

const GEMINI_ROOT = "https://generativelanguage.googleapis.com/v1beta";

let override = null;

export function getLlmConfig() {
  const apiKey = (override?.apiKey || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "").trim();
  const baseUrl = (
    override?.baseUrl ||
    process.env.LLM_BASE_URL ||
    GEMINI_ROOT
  ).replace(/\/$/, "");
  const model = override?.model || process.env.LLM_MODEL || "gemini-flash-latest";
  const gemini = isGemini({ baseUrl, model });
  const embeddingModel =
    override?.embeddingModel ||
    process.env.LLM_EMBEDDING_MODEL ||
    (gemini ? "gemini-embedding-001" : "text-embedding-3-small");
  let keySource = "none";
  if (override?.apiKey) keySource = "pasted";
  else if (process.env.LLM_API_KEY || process.env.OPENAI_API_KEY) keySource = "env";
  const fallbackApiKey = (process.env.LLM_FALLBACK_API_KEY || "").trim();
  const fallbackBaseUrl = (
    process.env.LLM_FALLBACK_BASE_URL || "https://api.meta.ai/v1"
  ).replace(/\/$/, "");
  const fallbackModel = (process.env.LLM_FALLBACK_MODEL || "muse-spark-1.3-contributor").trim();
  const requestedPrimary = (override?.provider || process.env.LLM_PRIMARY || "").trim().toLowerCase();
  const fallbackConfigured = Boolean(fallbackApiKey);
  const copilotModel = (process.env.LLM_COPILOT_MODEL || "").trim();
  const primary = resolvePrimary({ requestedPrimary, gemini, fallbackConfigured, apiKey });
  return {
    apiKey,
    baseUrl,
    model,
    embeddingModel,
    configured: primary !== "builtin" && (Boolean(apiKey) || (primary === "meta" && fallbackConfigured)),
    keySource,
    fallbackApiKey,
    fallbackBaseUrl,
    fallbackModel,
    fallbackConfigured,
    copilotModel,
    primary,
    chatModel: primary === "builtin" ? "built-in interview controller" : primary === "meta" ? fallbackModel : model,
    provider: primary,
  };
}

function resolvePrimary({ requestedPrimary, gemini, fallbackConfigured, apiKey }) {
  if (requestedPrimary === "builtin") return "builtin";
  if (requestedPrimary === "openai" && apiKey) return "openai";
  if (requestedPrimary === "meta" && fallbackConfigured) return "meta";
  if (requestedPrimary === "gemini" && gemini && apiKey) return "gemini";
  if (!gemini && apiKey) return "openai";
  if (gemini && apiKey) return "gemini";
  if (fallbackConfigured) return "meta";
  return "gemini";
}

export function setLlmConfig(input = {}) {
  if (input.clear) {
    override = null;
    return getLlmConfig();
  }
  const baseUrl = cleanBase(input.baseUrl || override?.baseUrl || "");
  override = {
    apiKey: input.apiKey ? String(input.apiKey).trim() : override?.apiKey || "",
    baseUrl,
    model: clipSetting(input.model || override?.model || "", 80),
    embeddingModel: clipSetting(input.embeddingModel || override?.embeddingModel || "", 80),
    provider: ["builtin", "meta", "gemini", "openai"].includes(input.provider || override?.provider)
      ? input.provider || override?.provider
      : override?.provider || "",
  };
  if (!override.apiKey && !override.baseUrl && !override.model && !override.embeddingModel && !override.provider) {
    override = null;
  }
  return getLlmConfig();
}

export function publicLlmStatus(extra = {}) {
  const config = getLlmConfig();
  const requested = (process.env.LLM_PRIMARY || "").trim().toLowerCase();
  const defaultProvider = ["builtin", "meta", "gemini", "openai"].includes(requested)
    ? requested
    : config.primary;
  return {
    configured: config.configured,
    model: config.model,
    baseUrl: config.baseUrl,
    embeddingModel: config.embeddingModel,
    keySource: config.keySource,
    fallbackConfigured: config.fallbackConfigured,
    fallbackModel: config.fallbackConfigured ? config.fallbackModel : "",
    primary: config.primary,
    chatModel: config.chatModel,
    copilotModel: config.copilotModel,
    provider: config.provider,
    defaults: {
      provider: defaultProvider,
      baseUrl: process.env.LLM_BASE_URL || GEMINI_ROOT,
      model: process.env.LLM_MODEL || "gemini-flash-latest",
      embeddingModel: process.env.LLM_EMBEDDING_MODEL || "gemini-embedding-001",
    },
    ...extra,
  };
}

export function isGemini(config) {
  return (
    /generativelanguage\.googleapis\.com/i.test(config.baseUrl || "") ||
    /^gemini/i.test(config.model || "")
  );
}

let metaUnavailable = false;

export async function chatComplete(config, { messages, tools, fallback = true }) {
  const providers = chatProviders(config, fallback);
  if (!providers.includes("openai")) {
    const errors = [];
    for (const provider of providers) {
      try {
        if (provider === "meta") {
          const message = await metaChat(config, { messages });
          return { ...message, provider: "meta" };
        }
        const message = await geminiChat(config, { messages, tools });
        return { ...message, provider: "gemini" };
      } catch (error) {
        if (provider === "meta" && /billing/i.test(error.message || "")) metaUnavailable = true;
        errors.push(error);
      }
    }
    if (errors.length > 1) throw new Error(bothFailedMessage(errors[0], errors[1]));
    throw errors[0] || new Error("The model call failed.");
  }
  const body = {
    model: config.model,
    temperature: 0.3,
    max_tokens: 220,
    messages,
  };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error(await failureMessage(response));
  const data = await response.json();
  const message = data.choices?.[0]?.message;
  if (!message) throw new Error("The model returned nothing.");
  await recordInterviewTokens(data.usage?.total_tokens);
  return { ...message, provider: "openai" };
}

export async function embedTexts(config, input) {
  if (isGemini(config)) return geminiEmbed(config, input);
  const response = await fetch(`${config.baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: config.embeddingModel, input }),
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error(await failureMessage(response));
  const data = await response.json();
  const rows = data.data || [];
  if (rows.length !== input.length) throw new Error("Embeddings came back short.");
  return rows.map((row) => row.embedding);
}

export async function probeModel(config) {
  await chatComplete(config, {
    messages: [{ role: "user", content: "Reply with the word ok." }],
    tools: [],
    fallback: false,
  });
}

async function geminiChat(config, { messages, tools }) {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .filter(Boolean)
    .join("\n\n");
  const body = {
    contents: geminiContents(messages),
    generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (tools?.length) {
    body.tools = [
      {
        functionDeclarations: tools.map((tool) => ({
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
        })),
      },
    ];
  }
  const models = [config.model];
  if (config.model !== "gemini-flash-lite-latest") models.push("gemini-flash-lite-latest");
  let lastError = null;
  for (const model of models) {
    const url = `${geminiRoot(config)}/models/${encodeURIComponent(model)}:generateContent`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-goog-api-key": config.apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    if (response.ok) return readGeminiMessage(await response.json());
    const error = new Error(await failureMessage(response));
    lastError = error;
    if (response.status !== 429 && response.status !== 503) throw error;
  }
  throw lastError || new Error("Gemini is busy right now. The built-in line was kept.");
}

function readGeminiMessage(data) {
  if (data.promptFeedback?.blockReason) throw new Error("Gemini blocked that turn.");
  const parts = data.candidates?.[0]?.content?.parts || [];
  const calls = parts
    .filter((part) => part.functionCall)
    .map((part, index) => ({
      id: `call_${index}`,
      type: "function",
      function: {
        name: part.functionCall.name,
        arguments: JSON.stringify(part.functionCall.args || {}),
      },
    }));
  const text = parts
    .filter((part) => part.text)
    .map((part) => part.text)
    .join("")
    .trim();
  if (!text && !calls.length) throw new Error("Gemini returned nothing.");
  return calls.length ? { content: text || null, tool_calls: calls } : { content: text };
}

async function geminiEmbed(config, input) {
  const model = /text-embedding|^ada/i.test(config.embeddingModel) ? "gemini-embedding-001" : config.embeddingModel;
  const url = `${geminiRoot(config)}/models/${encodeURIComponent(model)}:batchEmbedContents`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-goog-api-key": config.apiKey,
    },
    body: JSON.stringify({
      requests: input.map((text) => ({
        model: `models/${model}`,
        content: { parts: [{ text }] },
      })),
    }),
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error(await failureMessage(response));
  const data = await response.json();
  const rows = data.embeddings || [];
  if (rows.length !== input.length) throw new Error("Embeddings came back short.");
  return rows.map((row) => row.values);
}

function geminiContents(messages) {
  const contents = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "assistant") {
      const parts = [];
      if (message.content) parts.push({ text: message.content });
      for (const call of message.tool_calls || []) {
        let args = {};
        try {
          args = JSON.parse(call.function?.arguments || "{}");
        } catch {
          args = {};
        }
        parts.push({ functionCall: { name: call.function.name, args } });
      }
      if (parts.length) contents.push({ role: "model", parts });
      continue;
    }
    if (message.role === "tool") {
      let response = {};
      try {
        response = JSON.parse(message.content || "{}");
      } catch {
        response = { text: message.content || "" };
      }
      const part = { functionResponse: { name: message.name || "search_knowledge", response } };
      const last = contents[contents.length - 1];
      if (last?.role === "user" && last.parts.every((item) => item.functionResponse)) last.parts.push(part);
      else contents.push({ role: "user", parts: [part] });
      continue;
    }
    contents.push({ role: "user", parts: [{ text: message.content || "" }] });
  }
  return contents.length ? contents : [{ role: "user", parts: [{ text: "Reply with ok." }] }];
}

async function metaChat(config, { messages }) {
  const root = (config.fallbackBaseUrl || "https://api.meta.ai/v1").replace(/\/$/, "");
  const model = config.fallbackModel || "muse-spark-1.3-contributor";
  let response;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetch(`${root}/responses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.fallbackApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          input: metaInput(messages),
          stream: false,
        }),
        signal: AbortSignal.timeout(20000),
      });
    } catch (error) {
      if (error?.name === "TimeoutError" || error?.name === "AbortError") {
        throw new Error("The backup model timed out.");
      }
      throw new Error("The backup model could not be reached.");
    }
    if (response.ok || (response.status !== 429 && response.status !== 503) || attempt === 1) break;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  if (!response.ok) throw new Error(metaFailure(response.status));
  const data = await response.json();
  const text = metaText(data);
  if (!text) throw new Error("The backup model returned nothing.");
  return { content: text };
}

function metaInput(messages) {
  const note =
    "The search tool is not available on this turn. Use the retrieved passages already in the conversation. Reply with the spoken line only.";
  let noted = false;
  const input = [];
  for (const message of messages) {
    if (message.role === "system") {
      const text = `${message.content || ""}${noted ? "" : `\n\n${note}`}`;
      noted = true;
      input.push({ role: "system", content: [{ type: "input_text", text }] });
      continue;
    }
    if (message.role === "assistant") {
      const callNotes = (message.tool_calls || [])
        .map((call) => `${call.function?.name || "tool"} ${call.function?.arguments || ""}`.trim())
        .filter(Boolean);
      const text = [message.content || "", ...callNotes].filter(Boolean).join("\n");
      if (text) input.push({ role: "assistant", content: [{ type: "output_text", text }] });
      continue;
    }
    if (message.role === "tool") {
      input.push({
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Tool result (${message.name || "tool"}):\n${message.content || ""}`,
          },
        ],
      });
      continue;
    }
    input.push({
      role: "user",
      content: [{ type: "input_text", text: message.content || "" }],
    });
  }
  if (!noted) {
    input.unshift({ role: "system", content: [{ type: "input_text", text: note }] });
  }
  return input.length
    ? input
    : [{ role: "user", content: [{ type: "input_text", text: "Reply with ok." }] }];
}

function metaText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const chunks = [];
  for (const item of data?.output || []) {
    if (item?.type === "function_call" || item?.type === "reasoning") continue;
    if (typeof item?.text === "string") chunks.push(item.text);
    for (const part of item?.content || []) {
      if (typeof part?.text === "string" && part.text.trim()) chunks.push(part.text);
    }
  }
  return chunks.join("").trim();
}

function metaFailure(status) {
  if (status === 401 || status === 403) return "The backup key was refused.";
  if (status === 402) return "The backup model needs billing set up.";
  if (status === 429 || status === 503) return "The backup model is busy.";
  return "The backup model call failed.";
}

function chatProviders(config, allowBackup) {
  if (config.primary !== "meta" && !isGemini(config)) return ["openai"];
  const meta = config.fallbackConfigured ? "meta" : null;
  const gemini = config.apiKey && (config.primary === "meta" || isGemini(config)) ? "gemini" : null;
  const ordered = config.primary === "meta" ? [meta, gemini] : [gemini, meta];
  const providers = ordered.filter((name) => name && !(metaUnavailable && name === "meta"));
  return allowBackup ? providers : providers.slice(0, 1);
}

function bothFailedMessage(primary, backup) {
  const primaryText = String(primary?.message || "");
  const backupText = String(backup?.message || "");
  if (/busy/i.test(primaryText) && /busy/i.test(backupText)) {
    return "Both models are busy. The built-in line was kept.";
  }
  if (/billing/i.test(primaryText) || /billing/i.test(backupText)) {
    if (/busy/i.test(primaryText) || /busy/i.test(backupText)) {
      return "Gemini is busy, and Meta needs billing set up. The built-in line was kept.";
    }
    return "Meta needs billing set up. The built-in line was kept.";
  }
  if (/busy/i.test(primaryText) || /busy/i.test(backupText)) {
    return "One model is busy and the other failed. The built-in line was kept.";
  }
  if (/refused/i.test(primaryText) || /refused/i.test(backupText)) {
    return "A model key was refused. The built-in line was kept.";
  }
  if (/nothing/i.test(backupText) || /nothing/i.test(primaryText)) {
    return "A model returned nothing. The built-in line was kept.";
  }
  if (/timed out/i.test(primaryText) || /timed out/i.test(backupText)) {
    return "A model timed out. The built-in line was kept.";
  }
  return "Both models failed. The built-in line was kept.";
}

function geminiRoot(config) {
  if (/generativelanguage\.googleapis\.com/i.test(config.baseUrl || "")) {
    return config.baseUrl.replace(/\/$/, "").replace(/\/models\/[^/]+$/, "");
  }
  return GEMINI_ROOT;
}

function cleanBase(value) {
  const trimmed = String(value || "").trim().replace(/\/$/, "");
  if (!trimmed) return "";
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error("Base URL needs to start with http:// or https://");
  }
  return trimmed;
}

function clipSetting(value, max) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

async function failureMessage(response) {
  const detail = (await response.text())
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-…")
    .replace(/AQ\.[A-Za-z0-9_-]+/g, "AQ…")
    .replace(/AIza[A-Za-z0-9_-]+/g, "AIza…")
    .replace(/LLM_\d+__[A-Za-z0-9_-]+/g, "LLM_…")
    .slice(0, 180);
  if (response.status === 401 || response.status === 403) return "The key was refused.";
  if (response.status === 429 || response.status === 503) return "Gemini is busy right now. The built-in line was kept.";
  return `The model call failed (${response.status}). ${detail}`.trim();
}

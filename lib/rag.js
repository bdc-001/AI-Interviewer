import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { embedTexts, getLlmConfig } from "./llm.js";

function knowledgeDir() {
  const beside = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "knowledge");
  if (existsSync(beside)) return beside;
  return path.join(process.cwd(), "knowledge");
}
const STOP = new Set(
  "a an the and or of to for in on at is are was were be this that it with from as by your you we they i do not".split(
    " "
  )
);

let chunks = [];
let idf = new Map();
let avgLen = 1;
let vectors = null;
let vectorKey = "";
let ready = null;

export function loadKnowledge() {
  if (!ready) ready = buildIndex();
  return ready;
}

export async function retrieve(query, { roleId = "", k = 4 } = {}) {
  await loadKnowledge();
  return rank(query, roleId, k, null);
}

export async function retrieveForRole(query, roleId, k = 4) {
  await loadKnowledge();
  let queryVector = null;
  if (vectors) {
    try {
      const config = getLlmConfig();
      const [embedded] = await embedTexts(config, [query.slice(0, 500)]);
      queryVector = embedded;
    } catch {
      queryVector = null;
    }
  }
  return rank(query, roleId, k, queryVector);
}

export async function indexEmbeddings(config = getLlmConfig()) {
  await loadKnowledge();
  if (!config.configured) {
    vectors = null;
    vectorKey = "";
    return "keyword";
  }
  const fingerprint = `${config.baseUrl}|${config.embeddingModel}|${config.apiKey.slice(-6)}|${chunks.length}`;
  if (vectors && vectorKey === fingerprint) return "embeddings";
  try {
    const embedded = [];
    for (let start = 0; start < chunks.length; start += 16) {
      const batch = chunks.slice(start, start + 16).map((chunk) => chunk.text);
      embedded.push(...(await embedTexts(config, batch)));
    }
    vectors = new Map(chunks.map((chunk, index) => [chunk.id, embedded[index]]));
    vectorKey = fingerprint;
    return "embeddings";
  } catch {
    vectors = null;
    vectorKey = "";
    return "keyword";
  }
}

export function retrievalMode() {
  return vectors ? "embeddings" : "keyword";
}

export function clearEmbeddings() {
  vectors = null;
  vectorKey = "";
}

async function buildIndex() {
  const dir = knowledgeDir();
  const files = (await readdir(dir)).filter((name) => name.endsWith(".md")).sort();
  const sources = [];
  for (const file of files) {
    const raw = await readFile(path.join(dir, file), "utf8");
    sources.push(parseSource(file, raw));
  }
  chunks = sources.flatMap(chunkSource);
  const docs = chunks.map((chunk) => tokenize(chunk.text));
  const df = new Map();
  for (const tokens of docs) {
    for (const token of new Set(tokens)) df.set(token, (df.get(token) || 0) + 1);
  }
  idf = new Map();
  for (const [token, count] of df) {
    idf.set(token, Math.log((docs.length + 1) / (count + 1)) + 1);
  }
  const total = docs.reduce((sum, tokens) => sum + tokens.length, 0);
  avgLen = docs.length ? total / docs.length : 1;
}

function parseSource(file, raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  const meta = {};
  let body = raw;
  if (match) {
    body = match[2];
    for (const line of match[1].split(/\n/)) {
      const split = line.indexOf(":");
      if (split > 0) meta[line.slice(0, split).trim()] = line.slice(split + 1).trim();
    }
  }
  return {
    id: file.replace(/\.md$/, ""),
    title: meta.title || file,
    role: meta.roles && meta.roles !== "all" ? meta.roles : "all",
    text: body.trim(),
  };
}

function chunkSource(source) {
  const paragraphs = source.text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const pieces = [];
  let buffer = "";
  for (const paragraph of paragraphs) {
    const next = buffer ? `${buffer} ${paragraph}` : paragraph;
    if (next.length > 700 && buffer) {
      pieces.push(buffer);
      buffer = paragraph;
    } else {
      buffer = next;
    }
  }
  if (buffer) pieces.push(buffer);
  return pieces.map((text, index) => ({
    id: `${source.id}:${index}`,
    title: source.title,
    role: source.role,
    text,
  }));
}

function rank(query, roleId, k, queryVector) {
  const pool = chunks.filter((chunk) => chunk.role === "all" || chunk.role === roleId);
  const lexical = pool.map((chunk) => ({ chunk, score: lexicalScore(query, chunk) }));
  const lexicalMax = Math.max(...lexical.map((row) => row.score), 0);
  const scored = lexical.map((row) => {
    let score = lexicalMax ? row.score / lexicalMax : 0;
    if (queryVector && vectors?.has(row.chunk.id)) {
      const cosine = cosineSimilarity(queryVector, vectors.get(row.chunk.id));
      score = cosine * 0.75 + score * 0.25;
    }
    return { ...row.chunk, score };
  });
  return scored
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ id, title, text, score }) => ({ id, title, text, score }));
}

function lexicalScore(query, chunk) {
  const queryTokens = tokenize(query);
  const docTokens = tokenize(chunk.text);
  if (!queryTokens.length || !docTokens.length) return 0;
  const tf = new Map();
  for (const token of docTokens) tf.set(token, (tf.get(token) || 0) + 1);
  let score = 0;
  const k1 = 1.2;
  const b = 0.75;
  for (const token of queryTokens) {
    const freq = tf.get(token) || 0;
    if (!freq) continue;
    const weight = idf.get(token) || 0;
    const denom = freq + k1 * (1 - b + b * (docTokens.length / avgLen));
    score += weight * ((freq * (k1 + 1)) / denom);
  }
  return score;
}

function cosineSimilarity(left, right) {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  if (!leftNorm || !rightNorm) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

function tokenize(text) {
  return (String(text || "").toLowerCase().match(/[a-z0-9]{2,}/g) || []).filter((token) => !STOP.has(token));
}

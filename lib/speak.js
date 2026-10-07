import { questionCount } from "./engine.js";
import { getRole } from "./roles.js";
import { chatComplete, getLlmConfig } from "./llm.js";
import { retrieveForRole } from "./rag.js";
import { runTool, searchTool } from "./tools.js";

const MODEL_TURNS = new Set([
  "Vague, so stay here",
  "They named something",
  "Followed what they named",
  "Dug in once",
  "Enough already",
  "Next goal",
  "Follow-up used, moving on",
  "Stayed on this goal",
  "Answered, then waited",
  "Answered at the close",
  "Back to the same goal",
  "Back to the topic",
  "Unsure, so check",
  "Said it more plainly",
  "They said hello",
]);

const OPEN_TURNS = new Set(["Unsure, so check", "Said it more plainly", "They said hello"]);

const ECHO_TURNS = new Set([
  "Vague, so stay here",
  "They named something",
  "Followed what they named",
  "Dug in once",
  "Enough already",
  "Next goal",
  "Follow-up used, moving on",
  "Stayed on this goal",
]);

const MONEY = /\$\s?\d|\b\d{2,3}\s?k\b|\b\d+\s?(?:lpa|lakh|lakhs)\b|\b\d{2,3},\d{3}\b/i;

export async function maybeSpeak(session) {
  session.speech = "built-in";
  session.speechSource = "";
  session.toolsUsed = [];
  session.speechError = "";
  const config = getLlmConfig();
  if (!config.configured || session.mode !== "listening") return;
  const decision = session.lastDecision;
  if (!decision || !MODEL_TURNS.has(decision.title)) return;
  const last = session.messages[session.messages.length - 1];
  if (!last || last.role === "user") return;
  const canonical = last.text;
  const role = getRole(session.roleId);
  const candidate = [...session.messages].reverse().find((message) => message.role === "user")?.text || "";
  try {
    const retrieved = await retrieveForRole(`${candidate}\n${decision.detail}`, session.roleId, 4);
    const spoken = await composeLine({ config, session, role, canonical, decision, candidate, retrieved });
    if (!acceptSpoken({ canonical, generated: spoken.text, decision, candidate })) return;
    last.text = spoken.text;
    session.speech = "model";
    session.speechSource = spoken.provider || "";
    session.toolsUsed = spoken.tools;
  } catch (error) {
    session.speechError = error.message || "The model call failed. Built-in line kept.";
  }
}

export async function composeLine({ config, session, role, canonical, decision, candidate, retrieved }) {
  const passages = retrieved.length
    ? retrieved.map((hit, index) => `[${index + 1}] ${hit.title}\n${hit.text}`).join("\n\n")
    : "Nothing retrieved yet.";
  const prior = session.messages
    .slice(0, -1)
    .slice(-8)
    .map((message) => `${message.role === "user" ? "Candidate" : "Nova"}: ${message.text}`)
    .join("\n");
  const goal = role.goals[session.goalIndex];
  const goals = role.goals
    .map((item, index) => `${index + 1}. ${item.title}: ${item.aim}`)
    .join("\n");
  const conversational = OPEN_TURNS.has(decision.title);
  const messages = [
    {
      role: "system",
      content: `You are Nova, an AI recruiter, in a live first-round interview for the ${role.roleTitle} role at ${role.company}. Write only the next thing you say out loud. No labels, no stage directions.
Talk like a person in the conversation. Use the role, the goal, and what they just said. Do not recite a script.

Interview goals, in order:
${goals}
${goal ? `You are on: ${goal.title}. You need to hear: ${goal.aim}. The question already asked was: "${goal.ask}"` : `Phase: ${session.phase}`}
Tone: ${role.toneGuide}

This turn: ${decision.title}. ${decision.detail}

${conversational ? `A fallback if you need one. Do not copy it, and do not ask the original goal question again:\n${canonical}` : `A safe line, if you stay this close:\n${canonical}`}

Rules:
- One question. Do not add a second.
${conversational ? "- They are stuck or unsure. Ask what is confusing, or explain what you need in plain words. Do not repeat the goal question, and do not say \"piece of work\" unless they said it." : "- Keep the job of the safe question. Use your own words. Do not copy it.\n- If the safe line uses a real detail from their work, keep that detail."}
- Keep it brief and easy to say aloud.
- Never praise, grade, or explain the screening method.
- Do not mention a score, a rank, or whether they passed.
- Do not invent pay or any number that is not in the passages or in what they just said.
- Use the retrieved passages for job facts. If you still need a fact, call search_knowledge. If it is not there, say you do not have it and do not guess.
- Do not call search_knowledge just to rephrase their answer.
- If this turn brings them back from a side topic, acknowledge that topic in a few words, then ask one question about the current goal. Do not keep talking about the side topic.
- Short sentences. ${role.family === "engineering" ? "Do not perform warmth." : "Warm and plain."}`,
    },
    {
      role: "user",
      content: `Recent call:\n${prior || "(just started)"}\n\nRetrieved passages:\n${passages}\n\nWrite Nova's next line only.`,
    },
  ];
  const used = [];
  let provider = "";
  for (let round = 0; round < 3; round += 1) {
    const message = await chatComplete(config, { messages, tools: [searchTool] });
    provider = message.provider || provider;
    const calls = message.tool_calls || [];
    if (calls.length) {
      messages.push({ role: "assistant", content: message.content || null, tool_calls: calls });
      for (const call of calls) {
        let args = {};
        try {
          args = JSON.parse(call.function?.arguments || "{}");
        } catch {
          args = {};
        }
        const name = call.function?.name || "";
        if (name) used.push(name);
        const result = await runTool(name, args, role.id);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name,
          content: JSON.stringify(result),
        });
      }
      continue;
    }
    return { text: cleanLine(message.content || ""), tools: used, provider };
  }
  return { text: "", tools: used, provider };
}

export function acceptSpoken({ canonical, generated, decision, candidate }) {
  const line = cleanLine(generated);
  if (!line || line.length > 700) return false;
  if (questionCount(line) !== questionCount(canonical)) return false;
  if (MONEY.test(line) && !MONEY.test(canonical)) return false;
  if (/\b(you scored|your score|you passed|you failed)\b/i.test(line)) return false;
  if (/\bAI\b/i.test(canonical) && !/\bAI\b/i.test(line)) return false;
  if (/salary|pay/i.test(canonical) && !/salary|pay/i.test(line)) return false;
  if (/keep going/i.test(canonical) && !/keep going/i.test(line)) return false;
  if (OPEN_TURNS.has(decision?.title)) {
    if (questionCount(line) !== 1) return false;
    if (repeatsGoal(line, decision?.goalAsk)) return false;
    return true;
  }
  if (!keepsQuestion(canonical, line)) return false;
  if (ECHO_TURNS.has(decision?.title) && !sharesDetail(candidate, line)) return false;
  return true;
}

function repeatsGoal(generated, goalAsk) {
  const asked = String(goalAsk || "").toLowerCase().match(/[a-z][a-z0-9]{3,}/g) || [];
  const skip = new Set(["tell", "about", "what", "your", "that", "this", "with", "they", "them", "from", "have"]);
  const words = asked.filter((word) => !skip.has(word));
  if (words.length < 3) return false;
  const spoken = generated.toLowerCase();
  const hits = words.filter((word) => spoken.includes(word)).length;
  return hits >= 3;
}

function keepsQuestion(canonical, generated) {
  const asked = canonical.split(/(?<=\?)/).filter((part) => part.includes("?")).pop() || "";
  const words = (asked.toLowerCase().match(/[a-z][a-z0-9]{3,}/g) || []).slice(0, 8);
  if (words.length < 2) return true;
  const spoken = generated.toLowerCase();
  const hits = words.filter((word) => spoken.includes(word)).length;
  return hits >= 1;
}

function sharesDetail(candidate, generated) {
  const words = String(candidate || "").toLowerCase().match(/[a-z0-9]{4,}/g) || [];
  const skip = new Set([
    "that",
    "this",
    "with",
    "have",
    "from",
    "they",
    "them",
    "just",
    "about",
    "what",
    "when",
    "your",
    "mostly",
    "dont",
    "know",
    "sure",
    "idea",
    "nothing",
    "remember",
    "really",
    "think",
    "recently",
    "been",
    "working",
    "started",
    "something",
  ]);
  const useful = words.filter((word) => !skip.has(word));
  if (!useful.length) return true;
  const spoken = generated.toLowerCase();
  return useful.slice(0, 8).some((word) => spoken.includes(word));
}

function cleanLine(text) {
  let line = String(text || "").trim();
  line = line.replace(/^nova:\s*/i, "");
  if (
    (line.startsWith('"') && line.endsWith('"')) ||
    (line.startsWith("“") && line.endsWith("”"))
  ) {
    line = line.slice(1, -1).trim();
  }
  return line;
}

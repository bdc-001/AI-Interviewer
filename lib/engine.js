// Turn policy for the Nova screen.
//
// Mapped from convin go services, voicebot:
// - The listening flow opens with one short AI disclosure and its first role question,
//   then moves through the screen goals and close.
// - Inside the screen phase, each goal behaves like the advance goal agent.
//   A vague reply is not a finished goal. The generic agent template already says this.
//   Customer notes say recruiter screens are not doing it, so it is enforced here.
// - An unfinished sentence gets a backchannel and no new question, same job as the
//   natural_human_pause tool.
// - Facts about the job come from the role knowledge base. Pay is not in it.
// - The score is a post-call note. It is not spoken, and it is not a hire prediction.

import { randomUUID } from "node:crypto";
import { getRole } from "./roles.js";
import { closeSentences, openingLine } from "./prompt.js";

const ACTION =
  /\b(?:i|we)\s+(?:(?:built|rebuilt|wrote|rewrote|migrated|moved|cut|reduced|led|owned|fixed|designed|shipped|debugged|explained|pulled|split|sat|covered|coached|hired|scheduled|closed|opened|dropped|improved|launched|refactored|showed|drew|waited|ran|run|managed|handled|investigated|mentored|tested|measured|decided|prioritized|triaged|automated|optimized|supported|trained|planned|organized|responded|resolved|coordinated|negotiated)\b|(?:was|were)\s+(?:responsible|accountable)\b|(?:took\s+ownership|was\s+in\s+charge)\b)/i;

const VAGUE_LEX =
  /\b(stuff|things|whatever|kinda|kind of|sort of|various|pretty busy|and so on|a lot of things|you know|normal stuff|until they get it)\b/i;

export function createSession({ roleId = "engineer", mode = "listening" } = {}) {
  const role = getRole(roleId);
  const session = {
    id: randomUUID(),
    roleId: role.id,
    mode: mode === "fixed" ? "fixed" : "listening",
    phase: "screen",
    endedAtPhase: null,
    goalIndex: 0,
    goalState: "ask",
    pending: "",
    steeredBack: false,
    evidence: role.goals.map((goal) => ({
      id: goal.id,
      title: goal.title,
      quality: "missing",
      quotes: [],
    })),
    messages: [],
    lastDecision: null,
    score: null,
    done: false,
  };

  if (session.mode === "fixed") {
    const first = role.goals[0];
    pushAssistant(
      session,
      `Hi this is Nova an AI recruiter for ${role.company} about the ${role.roleTitle} role this call may be recorded let's get started. ${first.ask}`,
      {
        title: "Rushed open",
        detail:
          "Disclosure and the first role question run together. This comparison shows how the AI identity can get missed.",
      }
    );
    session.phase = "screen";
  } else {
    pushAssistant(session, openingLine(role), {
      title: "Introduction and first question",
      detail:
        "One brief AI disclosure, the role, and a stop-anytime reminder lead straight into the first role question. No start-permission loop.",
    });
  }

  return session;
}

export function applyTurn(session, text) {
  if (session.done) {
    return pushAssistant(
      session,
      "This screen is already closed. Start another role if you want a fresh pass.",
      {
        title: "Already closed",
        detail: "The note is already written. A new session starts clean.",
      }
    );
  }

  const trimmed = String(text || "").trim();
  if (!trimmed) return snapshot(session);
  if (echoesLastAssistant(session, trimmed)) return snapshot(session);

  session.messages.push({ role: "user", text: trimmed, at: new Date().toISOString() });

  if (session.mode === "fixed") return fixedTurn(session, trimmed);
  return liveTurn(session, trimmed);
}

export function endSession(session) {
  if (session.done) return snapshot(session);
  if (session.mode === "fixed" && !session.score) {
    session.score = opaqueScore();
  }
  if (session.mode === "listening") {
    session.score = buildScore(session);
  }
  session.endedAtPhase = session.phase;
  session.phase = "done";
  session.done = true;
  return pushAssistant(
    session,
    "We'll stop here. You can leave whenever you're ready. Thank you for your time.",
    {
      title: "Ended early",
      detail:
        "Scored whatever was actually heard. Goals we never reached stay missing, and the note says so.",
    }
  );
}

function liveTurn(session, text) {
  const role = getRole(session.roleId);
  const heard = analyze(text);

  if (isNo(text)) return stopPolitely(session, role, "They chose to stop the screen.");
  if (session.phase === "close" && wantsRepeat(text)) return onClose(session, role, text, heard);
  if (session.phase === "screen" && !heard.incomplete && isOffTopic(text, role)) {
    return steerBack(session, role);
  }
  if (heard.topic) return answerQuestion(session, role, heard);

  if (session.phase === "hold") return onHold(session, role, text, heard);
  if (session.phase === "close") return onClose(session, role, text, heard);
  return onScreen(session, role, text, heard);
}

function steerBack(session, role) {
  const goal = role.goals[session.goalIndex];
  if (!session.steeredBack) {
    session.steeredBack = true;
    const lead = role.family === "engineering" ? "We can leave that." : "That's alright.";
    return pushAssistant(session, `${lead} ${goal.shortAsk}`, {
      title: "Back to the topic",
      detail: "That wasn't about this goal. One conversational steer, then the same question.",
    });
  }
  session.steeredBack = false;
  const record = session.evidence[session.goalIndex];
  if (record.quality === "missing") record.quality = "thin";
  return advance(session, role, {
    title: "Follow-up used, moving on",
    detail: "They stayed off this goal. Leaving it instead of interviewing the side topic.",
  });
}

function isOffTopic(text, role) {
  if (extractHooks(text, role).length || ACTION.test(text)) return false;
  return /\b(weather|raining|forecast|netflix|movie|joke|football|cricket|soccer|basketball|pizza|hiking|my dog|my cat|boyfriend|girlfriend|weekend plans|small talk|how are you|what's up|whats up|by the way|unrelated|random question)\b/i.test(
    text
  );
}

function onHold(session, role, text, heard) {
  if (isYes(text)) {
    session.phase = "screen";
    const goal = role.goals[session.goalIndex];
    return pushAssistant(session, goal.shortAsk, {
      title: "Back to the same goal",
      detail: "They asked something. We answered and waited. Now one question, the one we were already on.",
    });
  }
  if (heard.incomplete) {
    remember(session, text);
    return pushAssistant(session, backchannel(role), {
      title: "Waited",
      detail: "Unfinished. Not using the pause to restart the list.",
    });
  }
  session.phase = "screen";
  return onScreen(session, role, text, heard);
}

function onClose(session, role, text, heard) {
  if (wantsRepeat(text)) {
    const again =
      role.family === "engineering"
        ? ["Here it is again, in short.", ...closeSentences(role).slice(0, 4)].join("\n")
        : ["Of course. Here it is again.", ...closeSentences(role).slice(0, 4)].join("\n");
    return pushAssistant(session, again, {
      title: "Repeated the close",
      detail: "Same facts, short sentences. No new information, no new question.",
    });
  }
  return finish(session, "They've heard what happens next.");
}

function onScreen(session, role, text, heard) {
  if (heard.incomplete) {
    remember(session, text);
    return pushAssistant(session, backchannel(role), {
      title: "Waited for them to finish",
      detail:
        "The sentence wasn't done. Backchannel only. This is the pause the tutor hang-up was missing.",
    });
  }

  if (isGreeting(text)) {
    const goal = role.goals[session.goalIndex];
    return pushAssistant(session, greetLine(role), {
      title: "They said hello",
      detail: `They greeted you during the interview for "${goal.title}". Greet them back. Do not recite the goal question and do not mention a piece of work unless they do. One short question about whether they are ready.`,
      goalAsk: goal.ask,
    });
  }

  if (isBareYes(text) || isBareAck(text)) {
    const goal = role.goals[session.goalIndex];
    return pushAssistant(session, goal.shortAsk, {
      title: "Back to the same goal",
      detail: "They agreed, but that is not an example. Ask the current goal once. Do not quote yes, and do not say \"you said\".",
    });
  }

  const spoken = session.pending ? `${session.pending} ${text}`.replace(/\s+/g, " ").trim() : text;
  session.pending = "";
  const goal = role.goals[session.goalIndex];
  const record = session.evidence[session.goalIndex];
  const quality = judge(spoken, role);
  if (!isNonAnswer(spoken)) record.quotes.push(spoken);

  if (session.goalState === "probe") {
    if (quality === "vague" && session.lastDecision?.title === "Unsure, so check" && soundsConfused(spoken)) {
      return pushAssistant(session, plainGoalLine(role, goal), {
        title: "Said it more plainly",
        detail: `They found "${goal.title}" confusing. Explain what you need in your own words and ask one easier question. Do not recite the original question.`,
        goalAsk: goal.ask,
      });
    }
    if (quality === "vague") {
      if (!isNonAnswer(spoken)) record.quality = "thin";
      session.goalState = "ask";
      return advance(session, role, {
        title: "Follow-up used, moving on",
        detail: "Second answer is still general. Leaving it, so this doesn't turn into a loop.",
      });
    }
    if (quality === "solid" && alreadyDeep(spoken)) {
      record.quality = "solid";
      session.goalState = "ask";
      return advance(session, role, {
        title: "Enough already",
        detail: "The follow-up had a reason and a result. No need to ask the same thing again.",
      });
    }
    if (quality === "partial" || (quality === "solid" && shouldDig(role, spoken, quality))) {
      record.quality = quality === "solid" ? "solid" : "partial";
      session.goalState = "dig";
      session.digHook = topHook(spoken, role) || "that";
      return pushAssistant(session, digLine(role, session.digHook, quality), {
        title: "They named something",
        detail: `The follow-up mentioned ${session.digHook}. One question on that. Still not moving to the next goal.`,
      });
    }
    record.quality = "solid";
    session.goalState = "ask";
    return advance(session, role, {
      title: "Follow-up used, moving on",
      detail: "The second pass had a real example. One follow-up was enough.",
    });
  }

  if (session.goalState === "dig") {
    if (record.quality === "partial" || record.quality === "missing") {
      if (!(quality === "vague" && isNonAnswer(spoken))) {
        record.quality = quality === "vague" ? "thin" : "solid";
      }
    }
    session.goalState = "ask";
    const namedDetail = role.family === "frontline" ? topHook(spoken, role) : "";
    const acknowledgment = namedDetail ? `You mentioned ${namedDetail}.` : "";
    return advance(session, role, {
      title: "Dug in once",
      detail: `Followed ${session.digHook || "what they named"}, then left the goal. A screen gets one dig, not a full interview.`,
    }, acknowledgment);
  }

  if (quality === "vague" && isUnsure(spoken)) {
    session.goalState = "probe";
    return pushAssistant(session, clarifyLine(role), {
      title: "Unsure, so check",
      detail: `They don't know how to answer "${goal.title}". You still need to hear: ${goal.aim}. Do not ask that goal again and do not bring up a piece of work unless they do. Ask whether the question is confusing, too broad, or they need it put a simpler way. One question.`,
      goalAsk: goal.ask,
    });
  }

  if (quality === "vague") {
    session.goalState = "probe";
    return pushAssistant(session, probeLine(role, spoken), {
      title: "Vague, so stay here",
      detail: `${goal.title} doesn't have a scene or a personal action yet. One follow-up. The next goal waits.`,
    });
  }

  if (quality === "solid" && alreadyDeep(spoken)) {
    record.quality = "solid";
    return advance(session, role, {
      title: "Enough already",
      detail:
        "They gave a reason and a result. Digging again would be showing off the follow-up, not learning something.",
    });
  }

  if (quality === "partial" || (quality === "solid" && shouldDig(role, spoken, quality))) {
    record.quality = quality === "solid" ? "solid" : "partial";
    session.goalState = "dig";
    session.digHook = topHook(spoken, role) || "that";
    return pushAssistant(session, digLine(role, session.digHook, quality), {
      title: "Followed what they named",
      detail: `They mentioned ${session.digHook}. One question on that, before any next goal.`,
    });
  }

  record.quality = "solid";
  return advance(session, role, {
    title: "Next goal",
    detail: `${goal.title} has something a recruiter could retell. Moving on with one question.`,
  });
}

function advance(session, role, decision, acknowledgment = "") {
  session.goalIndex += 1;
  session.goalState = "ask";
  session.steeredBack = false;
  if (session.goalIndex >= role.goals.length) {
    session.phase = "close";
    return pushAssistant(session, closeSentences(role).join("\n"), {
      title: "Close, one idea at a time",
      detail: "Short sentences. One offer to repeat. No new screen question glued on.",
    });
  }
  const next = role.goals[session.goalIndex];
  const prevQuality = session.evidence[session.goalIndex - 1].quality;
  const line = `${acknowledgment || transitionLine(role, prevQuality)} ${next.ask}`;
  return pushAssistant(session, line, decision);
}

function answerQuestion(session, role, heard) {
  const answer = knowledgeAnswer(role, heard.topic);
  if (heard.topic === "identity" && (session.phase === "screen" || session.phase === "hold")) {
    const goal = role.goals[session.goalIndex];
    session.phase = "screen";
    return pushAssistant(session, `${answer} ${goal.shortAsk}`, {
      title: "Clarified identity and continued",
      detail: "Answered plainly, then returned to the same role question without another start-permission check.",
    });
  }
  if (session.phase === "close") {
    return pushAssistant(session, `${answer}\nWant me to repeat what happens next?`, {
      title: "Answered at the close",
      detail: "Still no invented detail. Offer to repeat the next steps, nothing new.",
    });
  }
  session.phase = "hold";
  return pushAssistant(session, `${answer} Want to keep going with the screen?`, {
    title: "Answered, then waited",
    detail:
      "Did not say a flat 'can't answer' and jump to the next question. If it isn't in the brief, say who can answer, and give them the floor.",
  });
}

function finish(session, why) {
  session.score = session.mode === "fixed" ? opaqueScore() : buildScore(session);
  session.phase = "done";
  session.done = true;
  const role = getRole(session.roleId);
  const closer =
    session.mode === "fixed"
      ? "Thanks, a recruiter will review your profile and get back to you."
      : role.family === "engineering"
        ? "Good. We'll leave it there. You can leave whenever you're ready."
        : "Glad that was clear. You can leave whenever you're ready.";
  return pushAssistant(session, closer, {
    title: "Note written",
    detail: why,
  });
}

function stopPolitely(session, role, why) {
  session.score = buildScore(session);
  session.endedAtPhase = session.phase;
  session.phase = "done";
  session.done = true;
  const line =
    role.family === "engineering"
      ? "Of course. We'll stop here. You can leave whenever you're ready."
      : "No problem at all. We'll stop here. You can leave whenever you're ready.";
  return pushAssistant(session, line, {
    title: "Stopped when they said no",
    detail: why,
  });
}

function fixedTurn(session, text) {
  const role = getRole(session.roleId);
  const record = session.evidence[session.goalIndex];
  if (record) {
    record.quotes.push(text);
    record.quality = "thin";
  }

  const asking = analyze(text).topic;
  if (asking || /\?/.test(text)) {
    session.goalIndex = Math.min(session.goalIndex + 1, role.goals.length);
    const next = role.goals[session.goalIndex];
    const jump = next ? `I can't answer that. ${next.ask}` : fixedClose();
    if (!next) return fixedFinish(session, jump);
    return pushAssistant(session, jump, {
      title: "Dead end, then the script",
      detail: "Refused the question and moved on in the same turn. This is the note about salary and team.",
    });
  }

  const words = wordCount(text);
  const remaining = role.goals.slice(session.goalIndex + 1);
  if (words < 12 && remaining.length >= 2) {
    session.goalIndex = role.goals.length;
    const stacked = remaining
      .map((goal) => goal.ask)
      .join(" ");
    return pushAssistant(session, stacked, {
      title: "Questions stacked",
      detail:
        "Short answer, so the rest of the list came out at once. No follow-up on what they said. This is the tutor hang-up.",
    });
  }

  session.goalIndex += 1;
  if (session.goalIndex >= role.goals.length) return fixedFinish(session, fixedClose());
  return pushAssistant(session, role.goals[session.goalIndex].ask, {
    title: "Next line on the list",
    detail: "Did not use anything they just said. The next question was already written.",
  });
}

function fixedClose() {
  return "Great thanks for your time a recruiter will review your profile and get back to you about next steps shortly if you're a fit for the role and the team so keep an eye on your email.";
}

function fixedFinish(session, line) {
  session.score = opaqueScore();
  session.phase = "done";
  session.done = true;
  return pushAssistant(session, line, {
    title: "Score with no reason",
    detail: "The recruiter sees Medium and nothing under it.",
  });
}

function opaqueScore() {
  return {
    label: "Medium",
    lines: [],
    footnote: "No reason was attached. This is the gap in the note that asks what the score means.",
    opaque: true,
  };
}

function usefulQuotes(row) {
  return (row.quotes || []).map((quote) => String(quote || "").trim()).filter((quote) => quote && !isNonAnswer(quote));
}

function buildScore(session) {
  const rows = session.evidence.map((row) => {
    const useful = usefulQuotes(row);
    let quality = row.quality === "partial" ? "thin" : row.quality;
    if (quality !== "solid" && !useful.length) quality = "missing";
    return { ...row, quality, useful };
  });
  const solid = rows.filter((row) => row.quality === "solid");
  const thin = rows.filter((row) => row.quality === "thin");
  let label = "Low";
  let lead = "Most of the screen stayed general, so there isn't a clear example to hand a recruiter.";
  if (solid.length >= 2) {
    label = "High";
    lead = "Two parts of the screen had a specific example a recruiter could retell.";
  } else if (solid.length === 1 || thin.length >= 1) {
    label = "Medium";
    lead = "There is some real signal, and not enough to treat this as a clear pass on the screen alone.";
  }

  const lines = [lead];
  const quoteSource = solid[0] || thin[0];
  const quote = quoteSource?.useful?.at(-1) || "";
  if (quote) lines.push(`Heard: ${clip(quote, 28)}`);
  const gaps = rows.filter((row) => row.quality !== "solid").map((row) => row.title);
  if (gaps.length) lines.push(`Still thin or missing: ${gaps.join(", ")}.`);

  return {
    label,
    lines: lines.slice(0, 3),
    footnote:
      "This is about how much usable detail the screen heard. It is not a prediction they will be hired. Hire outcomes are a separate check, and this prototype does not have them.",
    opaque: false,
  };
}

function knowledgeAnswer(role, topic) {
  const warm = role.family === "frontline";
  if (topic === "pay") {
    return warm
      ? "I don't know the pay, and I don't want to guess a number. The person who talks to you next can go through that. Fair question."
      : "I don't have a salary range, and I won't invent one. The recruiter covers pay if you both go further. Fair thing to ask.";
  }
  if (topic === "team") return role.knowledge.team;
  if (topic === "place") return role.knowledge.place;
  if (topic === "hours") return role.knowledge.hours;
  if (topic === "role") return role.knowledge.role;
  if (topic === "next") return role.knowledge.next;
  if (topic === "identity") {
    return warm
      ? "I'm Nova. I'm an AI, not a person from the team. Happy to say that as plainly as you need."
      : "I'm Nova, an AI. Not a person, and not a recruiter on the hiring team.";
  }
  return warm
    ? "I don't have that in front of me, so I won't make it up. Someone on the team can answer it."
    : "That's outside what I was given for this call, so I won't guess. A recruiter can take it.";
}

function probeLine(role, text) {
  const bit = clip(text, 12);
  if (role.family === "engineering") {
    return `You said "${bit}." Pick one system you personally changed. What did you change?`;
  }
  return `You said "${bit}." Tell me about one real moment. What did you do?`;
}

function clarifyLine(role) {
  return role.family === "engineering"
    ? "That's alright. Is the question unclear, or is it just hard to think of an example?"
    : "That's okay. Is the question unclear, or do you want me to put it a simpler way?";
}

function plainGoalLine(role, goal) {
  const aim = goal.aim.replace(/\.$/, "");
  const lead = role.family === "engineering" ? "No problem." : "That's fair.";
  return `${lead} I'm looking for ${aim.charAt(0).toLowerCase()}${aim.slice(1)}. What comes to mind?`;
}

function soundsConfused(text) {
  return /\b(confus\w*|unclear|don't understand|didn't understand|didnt understand|what do you mean|too broad|not clear|lost me|simpler)\b/i.test(
    text
  );
}

function isNonAnswer(text) {
  if (wordCount(text) > 12 || ACTION.test(text)) return false;
  return /\b(?:don'?t know|do not know|don'?t remember|do not remember|not sure|no idea|can'?t remember|cannot remember|can'?t think|cannot think|nothing comes to mind|idk)\b/i.test(text);
}

function isUnsure(text) {
  return isNonAnswer(text);
}

function digLine(role, hook, quality) {
  const named = role.family === "frontline" && /^\d/.test(hook) ? `a ${hook}` : hook;
  if (role.family === "engineering" && quality === "solid") {
    return `You mentioned ${named}. What made that the right call?`;
  }
  if (role.family === "engineering") {
    return `You mentioned ${named}. What did you personally do with it?`;
  }
  return `You mentioned ${named}. What did you do right then?`;
}

function transitionLine(role, quality) {
  if (quality === "thin" || quality === "missing" || quality === "partial") {
    return role.family === "engineering" ? "Okay, I'll move on." : "Okay, we can leave that there.";
  }
  return "Got it.";
}

function shouldDig(role, text, quality) {
  if (!topHook(text, role)) return false;
  // A frontline answer that already says what they did does not need a second dig.
  // Engineering still gets one, unless the answer already had a reason and a result.
  if (role.family === "frontline" && quality === "solid") return false;
  return true;
}

function alreadyDeep(text) {
  const reason = /\b(because|so that|in order to|the reason|trade-?off)\b/i.test(text);
  const result = /\b(cut|reduced|dropped|from|down to|p\d{2}|%)\b/i.test(text) || /\d/.test(text);
  return reason && result;
}

export function judge(text, role) {
  const words = wordCount(text);
  const hooks = extractHooks(text, role);
  const action = ACTION.test(text);
  const vagueLex = VAGUE_LEX.test(text);

  if (hooks.length && action && words >= 8) return "solid";
  if (action && words >= 22) return "solid";
  if (hooks.length && action) return "solid";
  if (vagueLex && hooks.length === 0 && !action) return "vague";
  if (hooks.length) return "partial";
  if (words < 14 && !action) return "vague";
  if (words >= 18) return "partial";
  return "vague";
}

function extractHooks(text, role) {
  const found = [];
  for (const pattern of role.hookPatterns) {
    pattern.lastIndex = 0;
    const matches = text.match(pattern) || [];
    for (const match of matches) {
      const clean = match.replace(/\s+/g, " ").trim();
      if (!clean) continue;
      if (/^(a|an|the)$/i.test(clean)) continue;
      found.push(clean);
    }
  }
  const seen = new Set();
  const unique = [];
  for (const hook of found) {
    const key = hook.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(hook);
  }
  return unique.sort((a, b) => hookRank(b) - hookRank(a));
}

function topHook(text, role) {
  return extractHooks(text, role)[0] || "";
}

function hookRank(hook) {
  if (/\d/.test(hook) && /[a-z%]/i.test(hook) && !/^p\d{2}$/i.test(hook)) return 4;
  if (/\d/.test(hook) || /^p\d{2}$/i.test(hook)) return 3;
  if (/^(go|kafka|python|react|postgres|kubernetes|grpc|graphql|rust|docker)$/i.test(hook)) return 2;
  return 1;
}

function analyze(text) {
  return {
    incomplete: isIncomplete(text),
    topic: detectTopic(text),
  };
}

function detectTopic(text) {
  const identity = /\b(are you|you're|you are)\b.{0,24}\b(real|human|person|ai|bot|robot)\b|\b(is this|this is)\b.{0,16}\b(ai|a bot|a robot|a person|a human)\b/i.test(
    text
  );
  const directQuestion =
    identity ||
    /\b(what about|can i ask|i wanted to ask|could you tell me|can you tell me|do you know|do you have|what('?s| is) the|where would i|who would i|when would i|how does|how many|how often|are you (a |an )?(real|human|person|ai|bot)|is this (a |an )?(real|human|person|ai|bot))\b/i.test(text);
  const questionMark = /\?\s*$/.test(text);
  if (!directQuestion && !questionMark) return null;
  const t = text.toLowerCase();
  if (identity) return "identity";
  if (/salary|pay range|compensation|\bctc\b|package|how much|wage|hourly/.test(t)) return "pay";
  if (/team|who (would|will|do) i (work|report)|manager|coworker/.test(t)) return "team";
  if (/remote|hybrid|office|location|on site|onsite|where is the/.test(t)) return "place";
  if (/\bhours\b|schedule|weekend|night shift/.test(t)) return "hours";
  if (/what happens next|next step/.test(t)) return "next";
  if (/what('s| is) the (role|job)|what would i (do|be doing)|tell me about the (role|job)/.test(t)) return "role";
  if (directQuestion || questionMark || /\b(benefits|visa|start date|contract|holiday|vacation|leave policy)\b/i.test(t)) return "other";
  return null;
}

function isIncomplete(text) {
  const t = text.trim();
  if (/^(um+|uh+|hmm+|er+|wait|hold on|one sec|one second)[.!\s]*$/i.test(t)) return true;
  if (/[,…]\s*$/.test(t)) return true;
  if (/\b(and|so|but|because|like|or|then|with)\s*$/i.test(t)) return true;
  return false;
}

function isYes(text) {
  const t = text
    .trim()
    .replace(/^(?:um+|uh+|er+|hmm+|oh+|well|so)[,.\s]+/i, "");
  const lead =
    /^(yes|yeah|yep|yup|sure|ok|okay|fine|ready|start|sounds good|let's go|lets go|i'm ready|im ready|that works|good time|i do|go ahead|works for me|yep let's|sure thing|i can talk|i have time|now is fine|that's fine|thats fine|all good)\b/i;
  if (lead.test(t) && !isQualifiedNo(t)) return true;
  if (wordCount(t) > 6 || isQualifiedNo(t)) return false;
  return /\b(yes|yeah|yep|yup|sure|okay|ok|ready|sounds good|go ahead|i can talk|i have time|now is fine|that's fine|thats fine|all good)\b/i.test(t);
}

function isQualifiedNo(text) {
  return /\b(?:but|however)\b|\b(?:not today|not now|can't|cannot|no\b|i(?:'m| am) not\b|i do not\b|i don't\b)/i.test(text);
}

function echoesLastAssistant(session, text) {
  const previous = [...session.messages].reverse().find((message) => message.role === "assistant");
  if (!previous?.text) return false;
  const heard = spokenWords(text);
  const said = spokenWords(previous.text);
  if (heard.length < 4 || said.length < 4) return false;
  const saidSet = new Set(said);
  const hits = heard.filter((word) => saidSet.has(word)).length;
  return hits / heard.length >= 0.72;
}

function spokenWords(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2);
}

function isNo(text) {
  const t = text.trim();
  if (wordCount(t) > 10) return false;
  return /^(?:no|nope|not now|can't|cannot|i can't|im busy|i'm busy|stop|stop now|please stop|(?:can|could) we stop(?: now)?|i want to stop|i'd like to stop|i do not want to continue|i don't want to continue|end (?:the )?(?:screen|interview|call)|hang up|goodbye|bye|no thanks|no thank you)[.!?\s]*$/i.test(t);
}

function isGreeting(text) {
  return /^(?:hi|hello|hey|hiya|good morning|good afternoon|good evening|how are you|how's it going|hows it going)[.!?\s]*$/i.test(
    text.trim()
  );
}

function greetLine(role) {
  return role.family === "engineering"
    ? "Hi. Good to meet you. Want to start, or do you need a second?"
    : "Hi. Good to meet you. Want to start, or shall I give you a second?";
}

function isBareYes(text) {
  const t = text
    .trim()
    .replace(/^(?:um+|uh+|er+|hmm+|oh+|well|so)[,.\s]+/i, "");
  return /^(?:yes|yeah|yep|yup|sure|ok|okay|k|fine|ready|i'?m ready|im ready|sounds good|let'?s go|lets go|go ahead|sure thing|i can talk|i have time|now is fine|that'?s fine|thats fine|all good|let'?s start|lets start)[.!?\s]*$/i.test(t);
}

function isBareAck(text) {
  return /^(thanks|thank you|cool|nice|got it)[.!\s]*$/i.test(text.trim());
}

function wantsRepeat(text) {
  if (/\b(no|nope|don't|do not|no need|that's clear|that is clear|i'm good|im good|all good|thanks)\b/i.test(text)) {
    return false;
  }
  return /\b(say that again|say it again|repeat that|repeat it|didn't catch|did not catch|come again|slower|one more time)\b/i.test(
    text
  );
}

function remember(session, text) {
  if (/^(um+|uh+|hmm+|er+|wait|hold on|one sec|one second)[.!\s]*$/i.test(text.trim())) return;
  session.pending = session.pending ? `${session.pending} ${text}` : text;
}

function backchannel(role) {
  return role.family === "engineering" ? "Go on." : "Take your time. I'm here.";
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function clip(text, words) {
  const parts = text.replace(/\s+/g, " ").trim().split(" ");
  if (parts.length <= words) return parts.join(" ").replace(/[.]+$/, "");
  return parts.slice(0, words).join(" ").replace(/[,:;.]+$/, "");
}

const VAGUE_LIMIT = 3;

export function noteVagueAnswer(session) {
  session.vagueCount = (session.vagueCount || 0) + 1;
  if (session.vagueCount >= VAGUE_LIMIT) {
    session.vagueNotice = {
      id: session.vagueCount,
      text: "This interview is ending after three vague answers.",
    };
    return "end";
  }
  const left = VAGUE_LIMIT - session.vagueCount;
  session.vagueNotice = {
    id: session.vagueCount,
    text:
      left === 1
        ? "That answer is too vague. One more vague answer will end the interview."
        : "That answer is too vague. Please give a specific example.",
  };
  return "warn";
}

export function endForVagueAnswers(session, { keepLine = false } = {}) {
  if (session.done) return snapshot(session);
  session.score = session.mode === "listening" ? buildScore(session) : session.score;
  session.endedAtPhase = session.phase;
  session.phase = "done";
  session.done = true;
  if (!keepLine) {
    const line = "We'll stop here. The answers stayed too vague to continue. You can leave. Thank you for your time.";
    const last = session.messages[session.messages.length - 1];
    if (last?.role === "assistant") last.text = line;
    else session.messages.push({ role: "assistant", text: line, at: new Date().toISOString() });
  }
  session.lastDecision = {
    title: "Ended after vague answers",
    detail: "Three answers were too vague. The interview stopped.",
  };
  return snapshot(session);
}

function pushAssistant(session, text, decision) {
  session.messages.push({ role: "assistant", text, at: new Date().toISOString() });
  session.lastDecision = decision;
  return snapshot(session);
}

export function snapshot(session) {
  const role = getRole(session.roleId);
  return {
    id: session.id,
    roleId: session.roleId,
    mode: session.mode,
    phase: session.phase,
    endedAtPhase: session.endedAtPhase,
    goalIndex: session.goalIndex,
    goalState: session.goalState,
    done: session.done,
    lastDecision: session.lastDecision,
    score: session.score,
    toneName: role.toneName,
    roleLabel: role.label,
    speech: session.speech || "built-in",
    speechSource: session.speechSource || "",
    toolsUsed: session.toolsUsed || [],
    speechError: session.speechError || "",
    pending: session.pending || "",
    steeredBack: Boolean(session.steeredBack),
    voiceToken: session.voiceToken || "",
    voiceUserCount: session.voiceUserCount || 0,
    vagueCount: session.vagueCount || 0,
    vagueNotice: session.vagueNotice || null,
    evidence: session.evidence.map((row) => ({
      id: row.id,
      title: row.title,
      quality: row.quality,
      quotes: row.quotes.slice(),
    })),
    messages: session.messages.map((message) => ({
      role: message.role,
      text: message.text,
      at: message.at || "",
      ...(message.spoken ? { spoken: true } : {}),
    })),
    goals: session.evidence.map((row, index) => ({
      id: row.id,
      title: row.title,
      quality: row.quality,
      quotes: row.quotes.slice(),
      status: goalStatus(session, index, row),
    })),
  };
}

function goalStatus(session, index, row) {
  if (session.mode === "fixed") {
    if (row.quotes.length) return "asked";
    if (index === session.goalIndex && !session.done) return "now";
    return "later";
  }
  if (index > session.goalIndex) return "later";
  if (index < session.goalIndex) return row.quality === "partial" ? "thin" : row.quality;
  if (session.phase === "done" || session.phase === "close") {
    return row.quality === "partial" ? "thin" : row.quality;
  }
  if (session.goalState === "probe" || session.goalState === "dig") return "follow-up";
  return "now";
}

export function restoreSession(data) {
  if (!data || typeof data !== "object" || typeof data.id !== "string" || !data.id) return null;
  const role = getRole(data.roleId);
  if (!Array.isArray(data.messages) || !data.messages.length) return null;
  const evidence = Array.isArray(data.evidence) && data.evidence.length
    ? data.evidence.map((row) => ({
      id: row.id,
      title: row.title,
      quality: row.quality || "missing",
      quotes: Array.isArray(row.quotes) ? row.quotes.slice() : [],
    }))
    : role.goals.map((goal, index) => {
      const shown = Array.isArray(data.goals) ? data.goals[index] : null;
      return {
        id: goal.id,
        title: goal.title,
        quality: shown?.quality || "missing",
        quotes: Array.isArray(shown?.quotes) ? shown.quotes.slice() : [],
      };
    });
  const phases = new Set(["screen", "close", "done", "hold"]);
  return {
    id: data.id,
    roleId: role.id,
    mode: data.mode === "fixed" ? "fixed" : "listening",
    phase: phases.has(data.phase) ? data.phase : "screen",
    endedAtPhase: data.endedAtPhase || null,
    goalIndex: Number.isFinite(Number(data.goalIndex)) ? Number(data.goalIndex) : 0,
    goalState: data.goalState || "ask",
    pending: typeof data.pending === "string" ? data.pending : "",
    steeredBack: Boolean(data.steeredBack),
    voiceToken: typeof data.voiceToken === "string" ? data.voiceToken : "",
    evidence,
    messages: data.messages.map((message) => ({
      role: message.role,
      text: message.text || "",
      at: message.at || "",
      ...(message.spoken ? { spoken: true } : {}),
    })),
    lastDecision: data.lastDecision || null,
    score: data.score || null,
    done: Boolean(data.done),
    speech: data.speech,
    speechSource: data.speechSource,
    toolsUsed: Array.isArray(data.toolsUsed) ? data.toolsUsed : [],
    speechError: data.speechError || "",
    voiceUserCount: Number(data.voiceUserCount) || 0,
    vagueCount: Number(data.vagueCount) || 0,
    vagueNotice: data.vagueNotice?.id ? { id: Number(data.vagueNotice.id), text: String(data.vagueNotice.text || "") } : null,
    turnResults: data.turnResults && typeof data.turnResults === "object" ? data.turnResults : {},
    livekitDispatched: Boolean(data.livekitDispatched),
  };
}

export function questionCount(text) {
  return (text.match(/\?/g) || []).length;
}

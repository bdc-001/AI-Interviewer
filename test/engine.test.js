import test from "node:test";
import assert from "node:assert/strict";
import { applyTurn, createSession, endSession, questionCount } from "../lib/engine.js";
import { buildPrompt } from "../lib/prompt.js";
import { getRole } from "../lib/roles.js";

function say(session, text) {
  return applyTurn(session, text);
}

function last(session) {
  return session.messages[session.messages.length - 1].text;
}

test("the opening discloses AI and immediately asks the first role question", () => {
  const role = getRole("engineer");
  const session = createSession({ roleId: "engineer", mode: "listening" });
  const opening = session.messages[0].text;
  assert.match(opening, /I'm an AI/i);
  assert.match(opening, /software engineer/);
  assert.match(opening, /stop at any time/i);
  assert.match(opening, /Tell me about a piece of work you owned recently/);
  assert.equal(questionCount(opening), 1);
  assert.doesNotMatch(opening, /okay time|should i start|do you have a few minutes/i);
  assert.equal(session.phase, "screen");
  assert.match(session.messages[0].at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(session.lastDecision.title, "Introduction and first question");
});

test("the opening is not repeated if voice transcription echoes Nova", () => {
  const session = createSession({ roleId: "engineer", mode: "listening" });
  const opening = last(session);
  say(session, opening);
  assert.equal(session.messages.length, 1);
  assert.equal(last(session), opening);
  assert.equal(session.phase, "screen");
});

test("the candidate can stop immediately without being asked to confirm twice", () => {
  const session = createSession({ roleId: "engineer", mode: "listening" });
  say(session, "Can we stop?");
  assert.equal(session.done, true);
  assert.equal(session.lastDecision.title, "Stopped when they said no");
  assert.match(last(session), /stop here/i);
});

test("a vague engineering answer stays on the same goal", () => {
  const role = getRole("engineer");
  const session = startScreen("engineer");
  const view = say(session, "I mostly do backend, APIs and stuff.");
  const reply = last(session);
  assert.match(reply, /backend, APIs and stuff/i);
  assert.equal(questionCount(reply), 1);
  assert.equal(reply.includes(role.goals[1].ask), false);
  assert.equal(view.goals[0].status, "follow-up");
  assert.equal(view.goals[1].status, "later");
});

test("an unsure reply asks what is unclear instead of repeating the goal", () => {
  const session = startScreen("engineer");
  say(session, "i dont know");
  assert.equal(session.goalIndex, 0);
  assert.equal(session.lastDecision.title, "Unsure, so check");
  assert.match(last(session), /unclear|confus|simpler|example/i);
  assert.doesNotMatch(last(session), /piece of work/i);
  assert.equal(questionCount(last(session)), 1);
});

test("a greeting is answered without repeating the goal question", () => {
  const session = startScreen("engineer");
  say(session, "hi");
  assert.equal(session.goalIndex, 0);
  assert.equal(session.lastDecision.title, "They said hello");
  assert.match(last(session), /hi|hello|meet you/i);
  assert.doesNotMatch(last(session), /piece of work|personally changed/i);
  assert.equal(questionCount(last(session)), 1);
});

test("a named tool gets one dig, not the next question", () => {
  const role = getRole("engineer");
  const session = startScreen("engineer");
  say(session, "I worked on Kafka.");
  const reply = last(session);
  assert.match(reply, /Kafka/);
  assert.match(reply, /personally do/i);
  assert.equal(questionCount(reply), 1);
  assert.equal(reply.includes(role.goals[1].ask), false);
});

test("a full answer with a reason and a result moves on, using their detail", () => {
  const role = getRole("engineer");
  const session = startScreen("engineer");
  say(
    session,
    "I rebuilt checkout in Go because the Python service timed out under sale traffic. p99 went from 800ms to 180. I owned the service."
  );
  const reply = last(session);
  assert.match(reply, /p99|800ms|Go/);
  assert.equal(reply.includes(role.goals[1].ask), true);
  assert.equal(questionCount(reply), 1);
  assert.equal(session.evidence[0].quality, "solid");
});

test("pay is answered without a next screen question in the same turn", () => {
  const role = getRole("engineer");
  const session = startScreen("engineer");
  say(session, "What's the salary range?");
  const reply = last(session);
  assert.match(reply, /won't invent|don't have a salary/i);
  assert.match(reply, /keep going/i);
  assert.equal(reply.includes(role.goals[0].ask), false);
  assert.equal(reply.includes(role.goals[1].ask), false);
  assert.equal(questionCount(reply), 1);
  assert.doesNotMatch(reply, /I can't answer that/i);
});

test("an unfinished sentence gets no question", () => {
  const session = startScreen("engineer");
  say(session, "So I started the migration and");
  const reply = last(session);
  assert.equal(questionCount(reply), 0);
  assert.match(reply, /Go on/);
  say(session, "I rebuilt the retry path in Go because timeouts were dropping payments. p99 went from 800ms to 180.");
  assert.equal(session.evidence[0].quality, "solid");
});

test("restaurant tone is warmer and a scene gets a follow-up before the next goal", () => {
  const role = getRole("restaurant");
  const session = createSession({ roleId: "restaurant", mode: "listening" });
  const opening = session.messages[0].text;
  assert.match(opening, /I'm an AI recruiter/i);
  assert.match(opening, /restaurant manager/i);
  assert.doesNotMatch(opening, /software engineer/);
  say(session, "Saturday dinner we had a 40 minute wait and two cooks called out.");
  const reply = last(session);
  assert.match(reply, /40 minute wait/i);
  assert.equal(questionCount(reply), 1);
  assert.equal(reply.includes(role.goals[1].ask), false);

  say(session, "I pulled one server onto expo and cut the menu down to the grill.");
  const next = last(session);
  assert.match(next, /expo/i);
  assert.equal(next.includes(role.goals[1].ask), true);
  assert.equal(questionCount(next), 1);
});

test("an identity question is answered without another start-permission prompt", () => {
  const session = createSession({ roleId: "tutor", mode: "listening" });
  say(session, "Are you a real person?");
  const reply = last(session);
  assert.match(reply, /I'm an AI/i);
  assert.match(reply, /Back to a student who is stuck/);
  assert.doesNotMatch(reply, /okay time|keep going|should i start/i);
  assert.equal(session.phase, "screen");
  assert.equal(questionCount(reply), 1);
});

test("the close can be repeated in short sentences", () => {
  const session = finishEngineerScreen();
  assert.equal(session.phase, "close");
  const close = last(session);
  assert.match(close, /recruiter reads this conversation/i);
  assert.equal(questionCount(close), 1);
  say(session, "Can you say that again, slower?");
  const again = last(session);
  assert.match(again, /recruiter reads this conversation/i);
  assert.equal(questionCount(again), 0);
  say(session, "That's clear, thanks");
  assert.equal(session.done, true);
  assert.ok(session.score.lines.length >= 2);
  assert.equal(session.score.opaque, false);
});

test("the candidate can stop even after the interview reaches its close", () => {
  const session = finishEngineerScreen();
  assert.equal(session.phase, "close");
  say(session, "Can we stop?");
  assert.equal(session.done, true);
  assert.equal(session.lastDecision.title, "Stopped when they said no");
  assert.match(last(session), /stop here/i);
});

test("one strong thread is Medium, with a reason, and is not a hire prediction", () => {
  const session = startScreen("engineer");
  say(
    session,
    "I rebuilt checkout in Go because the Python service timed out. p99 went from 800ms to 180."
  );
  endSession(session);
  assert.equal(session.score.label, "Medium");
  assert.ok(session.score.lines.some((line) => /800ms|p99|Heard/i.test(line)));
  assert.match(session.score.footnote, /not a prediction/i);
});

test("a scene after a vague answer is followed, not skipped", () => {
  const role = getRole("restaurant");
  const session = startScreen("restaurant");
  say(session, "Yeah I manage shifts, it's pretty busy.");
  say(session, "Saturday dinner we had a 40 minute wait and two cooks called out.");
  const reply = last(session);
  assert.match(reply, /40 minute wait/i);
  assert.equal(reply.includes(role.goals[1].ask), false);
  assert.equal(questionCount(reply), 1);
});

test("the note quotes the useful answer, not the vague opener", () => {
  const session = startScreen("engineer");
  say(session, "I mostly do backend, APIs and stuff.");
  say(
    session,
    "I rebuilt checkout in Go because the Python service timed out. p99 went from 800ms to 180."
  );
  endSession(session);
  const heard = session.score.lines.find((line) => line.startsWith("Heard"));
  assert.match(heard, /checkout|800ms/);
  assert.doesNotMatch(heard, /APIs and stuff/);
});

test("two specific goals score High", () => {
  const session = finishEngineerScreen();
  say(session, "No need to repeat it");
  assert.equal(session.score.label, "High");
  assert.equal(session.score.lines.length <= 3, true);
});

test("fixed list stacks questions, refuses pay, and hides the reason", () => {
  const role = getRole("engineer");
  const session = createSession({ roleId: "engineer", mode: "fixed" });
  const opening = session.messages[0].text;
  assert.match(opening, /recorded/i);
  assert.equal(opening.includes(role.goals[0].ask), true);

  say(session, "I mostly do backend, APIs and stuff.");
  const stacked = last(session);
  assert.ok(questionCount(stacked) >= 2);
  assert.equal(stacked.includes(role.goals[1].ask), true);
  assert.equal(stacked.includes(role.goals[2].ask), true);

  const pay = createSession({ roleId: "engineer", mode: "fixed" });
  say(pay, "What's the salary range?");
  assert.match(last(pay), /I can't answer that/i);
  assert.match(last(pay), /\?/);
});

test("an off-topic reply comes back to the current goal, then moves on", () => {
  const session = startScreen("engineer");
  say(session, "The weather is nice. I watched a movie last night.");
  assert.equal(session.goalIndex, 0);
  assert.equal(session.lastDecision.title, "Back to the topic");
  assert.match(last(session), /piece of work you owned/i);
  assert.equal(questionCount(last(session)), 1);

  say(session, "Anyway, tell me a joke about pizza.");
  assert.equal(session.goalIndex, 1);
  assert.equal(session.lastDecision.title, "Follow-up used, moving on");
  assert.equal(questionCount(last(session)), 1);
});

test("a vague work answer stays a probe and is not treated as off topic", () => {
  const session = startScreen("engineer");
  say(session, "I mostly do backend, APIs and stuff.");
  assert.equal(session.lastDecision.title, "Vague, so stay here");
  assert.equal(session.goalIndex, 0);
});

test("prompt names the role, bans invented pay, and keeps one question per turn", () => {
  const prompt = buildPrompt("engineer");
  assert.match(prompt, /software engineer/);
  assert.match(prompt, /Do not invent it/);
  assert.match(prompt, /One question per turn/);
  assert.match(prompt, /natural enough|unfinished/i);
  assert.match(prompt, /not a prediction/i);
  assert.match(prompt, /bring them back/i);
  const tutor = buildPrompt("tutor");
  assert.match(tutor, /Warm and plain/);
  assert.doesNotMatch(tutor, /Formal and plain/);
});

function startScreen(roleId) {
  return createSession({ roleId, mode: "listening" });
}

function finishEngineerScreen() {
  const session = startScreen("engineer");
  say(
    session,
    "I rebuilt checkout in Go because the Python service timed out under sale traffic. p99 went from 800ms to 180. I owned the service."
  );
  say(
    session,
    "I wrote the two outcomes down with the PM, because the ticket only said make it faster, and we cut scope to the timeout path. It dropped from 800ms."
  );
  say(
    session,
    "We dropped the extra cache, because it was serving stale totals. p99 went from 400ms to 200ms."
  );
  return session;
}

import test from "node:test";
import assert from "node:assert/strict";
import { getRole } from "../lib/roles.js";
import { applySpokenLine, buildVapiPrompt, countVoiceUserTurns, isNewVoiceTurn } from "../lib/voice.js";

test("Vapi prompt follows Nova's candidate-screen policy and active role", () => {
  const prompt = buildVapiPrompt(getRole("restaurant"));
  assert.match(prompt, /AI recruiter conducting a first-round screen/i);
  assert.match(prompt, /restaurant manager at Harbor/i);
  assert.match(prompt, /connected Muse endpoint is Nova's interview controller/i);
  assert.match(prompt, /never guess a salary or range/i);
  assert.match(prompt, /Keep recruiter notes, evidence ratings, and internal reasoning private/i);
  assert.match(prompt, /immediately ask the first role question/i);
  assert.match(prompt, /Do not ask if now is okay or whether to start/i);
  assert.match(prompt, /young adult female voice/i);
});

test("fixed-script Vapi prompt preserves the comparison behavior", () => {
  const prompt = buildVapiPrompt(getRole("engineer"), "fixed");
  assert.match(prompt, /fixed-call-script comparison/i);
  assert.match(prompt, /including its deliberately stacked questions/i);
  assert.match(prompt, /Do not add an extra consent or expectations turn/i);
});

test("voice turn retries deduplicate without dropping a repeated answer", () => {
  const firstYes = [{ role: "user", content: "Yes" }];
  const secondYes = [
    { role: "user", content: "Yes" },
    { role: "assistant", content: "Should I start?" },
    { role: "user", content: "Yes" },
  ];

  assert.equal(countVoiceUserTurns(firstYes), 1);
  assert.equal(isNewVoiceTurn(firstYes, 0), true);
  assert.equal(countVoiceUserTurns(secondYes), 2);
  assert.equal(isNewVoiceTurn(secondYes, 1), true);
  assert.equal(isNewVoiceTurn(secondYes, 2), false);
});

test("spoken voice line replaces the canned chat reply for the current turn", () => {
  const session = {
    done: false,
    messages: [
      { role: "assistant", text: "Hi, I'm Nova. Tell me about a piece of work you owned." },
      { role: "user", text: "I've worked on a product management project." },
      { role: "assistant", text: "You said \"I've worked on a product management project.\" Pick one system you personally changed. What did you change?" },
    ],
  };

  assert.equal(applySpokenLine(session, "Hi, I'm Nova. Tell me about a piece of work you owned."), false);
  assert.equal(
    applySpokenLine(session, "You mentioned a product management project. What part of it did you personally own?"),
    true,
  );
  assert.equal(session.messages.at(-1).text, "You mentioned a product management project. What part of it did you personally own?");
  assert.equal(session.messages[0].text, "Hi, I'm Nova. Tell me about a piece of work you owned.");
  assert.equal(applySpokenLine(session, "I've worked on a product management project."), false);
});

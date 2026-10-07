import test from "node:test";
import assert from "node:assert/strict";
import { acceptModelReply, parseModelDecision } from "../lib/speak.js";

test("the model decision is read from JSON", () => {
  const parsed = parseModelDecision('{"vague":true,"reply":"What did you personally change in that project?"}');
  assert.equal(parsed.vague, true);
  assert.match(parsed.reply, /personally change/i);
});

test("a copied canned probe is not used as the spoken line", () => {
  assert.equal(acceptModelReply('You said "Yes." Pick one system you personally changed. What did you change?'), false);
  assert.equal(acceptModelReply("What part of that project did you personally change?"), true);
  assert.equal(acceptModelReply("What did you change? And what would you do next?"), false);
});

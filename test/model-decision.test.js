import test from "node:test";
import assert from "node:assert/strict";
import { parseModelDecision } from "../lib/speak.js";

test("the model decision is read from JSON", () => {
  const parsed = parseModelDecision('{"vague":true,"reply":"What did you personally change in that project?"}');
  assert.equal(parsed.vague, true);
  assert.match(parsed.reply, /personally change/i);
});

test("the spoken line is whatever the model returned", () => {
  const parsed = parseModelDecision('{"vague":false,"reply":"What did you change? And what would you do next?"}');
  assert.equal(parsed.vague, false);
  assert.match(parsed.reply, /what would you do next/i);
});

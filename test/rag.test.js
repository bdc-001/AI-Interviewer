import test from "node:test";
import assert from "node:assert/strict";
import { retrieve } from "../lib/rag.js";
import { acceptSpoken } from "../lib/speak.js";

test("salary questions retrieve the pay boundary, not a number", async () => {
  const hits = await retrieve("what is the salary range", { roleId: "engineer", k: 3 });
  assert.ok(hits.length);
  const text = hits.map((hit) => hit.text).join(" ");
  assert.match(text, /do not invent a salary|Pay is not in this brief/i);
  assert.doesNotMatch(text, /\$\d/);
});

test("engineer team facts come from the engineer brief", async () => {
  const hits = await retrieve("how big is the payments team", { roleId: "engineer", k: 2 });
  assert.match(hits[0].text, /seven people/i);
  assert.equal(hits[0].title, "Software engineer brief");
});

test("restaurant and tutor briefs stay on their own roles", async () => {
  const restaurant = await retrieve("assistant manager downtown", { roleId: "restaurant", k: 1 });
  assert.match(restaurant[0].text, /assistant manager/i);
  const tutor = await retrieve("coordinator sample session online", { roleId: "tutor", k: 1 });
  assert.match(tutor[0].text, /coordinator/i);
  assert.match(tutor[0].text, /online/i);
});

test("a query with no words in the brief retrieves nothing", async () => {
  const hits = await retrieve("quantum origami glacier", { roleId: "engineer", k: 3 });
  assert.equal(hits.length, 0);
});

test("a spoken line may be plainer and still has to keep the question and their words", () => {
  const canonical = `You said "I mostly do backend, APIs and stuff." Pick one system you personally changed. What did you change?`;
  const decision = { title: "Vague, so stay here", detail: "One follow-up." };
  const candidate = "I mostly do backend, APIs and stuff.";
  assert.equal(
    acceptSpoken({
      canonical,
      generated: `You said "backend, APIs and stuff." What one system did you personally change?`,
      decision,
      candidate,
    }),
    true
  );
  assert.equal(
    acceptSpoken({
      canonical,
      generated: "What did you change? And what would you do differently?",
      decision,
      candidate,
    }),
    false
  );
  assert.equal(
    acceptSpoken({
      canonical,
      generated: "What one system did you personally change?",
      decision,
      candidate,
    }),
    false
  );
});

test("an unsure reply can ask about confusion and must not recite the goal", () => {
  const goalAsk = "Tell me about a piece of work you owned recently. What did it do, and what was your part?";
  const decision = {
    title: "Unsure, so check",
    detail: "Ask whether the question is confusing.",
    goalAsk,
  };
  assert.equal(
    acceptSpoken({
      canonical: "That's alright. Is the question unclear, or is it just hard to think of an example?",
      generated: "No problem. Is that question confusing, or do you just need a second?",
      decision,
      candidate: "i dont know",
    }),
    true
  );
  assert.equal(
    acceptSpoken({
      canonical: "That's alright. Is the question unclear, or is it just hard to think of an example?",
      generated: "Tell me about a piece of work you owned recently. What was your part?",
      decision,
      candidate: "i dont know",
    }),
    false
  );
});

test("pay answers cannot invent a number", () => {
  const canonical =
    "I don't have a salary range, and I won't invent one. The recruiter covers pay if you both go further. Want to keep going with the screen?";
  const decision = { title: "Answered, then waited", detail: "No invented detail." };
  assert.equal(
    acceptSpoken({
      canonical,
      generated: "I don't have the salary, and I won't invent one. Want to keep going with the screen?",
      decision,
      candidate: "What's the salary range?",
    }),
    true
  );
  assert.equal(
    acceptSpoken({
      canonical,
      generated: "The range is about 180k. Want to keep going with the screen?",
      decision,
      candidate: "What's the salary range?",
    }),
    false
  );
});

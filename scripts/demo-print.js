import { applyTurn, createSession } from "../lib/engine.js";

function run(title, role, mode, lines) {
  console.log("\n==== " + title + " ====");
  const session = createSession({ roleId: role, mode });
  const dump = () => {
    const message = session.messages[session.messages.length - 1];
    console.log("\nNOVA: " + message.text.replaceAll("\n", " | "));
    console.log("  [" + session.lastDecision.title + "] " + session.lastDecision.detail);
  };
  dump();
  for (const line of lines) {
    console.log("\nTHEM: " + line);
    applyTurn(session, line);
    dump();
  }
  if (session.score) {
    console.log("\nSCORE " + session.score.label);
    for (const line of session.score.lines) console.log(" - " + line);
    console.log(session.score.footnote);
  }
}

run("engineer listen", "engineer", "listening", [
  "Yes",
  "Yes",
  "I mostly do backend, APIs and stuff.",
  "I rebuilt checkout in Go because the Python service timed out under sale traffic. p99 went from 800ms to 180. I owned the service.",
  "What's the salary range?",
  "Yes",
  "So I started the migration and",
  "I wrote the two outcomes down with the PM, because the ticket only said make it faster, and we cut scope to the timeout path. It dropped from 800ms.",
  "We dropped the extra cache, because it was serving stale totals. p99 went from 400ms to 200ms.",
  "Can you say that again, slower?",
  "That's clear",
]);

run("restaurant", "restaurant", "listening", [
  "Yeah",
  "Sure",
  "Yeah I manage shifts, it's pretty busy.",
  "Saturday dinner we had a 40 minute wait and two cooks called out.",
  "I pulled one server onto expo and cut the menu down to the grill.",
  "What's the team like?",
]);

run("tutor", "tutor", "listening", [
  "Yes",
  "Ready",
  "I explain things until they get it.",
  "A seventh grader was stuck on fractions for three weeks.",
  "I had him split a chocolate bar, then we wrote the same cut as numbers.",
]);

run("fixed", "engineer", "fixed", ["I mostly do backend, APIs and stuff."]);

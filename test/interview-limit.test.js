import test from "node:test";
import assert from "node:assert/strict";
import { interviewLimitMessage, reserveInterview, resetInterviewLimit } from "../lib/interview-limit.js";

test("only ten interviews can start, and the same one can continue", async () => {
  const previous = process.env.INTERVIEW_LIMIT;
  process.env.INTERVIEW_LIMIT = "10";
  resetInterviewLimit();
  try {
    for (let index = 0; index < 10; index += 1) {
      const result = await reserveInterview(`interview-${index}`);
      assert.equal(result.allowed, true);
      assert.equal(result.used, index + 1);
    }
    const blocked = await reserveInterview("interview-10");
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.used, 10);
    assert.equal(blocked.remaining, 0);
    assert.match(interviewLimitMessage(blocked), /10 interviews/);
    const continued = await reserveInterview("interview-3");
    assert.equal(continued.allowed, true);
    assert.equal(continued.used, 10);
  } finally {
    resetInterviewLimit();
    if (previous === undefined) delete process.env.INTERVIEW_LIMIT;
    else process.env.INTERVIEW_LIMIT = previous;
  }
});

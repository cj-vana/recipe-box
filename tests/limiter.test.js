import assert from "node:assert/strict";
import { test } from "node:test";
import { AttemptLimiter } from "../lib/users.js";

function clock(start = Date.UTC(2026, 10, 17, 12)) {
  let now = start;
  return { now: () => now, advance: (ms) => { now += ms; } };
}

test("one username guessed from many addresses pauses new addresses only", () => {
  const time = clock();
  const limiter = new AttemptLimiter({ now: time.now });
  limiter.succeed("198.51.100.7", "erin");
  for (let index = 0; index < 20; index += 1) limiter.fail(`203.0.113.${index + 1}`, "erin", { known: true });
  assert.ok(limiter.waitMinutes("203.0.113.200", "erin") > 0, "a new address waits");
  assert.equal(limiter.waitMinutes("198.51.100.7", "erin"), 0, "an address that signed in as erin before is not locked out");
  assert.equal(limiter.waitMinutes("203.0.113.200", "erin", { checkUsername: false }), 0, "home network sign-ins skip the username limit");
  limiter.succeed("198.51.100.7", "erin");
  assert.equal(limiter.waitMinutes("203.0.113.200", "erin"), 0, "a successful sign-in clears the username count");
  time.advance(31 * 86_400_000);
  for (let index = 0; index < 20; index += 1) limiter.fail(`203.0.113.${index + 1}`, "erin", { known: true });
  assert.ok(limiter.waitMinutes("198.51.100.7", "erin") > 0, "trust in an address lapses after 30 days");
});

test("unknown usernames never get a username counter", () => {
  const limiter = new AttemptLimiter();
  for (let index = 0; index < 50; index += 1) limiter.fail("203.0.113.9", `nobody-${index}`, { known: false });
  assert.equal([...limiter.failures.keys()].filter((key) => key.startsWith("n:")).length, 0);
});

test("a full limiter evicts the oldest address counters, never a username counter", () => {
  const limiter = new AttemptLimiter({ maxKeys: 40 });
  for (let index = 0; index < 5; index += 1) limiter.fail("203.0.113.1", "erin", { known: true });
  for (let index = 0; index < 200; index += 1) limiter.fail(`198.51.100.${index % 250}`, `nobody-${index}`, { known: false });
  assert.ok(limiter.failures.size <= 40, `size ${limiter.failures.size}`);
  assert.equal(limiter.recent("n:erin").length, 5, "erin's count survives the flood");
  limiter.fail("203.0.113.1", "erin", { known: true });
  assert.equal(limiter.recent("u:203.0.113.1|erin").length, 1, "evicted address counters start again");
});

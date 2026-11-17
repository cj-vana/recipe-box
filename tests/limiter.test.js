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
  for (let index = 0; index < 20; index += 1) limiter.fail(`203.0.113.${index + 1}`, "erin");
  assert.ok(limiter.waitMinutes("203.0.113.200", "erin") > 0, "a new address waits");
  assert.equal(limiter.waitMinutes("198.51.100.7", "erin"), 0, "an address that signed in as erin before is not locked out");
  assert.equal(limiter.waitMinutes("203.0.113.200", "erin", { checkUsername: false }), 0, "home network sign-ins skip the username limit");
  limiter.succeed("198.51.100.7", "erin");
  assert.equal(limiter.waitMinutes("203.0.113.200", "erin"), 0, "a successful sign-in clears the username count");
  time.advance(31 * 86_400_000);
  for (let index = 0; index < 20; index += 1) limiter.fail(`203.0.113.${index + 1}`, "erin");
  assert.ok(limiter.waitMinutes("198.51.100.7", "erin") > 0, "trust in an address lapses after 30 days");
});

test("a name that is not an account is counted like one that is", () => {
  const limiter = new AttemptLimiter();
  for (const username of ["erin", "nobody-real"]) {
    for (let index = 0; index < 20; index += 1) limiter.fail(`203.0.113.${index + 1}`, username);
  }
  assert.ok(limiter.waitMinutes("203.0.113.200", "nobody-real") > 0, "twenty misses pause a name with no account");
  assert.equal(limiter.waitMinutes("203.0.113.200", "nobody-real"), limiter.waitMinutes("203.0.113.200", "erin"));
});

test("a flood of addresses never pushes out a username count, and each count stays small", () => {
  const limiter = new AttemptLimiter({ maxKeys: 40 });
  for (let index = 0; index < 5; index += 1) limiter.fail("203.0.113.1", "erin");
  for (let index = 0; index < 200; index += 1) limiter.fail(`198.51.100.${index % 250}`, "nobody");
  assert.ok(limiter.failures.size <= 40, `address counters ${limiter.failures.size}`);
  assert.equal(limiter.recent("n:erin").length, 5, "erin's count survives the flood");
  assert.equal(limiter.recent("n:nobody").length, 20, "a count keeps only the times its limit reads");
  limiter.fail("203.0.113.1", "erin");
  assert.equal(limiter.recent("u:203.0.113.1|erin").length, 1, "evicted address counters start again");
});

test("a flood of names never pushes out a live username count, and names without a slot wait", () => {
  const time = clock();
  const limiter = new AttemptLimiter({ maxUsernames: 30, now: time.now });
  for (let index = 0; index < 20; index += 1) limiter.fail(`203.0.113.${index + 1}`, "erin");
  for (let index = 0; index < 100; index += 1) limiter.fail(`198.51.100.${index}`, `guess-${index}`);
  assert.equal(limiter.usernames.size, 30, "the cap holds");
  assert.equal(limiter.recent("n:erin").length, 20, "erin's count survives the flood");
  assert.ok(limiter.waitMinutes("192.0.2.1", "erin") > 0, "erin stays paused for new addresses");
  assert.ok(limiter.waitMinutes("192.0.2.1", "guess-99") > 0, "a name with no slot waits instead of going uncounted");
  assert.equal(limiter.waitMinutes("192.0.2.1", "guess-99", { checkUsername: false }), 0, "the home network is not held up by a full table");
  time.advance(15 * 60_000);
  assert.equal(limiter.waitMinutes("192.0.2.1", "guess-99"), 0, "slots free when the window passes");
  limiter.clear();
  assert.equal(limiter.usernames.size + limiter.failures.size, 0, "clear forgets every count");
});

test("a failure with no username counts against the address only", () => {
  const limiter = new AttemptLimiter();
  for (let index = 0; index < 20; index += 1) limiter.fail("203.0.113.9", null);
  assert.equal(limiter.usernames.size, 0);
  assert.ok(limiter.waitMinutes("203.0.113.9", null) > 0, "the address is paused");
  assert.equal(limiter.waitMinutes("203.0.113.10", null), 0, "other addresses are not");
});

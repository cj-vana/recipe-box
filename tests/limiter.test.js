import assert from "node:assert/strict";
import { test } from "node:test";
import { AttemptLimiter } from "../lib/users.js";

function clock(start = Date.UTC(2026, 10, 17, 12)) {
  let now = start;
  return { now: () => now, advance: (ms) => { now += ms; } };
}

// A wrong guess: counted when it begins, and never taken back.
function miss(limiter, address, username, options) {
  const attempt = limiter.begin(address, username, options);
  assert.equal(attempt.wait, 0, `${address} ${username} may try`);
}

test("one username guessed from many addresses pauses new addresses only", () => {
  const time = clock();
  const limiter = new AttemptLimiter({ now: time.now });
  limiter.trust("198.51.100.7", "erin");
  for (let index = 0; index < 20; index += 1) miss(limiter, `203.0.113.${index + 1}`, "erin");
  assert.ok(limiter.waitMinutes("203.0.113.200", "erin") > 0, "a new address waits");
  assert.equal(limiter.waitMinutes("198.51.100.7", "erin"), 0, "an address that signed in as erin before is not locked out");
  assert.equal(limiter.waitMinutes("203.0.113.200", "erin", { checkUsername: false }), 0, "home network sign-ins skip the username limit");
  time.advance(16 * 60_000);
  assert.equal(limiter.waitMinutes("203.0.113.200", "erin"), 0, "the pause ends when the window has passed");
  time.advance(31 * 86_400_000);
  for (let index = 0; index < 20; index += 1) miss(limiter, `203.0.113.${index + 1}`, "erin");
  assert.ok(limiter.waitMinutes("198.51.100.7", "erin") > 0, "trust in an address lapses after 30 days");
});

test("a name that is not an account is counted like one that is", () => {
  const limiter = new AttemptLimiter();
  for (const username of ["erin", "nobody-real"]) {
    for (let index = 0; index < 20; index += 1) miss(limiter, `203.0.113.${index + 1}`, username);
  }
  assert.ok(limiter.waitMinutes("203.0.113.200", "nobody-real") > 0, "twenty misses pause a name with no account");
  assert.equal(limiter.waitMinutes("203.0.113.200", "nobody-real"), limiter.waitMinutes("203.0.113.200", "erin"));
});

test("a burst counts every attempt as it begins, so none slip past the limits", () => {
  const limiter = new AttemptLimiter();
  const allowed = Array.from({ length: 30 }, () => limiter.begin("203.0.113.9", "erin")).filter((attempt) => attempt.wait === 0);
  assert.equal(allowed.length, 5, "five tries for one name from one address, however fast they arrive");
});

test("a right password takes its own attempt back out of the counts", () => {
  const limiter = new AttemptLimiter();
  for (let index = 0; index < 19; index += 1) miss(limiter, "203.0.113.9", `name-${index}`);
  const right = limiter.begin("203.0.113.9", "erin");
  assert.equal(right.wait, 0);
  limiter.succeed(right.ticket);
  assert.equal(limiter.recent("a:203.0.113.9").length, 19, "the address count is back to the wrong guesses");
  assert.equal(limiter.nameCount("erin"), 0, "and so is the name count");
  assert.ok(limiter.isTrusted("203.0.113.9", "erin"), "the address is trusted for erin");
});

test("a flood of other names never lowers a name's count, and the name counts never grow", () => {
  const limiter = new AttemptLimiter();
  for (let index = 0; index < 20; index += 1) miss(limiter, `203.0.113.${index + 1}`, "erin");
  const bytes = limiter.names.bytes;
  for (let index = 0; index < 3000; index += 1) miss(limiter, `198.18.${Math.floor(index / 250)}.${index % 250}`, `guess-${index}`);
  assert.ok(limiter.nameCount("erin") >= 20, "erin's count is still there");
  assert.ok(limiter.waitMinutes("192.0.2.1", "erin") > 0, "erin stays paused for new addresses");
  assert.equal(limiter.waitMinutes("192.0.2.1", "fresh-name"), 0, "the flood does not pause a name nobody tried");
  assert.equal(limiter.names.bytes, bytes, "the name counts take the same memory however many names are tried");
});

test("a flood of addresses never touches a name count", () => {
  const limiter = new AttemptLimiter({ maxKeys: 40 });
  for (let index = 0; index < 5; index += 1) miss(limiter, "203.0.113.1", "erin");
  for (let index = 0; index < 200; index += 1) miss(limiter, `198.51.100.${index}`, `nobody-${index}`);
  assert.ok(limiter.failures.size <= 40, `address counters ${limiter.failures.size}`);
  assert.equal(limiter.nameCount("erin"), 5, "erin's count is untouched");
  miss(limiter, "203.0.113.1", "erin");
  assert.equal(limiter.recent("u:203.0.113.1|erin").length, 1, "dropped address counters start again");
});

test("an attempt with no username counts against the address only", () => {
  const limiter = new AttemptLimiter();
  for (let index = 0; index < 20; index += 1) miss(limiter, "203.0.113.9", null);
  assert.ok(limiter.waitMinutes("203.0.113.9", null) > 0, "the address is paused");
  assert.equal(limiter.waitMinutes("203.0.113.10", null), 0, "other addresses are not");
  assert.equal(limiter.nameCount("null"), 0, "no name was counted");
  limiter.clear();
  assert.equal(limiter.failures.size + limiter.nameCount("erin"), 0, "clear forgets every count");
});

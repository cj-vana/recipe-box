import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { JsonWriter, readJsonArray } from "./files.js";

const scrypt = promisify(scryptCallback);
const SCRYPT_COST = { N: 32768, r: 8, p: 1 };
const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_MAX_MEMORY = 96 * 1024 * 1024;
const DAY = 86_400_000;

export const ROLES = ["member", "editor", "admin"];
export const SESSION_DAYS = 30;
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export class AuthError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(String(password), salt, SCRYPT_KEY_LENGTH, { ...SCRYPT_COST, maxmem: SCRYPT_MAX_MEMORY });
  return ["scrypt", SCRYPT_COST.N, SCRYPT_COST.r, SCRYPT_COST.p, salt.toString("base64url"), hash.toString("base64url")].join("$");
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, N, r, p, saltText, hashText] = parts;
  const expected = Buffer.from(hashText, "base64url");
  if (!expected.length) return false;
  const actual = await scrypt(String(password), Buffer.from(saltText, "base64url"), expected.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT_MAX_MEMORY,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function sessionKey(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

function cleanString(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

export function normalizeUsername(value) {
  return cleanString(value, 64).toLowerCase();
}

function checkUsername(username) {
  if (!USERNAME_PATTERN.test(username)) {
    throw new AuthError("Usernames are 3 to 32 characters: lowercase letters, numbers, dots, dashes or underscores, starting with a letter or number.");
  }
  return username;
}

function checkDisplayName(value) {
  const name = cleanString(value, 60);
  if (!name) throw new AuthError("A name is required.");
  return name;
}

function checkRole(value) {
  const role = cleanString(value, 20).toLowerCase();
  if (!ROLES.includes(role)) throw new AuthError("Choose a role: member, editor or admin.");
  return role;
}

export function checkPassword(value) {
  const password = String(value ?? "");
  if (password.length < PASSWORD_MIN_LENGTH) throw new AuthError(`Passwords need at least ${PASSWORD_MIN_LENGTH} characters.`);
  if (password.length > PASSWORD_MAX_LENGTH) throw new AuthError(`Passwords can be at most ${PASSWORD_MAX_LENGTH} characters.`);
  return password;
}

// Failed sign-ins are counted inside a sliding window:
// - per address + username (5) and per address (20): one visitor cannot lock everyone out,
//   because behind the tunnel the address is the visitor's own (cf-connecting-ip);
// - per username from any address (20): many addresses together cannot keep guessing one
//   person's password. Every name tried is counted, whether or not it is an account, so the
//   pause never tells a visitor which names exist. The limit skips addresses that signed in
//   as the person in the last 30 days and sign-ins on the home network, so it cannot lock the
//   real person out, and a successful sign-in resets it.
// Address counters and username counters are kept apart, each in recency order with its own
// cap, so a flood of one kind never pushes out the other. Pushing a real name's count out
// takes 10,000 newer names inside the window, which at 20 tries per address every 15 minutes
// needs 500 addresses. Each counter keeps only the times its limit reads.
export class AttemptLimiter {
  constructor({ windowMs = 15 * 60_000, perUser = 5, perAddress = 20, perUsername = 20, maxKeys = 10_000, maxUsernames = 10_000, trustDays = 30, now = () => Date.now() } = {}) {
    Object.assign(this, { windowMs, perUser, perAddress, perUsername, maxKeys, maxUsernames, trustDays, now });
    this.keep = Math.max(perUser, perAddress, perUsername);
    this.failures = new Map();
    this.usernames = new Map();
    this.trusted = new Map();
  }

  counters(key) {
    return key.startsWith("n:") ? this.usernames : this.failures;
  }

  recent(key) {
    const counters = this.counters(key);
    const now = this.now();
    const list = (counters.get(key) || []).filter((time) => now - time < this.windowMs);
    if (list.length) counters.set(key, list);
    else counters.delete(key);
    return list;
  }

  isTrusted(address, username) {
    const at = this.trusted.get(username)?.get(address);
    return Boolean(at) && this.now() - at < this.trustDays * DAY;
  }

  // Minutes until another attempt is allowed, or 0 when allowed now.
  waitMinutes(address, username, { checkUsername = true } = {}) {
    const checks = [[`u:${address}|${username}`, this.perUser], [`a:${address}`, this.perAddress]];
    if (checkUsername && !this.isTrusted(address, username)) checks.push([`n:${username}`, this.perUsername]);
    const waits = checks
      .map(([key, limit]) => [this.recent(key), limit])
      .filter(([list, limit]) => list.length >= limit)
      .map(([list, limit]) => list.slice(-limit)[0] + this.windowMs - this.now());
    if (!waits.length) return 0;
    return Math.max(1, Math.ceil(Math.max(...waits) / 60_000));
  }

  record(key, time) {
    const counters = this.counters(key);
    const list = [...this.recent(key), time].slice(-this.keep);
    counters.delete(key);
    counters.set(key, list);
  }

  trim(counters, limit) {
    if (counters.size <= limit) return;
    for (const key of [...counters.keys()]) this.recent(key);
    for (const key of [...counters.keys()]) {
      if (counters.size <= limit) break;
      counters.delete(key);
    }
  }

  fail(address, username) {
    const now = this.now();
    this.record(`u:${address}|${username}`, now);
    this.record(`a:${address}`, now);
    this.record(`n:${username}`, now);
    this.trim(this.failures, this.maxKeys);
    this.trim(this.usernames, this.maxUsernames);
  }

  // Forget every count; trusted addresses stay.
  clear() {
    this.failures.clear();
    this.usernames.clear();
  }

  succeed(address, username) {
    this.failures.delete(`u:${address}|${username}`);
    this.usernames.delete(`n:${username}`);
    const addresses = this.trusted.get(username) || new Map();
    addresses.delete(address);
    addresses.set(address, this.now());
    while (addresses.size > 20) addresses.delete(addresses.keys().next().value);
    this.trusted.set(username, addresses);
  }
}

export class UserStore {
  constructor({ dir, now = () => Date.now(), limiter } = {}) {
    this.usersFile = path.join(dir, "users.json");
    this.sessionsFile = path.join(dir, "sessions.json");
    this.dir = dir;
    this.now = now;
    this.limiter = limiter || new AttemptLimiter({ now });
    this.writer = new JsonWriter();
    this.users = [];
    this.sessions = [];
  }

  async init() {
    await mkdir(this.dir, { recursive: true });
    this.users = (await readJsonArray(this.usersFile)).filter((user) => user?.id && user?.username);
    const known = new Set(this.users.map((user) => user.id));
    const now = this.now();
    this.sessions = (await readJsonArray(this.sessionsFile))
      .filter((session) => session?.key && known.has(session.userId) && Date.parse(session.expiresAt) > now);
    if (!this.users.some((user) => user.owner)) {
      const stamp = new Date(now).toISOString();
      this.users.unshift({
        id: randomUUID(), username: "owner", displayName: "Owner", role: "admin", owner: true,
        passwordHash: "", createdAt: stamp, updatedAt: stamp, disabledAt: null, lastSignInAt: null,
      });
    }
    this.decoyHash = await hashPassword(randomBytes(24).toString("hex"));
    await Promise.all([this.persistUsers(), this.persistSessions()]);
    return this;
  }

  owner() {
    return this.users.find((user) => user.owner);
  }

  get(id) {
    return this.users.find((user) => user.id === id) || null;
  }

  publicUser(user) {
    if (!user) return null;
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      owner: Boolean(user.owner),
      hasPassword: Boolean(user.passwordHash),
      disabled: Boolean(user.disabledAt),
      createdAt: user.createdAt,
      lastSignInAt: user.lastSignInAt || null,
    };
  }

  list() {
    return [...this.users]
      .sort((a, b) => Number(Boolean(b.owner)) - Number(Boolean(a.owner)) || a.displayName.localeCompare(b.displayName))
      .map((user) => this.publicUser(user));
  }

  findByUsername(username) {
    const needle = normalizeUsername(username);
    return this.users.find((user) => user.username === needle) || null;
  }

  assertUsernameFree(username, exceptId = null) {
    const taken = this.users.find((user) => user.username === username && user.id !== exceptId);
    if (taken) throw new AuthError("That username is already taken.", 409);
  }

  async create({ displayName, username, role, password }) {
    const name = checkDisplayName(displayName);
    const login = checkUsername(normalizeUsername(username));
    this.assertUsernameFree(login);
    const level = checkRole(role ?? "member");
    const hash = await hashPassword(checkPassword(password));
    const stamp = new Date(this.now()).toISOString();
    const user = {
      id: randomUUID(), username: login, displayName: name, role: level, owner: false,
      passwordHash: hash, createdAt: stamp, updatedAt: stamp, disabledAt: null, lastSignInAt: null,
    };
    this.users.push(user);
    await this.persistUsers();
    return this.publicUser(user);
  }

  // Changes another person's details. `actorId` is the admin making the change. Only the
  // Owner may change the Owner's account, so a second admin cannot take it over.
  async update(id, patch = {}, { actorId } = {}) {
    const user = this.get(id);
    if (!user) return null;
    if (user.owner && actorId !== user.id) throw new AuthError("Only the owner can change the owner's account.", 403);
    const next = { ...user };
    if (patch.displayName !== undefined) next.displayName = checkDisplayName(patch.displayName);
    if (patch.username !== undefined) {
      next.username = checkUsername(normalizeUsername(patch.username));
      this.assertUsernameFree(next.username, user.id);
    }
    if (patch.role !== undefined) {
      next.role = checkRole(patch.role);
      if (user.owner && next.role !== "admin") throw new AuthError("The owner stays an admin.", 409);
      if (user.id === actorId && next.role !== "admin") throw new AuthError("You cannot remove your own admin role.", 409);
    }
    let endSessions = false;
    if (patch.disabled !== undefined) {
      const disable = Boolean(patch.disabled);
      if (disable && user.owner) throw new AuthError("The owner cannot be turned off.", 409);
      if (disable && user.id === actorId) throw new AuthError("You cannot turn off your own sign-in.", 409);
      next.disabledAt = disable ? user.disabledAt || new Date(this.now()).toISOString() : null;
      endSessions = disable;
    }
    if (patch.password !== undefined && patch.password !== "") {
      next.passwordHash = await hashPassword(checkPassword(patch.password));
      endSessions = true;
    }
    next.updatedAt = new Date(this.now()).toISOString();
    Object.assign(user, next);
    await this.persistUsers();
    if (endSessions) await this.endSessionsFor(user.id);
    return this.publicUser(user);
  }

  // A person changing their own name or (admins only) username.
  async updateSelf(id, patch = {}) {
    const user = this.get(id);
    if (!user) return null;
    const allowed = { displayName: patch.displayName };
    if (user.role === "admin" && patch.username !== undefined) allowed.username = patch.username;
    if (allowed.displayName === undefined) delete allowed.displayName;
    return this.update(id, allowed, { actorId: id });
  }

  // `current` is required whenever the person already has a password, except for the Owner
  // acting from the home network (`requireCurrent: false`), who could reach the same result by
  // making a new admin there. Sessions other than `keepToken` end, so a stolen session stops
  // working once the password changes.
  async changePassword(id, { current, next, keepToken = null, address = "local", requireCurrent = true } = {}) {
    const user = this.get(id);
    if (!user) throw new AuthError("Account not found.", 404);
    const fresh = checkPassword(next);
    if (user.passwordHash && requireCurrent) {
      // Wrong current passwords count across addresses like sign-ins. An address where the
      // person signed in with their password skips that count, so someone holding a stolen
      // session cannot stop the real person changing the password.
      const wait = this.limiter.waitMinutes(address, `password:${user.id}`, { checkUsername: !this.limiter.isTrusted(address, user.username) });
      if (wait) throw new AuthError(`Too many attempts. Try again in ${wait} minute${wait === 1 ? "" : "s"}.`, 429, { retryAfterMinutes: wait });
      if (!(await verifyPassword(String(current ?? ""), user.passwordHash))) {
        this.limiter.fail(address, `password:${user.id}`);
        throw new AuthError("Your current password is not right.", 403);
      }
      this.limiter.succeed(address, `password:${user.id}`);
    }
    user.passwordHash = await hashPassword(fresh);
    user.updatedAt = new Date(this.now()).toISOString();
    await this.persistUsers();
    await this.endSessionsFor(user.id, keepToken ? sessionKey(keepToken) : null);
    return this.publicUser(user);
  }

  async remove(id, { actorId } = {}) {
    const user = this.get(id);
    if (!user) return false;
    if (user.owner) throw new AuthError("The owner cannot be deleted.", 409);
    if (user.id === actorId) throw new AuthError("You cannot delete your own account.", 409);
    this.users = this.users.filter((candidate) => candidate.id !== id);
    await this.persistUsers();
    await this.endSessionsFor(id);
    return true;
  }

  async signIn(username, password, { address = "unknown", zone = "public" } = {}) {
    const login = normalizeUsername(username);
    if (!login || !password) throw new AuthError("Enter your username and password.", 400);
    const wait = this.limiter.waitMinutes(address, login, { checkUsername: zone !== "home" });
    if (wait) throw new AuthError(`Too many attempts. Try again in ${wait} minute${wait === 1 ? "" : "s"}.`, 429, { retryAfterMinutes: wait });
    const user = this.findByUsername(login);
    const stored = user?.passwordHash || this.decoyHash;
    const matches = await verifyPassword(String(password), stored);
    if (!user || !user.passwordHash || !matches) {
      this.limiter.fail(address, login);
      throw new AuthError("That username and password do not match.", 401);
    }
    if (user.disabledAt) throw new AuthError("This account is turned off. Ask the person who runs this Recipe Box.", 403);
    this.limiter.succeed(address, login);
    const token = randomBytes(32).toString("base64url");
    const now = this.now();
    this.sessions.push({
      key: sessionKey(token), userId: user.id,
      createdAt: new Date(now).toISOString(), expiresAt: new Date(now + SESSION_DAYS * DAY).toISOString(),
    });
    user.lastSignInAt = new Date(now).toISOString();
    await Promise.all([this.persistSessions(), this.persistUsers()]);
    return { token, user: this.publicUser(user) };
  }

  // Returns the signed-in person for a session token, or null. Sliding expiry: a session
  // used within its last 29 days is pushed out to 30 days again (written at most daily).
  resolve(token) {
    if (!token) return null;
    const key = sessionKey(token);
    const session = this.sessions.find((candidate) => candidate.key === key);
    if (!session) return null;
    const now = this.now();
    if (Date.parse(session.expiresAt) <= now) {
      this.sessions = this.sessions.filter((candidate) => candidate !== session);
      this.persistSessions().catch(() => {});
      return null;
    }
    const user = this.get(session.userId);
    if (!user || user.disabledAt || !user.passwordHash) return null;
    if (Date.parse(session.expiresAt) - now < (SESSION_DAYS - 1) * DAY) {
      session.expiresAt = new Date(now + SESSION_DAYS * DAY).toISOString();
      this.persistSessions().catch(() => {});
    }
    return { user, session };
  }

  async signOut(token) {
    if (!token) return;
    const key = sessionKey(token);
    const before = this.sessions.length;
    this.sessions = this.sessions.filter((session) => session.key !== key);
    if (this.sessions.length !== before) await this.persistSessions();
  }

  async endSessionsFor(userId, keepKey = null) {
    const before = this.sessions.length;
    this.sessions = this.sessions.filter((session) => session.userId !== userId || session.key === keepKey);
    if (this.sessions.length !== before) await this.persistSessions();
  }

  async signOutEverywhere(userId) {
    await this.endSessionsFor(userId);
  }

  persistUsers() { return this.writer.write(this.usersFile, this.users); }
  persistSessions() { return this.writer.write(this.sessionsFile, this.sessions); }
}

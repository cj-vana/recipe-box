import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";

// Reads a JSON file, returning `fallback` when the file does not exist yet.
export async function readJsonFile(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

export async function readJsonArray(file) {
  const value = await readJsonFile(file, []);
  return Array.isArray(value) ? value : [];
}

export async function readJsonObject(file) {
  const value = await readJsonFile(file, {});
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

// Serializes writes and replaces each file atomically (write a temp file, then rename).
export class JsonWriter {
  constructor() {
    this.queue = Promise.resolve();
  }

  write(file, value) {
    const payload = `${JSON.stringify(value, null, 2)}\n`;
    this.queue = this.queue.then(async () => {
      const tempFile = `${file}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(tempFile, payload, { encoding: "utf8", mode: 0o600 });
      await rename(tempFile, file);
    });
    return this.queue;
  }
}

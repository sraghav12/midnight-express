import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseEnvText, applyEnv, loadEnvFile } from "../server/env.js";

test("parses plain, quoted and commented values", () => {
  const env = parseEnvText([
    "# a comment",
    "",
    "PORT=8080",
    "PUBLIC_URL=https://x.example/play   # what the QR encodes",
    'NAME="quoted # not a comment"',
    "SINGLE='s p a c e'",
    "EMPTY=",
    "TREASURY_SECRET_KEY=   # base58, devnet only",
    "NOEQUALS",
    "=nokey",
  ].join("\n"));
  assert.deepEqual(env, {
    PORT: "8080",
    PUBLIC_URL: "https://x.example/play",
    NAME: "quoted # not a comment",
    SINGLE: "s p a c e",
    EMPTY: "",
    TREASURY_SECRET_KEY: "",
  });
});

test("a comment-only value is empty, not the literal comment (the bug that took the chain down)", () => {
  assert.equal(parseEnvText("KEY=   # base58…").KEY, "");
  assert.equal(parseEnvText("KEY=#nospace").KEY, "");
});

test("applyEnv never overrides a real environment variable and skips empties", () => {
  const target = { PORT: "9999" };
  const n = applyEnv({ PORT: "8080", EMPTY: "", NEW: "yes" }, target);
  assert.equal(n, 1);
  assert.deepEqual(target, { PORT: "9999", NEW: "yes" });
});

test("loadEnvFile reads a file into process.env and tolerates a missing one", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "me-env-"));
  const file = path.join(dir, ".env");
  fs.writeFileSync(file, "ME_TEST_VALUE=hello\nME_TEST_EMPTY=\n");
  delete process.env.ME_TEST_VALUE; delete process.env.ME_TEST_EMPTY;
  assert.equal(loadEnvFile(file), 1);
  assert.equal(process.env.ME_TEST_VALUE, "hello");
  assert.equal(process.env.ME_TEST_EMPTY, undefined);
  assert.equal(loadEnvFile(path.join(dir, "nope")), 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

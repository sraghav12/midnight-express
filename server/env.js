// Load .env before ANY other module evaluates. ES imports are hoisted and run in
// order, so this file must be the FIRST import in server/index.js -- sim.js, llm.js
// and agent.js all read process.env into constants at module load. Real env vars
// win; .env only fills in what is unset. Empty values are ignored.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Parse dotenv-style text into { KEY: value }. Rules, in order:
 *   - blank lines and lines starting with # are skipped
 *   - KEY=   # comment        -> empty (skipped by the loader)
 *   - KEY=value   # comment   -> "value"
 *   - KEY="quoted value"      -> quoted value, quotes stripped, inner # kept
 * Pure function so it can be tested without touching process.env.
 */
export function parseEnvText(text) {
  const out = {};
  for (const raw of String(text).split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("="); if (eq < 1) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    const quoted = (v.startsWith('"') && v.endsWith('"') && v.length >= 2) || (v.startsWith("'") && v.endsWith("'") && v.length >= 2);
    if (quoted) v = v.slice(1, -1);
    else {
      if (v.startsWith("#")) v = "";                       // `KEY=   # comment` -> empty
      v = v.replace(/\s+#.*$/, "");                        // `KEY=value   # comment`
    }
    out[k] = v;
  }
  return out;
}

/** Apply a parsed env to `target` (default process.env). Existing keys win. Returns how many were set. */
export function applyEnv(parsed, target = process.env) {
  let loaded = 0;
  for (const [k, v] of Object.entries(parsed)) {
    if (v !== "" && target[k] === undefined) { target[k] = v; loaded++; }
  }
  return loaded;
}

/** Load one .env file into process.env. Missing file is not an error. */
export function loadEnvFile(file) {
  try {
    if (!fs.existsSync(file)) return 0;
    return applyEnv(parseEnvText(fs.readFileSync(file, "utf8")));
  } catch (e) {
    console.warn(`[env] could not read ${file}: ${e.message}`);
    return 0;
  }
}

const here = path.dirname(fileURLToPath(import.meta.url));
const loaded = loadEnvFile(path.join(here, "..", ".env"));
if (loaded) console.log(`[env] loaded ${loaded} value(s) from .env`);

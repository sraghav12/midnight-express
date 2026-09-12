// Load .env before ANY other module evaluates. ES imports are hoisted and run in
// order, so this file must be the FIRST import in server/index.js -- sim.js, llm.js
// and agent.js all read process.env into constants at module load. Real env vars
// win; .env only fills in what is unset. Empty values are ignored.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(here, "..", ".env");
try {
  if (fs.existsSync(envFile)) {
    let loaded = 0;
    for (const raw of fs.readFileSync(envFile, "utf8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("="); if (eq < 1) continue;
      const k = line.slice(0, eq).trim();
      let v = line.slice(eq + 1).trim();
      if (v.startsWith("#")) v = "";                       // `KEY=   # comment` -> empty
      v = v.replace(/\s+#.*$/, "");                        // `KEY=value   # comment`
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (v !== "" && process.env[k] === undefined) { process.env[k] = v; loaded++; }
    }
    if (loaded) console.log(`[env] loaded ${loaded} value(s) from .env`);
  }
} catch (e) { console.warn(`[env] could not read .env: ${e.message}`); }

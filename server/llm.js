/**
 * One tiny provider layer for every LLM call in the project.
 *
 * Three backends, picked at boot and never mid-run:
 *   ifm   IFM K2 Horizon running LOCALLY via Ollama (OpenAI-compatible on :11434)
 *         -- no API key, no network, nothing to rate-limit at 4pm. Apache 2.0.
 *   xai     grok-4.6 over api.x.ai
 *   gemini  Gemini over its OpenAI-compatible endpoint
 *   none    no LLM at all; every caller has a heuristic that must stand on its own
 *
 * LLM_PROVIDER=auto (default) prefers local IFM, then xAI, then Gemini, then none.
 * Sponsor prizes are claimed by which one is actually driving -- never by decoration.
 * Everything is timeout-bounded: a slow model must never stall the 20Hz tick.
 */
// IFM K2 Horizon runs under IFM's own llama.cpp fork -- stock Ollama cannot load
// the 'k2-horizon' architecture. scripts/start-ifm.sh brings this up.
const IFM_URL = process.env.IFM_URL || "http://localhost:8090";
const OLLAMA = process.env.OLLAMA_URL || "http://localhost:11434";
const XAI_MODEL = process.env.XAI_MODEL || "grok-4.6";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";   // catalog moves; set GEMINI_MODEL in .env
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const WANT = process.env.LLM_PROVIDER || "auto";

let resolved = null;   // { provider, model, label }


/**
 * Prove the endpoint answers before trusting it. Serving != working: Ollama will
 * happily list a K2 model it cannot load ("unknown model architecture").
 */
async function worksIFM() {
  try {
    const r = await fetch(`${IFM_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        max_tokens: 4, temperature: 0,
        chat_template_kwargs: { enable_thinking: false },
        messages: [{ role: "user", content: "Say OK" }],
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) return false;
    const j = await r.json();
    return Boolean(j.choices?.[0]?.message?.content);
  } catch { return false; }
}

/** Decide once, at boot. Returns { provider, model, label }. */
export async function resolveProvider() {
  if (resolved) return resolved;

  if (WANT === "none") { resolved = { provider: "none", model: null, label: "heuristic only" }; return resolved; }

  if (WANT === "ifm" || WANT === "auto") {
    if (await worksIFM()) {
      resolved = { provider: "ifm", model: "K2-Horizon-0.9B", label: "IFM K2 Horizon 0.9B (local, no key)" };
      return resolved;
    }
    if (WANT === "ifm") {
      resolved = { provider: "none", model: null, label: "ifm requested but nothing is serving on " + IFM_URL };
      return resolved;
    }
  }

  if ((WANT === "xai" || WANT === "auto") && process.env.XAI_API_KEY) {
    resolved = { provider: "xai", model: XAI_MODEL, label: `xAI ${XAI_MODEL}` };
    return resolved;
  }

  if ((WANT === "gemini" || WANT === "auto") && process.env.GEMINI_API_KEY) {
    resolved = { provider: "gemini", model: GEMINI_MODEL, label: `Gemini ${GEMINI_MODEL}` };
    return resolved;
  }

  resolved = { provider: "none", model: null, label: "heuristic only (no local model, no key)" };
  return resolved;
}

export function providerSync() { return resolved || { provider: "none", model: null, label: "unresolved" }; }

/**
 * One completion. Returns a string, or null on any failure -- callers MUST have
 * a heuristic fallback and must not treat null as exceptional.
 */
/** A specific backend for one call, if its key/endpoint exists; else the default. */
function providerFor(name) {
  if (name === "gemini" && process.env.GEMINI_API_KEY) return { provider: "gemini", model: GEMINI_MODEL, label: `Gemini ${GEMINI_MODEL}` };
  if (name === "xai"    && process.env.XAI_API_KEY)    return { provider: "xai",    model: XAI_MODEL,    label: `xAI ${XAI_MODEL}` };
  if (name === "ifm"    && resolved?.provider === "ifm") return resolved;
  return null;
}

export async function complete(prompt, { maxTokens = 16, timeoutMs = 2500, temperature = 0, thinking = false, provider = null } = {}) {
  const p = (provider && providerFor(provider)) || await resolveProvider();
  if (p.provider === "none") return null;

  const isIFM = p.provider === "ifm";
  const url = isIFM ? `${IFM_URL}/v1/chat/completions`
            : p.provider === "gemini" ? GEMINI_URL
            : "https://api.x.ai/v1/chat/completions";
  const headers = { "content-type": "application/json" };
  if (p.provider === "xai")    headers.authorization = `Bearer ${process.env.XAI_API_KEY}`;
  if (p.provider === "gemini") headers.authorization = `Bearer ${process.env.GEMINI_API_KEY}`;

  try {
    const r = await fetch(url, {
      method: "POST", headers,
      body: JSON.stringify({
        ...(isIFM ? {} : { model: p.model }),
        max_tokens: maxTokens, temperature,
        // K2 Horizon is a reasoning model. Thinking OFF (~0.15s) is fine for
        // rewriting text but it does NOT decide -- asked to pick an option it
        // echoes the prompt. Thinking ON (~2s) picks correctly. Callers choose.
        ...(isIFM ? { chat_template_kwargs: { enable_thinking: thinking } } : {}),
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j.choices?.[0]?.message?.content ?? null;
  } catch { return null; }
}

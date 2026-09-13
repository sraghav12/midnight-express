/**
 * One tiny provider layer for every LLM call in the project.
 *
 * Backends, picked ONCE at boot (LLM_PROVIDER) and never mid-run:
 *   ifm     IFM K2 Horizon 0.9B served LOCALLY by IFM's llama.cpp fork on :8090. No key.
 *   ollama  any model served LOCALLY by Ollama on :11434 (OpenAI-compatible). No key.
 *   xai     Grok over api.x.ai
 *   gemini  Gemini over its OpenAI-compatible endpoint
 *   openai  any OpenAI-compatible endpoint: OpenAI, Groq, Together, vLLM, LM Studio...
 *   none    no LLM at all; every caller has a heuristic that must stand on its own
 *
 * LLM_PROVIDER=auto (default) prefers local models, then keys: ifm -> ollama -> xai ->
 * gemini -> openai -> none. Everything is timeout-bounded: a slow model must never
 * stall the 20 Hz tick, and `complete()` returns null on ANY failure so callers fall
 * back to their heuristic instead of throwing.
 */
const IFM_URL      = (process.env.IFM_URL || "http://localhost:8090").replace(/\/$/, "");
const OLLAMA_URL   = (process.env.OLLAMA_URL || "http://localhost:11434").replace(/\/$/, "");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2";
const XAI_MODEL    = process.env.XAI_MODEL || "grok-4.6";
// The 2.5 names returned 404 for keys created in Sept 2026; the "-latest" alias tracks the catalog.
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";
const GEMINI_URL   = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const OPENAI_BASE  = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const OPENAI_MODEL = process.env.LLM_MODEL || null;      // no default: the endpoint could serve anything
const WANT         = process.env.LLM_PROVIDER || "auto";

let resolved = null;   // provider descriptor, see describe()

/** "llama3.2" -> "Llama", "qwen2.5:1.5b" -> "Qwen", "gpt-4o" -> "GPT". The rival train's name on the board. */
export function shortName(model) {
  const m = /^([a-z]+)(\d*)/i.exec(String(model || ""));
  if (!m) return "Model";
  const w = m[1].toLowerCase();
  if (w === "gpt") return "GPT";
  const name = w[0].toUpperCase() + w.slice(1);
  return w.length === 1 ? name + m[2] : name;   // "K2", but "Llama" not "Llama3"
}

function describe(provider, model = null) {
  const bearer = (k) => (k ? { authorization: `Bearer ${k}` } : {});
  switch (provider) {
    case "ifm":    return { provider, model: "K2-Horizon-0.9B", label: "IFM K2 Horizon 0.9B (local, no key)", rivalName: "K2",
                            url: `${IFM_URL}/v1/chat/completions`, headers: {}, sendModel: false };
    case "ollama": return { provider, model, label: `Ollama ${model} (local, no key)`, rivalName: shortName(model),
                            url: `${OLLAMA_URL}/v1/chat/completions`, headers: {}, sendModel: true };
    case "xai":    return { provider, model, label: `xAI ${model}`, rivalName: "Grok",
                            url: "https://api.x.ai/v1/chat/completions", headers: bearer(process.env.XAI_API_KEY), sendModel: true };
    case "gemini": return { provider, model, label: `Gemini ${model}`, rivalName: "Gemini",
                            url: GEMINI_URL, headers: bearer(process.env.GEMINI_API_KEY), sendModel: true };
    case "openai": return { provider, model, label: `${model} via ${safeHost(OPENAI_BASE)}`, rivalName: shortName(model),
                            url: `${OPENAI_BASE}/chat/completions`, headers: bearer(process.env.LLM_API_KEY), sendModel: true };
    default:       return { provider: "none", model: null, label: "heuristic only", rivalName: null };
  }
}
function safeHost(u) { try { return new URL(u).host; } catch { return u; } }
const none = (label) => ({ ...describe("none"), label });

/**
 * Prove the IFM endpoint answers before trusting it. Serving != working: a server can
 * list a model it cannot load ("unknown model architecture").
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
    return Boolean(extractContent(j));
  } catch { return false; }
}

/** Ollama is up AND the requested model is pulled. We never pull on the player's behalf. */
async function worksOllama() {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return { ok: false, reason: `${OLLAMA_URL} answered HTTP ${r.status}` };
    const j = await r.json();
    const names = (j.models || []).map((m) => m.name || m.model || "");
    const have = names.some((n) => n === OLLAMA_MODEL || n === `${OLLAMA_MODEL}:latest` || n.startsWith(`${OLLAMA_MODEL}:`));
    return have ? { ok: true } : { ok: false, reason: `model "${OLLAMA_MODEL}" not pulled (ollama pull ${OLLAMA_MODEL}); have: ${names.join(", ") || "nothing"}` };
  } catch { return { ok: false, reason: `nothing is serving on ${OLLAMA_URL}` }; }
}

async function pick(want) {
  if (want === "none") return none("heuristic only (LLM_PROVIDER=none)");

  if (want === "ifm" || want === "auto") {
    if (await worksIFM()) return describe("ifm");
    if (want === "ifm") return none(`ifm requested but nothing is serving on ${IFM_URL} (./scripts/start-ifm.sh)`);
  }
  if (want === "ollama" || want === "auto") {
    const r = await worksOllama();
    if (r.ok) return describe("ollama", OLLAMA_MODEL);
    if (want === "ollama") return none(`ollama requested: ${r.reason}`);
  }
  if ((want === "xai" || want === "auto") && process.env.XAI_API_KEY) return describe("xai", XAI_MODEL);
  if ((want === "gemini" || want === "auto") && process.env.GEMINI_API_KEY) return describe("gemini", GEMINI_MODEL);
  if ((want === "openai" || want === "auto") && OPENAI_MODEL && (process.env.LLM_API_KEY || process.env.LLM_BASE_URL)) {
    return describe("openai", OPENAI_MODEL);
  }
  if (want !== "auto") return none(`${want} requested but not configured (missing key or LLM_MODEL)`);
  return none("heuristic only (no local model, no key)");
}

/** Decide once, at boot. Returns the provider descriptor. */
export async function resolveProvider() {
  if (!resolved) resolved = await pick(WANT);
  return resolved;
}

export function providerSync() { return resolved || { provider: "none", model: null, label: "unresolved", rivalName: null }; }

/** A specific backend for one call (DISPATCHER_PROVIDER / RECAP_PROVIDER), if configured; else null. */
function providerFor(name) {
  if (!name) return null;
  if (resolved && resolved.provider === name) return resolved;
  if (name === "gemini" && process.env.GEMINI_API_KEY) return describe("gemini", GEMINI_MODEL);
  if (name === "xai"    && process.env.XAI_API_KEY)    return describe("xai", XAI_MODEL);
  if (name === "openai" && OPENAI_MODEL && (process.env.LLM_API_KEY || process.env.LLM_BASE_URL)) return describe("openai", OPENAI_MODEL);
  return null;   // local backends (ifm, ollama) count only once verified as the main brain
}

/** The assistant text out of an OpenAI-style chat completion, or null. */
export function extractContent(j) {
  const c = j?.choices?.[0]?.message?.content;
  return typeof c === "string" && c.length ? c : null;
}

/**
 * One completion. Returns a string, or null on any failure -- callers MUST have
 * a heuristic fallback and must not treat null as exceptional.
 */
export async function complete(prompt, { maxTokens = 16, timeoutMs = 2500, temperature = 0, thinking = false, provider = null } = {}) {
  const p = (provider && providerFor(provider)) || await resolveProvider();
  if (p.provider === "none") return null;

  const body = { max_tokens: maxTokens, temperature, messages: [{ role: "user", content: prompt }] };
  if (p.sendModel) body.model = p.model;
  // K2 Horizon is a reasoning model. Thinking OFF (~0.15s) is fine for rewriting text
  // but it does NOT decide -- asked to pick an option it echoes the prompt. Thinking ON
  // (~2s) picks correctly. Callers choose per call.
  if (p.provider === "ifm") body.chat_template_kwargs = { enable_thinking: thinking };

  try {
    const r = await fetch(p.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...p.headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return null;
    return extractContent(await r.json());
  } catch { return null; }
}

/** Test hook: forget the boot-time decision so the next call re-resolves. */
export function _resetProviderForTests() { resolved = null; }

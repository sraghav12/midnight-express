// Drive the provider layer against a local mock of an OpenAI-compatible endpoint.
import http from "node:http";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

const seen = [];
const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    const j = JSON.parse(body);
    seen.push({ url: req.url, auth: req.headers.authorization, body: j });
    const prompt = j.messages[0].content;
    if (prompt.includes("FAIL")) { res.writeHead(500); return res.end("boom"); }
    if (prompt.includes("EMPTY")) { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ choices: [{ message: { content: "" } }] })); }
    const reply = () => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "I pick OAK" } }] })); };
    if (prompt.includes("SLOW")) setTimeout(reply, 400); else reply();
  });
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const port = mock.address().port;

process.env.LLM_PROVIDER = "openai";
process.env.LLM_BASE_URL = `http://127.0.0.1:${port}/v1/`;
process.env.LLM_MODEL = "mock-model";
process.env.LLM_API_KEY = "test-key";
const { resolveProvider, providerSync, complete, shortName, extractContent } = await import("../server/llm.js");

after(() => mock.close());

test("resolves the OpenAI-compatible provider from LLM_BASE_URL / LLM_MODEL", async () => {
  assert.equal(providerSync().label, "unresolved");
  const p = await resolveProvider();
  assert.equal(p.provider, "openai");
  assert.equal(p.model, "mock-model");
  assert.equal(p.rivalName, "Mock");
  assert.match(p.label, new RegExp(`127.0.0.1:${port}`));
  assert.equal(providerSync(), p, "decided once, at boot");
});

test("complete() posts a chat completion with the model and bearer key and returns the text", async () => {
  const out = await complete("Which way?", { maxTokens: 20, temperature: 0.5 });
  assert.equal(out, "I pick OAK");
  const r = seen.at(-1);
  assert.equal(r.url, "/v1/chat/completions");
  assert.equal(r.auth, "Bearer test-key");
  assert.equal(r.body.model, "mock-model");
  assert.equal(r.body.max_tokens, 20);
  assert.equal(r.body.temperature, 0.5);
  assert.equal(r.body.chat_template_kwargs, undefined, "the IFM-only knob is not sent elsewhere");
});

test("complete() returns null on HTTP errors, empty answers and timeouts -- never throws", async () => {
  assert.equal(await complete("FAIL please"), null);
  assert.equal(await complete("EMPTY please"), null);
  assert.equal(await complete("SLOW please", { timeoutMs: 60 }), null);
});

test("a per-call provider that is not configured falls back to the boot-time one", async () => {
  assert.equal(await complete("hello", { provider: "gemini" }), "I pick OAK");
});

test("shortName turns a model id into a train name", () => {
  assert.equal(shortName("llama3.2"), "Llama");
  assert.equal(shortName("qwen2.5:1.5b"), "Qwen");
  assert.equal(shortName("gpt-4o-mini"), "GPT");
  assert.equal(shortName("K2-Horizon-0.9B"), "K2");
  assert.equal(shortName(""), "Model");
});

test("extractContent is strict about the OpenAI shape", () => {
  assert.equal(extractContent({ choices: [{ message: { content: "x" } }] }), "x");
  assert.equal(extractContent({ choices: [{ message: { content: "" } }] }), null);
  assert.equal(extractContent({ choices: [] }), null);
  assert.equal(extractContent(null), null);
  assert.equal(extractContent({ choices: [{ message: { content: ["parts"] } }] }), null);
});

import assert from "node:assert/strict";
import test from "node:test";
import { ExaClient } from "../src/providers/exa.js";
import { OpenRouterClient } from "../src/providers/openrouter.js";

test("Exa URL extraction uses the contents endpoint with a bounded text request", async () => {
  let call;
  const client = new ExaClient({
    apiKey: "test",
    request: async (url, options) => {
      call = { url, options, body: JSON.parse(options.body) };
      return {
        results: [{ title: "Currículo", url: "https://example.com/c", text: "Contenido" }],
      };
    },
  });

  const result = await client.getUrlText("https://example.com/c");
  assert.equal(call.url, "https://api.exa.ai/contents");
  assert.deepEqual(call.body.ids, ["https://example.com/c"]);
  assert.equal(call.body.text.maxCharacters, 60_000);
  assert.equal(result.text, "Contenido");
});

test("Exa search bounds queries, deduplicates URLs, and drops private results", async () => {
  const queries = [];
  const client = new ExaClient({
    apiKey: "test",
    request: async (_url, options) => {
      queries.push(JSON.parse(options.body).query);
      return {
        results: [
          { title: "Good", url: "https://example.com/a", highlights: ["Useful"] },
          { title: "Duplicate", url: "https://example.com/a", highlights: ["Again"] },
          { title: "Private", url: "https://127.0.0.1/a", highlights: ["No"] },
        ],
      };
    },
  });

  const results = await client.search([" one ", "one", "two", "three", "ignored"]);
  assert.deepEqual(queries, ["one", "two", "three"]);
  assert.equal(results.length, 1);
  assert.equal(results[0].url, "https://example.com/a");
});

test("OpenRouter requires strict structured output and parses the JSON message", async () => {
  let requestBody;
  const client = new OpenRouterClient({
    apiKey: "test",
    request: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                subject: "Matemática",
                objectives: ["Sumar"],
                constraints: [],
                researchQueries: ["suma enseñanza"],
              }),
            },
          },
        ],
      };
    },
  });

  const result = await client.outlineCurriculum("Aprender sumas", 2);
  assert.equal(result.subject, "Matemática");
  assert.equal(requestBody.response_format.type, "json_schema");
  assert.equal(requestBody.response_format.json_schema.strict, true);
  assert.equal(requestBody.provider.require_parameters, true);
});


test("OpenRouter gives both model passes a bounded configurable generation deadline", async () => {
  const calls = [];
  const client = new OpenRouterClient({ apiKey: "test", timeoutMs: 180000,
    request: async (_url, options) => { calls.push(options); return { choices: [{ message: { content: "{}" } }] }; },
  });
  await client.outlineCurriculum("Synthetic curriculum", 7);
  await client.generatePlan({ outline: {}, sources: [], days: 7 });
  assert.deepEqual(calls.map(c => c.timeoutMs), [180000, 180000]);
  assert.match(calls[0].requestName, /análisis/);
  assert.match(calls[1].requestName, /generación/);
  for (const timeoutMs of [NaN, 0, -1, 600001]) {
    assert.throws(() => new OpenRouterClient({ apiKey: "test", timeoutMs }), /OPENROUTER_TIMEOUT_MS/);
  }
});

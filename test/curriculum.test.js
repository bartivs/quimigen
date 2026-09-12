import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPlanFromCurriculum } from "../src/curriculum/create-plan.js";
import { extractDocument } from "../src/curriculum/extract.js";
import { FixtureModelClient, FixtureResearchClient } from "../src/providers/fixture.js";

test("extracts and hashes a bounded text curriculum", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "quimigen-extract-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "curriculum.md");
  await writeFile(path, "Objetivo 1\r\n\r\n\r\n\r\nObjetivo 2\n", "utf8");

  const source = await extractDocument(path, "curriculum.md");
  assert.equal(source.kind, "document");
  assert.equal(source.text, "Objetivo 1\n\n\nObjetivo 2");
  assert.match(source.sha256, /^[a-f0-9]{64}$/);
});

test("rejects unsupported curriculum file types", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "quimigen-extract-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "curriculum.docx");
  await writeFile(path, "not really docx", "utf8");
  await assert.rejects(() => extractDocument(path, "curriculum.docx"), /Formato no soportado/);
});

test("rejects model citations that were not returned by research", async () => {
  const model = {
    outlineCurriculum: async () => ({
      subject: "Historia",
      objectives: ["Comprender"],
      constraints: [],
      researchQueries: ["historia fuente"],
    }),
    generatePlan: async () => ({
      summary: "Resumen",
      entries: [
        {
          id: "D1",
          topic: "Tema",
          objective: "Comprender",
          problem: "Pregunta",
          hints: ["Pista"],
          solution: "Respuesta",
          sourceUrls: ["https://hallucinated.example/source"],
          reviewRequired: true,
        },
      ],
    }),
  };
  const research = {
    search: async () => [
      { title: "Real", url: "https://example.com/real", excerpt: "Fuente real" },
    ],
  };

  await assert.rejects(
    () =>
      createPlanFromCurriculum({
        input: { chatId: "1", ownerUserId: "2", days: 1, deliveryTime: "18:00", timezone: "UTC" },
        source: { kind: "fixture", label: "Fixture", text: "Text", sha256: "hash" },
        model,
        research,
      }),
    /no proviene de la investigación/,
  );
});

test("fixture providers create a complete review-required draft", async () => {
  const plan = await createPlanFromCurriculum({
    input: {
      chatId: "1",
      ownerUserId: "2",
      days: 3,
      deliveryTime: "18:00",
      timezone: "America/Asuncion",
    },
    source: {
      kind: "fixture",
      label: "DEMO FIXTURE",
      text: "Balanceo, estequiometría y equilibrio.",
      sha256: "fixture-hash",
    },
    model: new FixtureModelClient(),
    research: new FixtureResearchClient(),
    now: new Date("2026-09-12T15:00:00Z"),
  });

  assert.match(plan.summary, /DEMO FIXTURE/);
  assert.equal(plan.entries.length, 3);
  assert.ok(plan.entries.every((entry) => entry.reviewRequired === true));
  assert.equal(plan.entries[2].scheduledDate, "2026-09-15");
  assert.equal(plan.researchSources.length, 2);
});

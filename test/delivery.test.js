import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { approvePlan, attachSchedule, createDraftPlan } from "../src/domain/plan.js";
import { deliverDueProblem } from "../src/delivery/deliver.js";
import { JsonStore } from "../src/store/json-store.js";

function plan() {
  const draft = createDraftPlan({
    id: "QG-DELIVERY",
    chatId: "10",
    ownerUserId: "20",
    days: 1,
    deliveryTime: "18:00",
    timezone: "UTC",
    startDate: "2026-09-13",
    source: { kind: "fixture", label: "Fixture", sha256: "hash" },
    summary: "Una práctica",
    objectives: ["Practicar"],
    researchSources: [{ title: "Source", url: "https://example.com", excerpt: "Excerpt" }],
    entries: [{
      id: "D1",
      topic: "Tema",
      objective: "Practicar",
      problem: "Resuelve esto.",
      hints: ["Una pista"],
      solution: "Una solución",
      sourceUrls: ["https://example.com"],
      reviewRequired: true,
    }],
  });
  return attachSchedule(approvePlan(draft, { chatId: "10", userId: "20" }), {
    id: "sched_1",
    deduplicationKey: "test:10:QG-DELIVERY",
    active: true,
  });
}

async function storeHarness(t) {
  const directory = await mkdtemp(join(tmpdir(), "quimigen-delivery-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new JsonStore(join(directory, "state.json"));
  await store.putPlan(plan());
  return store;
}

test("delivers one approved entry and refuses a duplicate run", async (t) => {
  const store = await storeHarness(t);
  const sent = [];
  const telegram = {
    sendMessage: async (chatId, text) => {
      sent.push({ chatId, text });
      return [{ message_id: 77 }];
    },
  };

  const first = await deliverDueProblem({
    store,
    telegram,
    planId: "QG-DELIVERY",
    timestamp: new Date("2026-09-13T18:00:00Z"),
  });
  assert.equal(first.status, "sent");
  assert.equal(first.completed, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Contenido previamente aprobado/);

  const second = await deliverDueProblem({
    store,
    telegram,
    planId: "QG-DELIVERY",
    timestamp: new Date("2026-09-13T18:05:00Z"),
  });
  assert.equal(second.kind, "skip");
  assert.equal(second.reason, "plan_not_active");
  assert.equal(sent.length, 1);
  assert.equal((await store.getPlan("QG-DELIVERY")).receipts[0].telegramMessageIds[0], 77);
});

test("marks an ambiguous Telegram failure uncertain and never retries it blindly", async (t) => {
  const store = await storeHarness(t);
  const telegram = { sendMessage: async () => { throw new Error("socket closed"); } };

  await assert.rejects(
    () => deliverDueProblem({
      store,
      telegram,
      planId: "QG-DELIVERY",
      timestamp: new Date("2026-09-13T18:00:00Z"),
    }),
    /socket closed/,
  );
  const stored = await store.getPlan("QG-DELIVERY");
  assert.equal(stored.receipts[0].status, "uncertain");

  const retry = await deliverDueProblem({
    store,
    telegram: { sendMessage: async () => { throw new Error("must not run"); } },
    planId: "QG-DELIVERY",
    timestamp: new Date("2026-09-13T18:01:00Z"),
  });
  assert.equal(retry.reason, "already_attempted");
});

test("completes an expired plan without backfilling missed days", async (t) => {
  const store = await storeHarness(t);
  const result = await deliverDueProblem({
    store,
    telegram: { sendMessage: async () => { throw new Error("must not send"); } },
    planId: "QG-DELIVERY",
    timestamp: new Date("2026-09-15T18:00:00Z"),
  });
  assert.equal(result.reason, "plan_completed");
  assert.equal((await store.getPlan("QG-DELIVERY")).status, "COMPLETED");
});

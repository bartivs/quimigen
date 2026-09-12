import assert from "node:assert/strict";
import test from "node:test";
import {
  PLAN_STATUS,
  approvePlan,
  attachSchedule,
  createDraftPlan,
  hashQueue,
  localDate,
  parsePlanCommand,
  pausePlan,
  resumePlan,
  selectDueEntry,
  validatePublicHttpsUrl,
} from "../src/domain/plan.js";

function draft(overrides = {}) {
  return createDraftPlan(
    {
      id: "QG-TEST",
      chatId: "100",
      ownerUserId: "200",
      days: 2,
      deliveryTime: "08:05",
      timezone: "America/Asuncion",
      startDate: "2026-09-13",
      source: { kind: "fixture", label: "DEMO FIXTURE", sha256: "abc" },
      summary: "Dos días de práctica.",
      objectives: ["Objetivo uno"],
      researchSources: [
        { title: "Fuente", url: "https://example.com/source", excerpt: "Extracto." },
      ],
      entries: [
        {
          id: "D1",
          topic: "Tema 1",
          objective: "Practicar uno",
          problem: "Problema uno",
          hints: ["Pista uno"],
          solution: "Solución uno",
          sourceUrls: ["https://example.com/source"],
        },
        {
          id: "D2",
          topic: "Tema 2",
          objective: "Practicar dos",
          problem: "Problema dos",
          hints: ["Pista dos"],
          solution: "Solución dos",
          sourceUrls: ["https://example.com/source"],
        },
      ],
      ...overrides,
    },
    new Date("2026-09-12T15:00:00Z"),
  );
}

const owner = { chatId: "100", userId: "200" };

test("parses bounded plan settings", () => {
  assert.deepEqual(parsePlanCommand("/plan 3 8:05 America/Asuncion"), {
    days: 3,
    deliveryTime: "08:05",
    timezone: "America/Asuncion",
  });
  assert.throws(() => parsePlanCommand("/plan 8 08:00 UTC"), /1 a 7/);
  assert.throws(() => parsePlanCommand("/plan 2 25:00 UTC"), /no es válida/);
  assert.throws(() => parsePlanCommand("/plan 2 10:00 Mars\/Base"), /zona horaria/);
});

test("calculates a local calendar date using the configured timezone", () => {
  assert.equal(localDate("2026-09-13T02:30:00Z", "America/Asuncion"), "2026-09-12");
  assert.equal(localDate("2026-09-13T05:00:00Z", "America/Asuncion"), "2026-09-13");
});

test("creates a versioned draft with stable scheduled entries and hash", () => {
  const plan = draft();
  assert.equal(plan.status, PLAN_STATUS.DRAFT);
  assert.equal(plan.entries[0].scheduledDate, "2026-09-13");
  assert.equal(plan.entries[1].scheduledDate, "2026-09-14");
  assert.equal(plan.queueHash, hashQueue(plan.entries));
  assert.equal(plan.approvedAt, null);
});

test("approval rejects the wrong owner and any changed queue", () => {
  const plan = draft();
  assert.throws(
    () => approvePlan(plan, { chatId: "100", userId: "other" }),
    /permiso/,
  );

  const tampered = structuredClone(plan);
  tampered.entries[0].problem = "Contenido cambiado";
  assert.throws(() => approvePlan(tampered, owner), /cola cambió/);
});

test("an approved active plan yields only today's not-yet-attempted entry", () => {
  const scheduled = attachSchedule(approvePlan(draft(), owner), {
    id: "sched_1",
    deduplicationKey: "dev:100:QG-TEST",
    active: true,
  });

  const due = selectDueEntry(scheduled, new Date("2026-09-13T15:00:00Z"));
  assert.equal(due.kind, "deliver");
  assert.equal(due.entry.id, "D1");

  scheduled.receipts.push({ deliveryKey: due.deliveryKey, status: "sent" });
  assert.equal(selectDueEntry(scheduled, new Date("2026-09-13T15:00:00Z")).reason, "already_attempted");
  assert.equal(selectDueEntry(scheduled, new Date("2026-09-20T15:00:00Z")).reason, "no_entry_for_date");
});

test("pause and resume preserve the exact approved queue", () => {
  const scheduled = attachSchedule(approvePlan(draft(), owner), {
    id: "sched_1",
    deduplicationKey: "dev:100:QG-TEST",
    active: true,
  });
  const paused = pausePlan(scheduled, owner);
  assert.equal(paused.status, PLAN_STATUS.PAUSED);
  assert.equal(selectDueEntry(paused, new Date("2026-09-13T15:00:00Z")).reason, "plan_not_active");

  const resumed = resumePlan(paused, owner);
  assert.equal(resumed.status, PLAN_STATUS.APPROVED_SCHEDULED);
  assert.equal(resumed.schedule.active, true);

  const tampered = structuredClone(paused);
  tampered.entries[0].solution = "otra";
  assert.throws(() => resumePlan(tampered, owner), /cola cambió/);
});

test("rejects URLs that are not plainly public HTTPS", () => {
  assert.equal(validatePublicHttpsUrl("https://example.com/a").hostname, "example.com");
  for (const value of [
    "http://example.com",
    "https://localhost/a",
    "https://127.0.0.1/a",
    "https://10.0.0.1/a",
    "https://192.168.1.10/a",
    "https://user:pass@example.com/a",
    "https://example.com:8443/a",
  ]) {
    assert.throws(() => validatePublicHttpsUrl(value));
  }
});

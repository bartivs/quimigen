import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlanFromCurriculum } from "../curriculum/create-plan.js";
import { approvePlan, attachSchedule } from "../domain/plan.js";
import { deliverDueProblem } from "../delivery/deliver.js";
import { FixtureModelClient, FixtureResearchClient } from "../providers/fixture.js";
import { FixtureScheduler } from "../providers/scheduler.js";
import { JsonStore } from "../store/json-store.js";
import { formatPlanPreview } from "../telegram/format.js";

const directory = await mkdtemp(join(tmpdir(), "quimigen-demo-flow-"));
try {
  const store = new JsonStore(join(directory, "state.json"));
  const curriculum = await readFile(new URL("../../fixtures/curriculum.md", import.meta.url), "utf8");
  const plan = await createPlanFromCurriculum({
    input: {
      id: "QG-DEMO-FLOW",
      chatId: "DEMO_CHAT",
      ownerUserId: "DEMO_USER",
      days: 3,
      deliveryTime: "18:00",
      timezone: "America/Asuncion",
    },
    source: {
      kind: "fixture",
      label: "DEMO FIXTURE · curriculum.md",
      text: curriculum,
      sha256: createHash("sha256").update(curriculum).digest("hex"),
    },
    model: new FixtureModelClient(),
    research: new FixtureResearchClient(),
    now: new Date("2026-09-12T15:00:00Z"),
  });

  const sealed = approvePlan(plan, { chatId: "DEMO_CHAT", userId: "DEMO_USER" });
  const schedule = await new FixtureScheduler("demo").createDailySchedule(sealed);
  const scheduled = attachSchedule(sealed, schedule);
  await store.putPlan(scheduled);

  console.log("\n=== 1. PLAN CREADO Y PROGRAMADO AUTOMÁTICAMENTE ===\n");
  console.log(formatPlanPreview(scheduled, true));
  console.log(`\nTRIGGER SIMULATED · ${schedule.id}\nqueueHash=${scheduled.queueHash}`);

  const telegram = {
    sendMessage: async (_chatId, text) => {
      console.log(`\n=== 2. ENTREGA DIARIA ===\n\n${text}`);
      return [{ message_id: 1 }];
    },
  };
  const result = await deliverDueProblem({
    store,
    telegram,
    planId: scheduled.id,
    timestamp: new Date("2026-09-13T21:00:00Z"),
  });
  console.log(`\n=== 3. RECIBO ===\n\n${JSON.stringify(result, null, 2)}\n`);
} finally {
  await rm(directory, { recursive: true, force: true });
}

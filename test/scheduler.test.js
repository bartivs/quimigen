import assert from "node:assert/strict";
import test from "node:test";
import { TriggerScheduler } from "../src/providers/scheduler.js";

test("creates one timezone-aware Trigger schedule per plan and environment", async () => {
  let createOptions;
  const api = {
    create: async (options) => {
      createOptions = options;
      return { id: "sched_live", active: true };
    },
  };
  const scheduler = new TriggerScheduler({ api, environment: "staging" });
  const result = await scheduler.createDailySchedule({
    id: "QG-1",
    chatId: "10",
    deliveryTime: "08:05",
    timezone: "America/Asuncion",
  });

  assert.deepEqual(createOptions, {
    task: "quimigen-daily-delivery",
    cron: "5 8 * * *",
    timezone: "America/Asuncion",
    externalId: "QG-1",
    deduplicationKey: "staging:10:QG-1",
  });
  assert.equal(result.simulated, false);
});

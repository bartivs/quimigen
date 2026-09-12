import assert from "node:assert/strict";
import test from "node:test";
import { TriggerScheduler } from "../src/providers/scheduler.js";

test("blank Trigger URLs use Cloud while explicit self-hosted URLs are preserved", () => {
  for (const [baseURL, expected] of [[undefined, "https://api.trigger.dev"], ["", "https://api.trigger.dev"], ["  ", "https://api.trigger.dev"], ["https://trigger.example.com", "https://trigger.example.com"]]) {
    let config;
    new TriggerScheduler({ baseURL, configureApi: (value) => { config = value; } });
    assert.equal(config.baseURL, expected);
  }
});

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

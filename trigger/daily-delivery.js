import { schedules } from "@trigger.dev/sdk";
import { deliverDueProblem } from "../src/delivery/deliver.js";
import { JsonStore } from "../src/store/json-store.js";
import { TelegramClient } from "../src/telegram/client.js";

export const DAILY_DELIVERY_TASK_ID = "quimigen-daily-delivery";

export const dailyDeliveryTask = schedules.task({
  id: DAILY_DELIVERY_TASK_ID,
  ttl: "30m",
  maxDuration: 60,
  retry: { maxAttempts: 1 },
  run: async (payload) => {
    if (!payload.externalId) throw new Error("El schedule no incluye externalId=planId.");
    const store = new JsonStore();
    const telegram = new TelegramClient();
    const result = await deliverDueProblem({
      store,
      telegram,
      planId: payload.externalId,
      timestamp: payload.timestamp,
    });

    if (result.completed && payload.scheduleId !== "sched_1234") {
      await schedules.deactivate(payload.scheduleId);
    }
    return {
      planId: payload.externalId,
      scheduleId: payload.scheduleId,
      timezone: payload.timezone,
      kind: result.kind,
      reason: result.reason,
      entryId: result.entry?.id,
      completed: result.completed === true,
    };
  },
});

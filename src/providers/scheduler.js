import { configure, schedules } from "@trigger.dev/sdk";

export const DAILY_DELIVERY_TASK_ID = "quimigen-daily-delivery";

export class TriggerScheduler {
  constructor({
    api = schedules,
    environment = process.env.TRIGGER_ENV ?? "dev",
    taskId = DAILY_DELIVERY_TASK_ID,
    baseURL = process.env.TRIGGER_API_URL,
    configureApi = configure,
  } = {}) {
    // An empty optional .env value overrides the SDK's nullish default.
    if (api === schedules) configureApi({ baseURL: baseURL?.trim() || "https://api.trigger.dev" });
    this.api = api;
    this.environment = environment;
    this.taskId = taskId;
  }

  async createDailySchedule(plan) {
    const [hour, minute] = plan.deliveryTime.split(":").map(Number);
    const deduplicationKey = `${this.environment}:${plan.chatId}:${plan.id}`;
    const schedule = await this.api.create({
      task: this.taskId,
      cron: `${minute} ${hour} * * *`,
      timezone: plan.timezone,
      externalId: plan.id,
      deduplicationKey,
    });
    return {
      id: schedule.id,
      deduplicationKey,
      active: schedule.active !== false,
      simulated: false,
    };
  }

  async deactivate(scheduleId) {
    return this.api.deactivate(scheduleId);
  }

  async activate(scheduleId) {
    return this.api.activate(scheduleId);
  }
}

export class FixtureScheduler {
  constructor(environment = process.env.TRIGGER_ENV ?? "dev") {
    this.environment = environment;
  }

  async createDailySchedule(plan) {
    return {
      id: `simulated_${plan.id}`,
      deduplicationKey: `${this.environment}:${plan.chatId}:${plan.id}`,
      active: true,
      simulated: true,
    };
  }

  async deactivate() {
    return { active: false, simulated: true };
  }

  async activate() {
    return { active: true, simulated: true };
  }
}

export function createScheduler(mode = process.env.QUIMIGEN_MODE ?? "live") {
  if (mode === "fixture") return new FixtureScheduler();
  if (mode === "live") return new TriggerScheduler();
  throw new Error(`QUIMIGEN_MODE no soportado: ${mode}`);
}

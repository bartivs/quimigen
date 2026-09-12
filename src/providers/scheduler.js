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

export class UnconfiguredLiveScheduler {
  async createDailySchedule() {
    throw new Error("Trigger.dev aún no está conectado en este build.");
  }

  async deactivate() {
    throw new Error("Trigger.dev aún no está conectado en este build.");
  }

  async activate() {
    throw new Error("Trigger.dev aún no está conectado en este build.");
  }
}

export function createScheduler(mode = process.env.QUIMIGEN_MODE ?? "live") {
  return mode === "fixture" ? new FixtureScheduler() : new UnconfiguredLiveScheduler();
}

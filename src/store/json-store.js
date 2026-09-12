import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const EMPTY_STATE = Object.freeze({ schemaVersion: 1, plans: {}, pendingIntakes: {} });

export class JsonStore {
  constructor(filePath = process.env.QUIMIGEN_STATE_FILE ?? ".data/state.json") {
    this.filePath = resolve(filePath);
    this.lockPath = `${this.filePath}.lock`;
  }

  async initialize() {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      await readFile(this.filePath, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await this.#writeState(structuredClone(EMPTY_STATE));
    }
  }

  async getPlan(id) {
    const state = await this.readState();
    return state.plans[id] ? structuredClone(state.plans[id]) : null;
  }

  async listPlansForChat(chatId) {
    const state = await this.readState();
    return Object.values(state.plans)
      .filter((plan) => plan.chatId === String(chatId))
      .map((plan) => structuredClone(plan));
  }

  async putPlan(plan) {
    return this.transact((state) => {
      state.plans[plan.id] = structuredClone(plan);
      return structuredClone(plan);
    });
  }

  async transactPlan(id, mutate) {
    return this.transact(async (state) => {
      const current = state.plans[id];
      if (!current) throw new Error(`Plan no encontrado: ${id}`);
      const next = await mutate(structuredClone(current));
      state.plans[id] = structuredClone(next);
      return structuredClone(next);
    });
  }

  async getPendingIntake(chatId) {
    const state = await this.readState();
    return state.pendingIntakes[String(chatId)]
      ? structuredClone(state.pendingIntakes[String(chatId)])
      : null;
  }

  async setPendingIntake(chatId, intake) {
    return this.transact((state) => {
      state.pendingIntakes[String(chatId)] = structuredClone(intake);
      return structuredClone(intake);
    });
  }

  async clearPendingIntake(chatId) {
    return this.transact((state) => {
      delete state.pendingIntakes[String(chatId)];
      return null;
    });
  }

  async readState() {
    await this.initialize();
    const parsed = JSON.parse(await readFile(this.filePath, "utf8"));
    validateState(parsed);
    return parsed;
  }

  async transact(mutate) {
    await this.initialize();
    const lock = await this.#acquireLock();
    try {
      const state = JSON.parse(await readFile(this.filePath, "utf8"));
      validateState(state);
      const result = await mutate(state);
      await this.#writeState(state);
      return result;
    } finally {
      await lock.close();
      await rm(this.lockPath, { force: true });
    }
  }

  async #acquireLock() {
    const startedAt = Date.now();
    while (true) {
      try {
        return await open(this.lockPath, "wx");
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        if (Date.now() - startedAt > 5_000) {
          throw new Error("No se pudo adquirir el lock del store en 5 segundos.");
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
      }
    }
  }

  async #writeState(state) {
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, this.filePath);
  }
}

function validateState(state) {
  if (
    !state ||
    state.schemaVersion !== 1 ||
    typeof state.plans !== "object" ||
    state.plans === null ||
    typeof state.pendingIntakes !== "object" ||
    state.pendingIntakes === null
  ) {
    throw new Error("El archivo de estado no tiene un esquema compatible.");
  }
}

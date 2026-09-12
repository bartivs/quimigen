import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  approvePlan,
  attachSchedule,
  parsePlanCommand,
  pausePlan,
  resumePlan,
} from "../domain/plan.js";
import { createPlanFromCurriculum } from "../curriculum/create-plan.js";
import { extractDocument, sourceFromUrlExtraction } from "../curriculum/extract.js";
import { validatePublicHttpsUrl } from "../domain/plan.js";
import { FixtureModelClient, FixtureResearchClient } from "../providers/fixture.js";
import { HELP_TEXT, formatPlanPreview, formatStatus } from "./format.js";

export class QuimiGenBot {
  constructor({ telegram, store, model, research, scheduler, fixture = false, now = () => new Date() }) {
    this.telegram = telegram;
    this.store = store;
    this.model = model;
    this.research = research;
    this.scheduler = scheduler;
    this.fixture = fixture;
    this.now = now;
  }

  async handleUpdate(update) {
    const message = update?.message;
    if (!message?.chat?.id || !message?.from?.id) return;
    const chatId = String(message.chat.id);
    const userId = String(message.from.id);
    const text = message.text?.trim() ?? "";

    try {
      if (/^\/(start|help)(?:@\w+)?$/i.test(text)) {
        await this.telegram.sendMessage(chatId, HELP_TEXT);
        return;
      }
      if (/^\/plan(?:@\w+)?\b/i.test(text)) {
        const settings = parsePlanCommand(text);
        await this.store.setPendingIntake(chatId, {
          ...settings,
          chatId,
          ownerUserId: userId,
          requestedAt: this.now().toISOString(),
        });
        await this.telegram.sendMessage(chatId, "Ahora envía un archivo .txt/.md/.pdf o una URL HTTPS pública.");
        return;
      }
      if (/^\/demo(?:@\w+)?$/i.test(text)) {
        await this.#createDemo(chatId, userId);
        return;
      }
      if (/^\/approve(?:@\w+)?\b/i.test(text)) {
        await this.#approve(text, chatId, userId);
        return;
      }
      if (/^\/status(?:@\w+)?\b/i.test(text)) {
        await this.#status(text, chatId, userId);
        return;
      }
      if (/^\/pause(?:@\w+)?\b/i.test(text)) {
        await this.#pause(text, chatId, userId);
        return;
      }
      if (/^\/resume(?:@\w+)?\b/i.test(text)) {
        await this.#requestResume(text, chatId, userId);
        return;
      }
      if (/^\/confirm_resume(?:@\w+)?\b/i.test(text)) {
        await this.#confirmResume(text, chatId, userId);
        return;
      }

      const intake = await this.store.getPendingIntake(chatId);
      if (intake && intake.ownerUserId !== userId) {
        await this.telegram.sendMessage(chatId, "Solo quien inició /plan puede enviar el currículo.");
        return;
      }
      if (intake && (message.document || isSingleHttpsUrl(text))) {
        await this.#consumeCurriculum(message, intake);
        return;
      }

      await this.telegram.sendMessage(chatId, "No entendí el mensaje. Usa /help para ver el flujo.");
    } catch (error) {
      await this.telegram.sendMessage(chatId, `No se realizó ninguna acción: ${safeError(error)}`);
    }
  }

  async #consumeCurriculum(message, intake) {
    await this.telegram.sendMessage(intake.chatId, "Procesando currículo; todavía no se programará ningún envío.");
    let temporaryDirectory;
    try {
      let source;
      if (message.document) {
        temporaryDirectory = await mkdtemp(join(tmpdir(), "quimigen-upload-"));
        const downloaded = await this.telegram.downloadDocument(message.document, temporaryDirectory);
        source = await extractDocument(downloaded.path, downloaded.fileName);
      } else {
        const extraction = await this.research.getUrlText(message.text.trim());
        source = sourceFromUrlExtraction(extraction);
      }
      const plan = await createPlanFromCurriculum({
        input: intake,
        source,
        model: this.model,
        research: this.research,
        now: this.now(),
      });
      await this.store.putPlan(plan);
      await this.store.clearPendingIntake(intake.chatId);
      await this.telegram.sendMessage(intake.chatId, formatPlanPreview(plan, this.fixture));
    } finally {
      if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  async #createDemo(chatId, userId) {
    const text = await readFile(new URL("../../fixtures/curriculum.md", import.meta.url), "utf8");
    const plan = await createPlanFromCurriculum({
      input: {
        id: `QG-DEMO-${String(chatId).replace(/\D/g, "").slice(-4) || "LOCAL"}`,
        chatId,
        ownerUserId: userId,
        days: 3,
        deliveryTime: "18:00",
        timezone: "America/Asuncion",
      },
      source: {
        kind: "fixture",
        label: "DEMO FIXTURE · curriculum.md",
        text,
        sha256: createHash("sha256").update(text).digest("hex"),
      },
      model: new FixtureModelClient(),
      research: new FixtureResearchClient(),
      now: this.now(),
    });
    await this.store.putPlan(plan);
    await this.telegram.sendMessage(chatId, formatPlanPreview(plan, true));
  }

  async #approve(text, chatId, userId) {
    const [id, version] = parseArguments(text, "/approve", 2);
    const plan = await this.#ownedPlan(id, chatId, userId);
    if (Number(version) !== plan.version) throw new Error("La versión no coincide con el borrador visible.");
    const approved = approvePlan(plan, { chatId, userId }, this.now());
    const schedule = await this.scheduler.createDailySchedule(approved);
    const scheduled = attachSchedule(approved, schedule, this.now());
    await this.store.transactPlan(id, (current) => {
      if (current.version !== plan.version || current.queueHash !== plan.queueHash || current.status !== plan.status) {
        throw new Error("El plan cambió durante la aprobación; vuelve a revisarlo.");
      }
      return scheduled;
    });
    const label = schedule.simulated ? "TRIGGER SIMULATED" : "TRIGGER LIVE";
    await this.telegram.sendMessage(chatId, `${label} · Plan ${id} v${version} programado.\n${formatStatus(scheduled)}\n\nUsa /pause ${id} para detener entregas.`);
  }

  async #status(text, chatId, userId) {
    const [id] = parseArguments(text, "/status", 1);
    const plan = await this.#ownedPlan(id, chatId, userId);
    await this.telegram.sendMessage(chatId, formatStatus(plan));
  }

  async #pause(text, chatId, userId) {
    const [id] = parseArguments(text, "/pause", 1);
    const plan = await this.#ownedPlan(id, chatId, userId);
    if (plan.schedule) await this.scheduler.deactivate(plan.schedule.id);
    const paused = pausePlan(plan, { chatId, userId }, this.now());
    await this.store.transactPlan(id, (current) => {
      if (current.status !== plan.status || current.version !== plan.version) throw new Error("El plan cambió; consulta /status.");
      return paused;
    });
    await this.telegram.sendMessage(chatId, `Plan ${id} pausado. No habrá más entregas hasta confirmación.`);
  }

  async #requestResume(text, chatId, userId) {
    const [id] = parseArguments(text, "/resume", 1);
    const plan = await this.#ownedPlan(id, chatId, userId);
    if (plan.status !== "PAUSED") throw new Error("El plan no está pausado.");
    await this.telegram.sendMessage(chatId, `Reanudar conserva la cola aprobada v${plan.version}. Confirma con:\n/confirm_resume ${id} ${plan.version}`);
  }

  async #confirmResume(text, chatId, userId) {
    const [id, version] = parseArguments(text, "/confirm_resume", 2);
    const plan = await this.#ownedPlan(id, chatId, userId);
    if (Number(version) !== plan.version) throw new Error("La versión no coincide.");
    await this.scheduler.activate(plan.schedule.id);
    const resumed = resumePlan(plan, { chatId, userId }, this.now());
    await this.store.transactPlan(id, (current) => {
      if (current.status !== plan.status || current.queueHash !== plan.queueHash) throw new Error("El plan cambió; no se reanudó.");
      return resumed;
    });
    await this.telegram.sendMessage(chatId, `Plan ${id} reanudado con la misma cola v${version}.`);
  }

  async #ownedPlan(id, chatId, userId) {
    const plan = await this.store.getPlan(id);
    if (!plan || plan.chatId !== chatId || plan.ownerUserId !== userId) {
      throw new Error("Plan no encontrado o sin permiso.");
    }
    return plan;
  }
}

export async function runPolling(bot, telegram, { signal } = {}) {
  let offset = 0;
  while (!signal?.aborted) {
    try {
      const updates = await telegram.getUpdates(offset);
      for (const update of updates) {
        offset = Math.max(offset, update.update_id + 1);
        await bot.handleUpdate(update);
      }
    } catch (error) {
      console.error("Polling error:", safeError(error));
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
}

function parseArguments(text, command, count) {
  const pattern = new RegExp(`^${command}(?:@\\w+)?\\s+(.+)$`, "i");
  const match = text.match(pattern);
  const values = match?.[1]?.trim().split(/\s+/) ?? [];
  if (values.length !== count) throw new Error(`Uso: ${command} ${count === 1 ? "<planId>" : "<planId> <version>"}`);
  return values;
}

function isSingleHttpsUrl(value) {
  try {
    validatePublicHttpsUrl(value);
    return !/\s/.test(value);
  } catch {
    return false;
  }
}

function safeError(error) {
  return error instanceof Error ? error.message.slice(0, 500) : "error desconocido";
}

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  approvePlan,
  attachSchedule,
  normalizeTime,
  parsePlanCommand,
  pausePlan,
  resumePlan,
  validatePublicHttpsUrl,
  validateTimezone,
} from "../domain/plan.js";
import { createPlanFromCurriculum } from "../curriculum/create-plan.js";
import { runStage } from "../curriculum/stage.js";
import { extractDocument, sourceFromUrlExtraction } from "../curriculum/extract.js";
import { FixtureModelClient, FixtureResearchClient } from "../providers/fixture.js";
import { HELP_TEXT, WELCOME_TEXT, formatPlanPreview, formatStatus } from "./format.js";

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
    if (update?.callback_query) {
      await this.#handleCallbackQuery(update.callback_query);
      return;
    }

    const message = update?.message;
    if (!message?.chat?.id || !message?.from?.id) return;
    const chatId = String(message.chat.id);
    const userId = String(message.from.id);
    const text = message.text?.trim() ?? "";

    try {
      if (/^\/start(?:@\w+)?$/i.test(text)) {
        await this.telegram.sendMessage(chatId, WELCOME_TEXT, navigationKeyboard());
        return;
      }
      if (/^\/help(?:@\w+)?$/i.test(text)) {
        await this.telegram.sendMessage(chatId, HELP_TEXT, navigationKeyboard());
        return;
      }
      if (/^\/plan(?:@\w+)?$/i.test(text)) {
        await this.#startSetup(chatId, userId);
        return;
      }
      if (/^\/plan(?:@\w+)?\b/i.test(text)) {
        const settings = parsePlanCommand(text);
        await this.#saveReadyIntake(chatId, userId, settings);
        return;
      }
      if (/^\/demo(?:@\w+)?$/i.test(text)) {
        await this.#createDemo(chatId, userId);
        return;
      }
      if (/^\/schedule(?:@\w+)?(?:\s|$)/i.test(text)) {
        await this.#retrySchedule(text, chatId, userId);
        return;
      }
      if (/^\/status(?:@\w+)?(?:\s|$)/i.test(text)) {
        await this.#status(text, chatId, userId);
        return;
      }
      if (/^\/pause(?:@\w+)?(?:\s|$)/i.test(text)) {
        await this.#pause(text, chatId, userId);
        return;
      }
      if (/^\/resume(?:@\w+)?(?:\s|$)/i.test(text)) {
        await this.#resume(text, chatId, userId);
        return;
      }
      if (/^\/confirm_resume(?:@\w+)?\b/i.test(text)) {
        await this.#confirmResumeLegacy(text, chatId, userId);
        return;
      }
      if (/^\/hint(?:@\w+)?\b/i.test(text)) {
        await this.#showEntryHelp(text, chatId, userId, "hint");
        return;
      }
      if (/^\/solution(?:@\w+)?\b/i.test(text)) {
        await this.#showEntryHelp(text, chatId, userId, "solution");
        return;
      }

      const intake = await this.store.getPendingIntake(chatId);
      if (intake && intake.ownerUserId !== userId) {
        await this.telegram.sendMessage(chatId, "Solo quien inició el plan puede continuar la configuración.");
        return;
      }
      if (intake && ["custom_days", "custom_time", "custom_timezone"].includes(intake.stage)) {
        await this.#consumeCustomSetting(text, intake);
        return;
      }
      if (intake?.stage === "source" && (message.document || isSingleHttpsUrl(text))) {
        await this.#consumeCurriculum(message, intake);
        return;
      }
      if (intake?.stage === "source") {
        await this.telegram.sendMessage(
          chatId,
          "Estoy esperando el currículo. Envía un archivo .txt, .md o .pdf, o pega una única URL HTTPS pública.",
        );
        return;
      }
      if (message.document || isSingleHttpsUrl(text)) {
        await this.telegram.sendMessage(
          chatId,
          "Primero toca «Crear un plan» o envía /plan para elegir los días y el horario.",
          navigationKeyboard(),
        );
        return;
      }

      await this.telegram.sendMessage(chatId, "No entendí el mensaje. Toca una opción o usa /help.", navigationKeyboard());
    } catch (error) {
      await this.telegram.sendMessage(chatId, `No se realizó ninguna acción: ${safeError(error)}`);
    }
  }

  async #handleCallbackQuery(query) {
    const chatId = query.message?.chat?.id ? String(query.message.chat.id) : null;
    const userId = query.from?.id ? String(query.from.id) : null;
    if (!chatId || !userId) return;

    try {
      if (this.telegram.answerCallbackQuery && query.id) {
        await this.telegram.answerCallbackQuery(query.id);
      }
      const data = query.data ?? "";
      if (data === "nav:create") {
        await this.#startSetup(chatId, userId);
      } else if (data === "nav:help") {
        await this.telegram.sendMessage(chatId, HELP_TEXT, navigationKeyboard());
      } else if (data === "nav:plans") {
        await this.#listPlans(chatId, userId);
      } else if (data === "setup:cancel") {
        await this.store.clearPendingIntake(chatId);
        await this.telegram.sendMessage(chatId, "Configuración cancelada.", navigationKeyboard());
      } else if (data.startsWith("setup:days:")) {
        const value = data.slice("setup:days:".length);
        if (value === "other") await this.#requestCustomSetting(chatId, userId, "custom_days", "Escribe un número de días entre 1 y 7.");
        else await this.#chooseDays(chatId, userId, Number(value));
      } else if (data.startsWith("setup:time:")) {
        const value = data.slice("setup:time:".length);
        if (value === "other") await this.#requestCustomSetting(chatId, userId, "custom_time", "Escribe la hora en formato HH:MM, por ejemplo 17:30.");
        else await this.#chooseTime(chatId, userId, value);
      } else if (data.startsWith("setup:tz:")) {
        const value = data.slice("setup:tz:".length);
        if (value === "other") await this.#requestCustomSetting(chatId, userId, "custom_timezone", "Escribe una zona horaria IANA, por ejemplo America/Bogota.");
        else await this.#chooseTimezone(chatId, userId, value);
      } else if (data.startsWith("plan:view:")) {
        const plan = await this.#ownedPlan(data.slice("plan:view:".length), chatId, userId);
        await this.telegram.sendMessage(chatId, formatPlanPreview(plan, this.fixture), planKeyboard(plan));
      } else if (data.startsWith("plan:status:")) {
        await this.#sendStatus(data.slice("plan:status:".length), chatId, userId);
      } else if (data.startsWith("plan:pause:")) {
        await this.#pauseById(data.slice("plan:pause:".length), chatId, userId);
      } else if (data.startsWith("plan:resume:")) {
        await this.#resumeById(data.slice("plan:resume:".length), chatId, userId);
      } else if (data.startsWith("plan:schedule:")) {
        await this.#retryScheduleById(data.slice("plan:schedule:".length), chatId, userId);
      } else {
        throw new Error("La opción ya no está disponible. Usa /help.");
      }
    } catch (error) {
      await this.telegram.sendMessage(chatId, `No se realizó ninguna acción: ${safeError(error)}`);
    }
  }

  async #startSetup(chatId, userId) {
    await this.store.setPendingIntake(chatId, {
      stage: "days",
      chatId,
      ownerUserId: userId,
      requestedAt: this.now().toISOString(),
    });
    await this.telegram.sendMessage(chatId, "¿Cuántos días quieres practicar?", daysKeyboard());
  }

  async #saveReadyIntake(chatId, userId, settings) {
    await this.store.setPendingIntake(chatId, {
      ...settings,
      stage: "source",
      chatId,
      ownerUserId: userId,
      requestedAt: this.now().toISOString(),
    });
    await this.telegram.sendMessage(
      chatId,
      `Perfecto: ${settings.days} días, a las ${settings.deliveryTime} (${settings.timezone}).\n\nAhora envía un archivo .txt, .md o .pdf, o una URL HTTPS pública. Al terminar, el plan quedará programado automáticamente.`,
      cancelKeyboard(),
    );
  }

  async #chooseDays(chatId, userId, days) {
    if (!Number.isInteger(days) || days < 1 || days > 7) throw new Error("El plan debe durar entre 1 y 7 días.");
    const intake = await this.#ownedIntake(chatId, userId);
    await this.store.setPendingIntake(chatId, { ...intake, days, stage: "time" });
    await this.telegram.sendMessage(chatId, "¿A qué hora quieres recibir el ejercicio diario?", timeKeyboard());
  }

  async #chooseTime(chatId, userId, value) {
    const deliveryTime = normalizeTime(value);
    const intake = await this.#ownedIntake(chatId, userId);
    if (!intake.days) throw new Error("Primero elige cuántos días quieres practicar.");
    await this.store.setPendingIntake(chatId, { ...intake, deliveryTime, stage: "timezone" });
    await this.telegram.sendMessage(chatId, "¿Cuál es tu zona horaria?", timezoneKeyboard());
  }

  async #chooseTimezone(chatId, userId, value) {
    const timezone = validateTimezone(value);
    const intake = await this.#ownedIntake(chatId, userId);
    if (!intake.days || !intake.deliveryTime) throw new Error("La configuración está incompleta; inicia nuevamente con /plan.");
    await this.#saveReadyIntake(chatId, userId, { days: intake.days, deliveryTime: intake.deliveryTime, timezone });
  }

  async #requestCustomSetting(chatId, userId, stage, prompt) {
    const intake = await this.#ownedIntake(chatId, userId);
    await this.store.setPendingIntake(chatId, { ...intake, stage });
    await this.telegram.sendMessage(chatId, prompt, cancelKeyboard());
  }

  async #consumeCustomSetting(text, intake) {
    if (!text) throw new Error("Escribe un valor para continuar.");
    if (intake.stage === "custom_days") {
      if (!/^\d+$/.test(text)) throw new Error("Escribe un número de días entre 1 y 7.");
      await this.#chooseDays(intake.chatId, intake.ownerUserId, Number(text));
    } else if (intake.stage === "custom_time") {
      await this.#chooseTime(intake.chatId, intake.ownerUserId, text);
    } else {
      await this.#chooseTimezone(intake.chatId, intake.ownerUserId, text);
    }
  }

  async #ownedIntake(chatId, userId) {
    const intake = await this.store.getPendingIntake(chatId);
    if (!intake || intake.ownerUserId !== userId) throw new Error("La configuración expiró; inicia nuevamente con /plan.");
    return intake;
  }

  async #consumeCurriculum(message, intake) {
    await this.telegram.sendMessage(
      intake.chatId,
      "Recibido. Estoy analizando el currículo y preparando la cola completa; puede tardar varios minutos. Después programaré las entregas automáticamente. No necesitas reenviar el archivo mientras esperas.",
    );
    let temporaryDirectory;
    let savedPlan;
    try {
      let source;
      if (message.document) {
        temporaryDirectory = await mkdtemp(join(tmpdir(), "quimigen-upload-"));
        const downloaded = await runStage("Telegram · descarga", () => this.telegram.downloadDocument(message.document, temporaryDirectory));
        source = await extractDocument(downloaded.path, downloaded.fileName);
      } else {
        const extraction = await runStage("Exa · extracción", () => this.research.getUrlText(message.text.trim()));
        source = sourceFromUrlExtraction(extraction);
      }
      const plan = await createPlanFromCurriculum({
        input: intake,
        source,
        model: this.model,
        research: this.research,
        now: this.now(),
      });
      savedPlan = await this.store.putPlan(plan);
      await this.store.clearPendingIntake(intake.chatId);
      await this.#scheduleAndPresent(plan, { fixture: this.fixture });
    } catch (error) {
      await this.telegram.sendMessage(intake.chatId, savedPlan
        ? `El plan ${savedPlan.id} está guardado, pero no pude completar la confirmación. Consulta /status ${savedPlan.id} antes de reintentar; las entregas podrían estar activas.`
        : `No pude crear el plan: ${safeError(error)}\nNo se programaron entregas. Conservé tus días y horario: reenvía el archivo o la URL para reintentar, o cancela la configuración.`,
      savedPlan ? navigationKeyboard() : cancelKeyboard());
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
    await this.#scheduleAndPresent(plan, { fixture: true });
  }

  async #scheduleAndPresent(plan, { fixture }) {
    let scheduled;
    try {
      scheduled = await this.#sealAndSchedule(plan);
    } catch (error) {
      const current = await this.store.getPlan(plan.id);
      await this.telegram.sendMessage(
        plan.chatId,
        `${formatPlanPreview(current ?? plan, fixture)}\n\nNo pude activar las entregas: ${safeError(error)}\nLa cola sigue guardada y no se enviará nada hasta reintentar.`,
        planKeyboard(current ?? plan),
      );
      return;
    }
    await this.telegram.sendMessage(plan.chatId, formatPlanPreview(scheduled, fixture), planKeyboard(scheduled));
  }

  async #sealAndSchedule(plan) {
    const sealed = approvePlan(plan, { chatId: plan.chatId, userId: plan.ownerUserId }, this.now());
    const schedule = await runStage("Trigger · programación", () => this.scheduler.createDailySchedule(sealed));
    const scheduled = attachSchedule(sealed, schedule, this.now());
    return this.store.transactPlan(plan.id, (current) => {
      if (current.version !== plan.version || current.queueHash !== plan.queueHash || current.status !== plan.status) {
        throw new Error("El plan cambió durante la programación; vuelve a consultar su estado.");
      }
      return scheduled;
    });
  }

  async #retrySchedule(text, chatId, userId) {
    const id = parseOptionalPlanId(text, "/schedule");
    const plan = await this.#resolveOwnedPlan(id, chatId, userId, ["DRAFT"]);
    await this.#retryScheduleById(plan.id, chatId, userId);
  }

  async #retryScheduleById(id, chatId, userId) {
    const plan = await this.#ownedPlan(id, chatId, userId);
    if (plan.status !== "DRAFT") throw new Error("Este plan no está pendiente de programación.");
    const scheduled = await this.#sealAndSchedule(plan);
    const label = scheduled.schedule.simulated ? "TRIGGER SIMULATED" : "TRIGGER LIVE";
    await this.telegram.sendMessage(
      chatId,
      `${label} · Entregas activadas automáticamente.\n\n${formatStatus(scheduled)}`,
      planKeyboard(scheduled),
    );
  }

  async #status(text, chatId, userId) {
    const id = parseOptionalPlanId(text, "/status");
    const plan = await this.#resolveOwnedPlan(id, chatId, userId);
    await this.#sendStatus(plan.id, chatId, userId);
  }

  async #sendStatus(id, chatId, userId) {
    const plan = await this.#ownedPlan(id, chatId, userId);
    await this.telegram.sendMessage(chatId, formatStatus(plan), planKeyboard(plan));
  }

  async #listPlans(chatId, userId) {
    const plans = (await this.store.listPlansForChat(chatId))
      .filter((plan) => plan.ownerUserId === userId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (plans.length === 0) {
      await this.telegram.sendMessage(chatId, "Todavía no tienes planes en este chat.", navigationKeyboard());
      return;
    }
    const lines = plans.map((plan) => `• ${plan.id} · ${visibleStatus(plan.status)} · ${plan.deliveryTime} (${plan.timezone})`);
    await this.telegram.sendMessage(chatId, `Tus planes:\n\n${lines.join("\n")}`, planKeyboard(plans[0]));
  }

  async #pause(text, chatId, userId) {
    const id = parseOptionalPlanId(text, "/pause");
    const plan = await this.#resolveOwnedPlan(id, chatId, userId, ["APPROVED_SCHEDULED"]);
    await this.#pauseById(plan.id, chatId, userId);
  }

  async #pauseById(id, chatId, userId) {
    const plan = await this.#ownedPlan(id, chatId, userId);
    if (plan.schedule) await this.scheduler.deactivate(plan.schedule.id);
    const paused = pausePlan(plan, { chatId, userId }, this.now());
    const saved = await this.store.transactPlan(id, (current) => {
      if (current.status !== plan.status || current.version !== plan.version) throw new Error("El plan cambió; consulta su estado.");
      return paused;
    });
    await this.telegram.sendMessage(chatId, `⏸ Plan ${id} pausado. No habrá más entregas hasta que lo reanudes.`, planKeyboard(saved));
  }

  async #resume(text, chatId, userId) {
    const id = parseOptionalPlanId(text, "/resume");
    const plan = await this.#resolveOwnedPlan(id, chatId, userId, ["PAUSED"]);
    await this.#resumeById(plan.id, chatId, userId);
  }

  async #resumeById(id, chatId, userId) {
    const plan = await this.#ownedPlan(id, chatId, userId);
    const resumed = resumePlan(plan, { chatId, userId }, this.now());
    await this.scheduler.activate(plan.schedule.id);
    const saved = await this.store.transactPlan(id, (current) => {
      if (current.status !== plan.status || current.queueHash !== plan.queueHash) throw new Error("El plan cambió; no se reanudó.");
      return resumed;
    });
    await this.telegram.sendMessage(chatId, `▶️ Plan ${id} reanudado. Próxima entrega según el horario configurado.`, planKeyboard(saved));
  }

  async #confirmResumeLegacy(text, chatId, userId) {
    const [id, version] = parseArguments(text, "/confirm_resume", 2);
    const plan = await this.#ownedPlan(id, chatId, userId);
    if (Number(version) !== plan.version) throw new Error("La versión no coincide.");
    await this.#resumeById(id, chatId, userId);
  }

  async #showEntryHelp(text, chatId, userId, kind) {
    const command = kind === "hint" ? "/hint" : "/solution";
    const [id, entryId] = parseArguments(text, command, 2);
    const plan = await this.#ownedPlan(id, chatId, userId);
    const delivered = plan.receipts.some(
      (receipt) => receipt.entryId === entryId && receipt.status === "sent",
    );
    if (!delivered) throw new Error("Esa entrada todavía no fue entregada.");
    const entry = plan.entries.find((candidate) => candidate.id === entryId);
    if (!entry) throw new Error("Entrada no encontrada.");
    const content = kind === "hint" ? `Pistas:\n• ${entry.hints.join("\n• ")}` : `Solución revisable:\n${entry.solution}`;
    await this.telegram.sendMessage(chatId, `${plan.id} · ${entry.id}\n${content}`);
  }

  async #resolveOwnedPlan(id, chatId, userId, preferredStatuses = []) {
    if (id) return this.#ownedPlan(id, chatId, userId);
    const plans = (await this.store.listPlansForChat(chatId))
      .filter((plan) => plan.ownerUserId === userId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const plan = preferredStatuses.length > 0
      ? plans.find((candidate) => preferredStatuses.includes(candidate.status))
      : plans[0];
    if (!plan) throw new Error("No encontré un plan aplicable en este chat.");
    return plan;
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

function navigationKeyboard() {
  return keyboard([
    [button("Crear un plan", "nav:create"), button("Ver planes", "nav:plans")],
    [button("Ayuda", "nav:help")],
  ]);
}

function daysKeyboard() {
  return keyboard([
    [button("3 días", "setup:days:3"), button("5 días", "setup:days:5"), button("7 días", "setup:days:7")],
    [button("Otro", "setup:days:other"), button("Cancelar", "setup:cancel")],
  ]);
}

function timeKeyboard() {
  return keyboard([
    [button("08:00", "setup:time:08:00"), button("18:00", "setup:time:18:00")],
    [button("Otra hora", "setup:time:other"), button("Cancelar", "setup:cancel")],
  ]);
}

function timezoneKeyboard() {
  return keyboard([
    [button("America/Asuncion", "setup:tz:America/Asuncion")],
    [button("UTC", "setup:tz:UTC"), button("Otra zona", "setup:tz:other")],
    [button("Cancelar", "setup:cancel")],
  ]);
}

function cancelKeyboard() {
  return keyboard([[button("Cancelar", "setup:cancel")]]);
}

function planKeyboard(plan) {
  const rows = [
    [button("Ver plan completo", `plan:view:${plan.id}`), button("Ver estado", `plan:status:${plan.id}`)],
  ];
  if (plan.status === "APPROVED_SCHEDULED") rows.push([button("Pausar entregas", `plan:pause:${plan.id}`)]);
  if (plan.status === "PAUSED") rows.push([button("Reanudar", `plan:resume:${plan.id}`)]);
  if (plan.status === "DRAFT") rows.push([button("Reintentar programación", `plan:schedule:${plan.id}`)]);
  rows.push([button("Crear otro plan", "nav:create")]);
  return keyboard(rows);
}

function keyboard(inlineKeyboard) {
  return { reply_markup: { inline_keyboard: inlineKeyboard } };
}

function button(text, callbackData) {
  return { text, callback_data: callbackData };
}

function parseArguments(text, command, count) {
  const pattern = new RegExp(`^${command}(?:@\\w+)?\\s+(.+)$`, "i");
  const match = text.match(pattern);
  const values = match?.[1]?.trim().split(/\s+/) ?? [];
  if (values.length !== count) throw new Error(`Uso: ${command} ${count === 1 ? "<planId>" : "<planId> <version>"}`);
  return values;
}

function parseOptionalPlanId(text, command) {
  const pattern = new RegExp(`^${command}(?:@\\w+)?(?:\\s+(\\S+))?\\s*$`, "i");
  const match = text.match(pattern);
  if (!match) throw new Error(`Uso: ${command} [planId]`);
  return match[1] ?? null;
}

function isSingleHttpsUrl(value) {
  try {
    validatePublicHttpsUrl(value);
    return !/\s/.test(value);
  } catch {
    return false;
  }
}

function visibleStatus(status) {
  return {
    DRAFT: "pendiente de programación",
    APPROVED_SCHEDULED: "activo",
    PAUSED: "pausado",
    COMPLETED: "completado",
  }[status] ?? status;
}

function safeError(error) {
  return error instanceof Error ? error.message.slice(0, 500) : "error desconocido";
}

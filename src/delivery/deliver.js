import { PLAN_STATUS, localDate, selectDueEntry } from "../domain/plan.js";

export async function deliverDueProblem({ store, telegram, planId, timestamp = new Date() }) {
  let decision;
  let reservedReceipt;

  await store.transactPlan(planId, (plan) => {
    decision = selectDueEntry(plan, timestamp);
    if (decision.kind === "skip") {
      const today = localDate(timestamp, plan.timezone);
      const lastDate = plan.entries.at(-1)?.scheduledDate;
      if (
        decision.reason === "no_entry_for_date" &&
        lastDate &&
        today > lastDate &&
        plan.status === PLAN_STATUS.APPROVED_SCHEDULED
      ) {
        plan.status = PLAN_STATUS.COMPLETED;
        if (plan.schedule) plan.schedule.active = false;
        plan.updatedAt = new Date(timestamp).toISOString();
        decision = { ...decision, reason: "plan_completed", completed: true };
      }
      return plan;
    }

    reservedReceipt = {
      deliveryKey: decision.deliveryKey,
      entryId: decision.entry.id,
      scheduledDate: decision.date,
      status: "sending",
      attemptedAt: new Date().toISOString(),
      sentAt: null,
      telegramMessageIds: [],
      error: null,
    };
    plan.receipts.push(reservedReceipt);
    plan.updatedAt = new Date().toISOString();
    return plan;
  });

  if (decision.kind === "skip") return decision;

  try {
    const messages = await telegram.sendMessage(
      (await store.getPlan(planId)).chatId,
      formatDailyDelivery(await store.getPlan(planId), decision.entry),
    );
    let completed = false;
    await store.transactPlan(planId, (plan) => {
      const receipt = plan.receipts.find((candidate) => candidate.deliveryKey === decision.deliveryKey);
      if (!receipt || receipt.status !== "sending") {
        throw new Error("El recibo reservado no está disponible para finalizar.");
      }
      receipt.status = "sent";
      receipt.sentAt = new Date().toISOString();
      receipt.telegramMessageIds = messages.map((message) => message.message_id).filter(Boolean);
      completed = plan.entries.every((entry) =>
        plan.receipts.some((candidate) => candidate.entryId === entry.id && candidate.status === "sent"),
      );
      if (completed) {
        plan.status = PLAN_STATUS.COMPLETED;
        if (plan.schedule) plan.schedule.active = false;
      }
      plan.updatedAt = new Date().toISOString();
      return plan;
    });
    return { ...decision, status: "sent", completed };
  } catch (error) {
    await store.transactPlan(planId, (plan) => {
      const receipt = plan.receipts.find((candidate) => candidate.deliveryKey === decision.deliveryKey);
      if (receipt?.status === "sending") {
        receipt.status = "uncertain";
        receipt.error = safeError(error);
        plan.updatedAt = new Date().toISOString();
      }
      return plan;
    });
    throw error;
  }
}

export function formatDailyDelivery(plan, entry) {
  return `PRÁCTICA DIARIA · ${plan.id} v${plan.version}\nDÍA ${entry.day} · ${entry.topic}\n\nObjetivo: ${entry.objective}\n\n${entry.problem}\n\nPista: /hint ${plan.id} ${entry.id}\nSolución: /solution ${plan.id} ${entry.id}\nPausar: /pause ${plan.id}\n\nContenido de la cola sellada automáticamente · REVISIÓN RECOMENDADA`;
}

function safeError(error) {
  return error instanceof Error ? error.message.slice(0, 500) : "error desconocido";
}

import { createHash, randomBytes } from "node:crypto";

export const PLAN_STATUS = Object.freeze({
  AWAITING_SOURCE: "AWAITING_SOURCE",
  GENERATING: "GENERATING",
  DRAFT: "DRAFT",
  APPROVED_SCHEDULED: "APPROVED_SCHEDULED",
  PAUSED: "PAUSED",
  COMPLETED: "COMPLETED",
});

const ACTIVE_STATUSES = new Set([
  PLAN_STATUS.APPROVED_SCHEDULED,
  PLAN_STATUS.PAUSED,
  PLAN_STATUS.COMPLETED,
]);

export function parsePlanCommand(text) {
  const match = text.trim().match(/^\/plan(?:@\w+)?\s+(\d+)\s+(\d{1,2}:\d{2})\s+(\S+)$/i);
  if (!match) {
    throw new Error("Uso: /plan <1-7 días> <HH:MM> <zona IANA>");
  }

  const days = Number(match[1]);
  const deliveryTime = normalizeTime(match[2]);
  const timezone = validateTimezone(match[3]);

  if (!Number.isInteger(days) || days < 1 || days > 7) {
    throw new Error("El MVP admite planes de 1 a 7 días.");
  }

  return { days, deliveryTime, timezone };
}

export function normalizeTime(value) {
  const match = String(value).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) throw new Error("La hora debe usar HH:MM.");

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error("La hora no es válida.");
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function validateTimezone(value) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return value;
  } catch {
    throw new Error("La zona horaria IANA no es válida.");
  }
}

export function localDate(timestamp, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: validateTimezone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));

  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function addCalendarDays(dateString, amount) {
  assertDateString(dateString);
  const date = new Date(`${dateString}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function buildScheduledEntries(entries, startDate) {
  assertDateString(startDate);
  return entries.map((entry, index) => ({
    ...entry,
    day: index + 1,
    scheduledDate: addCalendarDays(startDate, index),
  }));
}

export function createDraftPlan(input, now = new Date()) {
  const entries = validateEntries(input.entries, input.days);
  const id = input.id ?? `QG-${randomBytes(3).toString("hex").toUpperCase()}`;
  const version = input.version ?? 1;
  const startDate = input.startDate ?? addCalendarDays(localDate(now, input.timezone), 1);
  const scheduledEntries = buildScheduledEntries(entries, startDate);
  const queueHash = hashQueue(scheduledEntries);
  const timestamp = new Date(now).toISOString();

  return {
    id,
    chatId: String(input.chatId),
    ownerUserId: String(input.ownerUserId),
    createdAt: timestamp,
    updatedAt: timestamp,
    days: input.days,
    deliveryTime: normalizeTime(input.deliveryTime),
    timezone: validateTimezone(input.timezone),
    startDate,
    source: validateSource(input.source),
    summary: requireText(input.summary, "summary"),
    objectives: stringArray(input.objectives, "objectives"),
    researchSources: validateResearchSources(input.researchSources ?? []),
    entries: scheduledEntries,
    version,
    queueHash,
    status: PLAN_STATUS.DRAFT,
    approvedAt: null,
    schedule: null,
    receipts: [],
  };
}

export function approvePlan(plan, actor, now = new Date()) {
  assertOwner(plan, actor);
  if (plan.status !== PLAN_STATUS.DRAFT) {
    throw new Error("Solo un borrador puede aprobarse.");
  }

  if (hashQueue(plan.entries) !== plan.queueHash) {
    throw new Error("La cola cambió; regenera la versión antes de aprobar.");
  }

  return {
    ...plan,
    status: PLAN_STATUS.APPROVED_SCHEDULED,
    approvedAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
  };
}

export function attachSchedule(plan, schedule, now = new Date()) {
  if (plan.status !== PLAN_STATUS.APPROVED_SCHEDULED) {
    throw new Error("El plan debe estar aprobado antes de asociar un schedule.");
  }
  if (!schedule?.id || !schedule?.deduplicationKey) {
    throw new Error("El recibo del schedule está incompleto.");
  }

  return {
    ...plan,
    schedule: {
      id: schedule.id,
      deduplicationKey: schedule.deduplicationKey,
      active: schedule.active !== false,
      simulated: schedule.simulated === true,
    },
    updatedAt: new Date(now).toISOString(),
  };
}

export function pausePlan(plan, actor, now = new Date()) {
  assertOwner(plan, actor);
  if (plan.status !== PLAN_STATUS.APPROVED_SCHEDULED) {
    throw new Error("Solo un plan programado puede pausarse.");
  }
  return {
    ...plan,
    status: PLAN_STATUS.PAUSED,
    schedule: plan.schedule ? { ...plan.schedule, active: false } : null,
    updatedAt: new Date(now).toISOString(),
  };
}

export function resumePlan(plan, actor, now = new Date()) {
  assertOwner(plan, actor);
  if (plan.status !== PLAN_STATUS.PAUSED) {
    throw new Error("Solo un plan pausado puede reanudarse.");
  }
  if (hashQueue(plan.entries) !== plan.queueHash) {
    throw new Error("La cola cambió; requiere una nueva aprobación.");
  }
  return {
    ...plan,
    status: PLAN_STATUS.APPROVED_SCHEDULED,
    schedule: plan.schedule ? { ...plan.schedule, active: true } : null,
    updatedAt: new Date(now).toISOString(),
  };
}

export function selectDueEntry(plan, timestamp = new Date()) {
  if (plan.status !== PLAN_STATUS.APPROVED_SCHEDULED || plan.schedule?.active !== true) {
    return { kind: "skip", reason: "plan_not_active" };
  }
  if (hashQueue(plan.entries) !== plan.queueHash) {
    return { kind: "skip", reason: "approval_invalid" };
  }

  const date = localDate(timestamp, plan.timezone);
  const entry = plan.entries.find((candidate) => candidate.scheduledDate === date);
  if (!entry) return { kind: "skip", reason: "no_entry_for_date", date };

  const deliveryKey = `${plan.id}:${plan.version}:${date}:${entry.id}`;
  const receipt = plan.receipts.find((candidate) => candidate.deliveryKey === deliveryKey);
  if (receipt) return { kind: "skip", reason: "already_attempted", date, receipt };

  return { kind: "deliver", date, deliveryKey, entry };
}

export function hashQueue(entries) {
  const normalized = entries.map((entry) => ({
    id: entry.id,
    day: entry.day,
    scheduledDate: entry.scheduledDate,
    topic: entry.topic,
    objective: entry.objective,
    problem: entry.problem,
    hints: entry.hints,
    solution: entry.solution,
    sourceUrls: [...entry.sourceUrls].sort(),
    reviewRequired: entry.reviewRequired,
  }));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

export function assertOwner(plan, actor) {
  if (String(actor.chatId) !== plan.chatId || String(actor.userId) !== plan.ownerUserId) {
    throw new Error("No tienes permiso para modificar este plan.");
  }
}

function validateEntries(entries, days) {
  if (!Array.isArray(entries) || entries.length !== days) {
    throw new Error(`El plan debe contener exactamente ${days} entradas.`);
  }
  const ids = new Set();
  return entries.map((entry, index) => {
    const id = requireText(entry.id ?? `D${index + 1}`, "entry.id");
    if (ids.has(id)) throw new Error("Los IDs de entrada deben ser únicos.");
    ids.add(id);
    return {
      id,
      topic: requireText(entry.topic, "entry.topic"),
      objective: requireText(entry.objective, "entry.objective"),
      problem: requireText(entry.problem, "entry.problem"),
      hints: stringArray(entry.hints, "entry.hints"),
      solution: requireText(entry.solution, "entry.solution"),
      sourceUrls: urlArray(entry.sourceUrls ?? []),
      reviewRequired: entry.reviewRequired !== false,
    };
  });
}

function validateSource(source) {
  if (!source || !["document", "url", "fixture"].includes(source.kind)) {
    throw new Error("El tipo de fuente no es válido.");
  }
  return {
    kind: source.kind,
    label: requireText(source.label, "source.label"),
    sha256: requireText(source.sha256, "source.sha256"),
  };
}

function validateResearchSources(sources) {
  if (!Array.isArray(sources)) throw new Error("researchSources debe ser una lista.");
  return sources.map((source) => ({
    title: requireText(source.title, "researchSource.title"),
    url: validatePublicHttpsUrl(source.url).toString(),
    excerpt: requireText(source.excerpt, "researchSource.excerpt"),
  }));
}

export function validatePublicHttpsUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("La URL no es válida.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new Error("Solo se permiten URLs HTTPS públicas sin credenciales ni puerto.");
  }
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === "::1" ||
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    host.startsWith("fe80:")
  ) {
    throw new Error("La URL apunta a una red no pública.");
  }
  return url;
}

function urlArray(values) {
  if (!Array.isArray(values)) throw new Error("sourceUrls debe ser una lista.");
  return values.map((value) => validatePublicHttpsUrl(value).toString());
}

function stringArray(values, name) {
  if (!Array.isArray(values)) throw new Error(`${name} debe ser una lista.`);
  return values.map((value) => requireText(value, name));
}

function requireText(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} no puede estar vacío.`);
  }
  return value.trim();
}

function assertDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error("La fecha debe usar YYYY-MM-DD.");
  }
}

export function isApprovedStatus(status) {
  return ACTIVE_STATUSES.has(status);
}

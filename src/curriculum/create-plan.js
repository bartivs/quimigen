import { createDraftPlan } from "../domain/plan.js";
import { runStage } from "./stage.js";

export async function createPlanFromCurriculum({ input, source, model, research, now = new Date() }) {
  const outline = validateOutline(await runStage("OpenRouter · análisis", () =>
    model.outlineCurriculum(source.text, input.days)));
  const researchSources = await runStage("Exa · investigación", () => research.search(outline.researchQueries));
  if (researchSources.length === 0) throw new Error("Exa no encontró fuentes utilizables. Reenvía el currículo para reintentar.");
  const generated = validateGeneratedPlan(
    await runStage("OpenRouter · generación", () => model.generatePlan({ outline, sources: researchSources, days: input.days })),
    input.days,
    researchSources,
  );

  const sourceDescriptor = {
    kind: source.kind,
    label: source.label,
    sha256: source.sha256,
  };
  if (source.url && !researchSources.some((candidate) => candidate.url === source.url)) {
    researchSources.unshift({
      title: source.label,
      url: source.url,
      excerpt: "Currículo proporcionado por el usuario.",
    });
  }

  return createDraftPlan(
    {
      id: input.id,
      chatId: input.chatId,
      ownerUserId: input.ownerUserId,
      days: input.days,
      deliveryTime: input.deliveryTime,
      timezone: input.timezone,
      source: sourceDescriptor,
      summary: generated.summary,
      objectives: outline.objectives,
      researchSources,
      entries: generated.entries,
    },
    now,
  );
}

function validateOutline(value) {
  if (!value || typeof value.subject !== "string") throw new Error("Outline inválido: subject.");
  for (const key of ["objectives", "constraints", "researchQueries"]) {
    if (!Array.isArray(value[key])) throw new Error(`Outline inválido: ${key}.`);
  }
  if (value.objectives.length === 0 || value.researchQueries.length === 0) {
    throw new Error("El outline debe incluir objetivos y consultas.");
  }
  return value;
}

function validateGeneratedPlan(value, days, sources) {
  if (!value || typeof value.summary !== "string" || !Array.isArray(value.entries)) {
    throw new Error("El plan generado no cumple el contrato.");
  }
  if (value.entries.length !== days) {
    throw new Error(`El modelo devolvió ${value.entries.length} entradas; se esperaban ${days}.`);
  }

  const allowedUrls = new Set(sources.map((source) => source.url));
  for (const entry of value.entries) {
    if (entry.reviewRequired !== true) {
      throw new Error("Cada entrada debe requerir revisión humana.");
    }
    if (!Array.isArray(entry.sourceUrls) || entry.sourceUrls.length === 0) {
      throw new Error("Cada entrada debe citar al menos una fuente investigada.");
    }
    if (entry.sourceUrls.some((url) => !allowedUrls.has(url))) {
      throw new Error("El modelo citó una URL que no proviene de la investigación.");
    }
  }
  return value;
}

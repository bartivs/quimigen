export function formatPlanPreview(plan, fixture = false) {
  const prefix = fixture ? "DEMO FIXTURE · " : "";
  const sourceLines = plan.researchSources
    .map((source, index) => `${index + 1}. ${source.title}\n${source.url}`)
    .join("\n");
  const entries = plan.entries.map(formatEntry).join("\n\n");
  return `${prefix}BORRADOR ${plan.id} v${plan.version}\n\n${plan.summary}\n\nInicio: ${plan.startDate}\nHora: ${plan.deliveryTime} (${plan.timezone})\nProblemas: ${plan.entries.length}\nRevisión humana: obligatoria\n\nOBJETIVOS\n${plan.objectives.map((value) => `• ${value}`).join("\n")}\n\nFUENTES\n${sourceLines || "Sin fuentes externas"}\n\nCOLA COMPLETA PARA REVISIÓN\n${entries}\n\nNada se enviará todavía. Para aprobar exactamente esta cola:\n/approve ${plan.id} ${plan.version}`;
}

export function formatEntry(entry) {
  return `DÍA ${entry.day} · ${entry.scheduledDate} · ${entry.topic}\nObjetivo: ${entry.objective}\nProblema: ${entry.problem}\nPistas: ${entry.hints.join(" | ")}\nSolución: ${entry.solution}\nFuentes: ${entry.sourceUrls.join(", ")}\nREVISIÓN REQUERIDA`;
}

export function formatStatus(plan) {
  const delivered = plan.receipts.filter((receipt) => receipt.status === "sent").length;
  const schedule = plan.schedule
    ? `${plan.schedule.id}${plan.schedule.simulated ? " · TRIGGER SIMULATED" : ""}`
    : "sin schedule";
  return `${plan.id} v${plan.version}\nEstado: ${plan.status}\nEntrega: ${plan.deliveryTime} (${plan.timezone})\nInicio: ${plan.startDate}\nEntregados: ${delivered}/${plan.entries.length}\nSchedule: ${schedule}`;
}

export const HELP_TEXT = `QuimiGen convierte un currículo en práctica diaria revisable.\n\n1. /plan <1-7 días> <HH:MM> <zona IANA>\n2. Envía un .txt, .md, .pdf o URL HTTPS pública.\n3. Revisa la cola completa.\n4. /approve <planId> <version>\n\nControles: /status <planId>, /pause <planId>, /resume <planId>, /confirm_resume <planId> <version>. Después de una entrega: /hint <planId> <entryId>, /solution <planId> <entryId>.\n\n/demo crea un borrador rotulado sin usar proveedores live.\n\nPrivacidad: no envíes nombres, notas ni datos personales. Los archivos temporales se eliminan después de extraerlos.`;

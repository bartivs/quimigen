export function formatPlanPreview(plan, fixture = false) {
  const prefix = fixture ? "DEMO FIXTURE · " : "";
  const sourceLines = plan.researchSources
    .map((source, index) => `${index + 1}. ${source.title}\n${source.url}`)
    .join("\n");
  const entries = plan.entries.map(formatEntry).join("\n\n");
  const presentation = {
    APPROVED_SCHEDULED: {
      heading: "PLAN CREADO Y PROGRAMADO",
      footer: "Esta versión quedó sellada y programada automáticamente. Solo se enviarán los ejercicios exactos que aparecen arriba. Puedes pausar las entregas cuando quieras.",
    },
    PAUSED: {
      heading: "PLAN PAUSADO",
      footer: "Esta versión continúa sellada, pero no se enviará nada mientras esté pausada. Puedes reanudarla cuando quieras.",
    },
    COMPLETED: {
      heading: "PLAN COMPLETADO",
      footer: "Todas las entregas previstas para esta versión sellada finalizaron.",
    },
    DRAFT: {
      heading: "PLAN CREADO",
      footer: "La cola está guardada, pero las entregas no están activas. Usa «Reintentar programación» cuando el servicio vuelva a estar disponible.",
    },
  }[plan.status] ?? { heading: "PLAN", footer: "Consulta el estado antes de continuar." };
  const { heading, footer } = presentation;
  return `${prefix}${heading} · ${plan.id} v${plan.version}\n\n${plan.summary}\n\nInicio: ${plan.startDate}\nHora: ${plan.deliveryTime} (${plan.timezone})\nProblemas: ${plan.entries.length}\nRevisión humana recomendada\n\nOBJETIVOS\n${plan.objectives.map((value) => `• ${value}`).join("\n")}\n\nFUENTES\n${sourceLines || "Sin fuentes externas"}\n\nCOLA COMPLETA\n${entries}\n\n${footer}`;
}

export function formatEntry(entry) {
  return `DÍA ${entry.day} · ${entry.scheduledDate} · ${entry.topic}\nObjetivo: ${entry.objective}\nProblema: ${entry.problem}\nPistas: ${entry.hints.join(" | ")}\nSolución: ${entry.solution}\nFuentes: ${entry.sourceUrls.join(", ")}\nREVISIÓN RECOMENDADA`;
}

export function formatStatus(plan) {
  const delivered = plan.receipts.filter((receipt) => receipt.status === "sent").length;
  const schedule = plan.schedule
    ? `${plan.schedule.id}${plan.schedule.simulated ? " · TRIGGER SIMULATED" : ""}`
    : "sin programación activa";
  return `${plan.id} v${plan.version}\nEstado: ${visibleStatus(plan.status)}\nEntrega: ${plan.deliveryTime} (${plan.timezone})\nInicio: ${plan.startDate}\nEntregados: ${delivered}/${plan.entries.length}\nProgramación: ${schedule}`;
}

export const WELCOME_TEXT = `¡Hola! Creo planes de práctica a partir de un currículo.\n\nTe guiaré para elegir la duración y el horario. Después podrás enviar un archivo o una URL; la cola quedará programada automáticamente y podrás pausarla cuando quieras.\n\nPrivacidad: no envíes nombres, notas ni datos personales.`;

export const HELP_TEXT = `QuimiGen convierte un currículo en práctica diaria.\n\nFlujo guiado:\n1. Toca «Crear un plan» o envía /plan.\n2. Elige duración, hora y zona horaria.\n3. Envía un .txt, .md, .pdf o una URL HTTPS pública.\n4. El plan se genera, se sella y se programa automáticamente.\n\nTambién puedes configurar todo de una vez:\n/plan <1-7 días> <HH:MM> <zona IANA>\n\nControles: /status [planId], /pause [planId] y /resume [planId]. Si omites el ID se usa el plan más reciente aplicable. Después de una entrega: /hint <planId> <entryId> y /solution <planId> <entryId>.\n\n/demo crea y programa un plan rotulado sin usar proveedores live.\n\nPrivacidad: no envíes nombres, notas ni datos personales. Los archivos temporales se eliminan después de extraerlos.`;

function visibleStatus(status) {
  return {
    DRAFT: "pendiente de programación",
    APPROVED_SCHEDULED: "activo",
    PAUSED: "pausado",
    COMPLETED: "completado",
  }[status] ?? status;
}

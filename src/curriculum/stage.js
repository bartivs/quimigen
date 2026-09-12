// Log metadata only: never curricula, prompts, responses, URLs, or user/chat IDs.
export async function runStage(stage, operation, logger = console.info) {
  const startedAt = Date.now();
  const report = (status, extra = {}) => {
    try {
      logger(JSON.stringify({ event: "quimigen_stage", stage, status, elapsedMs: Date.now() - startedAt, ...extra }));
    } catch {
      // Diagnostics must not change the outcome of an operation.
    }
  };
  report("started");
  try {
    const result = await operation();
    report("completed");
    return result;
  } catch (cause) {
    const timeout = cause?.code === "PROVIDER_TIMEOUT" || cause?.name === "TimeoutError";
    report("failed", { reason: timeout ? "timeout" : "operation_failed" });
    const error = new Error(`${stage}: ${timeout ? "se agotó el tiempo de espera" : "no se pudo completar la etapa"}.`, { cause });
    error.code = timeout ? "PROVIDER_TIMEOUT" : "STAGE_FAILED";
    throw error;
  }
}

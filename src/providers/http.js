export class ProviderTimeoutError extends Error {
  constructor(requestName, timeoutMs, cause) {
    super(`${requestName}: se agotó el tiempo de espera (${timeoutMs / 1_000} s).`, { cause });
    this.name = "ProviderTimeoutError";
    this.code = "PROVIDER_TIMEOUT";
  }
}

export async function fetchJson(url, options = {}) {
  const { timeoutMs = 20_000, signal, requestName = "El proveedor", ...fetchOptions } = options;
  const deadline = AbortSignal.timeout(timeoutMs);
  let response;
  let bodyText;
  try {
    response = await fetch(url, {
      ...fetchOptions,
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      headers: {
        accept: "application/json",
        ...fetchOptions.headers,
      },
    });
    // Keep the deadline active while reading the response, not just its headers.
    bodyText = await response.text();
  } catch (error) {
    if (deadline.aborted && !signal?.aborted) {
      throw new ProviderTimeoutError(requestName, timeoutMs, error);
    }
    throw error;
  }
  let body;
  try {
    body = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    throw new Error(`El proveedor devolvió JSON inválido (${response.status}).`);
  }

  if (!response.ok) {
    const detail = body?.error?.message ?? body?.error ?? body?.message ?? response.statusText;
    throw new Error(`Error del proveedor (${response.status}): ${detail}`);
  }
  return body;
}

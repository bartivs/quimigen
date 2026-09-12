export async function fetchJson(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const response = await fetch(url, {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(timeoutMs),
    headers: {
      accept: "application/json",
      ...options.headers,
    },
  });

  const bodyText = await response.text();
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

import { validatePublicHttpsUrl } from "../domain/plan.js";
import { fetchJson } from "./http.js";

export class ExaClient {
  constructor({ apiKey = process.env.EXA_API_KEY, request = fetchJson } = {}) {
    if (!apiKey) throw new Error("EXA_API_KEY no está configurada.");
    this.apiKey = apiKey;
    this.request = request;
  }

  async getUrlText(inputUrl) {
    const url = validatePublicHttpsUrl(inputUrl).toString();
    const response = await this.request("https://api.exa.ai/contents", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
      },
      body: JSON.stringify({ ids: [url], text: { maxCharacters: 60_000 } }),
    });
    const result = response?.results?.[0];
    if (!result?.text?.trim()) throw new Error("Exa no pudo extraer texto de la URL.");
    return {
      text: capText(result.text),
      label: result.title?.trim() || url,
      canonicalUrl: validatePublicHttpsUrl(result.url || url).toString(),
    };
  }

  async search(queries) {
    const boundedQueries = normalizeQueries(queries);
    const responses = await Promise.all(
      boundedQueries.map((query) =>
        this.request("https://api.exa.ai/search", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": this.apiKey,
          },
          body: JSON.stringify({
            query,
            type: "auto",
            numResults: 3,
            moderation: true,
            contents: { highlights: { maxCharacters: 1_200 } },
          }),
        }),
      ),
    );

    const byUrl = new Map();
    for (const response of responses) {
      for (const result of response?.results ?? []) {
        try {
          const url = validatePublicHttpsUrl(result.url).toString();
          if (!byUrl.has(url)) {
            const excerpt = Array.isArray(result.highlights)
              ? result.highlights.join(" … ")
              : result.text || result.summary || "Fuente localizada por Exa.";
            byUrl.set(url, {
              title: String(result.title || new URL(url).hostname).trim(),
              url,
              excerpt: capText(String(excerpt), 1_500),
            });
          }
        } catch {
          // Ignore malformed or non-public provider results.
        }
      }
    }
    return [...byUrl.values()].slice(0, 6);
  }
}

function normalizeQueries(queries) {
  if (!Array.isArray(queries)) throw new Error("Las consultas Exa deben ser una lista.");
  const normalized = [...new Set(queries.map((value) => String(value).trim()).filter(Boolean))]
    .slice(0, 3)
    .map((value) => value.slice(0, 300));
  if (normalized.length === 0) throw new Error("El agente no produjo consultas de investigación.");
  return normalized;
}

function capText(value, limit = 80_000) {
  const normalized = value.replaceAll("\u0000", "").trim();
  if (!normalized) throw new Error("La fuente no contiene texto utilizable.");
  return normalized.slice(0, limit);
}

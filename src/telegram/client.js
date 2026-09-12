import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fetchJson } from "../providers/http.js";

const MAX_FILE_BYTES = 20 * 1024 * 1024;

export class TelegramClient {
  constructor({ token = process.env.TELEGRAM_BOT_TOKEN, request = fetchJson, binaryFetch = fetch } = {}) {
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN no está configurado.");
    this.baseUrl = `https://api.telegram.org/bot${token}`;
    this.fileBaseUrl = `https://api.telegram.org/file/bot${token}`;
    this.request = request;
    this.binaryFetch = binaryFetch;
  }

  async getUpdates(offset, timeout = 30) {
    const body = await this.#call("getUpdates", {
      offset,
      timeout,
      allowed_updates: ["message", "callback_query"],
    }, (timeout + 10) * 1_000);
    return body.result ?? [];
  }

  async sendMessage(chatId, text, extra = {}) {
    const messages = [];
    const chunks = chunkText(text);
    for (const [index, chunk] of chunks.entries()) {
      const body = await this.#call("sendMessage", {
        chat_id: String(chatId),
        text: chunk,
        link_preview_options: { is_disabled: true },
        ...(index === chunks.length - 1 ? extra : {}),
      });
      messages.push(body.result);
    }
    return messages;
  }

  async answerCallbackQuery(callbackQueryId) {
    const body = await this.#call("answerCallbackQuery", {
      callback_query_id: String(callbackQueryId),
    });
    return body.result;
  }

  async downloadDocument(document, directory) {
    if (!document?.file_id) throw new Error("El mensaje no contiene un documento descargable.");
    if (document.file_size && document.file_size > MAX_FILE_BYTES) {
      throw new Error("El archivo supera el máximo de 20 MB.");
    }

    const file = await this.#call("getFile", { file_id: document.file_id });
    if (!file.result?.file_path) throw new Error("Telegram no devolvió la ruta del archivo.");
    const response = await this.binaryFetch(`${this.fileBaseUrl}/${file.result.file_path}`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Telegram no pudo descargar el archivo (${response.status}).`);
    const advertisedSize = Number(response.headers.get("content-length") ?? 0);
    if (advertisedSize > MAX_FILE_BYTES) throw new Error("El archivo supera el máximo de 20 MB.");

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_FILE_BYTES) throw new Error("El archivo supera el máximo de 20 MB.");
    await mkdir(directory, { recursive: true });
    const safeName = sanitizeFileName(document.file_name || basename(file.result.file_path));
    const path = join(directory, safeName);
    await writeFile(path, bytes, { mode: 0o600 });
    return { path, fileName: safeName };
  }

  async #call(method, payload, timeoutMs = 20_000) {
    const response = await this.request(`${this.baseUrl}/${method}`, {
      method: "POST",
      timeoutMs,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response?.ok) {
      throw new Error(`Telegram rechazó ${method}: ${response?.description ?? "error desconocido"}`);
    }
    return response;
  }
}

export function chunkText(value, maxLength = 3_900) {
  const text = String(value);
  if (text.length <= maxLength) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    let boundary = remaining.lastIndexOf("\n\n", maxLength);
    if (boundary < maxLength / 2) boundary = remaining.lastIndexOf("\n", maxLength);
    if (boundary < maxLength / 2) boundary = remaining.lastIndexOf(" ", maxLength);
    if (boundary < maxLength / 2) boundary = maxLength;
    chunks.push(remaining.slice(0, boundary).trimEnd());
    remaining = remaining.slice(boundary).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function sanitizeFileName(value) {
  const safe = basename(String(value)).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return safe || "curriculum.txt";
}

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { stat, readFile } from "node:fs/promises";
import { extname } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_CHARS = 80_000;
const TEXT_EXTENSIONS = new Set([".txt", ".md", ".markdown"]);

export async function extractDocument(filePath, fileName) {
  const metadata = await stat(filePath);
  if (metadata.size > MAX_FILE_BYTES) throw new Error("El archivo supera el máximo de 20 MB.");
  const extension = extname(fileName || filePath).toLowerCase();

  let text;
  if (TEXT_EXTENSIONS.has(extension)) {
    text = await readFile(filePath, "utf8");
  } else if (extension === ".pdf") {
    try {
      const result = await execFileAsync("pdftotext", [filePath, "-"], {
        encoding: "utf8",
        maxBuffer: 2 * 1024 * 1024,
        timeout: 15_000,
      });
      text = result.stdout;
    } catch (error) {
      throw new Error(`No se pudo extraer el PDF con pdftotext: ${error.message}`);
    }
  } else {
    throw new Error("Formato no soportado. Usa .txt, .md o .pdf.");
  }

  const normalized = normalizeExtractedText(text);
  return {
    text: normalized,
    sha256: createHash("sha256").update(normalized).digest("hex"),
    label: fileName,
    kind: "document",
  };
}

export function sourceFromUrlExtraction(extraction) {
  const text = normalizeExtractedText(extraction.text);
  return {
    text,
    sha256: createHash("sha256").update(text).digest("hex"),
    label: extraction.label,
    url: extraction.canonicalUrl,
    kind: "url",
  };
}

function normalizeExtractedText(value) {
  const normalized = String(value)
    .replaceAll("\u0000", "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
  if (!normalized) throw new Error("La fuente no contiene texto utilizable.");
  return normalized.slice(0, MAX_TEXT_CHARS);
}

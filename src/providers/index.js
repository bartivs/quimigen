import { ExaClient } from "./exa.js";
import { FixtureModelClient, FixtureResearchClient } from "./fixture.js";
import { OpenRouterClient } from "./openrouter.js";

export function createProviders(mode = process.env.QUIMIGEN_MODE ?? "live") {
  if (mode === "fixture") {
    return { model: new FixtureModelClient(), research: new FixtureResearchClient(), fixture: true };
  }
  if (mode !== "live") throw new Error(`QUIMIGEN_MODE no soportado: ${mode}`);
  return { model: new OpenRouterClient(), research: new ExaClient(), fixture: false };
}

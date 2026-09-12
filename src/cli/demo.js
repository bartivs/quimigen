import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createPlanFromCurriculum } from "../curriculum/create-plan.js";
import { createProviders } from "../providers/index.js";

const text = await readFile(new URL("../../fixtures/curriculum.md", import.meta.url), "utf8");
const providers = createProviders("fixture");
const plan = await createPlanFromCurriculum({
  input: {
    id: "QG-DEMO",
    chatId: "DEMO_CHAT",
    ownerUserId: "DEMO_USER",
    days: 3,
    deliveryTime: "18:00",
    timezone: "America/Asuncion",
  },
  source: {
    kind: "fixture",
    label: "DEMO FIXTURE · curriculum.md",
    text,
    sha256: createHash("sha256").update(text).digest("hex"),
  },
  model: providers.model,
  research: providers.research,
  now: new Date("2026-09-12T15:00:00Z"),
});

console.log("DEMO FIXTURE · NO PROVIDERS LIVE");
console.log(JSON.stringify(plan, null, 2));

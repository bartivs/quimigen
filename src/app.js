import { JsonStore } from "./store/json-store.js";
import { createProviders } from "./providers/index.js";
import { createScheduler } from "./providers/scheduler.js";
import { QuimiGenBot, runPolling } from "./telegram/bot.js";
import { TelegramClient } from "./telegram/client.js";

const mode = process.env.QUIMIGEN_MODE ?? "live";
const store = new JsonStore();
await store.initialize();
const providers = createProviders(mode);
const scheduler = createScheduler(mode);
const telegram = new TelegramClient();
const bot = new QuimiGenBot({ telegram, store, scheduler, ...providers });

console.log(`QuimiGen bot started · mode=${mode}${providers.fixture ? " · DEMO FIXTURE" : ""}`);
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());
await runPolling(bot, telegram, { signal: controller.signal });

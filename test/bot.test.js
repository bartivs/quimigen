import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { QuimiGenBot } from "../src/telegram/bot.js";
import { FixtureModelClient, FixtureResearchClient } from "../src/providers/fixture.js";
import { FixtureScheduler } from "../src/providers/scheduler.js";
import { JsonStore } from "../src/store/json-store.js";

class FakeTelegram {
  messages = [];
  async sendMessage(chatId, text) {
    this.messages.push({ chatId: String(chatId), text });
    return [{ message_id: this.messages.length }];
  }
}

function update(text, { chatId = 100, userId = 200 } = {}) {
  return { update_id: 1, message: { chat: { id: chatId }, from: { id: userId }, text } };
}

async function harness(t) {
  const directory = await mkdtemp(join(tmpdir(), "quimigen-bot-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const telegram = new FakeTelegram();
  const store = new JsonStore(join(directory, "state.json"));
  const bot = new QuimiGenBot({
    telegram,
    store,
    model: new FixtureModelClient(),
    research: new FixtureResearchClient(),
    scheduler: new FixtureScheduler("test"),
    fixture: true,
    now: () => new Date("2026-09-12T15:00:00Z"),
  });
  return { bot, telegram, store };
}

test("plan command records bounded intake and rejects another sender", async (t) => {
  const { bot, telegram, store } = await harness(t);
  await bot.handleUpdate(update("/plan 3 18:00 America/Asuncion"));
  assert.equal((await store.getPendingIntake("100")).days, 3);

  await bot.handleUpdate(update("https://example.com/curriculum", { userId: 999 }));
  assert.match(telegram.messages.at(-1).text, /Solo quien inició/);
});

test("demo exposes the complete queue and requires exact owner/version approval", async (t) => {
  const { bot, telegram, store } = await harness(t);
  await bot.handleUpdate(update("/demo"));
  const plans = await store.listPlansForChat("100");
  assert.equal(plans.length, 1);
  const plan = plans[0];
  assert.match(telegram.messages.at(-1).text, /COLA COMPLETA PARA REVISIÓN/);
  assert.match(telegram.messages.at(-1).text, /DEMO FIXTURE/);
  assert.equal(plan.status, "DRAFT");

  await bot.handleUpdate(update(`/approve ${plan.id} ${plan.version}`, { userId: 999 }));
  assert.match(telegram.messages.at(-1).text, /sin permiso/);
  assert.equal((await store.getPlan(plan.id)).status, "DRAFT");

  await bot.handleUpdate(update(`/approve ${plan.id} 99`));
  assert.match(telegram.messages.at(-1).text, /versión no coincide/);

  await bot.handleUpdate(update(`/approve ${plan.id} ${plan.version}`));
  const approved = await store.getPlan(plan.id);
  assert.equal(approved.status, "APPROVED_SCHEDULED");
  assert.equal(approved.schedule.simulated, true);
  assert.match(telegram.messages.at(-1).text, /TRIGGER SIMULATED/);
});

test("pause and resume need explicit second confirmation", async (t) => {
  const { bot, telegram, store } = await harness(t);
  await bot.handleUpdate(update("/demo"));
  const [plan] = await store.listPlansForChat("100");
  await bot.handleUpdate(update(`/approve ${plan.id} ${plan.version}`));
  await bot.handleUpdate(update(`/pause ${plan.id}`));
  assert.equal((await store.getPlan(plan.id)).status, "PAUSED");

  await bot.handleUpdate(update(`/resume ${plan.id}`));
  assert.match(telegram.messages.at(-1).text, /confirm_resume/);
  assert.equal((await store.getPlan(plan.id)).status, "PAUSED");

  await bot.handleUpdate(update(`/confirm_resume ${plan.id} ${plan.version}`));
  assert.equal((await store.getPlan(plan.id)).status, "APPROVED_SCHEDULED");
});

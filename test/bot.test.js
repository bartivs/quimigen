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
  answeredCallbacks = [];

  async sendMessage(chatId, text, extra = {}) {
    this.messages.push({ chatId: String(chatId), text, extra });
    return [{ message_id: this.messages.length }];
  }

  async answerCallbackQuery(id) {
    this.answeredCallbacks.push(id);
    return true;
  }
}

function update(text, { chatId = 100, userId = 200 } = {}) {
  return { update_id: 1, message: { chat: { id: chatId }, from: { id: userId }, text } };
}

function callback(data, { chatId = 100, userId = 200, id = "callback-1" } = {}) {
  return {
    update_id: 2,
    callback_query: {
      id,
      data,
      from: { id: userId },
      message: { chat: { id: chatId } },
    },
  };
}

async function harness(t, { scheduler = new FixtureScheduler("test") } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "quimigen-bot-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const telegram = new FakeTelegram();
  const store = new JsonStore(join(directory, "state.json"));
  const bot = new QuimiGenBot({
    telegram,
    store,
    model: new FixtureModelClient(),
    research: new FixtureResearchClient(),
    scheduler,
    fixture: true,
    now: () => new Date("2026-09-12T15:00:00Z"),
  });
  return { bot, telegram, store };
}

test("guided setup uses buttons and reaches curriculum intake without command syntax", async (t) => {
  const { bot, telegram, store } = await harness(t);

  await bot.handleUpdate(update("/start"));
  assert.equal(telegram.messages.at(-1).extra.reply_markup.inline_keyboard[0][0].callback_data, "nav:create");

  await bot.handleUpdate(callback("nav:create"));
  assert.equal((await store.getPendingIntake("100")).stage, "days");

  await bot.handleUpdate(callback("setup:days:3"));
  await bot.handleUpdate(callback("setup:time:18:00"));
  await bot.handleUpdate(callback("setup:tz:America/Asuncion"));

  const intake = await store.getPendingIntake("100");
  assert.deepEqual(
    { stage: intake.stage, days: intake.days, deliveryTime: intake.deliveryTime, timezone: intake.timezone },
    { stage: "source", days: 3, deliveryTime: "18:00", timezone: "America/Asuncion" },
  );
  assert.match(telegram.messages.at(-1).text, /programado automáticamente/);
  assert.equal(telegram.answeredCallbacks.length, 4);
});

test("advanced plan command records bounded intake and rejects another sender", async (t) => {
  const { bot, telegram, store } = await harness(t);
  await bot.handleUpdate(update("/plan 3 18:00 America/Asuncion"));
  assert.equal((await store.getPendingIntake("100")).days, 3);
  assert.equal((await store.getPendingIntake("100")).stage, "source");

  await bot.handleUpdate(update("https://example.com/curriculum", { userId: 999 }));
  assert.match(telegram.messages.at(-1).text, /Solo quien inició/);
});

test("demo seals and schedules the complete queue without manual approval", async (t) => {
  const { bot, telegram, store } = await harness(t);
  await bot.handleUpdate(update("/demo"));

  const [plan] = await store.listPlansForChat("100");
  assert.equal(plan.status, "APPROVED_SCHEDULED");
  assert.equal(plan.schedule.simulated, true);
  assert.ok(plan.approvedAt);
  assert.match(telegram.messages.at(-1).text, /PLAN CREADO Y PROGRAMADO/);
  assert.match(telegram.messages.at(-1).text, /COLA COMPLETA/);
  assert.match(telegram.messages.at(-1).text, /DEMO FIXTURE/);
  assert.doesNotMatch(telegram.messages.at(-1).text, /\/approve/);
});

test("pause and resume work directly from buttons without a second confirmation", async (t) => {
  const { bot, telegram, store } = await harness(t);
  await bot.handleUpdate(update("/demo"));
  const [plan] = await store.listPlansForChat("100");

  await bot.handleUpdate(callback(`plan:pause:${plan.id}`));
  assert.equal((await store.getPlan(plan.id)).status, "PAUSED");
  assert.match(telegram.messages.at(-1).text, /pausado/);

  await bot.handleUpdate(callback(`plan:resume:${plan.id}`));
  assert.equal((await store.getPlan(plan.id)).status, "APPROVED_SCHEDULED");
  assert.match(telegram.messages.at(-1).text, /reanudado/);
});

test("a scheduling failure keeps the sealed candidate inactive and offers a safe retry", async (t) => {
  let shouldFail = true;
  const fixtureScheduler = new FixtureScheduler("test");
  const scheduler = {
    async createDailySchedule(plan) {
      if (shouldFail) throw new Error("scheduler unavailable");
      return fixtureScheduler.createDailySchedule(plan);
    },
    deactivate: (...args) => fixtureScheduler.deactivate(...args),
    activate: (...args) => fixtureScheduler.activate(...args),
  };
  const { bot, telegram, store } = await harness(t, { scheduler });

  await bot.handleUpdate(update("/demo"));
  const [draft] = await store.listPlansForChat("100");
  assert.equal(draft.status, "DRAFT");
  assert.equal(draft.schedule, null);
  assert.match(telegram.messages.at(-1).text, /no se enviará nada/i);
  assert.equal(
    telegram.messages.at(-1).extra.reply_markup.inline_keyboard.at(-2)[0].callback_data,
    `plan:schedule:${draft.id}`,
  );

  shouldFail = false;
  await bot.handleUpdate(callback(`plan:schedule:${draft.id}`));
  assert.equal((await store.getPlan(draft.id)).status, "APPROVED_SCHEDULED");
});


for (const stage of ["outlineCurriculum", "search", "generatePlan"]) {
  test(`timeout in ${stage} preserves intake and retry creates only one sealed plan`, async (t) => {
    const { bot, telegram, store } = await harness(t);
    const provider = stage === "search" ? bot.research : bot.model;
    const original = provider[stage].bind(provider);
    provider[stage] = async () => { throw new DOMException("timeout", "TimeoutError"); };
    await bot.handleUpdate(update("/plan 3 18:00 UTC"));
    await bot.handleUpdate(update("https://example.com/curriculum"));
    assert.equal((await store.listPlansForChat("100")).length, 0);
    assert.equal((await store.getPendingIntake("100")).stage, "source");
    assert.match(telegram.messages.at(-1).text, /tiempo de espera/);
    assert.match(telegram.messages.at(-1).text, /No se programaron entregas/);
    provider[stage] = original;
    await bot.handleUpdate(update("https://example.com/curriculum"));
    const plans = await store.listPlansForChat("100");
    assert.equal(plans.length, 1);
    assert.equal(plans[0].status, "APPROVED_SCHEDULED");
    assert.equal(await store.getPendingIntake("100"), null);
  });
}

test("preview timeout does not claim the already scheduled plan was rolled back", async (t) => {
  const { bot, telegram, store } = await harness(t);
  const send = telegram.sendMessage.bind(telegram);
  telegram.sendMessage = async (chatId, text, extra) => {
    if (text.includes("COLA COMPLETA")) throw new DOMException("timeout", "TimeoutError");
    return send(chatId, text, extra);
  };
  await bot.handleUpdate(update("/plan 3 18:00 UTC"));
  await bot.handleUpdate(update("https://example.com/curriculum"));
  assert.equal((await store.listPlansForChat("100"))[0].status, "APPROVED_SCHEDULED");
  assert.match(telegram.messages.at(-1).text, /entregas podrían estar activas/);
  assert.match(telegram.messages.at(-1).text, /status/);
});

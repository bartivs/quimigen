import assert from "node:assert/strict";
import test from "node:test";
import { TelegramClient, chunkText } from "../src/telegram/client.js";

test("chunks long messages without dropping content", () => {
  const text = `${"a".repeat(2_000)}\n\n${"b".repeat(2_000)}\n\n${"c".repeat(2_000)}`;
  const chunks = chunkText(text, 2_500);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 2_500));
  assert.equal(chunks.join("\n\n"), text);
});

test("Telegram API requests never require markdown rendering", async () => {
  const calls = [];
  const client = new TelegramClient({
    token: "secret",
    request: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return { ok: true, result: { message_id: calls.length } };
    },
  });
  await client.sendMessage("1", "plain _ content");
  assert.match(calls[0].url, /sendMessage$/);
  assert.equal(calls[0].body.parse_mode, undefined);
  assert.equal(calls[0].body.link_preview_options.is_disabled, true);
});

test("polling includes inline-button callbacks and acknowledges them", async () => {
  const calls = [];
  const client = new TelegramClient({
    token: "secret",
    request: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return { ok: true, result: [] };
    },
  });

  await client.getUpdates(10, 0);
  await client.answerCallbackQuery("callback-1");

  assert.deepEqual(calls[0].body.allowed_updates, ["message", "callback_query"]);
  assert.match(calls[1].url, /answerCallbackQuery$/);
  assert.equal(calls[1].body.callback_query_id, "callback-1");
});

test("inline keyboard is attached only to the final chunk", async () => {
  const calls = [];
  const client = new TelegramClient({
    token: "secret",
    request: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      return { ok: true, result: { message_id: calls.length } };
    },
  });
  const replyMarkup = { inline_keyboard: [[{ text: "Pause", callback_data: "pause" }]] };

  await client.sendMessage("1", `${"a".repeat(3_900)}\n\n${"b".repeat(100)}`, { reply_markup: replyMarkup });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].reply_markup, undefined);
  assert.deepEqual(calls[1].reply_markup, replyMarkup);
});

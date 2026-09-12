import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { JsonStore } from "../src/store/json-store.js";

test("persists plans and pending intake without leaking file permissions", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "quimigen-store-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "state.json");
  const store = new JsonStore(file);

  await store.setPendingIntake("chat-1", { days: 3 });
  assert.deepEqual(await store.getPendingIntake("chat-1"), { days: 3 });
  await store.clearPendingIntake("chat-1");
  assert.equal(await store.getPendingIntake("chat-1"), null);

  await store.putPlan({ id: "QG-1", chatId: "chat-1", value: 1 });
  const updated = await store.transactPlan("QG-1", (plan) => ({ ...plan, value: plan.value + 1 }));
  assert.equal(updated.value, 2);
  assert.equal((await store.getPlan("QG-1")).value, 2);
  assert.equal(JSON.parse(await readFile(file, "utf8")).schemaVersion, 1);
});

test("serializes concurrent transactions through its lock", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "quimigen-store-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new JsonStore(join(directory, "state.json"));
  await store.putPlan({ id: "QG-2", chatId: "chat-2", count: 0 });

  await Promise.all(
    Array.from({ length: 8 }, () =>
      store.transactPlan("QG-2", async (plan) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { ...plan, count: plan.count + 1 };
      }),
    ),
  );

  assert.equal((await store.getPlan("QG-2")).count, 8);
});

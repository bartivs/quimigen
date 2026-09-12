import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const checker = new URL("../scripts/check-deploy-env.sh", import.meta.url).pathname;

function environment(overrides = {}) {
  return {
    QUIMIGEN_MODE: "live",
    TELEGRAM_BOT_TOKEN: "telegram-test",
    EXA_API_KEY: "exa-test",
    OPENROUTER_API_KEY: "openrouter-test",
    TRIGGER_PROJECT_REF: "proj_test",
    TRIGGER_SECRET_KEY: "tr_dev_test",
    TRIGGER_CLI_ACCESS_TOKEN: "tr_pat_test",
    ...overrides,
  };
}

async function writeEnvironment(values) {
  const directory = await mkdtemp(join(tmpdir(), "quimigen-deploy-"));
  const path = join(directory, ".env");
  await writeFile(path, Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n"));
  return { directory, path };
}

test("accepts correctly scoped deployment credentials", async () => {
  const fixture = await writeEnvironment(environment());
  try {
    const { stdout } = await execFileAsync(checker, [fixture.path]);
    assert.match(stdout, /configured/);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("rejects a Trigger secret mistakenly entered as the project ref without echoing it", async () => {
  const leakedValue = "tr_dev_do-not-print-this";
  const fixture = await writeEnvironment(environment({ TRIGGER_PROJECT_REF: leakedValue }));
  try {
    await assert.rejects(execFileAsync(checker, [fixture.path]), (error) => {
      assert.match(error.stderr, /TRIGGER_PROJECT_REF\(must-start-with-proj_\)/);
      assert.doesNotMatch(error.stderr, new RegExp(leakedValue));
      return true;
    });
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

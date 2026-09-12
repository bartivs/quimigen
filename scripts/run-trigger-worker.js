import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";

const token = process.env.TRIGGER_CLI_ACCESS_TOKEN;
const project = process.env.TRIGGER_PROJECT_REF;
if (!token || !project) {
  console.error("CONFIG_REQUIRED: TRIGGER_CLI_ACCESS_TOKEN and TRIGGER_PROJECT_REF are required.");
  process.exit(1);
}

const configHome = process.env.XDG_CONFIG_HOME ?? "/run/trigger-auth";
const triggerConfigDir = join(configHome, "trigger");
const triggerConfigPath = join(triggerConfigDir, "config.json");
await mkdir(triggerConfigDir, { recursive: true, mode: 0o700 });
await writeFile(
  triggerConfigPath,
  JSON.stringify({
    version: 2,
    currentProfile: "default",
    profiles: {
      default: {
        accessToken: token,
        apiUrl: process.env.TRIGGER_API_URL || "https://api.trigger.dev",
      },
    },
    settings: {
      hasSeenMCPInstallPrompt: true,
      hasSeenRulesInstallPrompt: true,
    },
  }),
  { mode: 0o600 },
);
await chmod(triggerConfigPath, 0o600);

const readyPath = "/tmp/trigger-ready";
await rm(readyPath, { force: true });

const child = spawn(
  "./node_modules/.bin/trigger",
  [
    "dev",
    "start",
    "--config",
    "trigger.config.mjs",
    "--project-ref",
    project,
    "--max-concurrent-runs",
    "1",
    "--skip-update-check",
    "--skip-telemetry",
    "--log-level",
    "log",
  ],
  { stdio: ["inherit", "pipe", "pipe"], env: process.env },
);

let output = "";
function observe(chunk, destination) {
  destination.write(chunk);
  output = `${output}${chunk}`.slice(-8_192);
  if (output.includes("Local worker ready")) {
    writeFile(readyPath, new Date().toISOString(), { mode: 0o600 }).catch((error) => {
      console.error(`Unable to record Trigger.dev readiness (${error.code ?? "unknown error"}).`);
    });
  }
  if (output.includes("Error: Build failed")) {
    child.kill("SIGTERM");
  }
}
child.stdout.on("data", (chunk) => observe(chunk, process.stdout));
child.stderr.on("data", (chunk) => observe(chunk, process.stderr));

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("error", (error) => {
  console.error(`Unable to start the Trigger.dev CLI (${error.code ?? "unknown error"}).`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});

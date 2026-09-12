import { chmod, mkdir, writeFile } from "node:fs/promises";
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
        ...(process.env.TRIGGER_API_URL ? { apiUrl: process.env.TRIGGER_API_URL } : {}),
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

const child = spawn(
  "./node_modules/.bin/trigger.dev",
  [
    "dev",
    "start",
    "--config",
    "trigger.config.mjs",
    "--project-ref",
    project,
    "--skip-update-check",
    "--skip-telemetry",
    "--log-level",
    "log",
  ],
  { stdio: "inherit", env: process.env },
);

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});

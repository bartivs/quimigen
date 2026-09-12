const fixture = process.argv.includes("--fixture") || process.env.QUIMIGEN_MODE === "fixture";
const required = fixture
  ? []
  : [
      "TELEGRAM_BOT_TOKEN",
      "EXA_API_KEY",
      "OPENROUTER_API_KEY",
      "TRIGGER_SECRET_KEY",
      "TRIGGER_PROJECT_REF",
      "QUIMIGEN_STATE_FILE",
    ];
const missing = required.filter((name) => !process.env[name]);

if (missing.length > 0) {
  console.error(`Missing environment variables: ${missing.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log(fixture ? "Config OK: DEMO FIXTURE mode" : "Config OK: live providers configured");
}

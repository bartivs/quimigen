#!/bin/sh
set -eu

file=${1:-.env}
if [ ! -f "$file" ]; then
  echo "CONFIG_REQUIRED: missing $file" >&2
  exit 1
fi

value_for() {
  awk -F= -v key="$1" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$file"
}

required='TELEGRAM_BOT_TOKEN EXA_API_KEY OPENROUTER_API_KEY TRIGGER_PROJECT_REF TRIGGER_SECRET_KEY TRIGGER_CLI_ACCESS_TOKEN'
issues=''
for key in $required; do
  value=$(value_for "$key")
  case "$value" in
    ''|change-me*|replace-me*) issues="$issues $key" ;;
  esac
done

case "$(value_for TRIGGER_PROJECT_REF)" in proj_*) ;; *) issues="$issues TRIGGER_PROJECT_REF(must-start-with-proj_)" ;; esac
case "$(value_for TRIGGER_SECRET_KEY)" in tr_dev_*) ;; *) issues="$issues TRIGGER_SECRET_KEY(must-be-development-key)" ;; esac
case "$(value_for TRIGGER_CLI_ACCESS_TOKEN)" in tr_pat_*) ;; *) issues="$issues TRIGGER_CLI_ACCESS_TOKEN(must-start-with-tr_pat_)" ;; esac

if [ "$(value_for QUIMIGEN_MODE)" != "live" ]; then
  issues="$issues QUIMIGEN_MODE=live"
fi

if [ -n "$issues" ]; then
  echo "CONFIG_REQUIRED: correct these values in $file:$issues" >&2
  exit 1
fi

echo "Deployment environment is configured (values not printed)."

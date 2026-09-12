#!/bin/sh
set -eu

file=${1:-.env}
if [ ! -f "$file" ]; then
  echo "CONFIG_REQUIRED: missing $file" >&2
  exit 1
fi

required='TELEGRAM_BOT_TOKEN EXA_API_KEY OPENROUTER_API_KEY TRIGGER_PROJECT_REF TRIGGER_SECRET_KEY TRIGGER_CLI_ACCESS_TOKEN'
missing=''
for key in $required; do
  value=$(awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$file")
  case "$value" in
    ''|change-me*|replace-me*) missing="$missing $key" ;;
  esac
done

mode=$(awk -F= '$1 == "QUIMIGEN_MODE" { sub(/^[^=]*=/, ""); print; exit }' "$file")
if [ "$mode" != "live" ]; then
  missing="$missing QUIMIGEN_MODE=live"
fi

if [ -n "$missing" ]; then
  echo "CONFIG_REQUIRED: set these values in $file:$missing" >&2
  exit 1
fi

echo "Deployment environment is configured (values not printed)."

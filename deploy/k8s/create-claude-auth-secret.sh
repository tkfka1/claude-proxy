#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="${NAMESPACE:-claude-proxy}"
SECRET_NAME="${SECRET_NAME:-claude-auth}"
CLAUDE_DIR="${CLAUDE_DIR:-$HOME/.claude}"
CREDENTIALS_FILE="${CREDENTIALS_FILE:-$CLAUDE_DIR/.credentials.json}"
SETTINGS_FILE="${SETTINGS_FILE:-$CLAUDE_DIR/settings.json}"

if [[ ! -f "$CREDENTIALS_FILE" ]]; then
  echo "Missing Claude credentials file: $CREDENTIALS_FILE" >&2
  exit 1
fi

if [[ ! -f "$SETTINGS_FILE" ]]; then
  echo "Missing Claude settings file: $SETTINGS_FILE" >&2
  exit 1
fi

kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

kubectl create secret generic "$SECRET_NAME" \
  --namespace "$NAMESPACE" \
  --from-file=credentials.json="$CREDENTIALS_FILE" \
  --from-file=settings.json="$SETTINGS_FILE" \
  --dry-run=client \
  -o yaml | kubectl apply -f -

echo "Applied secret $SECRET_NAME in namespace $NAMESPACE"

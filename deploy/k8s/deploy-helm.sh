#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

RELEASE_NAME="${RELEASE_NAME:-claude-proxy}"
NAMESPACE="${NAMESPACE:-claude-proxy}"
CHART_PATH="${CHART_PATH:-$ROOT_DIR/charts/claude-anthropic-proxy}"
VALUES_FILE="${VALUES_FILE:-$CHART_PATH/values-prod.yaml}"
EXTRA_VALUES_FILE="${EXTRA_VALUES_FILE:-}"
IMAGE_REPOSITORY="${IMAGE_REPOSITORY:-}"
IMAGE_TAG="${IMAGE_TAG:-}"
CLAUDE_AUTH_SECRET="${CLAUDE_AUTH_SECRET:-}"
PROXY_ENV_SECRET="${PROXY_ENV_SECRET:-}"
DRY_RUN="${DRY_RUN:-false}"

cmd=(
  helm upgrade --install "$RELEASE_NAME" "$CHART_PATH"
  --namespace "$NAMESPACE"
  --create-namespace
  -f "$VALUES_FILE"
)

if [[ -n "$EXTRA_VALUES_FILE" ]]; then
  cmd+=(-f "$EXTRA_VALUES_FILE")
fi

if [[ -n "$IMAGE_REPOSITORY" ]]; then
  cmd+=(--set "image.repository=$IMAGE_REPOSITORY")
fi

if [[ -n "$IMAGE_TAG" ]]; then
  cmd+=(--set "image.tag=$IMAGE_TAG")
fi

if [[ -n "$CLAUDE_AUTH_SECRET" ]]; then
  cmd+=(--set "claudeAuth.existingSecret=$CLAUDE_AUTH_SECRET")
fi

if [[ -n "$PROXY_ENV_SECRET" ]]; then
  cmd+=(--set "proxyApiKey.existingSecret=$PROXY_ENV_SECRET")
fi

if [[ "$DRY_RUN" == "true" ]]; then
  cmd+=(--dry-run --debug)
fi

printf 'Running:'
printf ' %q' "${cmd[@]}"
printf '\n'

"${cmd[@]}"

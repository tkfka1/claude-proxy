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
EXTERNAL_REDIS_URL="${EXTERNAL_REDIS_URL:-}"
EXTERNAL_REDIS_SECRET="${EXTERNAL_REDIS_SECRET:-}"
EXTERNAL_REDIS_SECRET_KEY="${EXTERNAL_REDIS_SECRET_KEY:-REDIS_URL}"
DRY_RUN="${DRY_RUN:-false}"

if [[ "$DRY_RUN" == "true" ]]; then
  cmd=(
    helm template "$RELEASE_NAME" "$CHART_PATH"
    --namespace "$NAMESPACE"
    -f "$VALUES_FILE"
  )
else
  cmd=(
    helm upgrade --install "$RELEASE_NAME" "$CHART_PATH"
    --namespace "$NAMESPACE"
    --create-namespace
    -f "$VALUES_FILE"
  )
fi

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

if [[ -n "$EXTERNAL_REDIS_URL" && -n "$EXTERNAL_REDIS_SECRET" ]]; then
  echo "Set only one of EXTERNAL_REDIS_URL or EXTERNAL_REDIS_SECRET." >&2
  exit 1
fi

if [[ -n "$EXTERNAL_REDIS_SECRET" ]]; then
  cmd+=(--set "redis.enabled=false")
  cmd+=(--set "redis.external.existingSecret=$EXTERNAL_REDIS_SECRET")
  cmd+=(--set "redis.external.existingSecretKey=$EXTERNAL_REDIS_SECRET_KEY")
elif [[ -n "$EXTERNAL_REDIS_URL" ]]; then
  cmd+=(--set "redis.enabled=false")
  cmd+=(--set-string "env.REDIS_URL=$EXTERNAL_REDIS_URL")
fi

printf 'Running:'
for arg in "${cmd[@]}"; do
  if [[ "$arg" == env.REDIS_URL=* ]]; then
    printf ' %q' "env.REDIS_URL=<redacted>"
  else
    printf ' %q' "$arg"
  fi
done
printf '\n'

"${cmd[@]}"

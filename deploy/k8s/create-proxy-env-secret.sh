#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="${NAMESPACE:-claude-proxy}"
SECRET_NAME="${SECRET_NAME:-claude-proxy-env}"
API_KEY="${PROXY_API_KEY:-}"

if [[ -z "$API_KEY" ]]; then
  echo "PROXY_API_KEY environment variable is required." >&2
  exit 1
fi

kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

kubectl create secret generic "$SECRET_NAME" \
  --namespace "$NAMESPACE" \
  --from-literal=PROXY_API_KEY="$API_KEY" \
  --dry-run=client \
  -o yaml | kubectl apply -f -

echo "Applied secret $SECRET_NAME in namespace $NAMESPACE"

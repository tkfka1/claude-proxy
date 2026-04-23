# Helm chart: claude-anthropic-proxy

## 포함된 파일

- `values.yaml`: 기본값
- `values-prod.yaml`: 운영용 시작점 예시
- `examples/external-secret.yaml`: External Secrets Operator 예시
- `examples/sealed-secret.yaml`: Bitnami SealedSecret 예시
- `examples/values-ingress-cert-manager.yaml`: Ingress + cert-manager values 예시
- `examples/clusterissuer-letsencrypt.yaml`: cert-manager ClusterIssuer 예시

## 설치 전 준비

이 앱은 `claude` CLI 로그인 정보가 필요합니다.
가장 쉬운 방법은 로컬 `~/.claude/.credentials.json` 을 Kubernetes Secret으로 넣는 것입니다.

### 기존 로그인 정보로 Secret 생성

```bash
kubectl create namespace claude-proxy

kubectl create secret generic claude-auth \
  -n claude-proxy \
  --from-file=credentials.json=$HOME/.claude/.credentials.json \
  --from-file=settings.json=$HOME/.claude/settings.json
```

## 설치

```bash
helm upgrade --install claude-proxy ./charts/claude-anthropic-proxy \
  -n claude-proxy \
  --create-namespace \
  --set image.repository=claude-anthropic-proxy \
  --set image.tag=latest \
  --set claudeAuth.existingSecret=claude-auth
```

## 운영용 values 예시 사용

```bash
helm upgrade --install claude-proxy ./charts/claude-anthropic-proxy \
  -n claude-proxy \
  --create-namespace \
  -f charts/claude-anthropic-proxy/values-prod.yaml \
  --set image.repository=ghcr.io/example/claude-anthropic-proxy \
  --set image.tag=0.1.0 \
  --set claudeAuth.existingSecret=claude-auth
```

## Ingress + cert-manager 예시

```bash
kubectl apply -f charts/claude-anthropic-proxy/examples/clusterissuer-letsencrypt.yaml

helm upgrade --install claude-proxy ./charts/claude-anthropic-proxy \
  -n claude-proxy \
  --create-namespace \
  -f charts/claude-anthropic-proxy/values-prod.yaml \
  -f charts/claude-anthropic-proxy/examples/values-ingress-cert-manager.yaml \
  --set image.repository=ghcr.io/example/claude-anthropic-proxy \
  --set image.tag=0.1.0 \
  --set claudeAuth.existingSecret=claude-auth
```

## ExternalSecret 예시

`examples/external-secret.yaml` 은 `claude-auth` Secret을 외부 비밀 저장소에서 동기화하는 예시입니다.

```bash
kubectl apply -f charts/claude-anthropic-proxy/examples/external-secret.yaml
```

그 후 차트는 기존 Secret 사용 방식으로 설치합니다.

## SealedSecret 예시

`examples/sealed-secret.yaml` 의 placeholder 값을 실제 `kubeseal` 결과로 바꾼 뒤 적용합니다.

```bash
kubectl apply -f charts/claude-anthropic-proxy/examples/sealed-secret.yaml
```

## inline secret 생성 방식

운영에서는 ExternalSecret 또는 기존 Secret 사용을 권장하지만, 테스트 용도로 chart가 Secret을 직접 만들 수도 있습니다.

```bash
helm upgrade --install claude-proxy ./charts/claude-anthropic-proxy \
  -n claude-proxy \
  --create-namespace \
  --set image.repository=claude-anthropic-proxy \
  --set image.tag=latest \
  --set claudeAuth.createSecret=true \
  --set-file claudeAuth.inline.credentialsJson=$HOME/.claude/.credentials.json \
  --set-file claudeAuth.inline.settingsJson=$HOME/.claude/settings.json
```

> 주의: inline 방식은 shell history, CI logs, values 파일 관리에 각별히 주의해야 합니다.

## 주요 values

- `image.repository`, `image.tag`
- `service.type`, `service.port`
- `ingress.enabled`
- `autoscaling.*`
- `resources`
- `podDisruptionBudget.*`
- `env.*`
- `claudeAuth.existingSecret`
- `claudeAuth.createSecret`
- `claudeAuth.mountPath`

## values 파일 예시

```yaml
image:
  repository: ghcr.io/example/claude-anthropic-proxy
  tag: "0.1.0"

env:
  CLAUDE_DEFAULT_MODEL: sonnet
  ENABLE_REQUEST_LOGGING: "true"
  PROXY_API_KEY: change-me
  ALLOW_MISSING_API_KEY_HEADER: "false"

service:
  type: ClusterIP
  port: 80

claudeAuth:
  existingSecret: claude-auth

ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
  hosts:
    - host: claude-proxy.example.com
      paths:
        - path: /
          pathType: Prefix
```

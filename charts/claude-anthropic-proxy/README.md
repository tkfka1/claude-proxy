# Helm chart: claude-anthropic-proxy

## 포함된 파일

- `values.yaml`: 기본값
- `values-prod.yaml`: 운영용 시작점 예시
- `examples/external-secret.yaml`: External Secrets Operator 예시
- `examples/sealed-secret.yaml`: Bitnami SealedSecret 예시
- `examples/values-ingress-cert-manager.yaml`: Ingress + cert-manager values 예시
- `examples/values-proxy-state-pvc.yaml`: 로컬 파일 기반 state를 PVC에 유지하는 fallback 예시
- `examples/clusterissuer-letsencrypt.yaml`: cert-manager ClusterIssuer 예시
- `../../deploy/k8s/*.sh`: 실제 클러스터 배포용 helper script

## 설치 전 준비

이 앱은 `claude` CLI 로그인 정보가 필요합니다.
가장 쉬운 방법은 로컬 `~/.claude/.credentials.json` 을 Kubernetes Secret으로 넣는 것입니다.

### 기존 로그인 정보로 Secret 생성

```bash
./deploy/k8s/create-claude-auth-secret.sh
```

또는 수동 명령:

```bash
kubectl create namespace claude-proxy

kubectl create secret generic claude-auth \
  -n claude-proxy \
  --from-file=credentials.json=$HOME/.claude/.credentials.json \
  --from-file=settings.json=$HOME/.claude/settings.json
```

## 프록시 API key Secret (optional bootstrap)

운영에서는 values 파일에 평문 키를 넣지 말고 Secret으로 넣는 것을 권장합니다.

```bash
PROXY_API_KEY='replace-with-strong-random-value' \
./deploy/k8s/create-proxy-env-secret.sh
```

수동 명령:

```bash
kubectl create secret generic claude-proxy-env \
  -n claude-proxy \
  --from-literal=PROXY_API_KEY='replace-with-strong-random-value'
```

지금 기본 운영 흐름에서는 이 Secret이 **필수는 아닙니다**.
차트가 내부 Redis를 같이 띄워 `/docs` 에서 설정한 x-api-key 와 최근 로그를 저장하므로,
처음 부팅 후 `/docs` 에서 키를 저장하는 쪽이 기본 경로입니다.

## 설치

가장 쉬운 방법:

```bash
./deploy/k8s/deploy-helm.sh
```

## 운영용 values 예시 사용

```bash
helm upgrade --install claude-proxy ./charts/claude-anthropic-proxy \
  -n claude-proxy \
  --create-namespace \
  -f charts/claude-anthropic-proxy/values-prod.yaml \
  --set claudeAuth.existingSecret=claude-auth
```

외부 Redis를 쓰고 싶으면:

```bash
helm upgrade --install claude-proxy ./charts/claude-anthropic-proxy \
  -n claude-proxy \
  --create-namespace \
  -f charts/claude-anthropic-proxy/values-prod.yaml \
  --set claudeAuth.existingSecret=claude-auth \
  --set redis.enabled=false \
  --set env.REDIS_URL=redis://redis.default.svc.cluster.local:6379/0
```

## Ingress + cert-manager 예시

```bash
kubectl apply -f charts/claude-anthropic-proxy/examples/clusterissuer-letsencrypt.yaml

EXTRA_VALUES_FILE=charts/claude-anthropic-proxy/examples/values-ingress-cert-manager.yaml \
./deploy/k8s/deploy-helm.sh
```

## x-api-key state PVC fallback 예시

기본 `values-prod.yaml` 는 내부 Redis를 같이 띄워 상태를 보존합니다.
이 기본 경로에서는 `/v1/messages` active concurrency도 Redis semaphore 기준으로 공유되고, 대기열도 Redis에 올라갑니다.
또한 `/docs` 로그인 세션과 로그인 시도 제한도 pod 사이에서 Redis를 통해 공유됩니다.
Redis 대신 로컬 파일 + PVC fallback 모드가 필요할 때만 아래 예시를 씁니다.

이 예시는 single replica 기준입니다.
아래 예시는 기본값을 더 작은 values 파일로 켜는 예시입니다.

기본 안전장치는 single replica 기준입니다.
`proxyState.persistence.enabled=true` 일 때는:

- `replicaCount=1`
- 또는 `autoscaling.minReplicas=1`

이어야 하고, 여러 replica를 정말 써야 하면 `proxyState.persistence.allowSharedState=true` 를 명시해서
shared filesystem/race 조건을 직접 감수해야 합니다.

예:

```bash
helm upgrade --install claude-proxy ./charts/claude-anthropic-proxy \
  -n claude-proxy \
  --create-namespace \
  -f charts/claude-anthropic-proxy/examples/values-proxy-state-pvc.yaml \
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
  --set image.repository=ghcr.io/tkfka1/claude-proxy \
  --set image.tag=1.1.0 \
  --set claudeAuth.createSecret=true \
  --set-file claudeAuth.inline.credentialsJson=$HOME/.claude/.credentials.json \
  --set-file claudeAuth.inline.settingsJson=$HOME/.claude/settings.json
```

> 주의: inline 방식은 shell history, CI logs, values 파일 관리에 각별히 주의해야 합니다.

최신 `main` 브랜치 이미지를 바로 써보고 싶으면 `image.tag=main` 으로 override 하면 됩니다.
커밋 고정 배포가 필요하면 `image.tag=sha-<7자리>` 도 사용할 수 있습니다.

## 주요 values

- `image.repository`, `image.tag`
- `service.type`, `service.port`
- `ingress.enabled`
- `autoscaling.*`
- `resources`
- `podDisruptionBudget.*`
- `env.*`
- `redis.enabled`, `redis.persistence.*`
- `proxyApiKey.value`
- `proxyApiKey.existingSecret`
- `proxyState.persistence.*`
- `claudeAuth.existingSecret`
- `claudeAuth.createSecret`
- `claudeAuth.mountPath`

## values 파일 예시

```yaml
image:
  repository: ghcr.io/tkfka1/claude-proxy
  tag: "1.1.0"

env:
  CLAUDE_DEFAULT_MODEL: sonnet
  ENABLE_REQUEST_LOGGING: "false"
  ALLOW_MISSING_API_KEY_HEADER: "false"
redis:
  enabled: true
  persistence:
    enabled: true
    size: 1Gi

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

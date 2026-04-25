# Helm chart: claude-anthropic-proxy

## 포함된 파일

- `values.yaml`: 기본값
- `values-prod.yaml`: 운영용 시작점 예시
- `examples/external-secret.yaml`: External Secrets Operator 예시
- `examples/sealed-secret.yaml`: Bitnami SealedSecret 예시
- `examples/values-ingress-cert-manager.yaml`: Ingress + cert-manager values 예시
- `examples/values-ingress-idc-http.yaml`: `claude-proxy.idc.hkyo.kr` HTTP ingress values 예시
- `examples/values-proxy-state-pvc.yaml`: legacy local-file fallback 예시(운영 기본은 Redis)
- `examples/clusterissuer-letsencrypt.yaml`: cert-manager ClusterIssuer 예시
- `../../deploy/k8s/*.sh`: 실제 클러스터 배포용 helper script

## 설치 전 준비

이 앱은 `claude` CLI 로그인 정보가 필요합니다.
가장 쉬운 방법은 로컬 `~/.claude/.credentials.json` 을 Kubernetes Secret으로 넣는 것입니다.
또한 서버 시작 전에 `WEB_PASSWORD` 또는 `WEB_PASSWORD_HASH` 를 실제 값으로 설정해야 합니다.

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
운영용 `values-prod.yaml` 은 내부 Redis를 같이 띄워 `/docs` 에서 설정한 x-api-key, 최근 로그, 문서 로그인 세션/시도 제한, 메시지 동시성 상태를 저장하므로,
처음 부팅 후 `/docs` 에서 키를 저장하는 쪽이 기본 경로입니다.

## 설치

가장 쉬운 방법:

```bash
./deploy/k8s/deploy-helm.sh
```

간단한 테스트 배포에서는 아래처럼 문서 화면 비밀번호를 직접 넘길 수 있습니다.
운영에서는 shell history에 남지 않도록 `WEB_PASSWORD_HASH` 또는 `extraEnvFrom` Secret 사용을 권장합니다.

```bash
helm upgrade --install claude-proxy ./charts/claude-anthropic-proxy \
  -n claude-proxy \
  --create-namespace \
  -f charts/claude-anthropic-proxy/values-prod.yaml \
  --set claudeAuth.existingSecret=claude-auth \
  --set env.WEB_PASSWORD='docs-password-32chars-min-example'
```

## 운영용 values 예시 사용

```bash
helm upgrade --install claude-proxy ./charts/claude-anthropic-proxy \
  -n claude-proxy \
  --create-namespace \
  -f charts/claude-anthropic-proxy/values-prod.yaml \
  --set claudeAuth.existingSecret=claude-auth
```

기본 설치는 내부 Redis를 같이 띄웁니다. 프록시 Pod에는 내부 Redis 주소가 `REDIS_URL` 로 자동 주입됩니다.
`values-prod.yaml` 은 Claude auth Secret을 각 Pod의 writable runtime volume으로 seed하고 `claudeAuth.redisSync.enabled=true` 로 Redis에 동기화합니다. 그래서 Claude CLI token refresh와 `/docs` 웹 로그인 결과가 여러 프록시 Pod 사이에서 공유됩니다.

외부 Redis를 쓰려면 내부 Redis를 끄고 `env.REDIS_URL` 을 지정합니다.

```bash
helm upgrade --install claude-proxy ./charts/claude-anthropic-proxy \
  -n claude-proxy \
  --create-namespace \
  -f charts/claude-anthropic-proxy/values-prod.yaml \
  --set claudeAuth.existingSecret=claude-auth \
  --set redis.enabled=false \
  --set env.REDIS_URL=redis://redis.default.svc.cluster.local:6379/0
```

Redis URL에 비밀번호가 들어가면 values/명령줄에 직접 넣지 말고 Secret으로 주입하는 것을 권장합니다.

```bash
kubectl create secret generic claude-proxy-redis-env \
  -n claude-proxy \
  --from-literal=REDIS_URL='redis://:password@redis.default.svc.cluster.local:6379/0'

helm upgrade --install claude-proxy ./charts/claude-anthropic-proxy \
  -n claude-proxy \
  --create-namespace \
  -f charts/claude-anthropic-proxy/values-prod.yaml \
  --set claudeAuth.existingSecret=claude-auth \
  --set redis.enabled=false \
  --set redis.external.existingSecret=claude-proxy-redis-env
```

## Ingress + cert-manager 예시

```bash
kubectl apply -f charts/claude-anthropic-proxy/examples/clusterissuer-letsencrypt.yaml

EXTRA_VALUES_FILE=charts/claude-anthropic-proxy/examples/values-ingress-cert-manager.yaml \
./deploy/k8s/deploy-helm.sh
```

## IDC HTTP Ingress 예시

앞단 Load Balancer가 `http://claude-proxy.idc.hkyo.kr/` 를 ingress controller로 전달하는 구성입니다.
TLS/cert-manager는 켜지지 않고, service는 기존 `ClusterIP` 그대로 둡니다.
앱의 HSTS 헤더는 HTTPS 요청 또는 `X-Forwarded-Proto: https` 가 들어온 요청에만 전송됩니다.

```bash
EXTRA_VALUES_FILE=charts/claude-anthropic-proxy/examples/values-ingress-idc-http.yaml \
./deploy/k8s/deploy-helm.sh
```

## Redis 운영 모드

이 차트의 기본 운영 모드는 Redis입니다.

- 내부 Redis: `redis.enabled=true` 일 때 chart가 Redis StatefulSet/Service/PVC를 같이 생성하고 프록시에 `REDIS_URL` 을 자동 주입합니다.
- 외부 Redis: `redis.enabled=false` 로 내부 Redis를 끄고 `env.REDIS_URL` 을 직접 지정하거나 `redis.external.existingSecret` 으로 Secret을 참조합니다.
- `/v1/messages` active concurrency와 FIFO 대기열은 Redis semaphore 기준으로 공유됩니다. readinessProbe는 `/ready` 를 사용해 Redis `PING` 실패 시 트래픽을 받지 않습니다.
- `/docs` 에서 저장한 x-api-key, 최근 로그, 로그인 세션, 로그인 시도 제한도 Redis에 저장됩니다.
- `claudeAuth.redisSync.enabled=true` 이면 Claude auth runtime files도 Redis에 저장되어 여러 프록시 Pod가 같은 인증 상태를 사용합니다.
- Claude auth 로그인/로그아웃 operation 상태도 Redis에 저장되어 multi-pod Ingress 뒤에서도 `/docs` 진행 상태와 로그인 링크가 일관되게 보입니다.
- 정상 Claude 호출 뒤에는 CLI가 갱신했을 수 있는 auth files를 Redis shared state에 다시 저장해 Pod 교체 후 stale token으로 돌아가는 리스크를 줄입니다.
- `/metrics` 에서 request/message/Claude CLI timeout/x-api-key rotation/Redis 상태를 확인할 수 있습니다.
- Pod 종료 시 SIGTERM graceful shutdown이 실행되며 `terminationGracePeriodSeconds` 안에서 큐, in-flight CLI process, Redis 연결을 정리합니다.
- 운영 values는 앱 PDB(`minAvailable=1`), Redis PDB, preferred pod anti-affinity, topology spread constraint를 켜서 자발적 중단/노드 집중 리스크를 줄입니다.
- 내부 Redis는 단일 StatefulSet/PVC입니다. 완전한 Redis HA가 필요하면 `redis.enabled=false` 와 `redis.external.existingSecret`/`env.REDIS_URL` 로 외부 managed/HA Redis를 붙이세요.
- 앱은 Kubernetes API를 쓰지 않으므로 기본 ServiceAccount token automount는 꺼져 있습니다.

웹 비밀번호를 잊었거나 Secret에 보관한 값과 Redis 런타임 값을 다시 맞춰야 하면 admin CLI로 재설정합니다.
아래 명령은 비밀번호 파일을 stdin으로 넘기고, 기존 웹 세션과 로그인 실패 카운터를 같이 정리합니다. 실행 중인 Pod는 Redis 값을 다시 읽습니다(웹 로그인은 다음 로그인/세션 확인, 프록시 인증은 최대 1초 캐시 후 반영).

```bash
kubectl -n claude-proxy exec -i deploy/claude-proxy-claude-anthropic-proxy -- \
  sh -lc 'claude-proxy-admin web-password reset --stdin' < /path/to/password.txt
```

웹에 로그인할 수 없고 `x-api-key` 를 복구해야 하면 새 키 파일을 Redis에 직접 반영할 수 있습니다. 복구 경로는 이전 키 grace period를 보존하지 않습니다.

```bash
kubectl -n claude-proxy exec -i deploy/claude-proxy-claude-anthropic-proxy -- \
  sh -lc 'claude-proxy-admin proxy-key reset --stdin' < /path/to/proxy-key.txt
```

legacy local-file fallback이 꼭 필요하면 `examples/values-proxy-state-pvc.yaml` 를 참고할 수 있지만, 운영 기본 경로는 Redis입니다.

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
- `serviceAccount.*`
- `service.type`, `service.port`
- `ingress.enabled`
- `autoscaling.*`
- `resources`
- `podSecurityContext`, `securityContext`
- `podDisruptionBudget.*`
- `topologySpreadConstraints`, `affinity`, `nodeSelector`, `tolerations`
- `terminationGracePeriodSeconds`
- `env.*`
- `redis.enabled`, `redis.persistence.*`, `redis.external.*`, `redis.podDisruptionBudget.*`, `redis.podSecurityContext`, `redis.securityContext`
- `proxyApiKey.value`
- `proxyApiKey.existingSecret`
- `proxyState.persistence.*`
- `claudeAuth.existingSecret`
- `claudeAuth.createSecret`
- `claudeAuth.mountPath`
- `claudeAuth.writable`, `claudeAuth.seedPolicy`
- `claudeAuth.redisSync.enabled`
- `claudeAuth.persistence.*`

## values 파일 예시

```yaml
image:
  repository: ghcr.io/tkfka1/claude-proxy
  tag: "1.1.0"

env:
  CLAUDE_DEFAULT_MODEL: sonnet
  ENABLE_REQUEST_LOGGING: "false"
  ALLOW_MISSING_API_KEY_HEADER: "false"
  WEB_PASSWORD: docs-password-32chars-min-example

proxyState:
  persistence:
    enabled: false

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
  persistence:
    enabled: true
    size: 1Gi

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

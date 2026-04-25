# Kubernetes deployment helpers

실제 클러스터에 Helm으로 배포할 때 반복되는 명령을 스크립트로 정리했습니다.

## 기본 전제

- `kubectl`, `helm` 설치
- 현재 kube-context 가 대상 클러스터를 가리킴
- Claude CLI 로그인 정보가 로컬 `~/.claude` 에 존재
- 서버 시작 전에 `WEB_PASSWORD` 또는 `WEB_PASSWORD_HASH` 를 실제 값으로 설정해야 함
- 이미지 기본값은 `ghcr.io/tkfka1/claude-proxy:1.1.0`
- `main` push 가 성공하면 GHCR 에 `ghcr.io/tkfka1/claude-proxy:main` 도 자동 갱신됨

## 1) Claude auth Secret 생성

```bash
./deploy/k8s/create-claude-auth-secret.sh
```

기본값:

- namespace: `claude-proxy`
- secret name: `claude-auth`

오버라이드 예시:

```bash
NAMESPACE=prod-ai \
SECRET_NAME=claude-auth \
CLAUDE_DIR=$HOME/.claude \
./deploy/k8s/create-claude-auth-secret.sh
```

## 2) 프록시 API key Secret 생성 (optional legacy bootstrap)

```bash
PROXY_API_KEY='replace-with-strong-random-value' \
./deploy/k8s/create-proxy-env-secret.sh
```

기본값:

- namespace: `claude-proxy`
- secret name: `claude-proxy-env`

지금 기본 운영 경로에서는 **필수 아님** 입니다.
차트가 기본으로 내부 Redis에 `/docs` x-api-key 상태, 최근 로그, 문서 로그인 세션/시도 제한, 메시지 동시성 상태를 유지하므로,
첫 배포 후 `/docs` 에 로그인해서 키를 한 번 저장하면 됩니다.
이 스크립트는 "처음부터 env/Secret으로 키를 넣고 시작하고 싶다"는 경우에만 optional bootstrap 용도로 씁니다.

## 3) Helm 배포

```bash
./deploy/k8s/deploy-helm.sh
```

문서 화면 비밀번호는 secret 관리 방식에 맞게 설정합니다. 간단한 테스트 배포라면:

```bash
helm upgrade --install claude-proxy ./charts/claude-anthropic-proxy \
  -n claude-proxy \
  --create-namespace \
  -f charts/claude-anthropic-proxy/values-prod.yaml \
  --set claudeAuth.existingSecret=claude-auth \
  --set env.WEB_PASSWORD='docs-password-32chars-min-example'
```

운영에서는 shell history에 남지 않도록 `WEB_PASSWORD_HASH` 또는 `extraEnvFrom` Secret 사용을 권장합니다.

기본값:

- release: `claude-proxy`
- namespace: `claude-proxy`
- values: `charts/claude-anthropic-proxy/values-prod.yaml`

`values-prod.yaml` 는 아래 secret 이름을 기본 사용합니다.

- `claudeAuth.existingSecret=claude-auth`
- `redis.enabled=true`
- `proxyState.persistence.enabled=false`
- `proxyApiKey` secret 기본값은 비워 둠

### dry-run

```bash
DRY_RUN=true ./deploy/k8s/deploy-helm.sh
```

### ingress values 추가

```bash
EXTRA_VALUES_FILE=charts/claude-anthropic-proxy/examples/values-ingress-cert-manager.yaml \
./deploy/k8s/deploy-helm.sh
```

### IDC HTTP ingress

앞단 Load Balancer가 `http://claude-proxy.idc.hkyo.kr/` 를 ingress controller로 전달하는 배포에서는
TLS/cert-manager 없이 HTTP ingress values만 추가합니다.

```bash
EXTRA_VALUES_FILE=charts/claude-anthropic-proxy/examples/values-ingress-idc-http.yaml \
./deploy/k8s/deploy-helm.sh
```

### 기본 운영 동작

`values-prod.yaml` 는 내부 Redis를 같이 올리는 운영 시작점입니다.

- chart 내부 Redis StatefulSet/Service/PVC가 같이 뜸
- 프록시 Pod에는 내부 Redis 주소가 `REDIS_URL` 로 자동 주입됨
- `/v1/messages` 실행 슬롯과 FIFO 대기열은 Redis 기반 전역 semaphore로 관리됨
- `MAX_CONCURRENT_MESSAGE_REQUESTS`, `MAX_QUEUED_MESSAGE_REQUESTS`, `MAX_MESSAGE_QUEUE_WAIT_MS` 로 전역 동시성/큐를 제어
- `/metrics` 에서 request/message/Claude CLI timeout/x-api-key rotation/Redis 상태를 확인 가능
- Pod 종료 시 SIGTERM graceful shutdown으로 새 요청을 막고 큐/in-flight CLI process/Redis 연결을 정리
- 초기엔 `/v1/messages` 가 잠겨 있고
- `/docs` 에 로그인해서 x-api-key 를 한 번 저장하면 이후 재시작해도 Redis에 유지됨
- `/logs/recent` 및 `/docs` 최근 로그 패널도 Redis에 저장되어 재시작 후 이어짐
- `/docs` 로그인 세션과 로그인 실패 제한도 Redis에 저장되어 여러 Pod 사이에서 공유됨

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

스크립트로 외부 Redis를 지정하려면:

```bash
EXTERNAL_REDIS_URL=redis://redis.default.svc.cluster.local:6379/0 \
./deploy/k8s/deploy-helm.sh
```

비밀번호가 포함된 외부 Redis는 Secret을 만들고 스크립트에 Secret 이름만 넘기는 쪽을 권장합니다.

```bash
kubectl create secret generic claude-proxy-redis-env \
  -n claude-proxy \
  --from-literal=REDIS_URL='redis://:password@redis.default.svc.cluster.local:6379/0'

EXTERNAL_REDIS_SECRET=claude-proxy-redis-env \
./deploy/k8s/deploy-helm.sh
```

### 이미지/secret 이름 오버라이드

```bash
IMAGE_TAG=1.1.0 \
CLAUDE_AUTH_SECRET=claude-auth \
./deploy/k8s/deploy-helm.sh
```

최신 `main` 브랜치 이미지를 바로 배포하려면:

```bash
IMAGE_TAG=main \
CLAUDE_AUTH_SECRET=claude-auth \
./deploy/k8s/deploy-helm.sh
```

## 배포 후 확인

```bash
kubectl get pods -n claude-proxy
kubectl get svc -n claude-proxy
kubectl logs deploy/claude-proxy-claude-anthropic-proxy -n claude-proxy --tail=100
kubectl port-forward svc/claude-proxy-claude-anthropic-proxy -n claude-proxy 8080:80
curl http://127.0.0.1:8080/health
```

## 롤링 업데이트

태그만 바꿔 다시 실행하면 됩니다.

```bash
IMAGE_TAG=1.1.0 ./deploy/k8s/deploy-helm.sh
```

검증용 edge 배포는 `IMAGE_TAG=main` 또는 `IMAGE_TAG=sha-<7자리>` 로도 가능합니다.

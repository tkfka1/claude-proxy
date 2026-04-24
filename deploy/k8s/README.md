# Kubernetes deployment helpers

실제 클러스터에 Helm으로 배포할 때 반복되는 명령을 스크립트로 정리했습니다.

## 기본 전제

- `kubectl`, `helm` 설치
- 현재 kube-context 가 대상 클러스터를 가리킴
- Claude CLI 로그인 정보가 로컬 `~/.claude` 에 존재
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
차트가 Redis에 `/docs` x-api-key 상태와 최근 로그를 같이 유지하므로, 첫 배포 후 `/docs` 에 로그인해서 키를 한 번 저장하면 됩니다.
이 스크립트는 "처음부터 env/Secret으로 키를 넣고 시작하고 싶다"는 경우에만 optional bootstrap 용도로 씁니다.

## 3) Helm 배포

```bash
./deploy/k8s/deploy-helm.sh
```

기본값:

- release: `claude-proxy`
- namespace: `claude-proxy`
- values: `charts/claude-anthropic-proxy/values-prod.yaml`

`values-prod.yaml` 는 아래 secret 이름을 기본 사용합니다.

- `claudeAuth.existingSecret=claude-auth`
- `redis.enabled=true`
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

### 기본 운영 동작

`values-prod.yaml` 는 이제 Redis 친화적인 단일 replica 시작점입니다.

- chart 내부 Redis가 같이 뜨고 `/docs` 에서 저장한 x-api-key 가 Redis에 유지됨
- 초기엔 `/v1/messages` 가 잠겨 있고
- `/docs` 에 로그인해서 x-api-key 를 한 번 저장하면 이후 재시작해도 그대로 유지됨
- `/logs/recent` 및 `/docs` 최근 로그 패널도 재시작 후 이어짐

Redis를 외부로 빼고 싶으면 `env.REDIS_URL` 만 override 하면 됩니다.
예:

```bash
helm upgrade --install claude-proxy ./charts/claude-anthropic-proxy \
  -n claude-proxy \
  --create-namespace \
  -f charts/claude-anthropic-proxy/values-prod.yaml \
  --set claudeAuth.existingSecret=claude-auth \
  --set env.REDIS_URL=redis://redis.default.svc.cluster.local:6379/0
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

# Kubernetes deployment helpers

실제 클러스터에 Helm으로 배포할 때 반복되는 명령을 스크립트로 정리했습니다.

## 기본 전제

- `kubectl`, `helm` 설치
- 현재 kube-context 가 대상 클러스터를 가리킴
- Claude CLI 로그인 정보가 로컬 `~/.claude` 에 존재
- 이미지 기본값은 `ghcr.io/tkfka1/claude-proxy:1.0.1`

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

## 2) 프록시 API key Secret 생성

```bash
PROXY_API_KEY='replace-with-strong-random-value' \
./deploy/k8s/create-proxy-env-secret.sh
```

기본값:

- namespace: `claude-proxy`
- secret name: `claude-proxy-env`

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
- `proxyApiKey.existingSecret=claude-proxy-env`

### dry-run

```bash
DRY_RUN=true ./deploy/k8s/deploy-helm.sh
```

### ingress values 추가

```bash
EXTRA_VALUES_FILE=charts/claude-anthropic-proxy/examples/values-ingress-cert-manager.yaml \
./deploy/k8s/deploy-helm.sh
```

### 이미지/secret 이름 오버라이드

```bash
IMAGE_TAG=1.0.1 \
CLAUDE_AUTH_SECRET=claude-auth \
PROXY_ENV_SECRET=claude-proxy-env \
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
IMAGE_TAG=1.0.2 ./deploy/k8s/deploy-helm.sh
```

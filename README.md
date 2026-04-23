# claude-anthropic-proxy

`claude` CLI를 뒤에서 호출해서, 바깥에서는 Anthropic Messages API처럼 보이게 만드는 프록시입니다.

## 동작 방식

1. 클라이언트가 `POST /v1/messages` 로 요청
2. 프록시가 Anthropic 요청을 `claude` CLI 프롬프트로 변환
3. `claude` CLI 실행
4. 결과를 Anthropic Messages API 형식으로 재포장해서 응답

---

## 지원 범위

- `POST /v1/messages`
- `GET /v1/models`
- `GET /health`
- Anthropic 스타일 JSON 응답
- `stream: true` 요청에 대한 SSE 응답
- `system`, `messages`, `stop_sequences` 처리

## 현재 제한사항

- Anthropic `tools` / `tool_choice` 미지원
- 이미지/문서 블록 미지원
- `max_tokens`, `temperature` 는 현재 입력 검증만 하고 CLI 제어로 직접 매핑하지 않음
- 스트리밍은 `claude --output-format stream-json` 기반 best-effort 변환

---

## 요구사항

- Node.js 20+
- `claude` CLI 설치
- `claude auth login` 완료

로그인 확인:

```bash
claude auth status
```

---

## 설치

```bash
npm install
cp .env.example .env
```

`.env` 는 자동 로드됩니다. (`dotenv` 적용)

---

## 빠른 시작

### 1. Claude 로그인 확인

```bash
claude auth status
```

### 2. `.env` 수정

기본값으로도 실행 가능하지만 필요하면 수정:

```bash
vi .env
```

### 3. 실행

```bash
npm start
```

기본 주소:

```text
http://0.0.0.0:8080
```

### 4. health check

```bash
curl http://localhost:8080/health
```

### 5. 메시지 요청

```bash
curl http://localhost:8080/v1/messages \
  -H 'content-type: application/json' \
  -H 'anthropic-version: 2023-06-01' \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 1024,
    "messages": [
      {"role": "user", "content": "안녕하세요"}
    ]
  }'
```

---

## 스트리밍 사용법

```bash
curl -N http://localhost:8080/v1/messages \
  -H 'content-type: application/json' \
  -H 'anthropic-version: 2023-06-01' \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 1024,
    "stream": true,
    "messages": [
      {"role": "user", "content": "짧게 자기소개 해줘"}
    ]
  }'
```

---

## 환경 변수

`.env.example` 참고.

### 서버 설정

- `HOST`: 바인드 주소 (기본값 `0.0.0.0`)
- `PORT`: 포트 (기본값 `8080`)
- `REQUEST_BODY_LIMIT_BYTES`: 요청 바디 최대 크기
- `ENABLE_REQUEST_LOGGING`: 요청 로그 출력 여부

### Claude CLI 설정

- `CLAUDE_BIN`: `claude` 실행 파일 경로
- `CLAUDE_DEFAULT_MODEL`: 기본 CLI 모델 alias (`sonnet` 등)
- `CLAUDE_MODEL_MAP_JSON`: 외부 모델명 → CLI 모델 alias 매핑 JSON 문자열
- `CLAUDE_EXTRA_ARGS_JSON`: `claude` 실행 시 추가 인자 JSON 배열 문자열

예:

```dotenv
CLAUDE_MODEL_MAP_JSON={"claude-sonnet-4-20250514":"sonnet","claude-opus-4-20250514":"opus"}
CLAUDE_EXTRA_ARGS_JSON=["--verbose"]
```

### 프록시 인증 설정

- `PROXY_API_KEY`: 프록시 자체 API 키
- `ALLOW_MISSING_API_KEY_HEADER`: `x-api-key` 없는 요청 허용 여부
- `REQUIRE_ANTHROPIC_VERSION`: `anthropic-version` 헤더 필수 여부
- `DEFAULT_ANTHROPIC_VERSION`: 기본 버전 문자열

API 키 강제 예시:

```dotenv
PROXY_API_KEY=local-proxy-key
ALLOW_MISSING_API_KEY_HEADER=false
```

요청 예시:

```bash
curl http://localhost:8080/v1/messages \
  -H 'content-type: application/json' \
  -H 'anthropic-version: 2023-06-01' \
  -H 'x-api-key: local-proxy-key' \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 256,
    "messages": [{"role": "user", "content": "hello"}]
  }'
```

---

## 모델 매핑

예:

```dotenv
CLAUDE_MODEL_MAP_JSON={"claude-sonnet-4-20250514":"sonnet","claude-opus-4-20250514":"opus","claude-haiku-4-5":"haiku"}
```

매핑이 없으면 내부 fallback 규칙:

- 이름에 `sonnet` 포함 → `sonnet`
- 이름에 `opus` 포함 → `opus`
- 이름에 `haiku` 포함 → `haiku`
- 그래도 못 맞추면 요청 문자열 그대로 전달

---

## Makefile 사용법

제공 파일:

- `Makefile`

자주 쓰는 명령:

```bash
make install
make start
make test
make health
make docker-build
make docker-run
make helm-lint
make helm-template
make compose-up
make compose-down
make compose-logs
make pm2-start
make pm2-restart
```

---

## PM2 사용법

파일:

- `ecosystem.config.cjs`

실행:

```bash
pm2 start ecosystem.config.cjs --update-env
pm2 save
```

확인:

```bash
pm2 status
pm2 logs claude-anthropic-proxy
```

중지/재시작:

```bash
pm2 restart claude-anthropic-proxy --update-env
pm2 stop claude-anthropic-proxy
```

> `.env` 는 앱 시작 시 자동 로드됩니다.

---

## systemd 사용법

샘플 유닛 파일:

```text
deploy/systemd/claude-anthropic-proxy.service
```

### 1. 배포 위치 예시

```bash
sudo mkdir -p /opt/claude-anthropic-proxy
sudo rsync -av ./ /opt/claude-anthropic-proxy/
cd /opt/claude-anthropic-proxy
npm install
```

### 2. 환경파일 준비

```bash
sudo cp .env.example /etc/claude-anthropic-proxy.env
sudo vi /etc/claude-anthropic-proxy.env
```

### 3. 서비스 유닛 설치

`deploy/systemd/claude-anthropic-proxy.service` 에서 `User` / `Group` 을 실제 계정으로 바꿉니다.

중요:

- **systemd 서비스는 `claude auth login` 이 되어 있는 같은 사용자로 실행해야 합니다.**

확인:

```bash
sudo -u myuser claude auth status
```

필요하면:

```bash
sudo -u myuser claude auth login
```

설치:

```bash
sudo cp deploy/systemd/claude-anthropic-proxy.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now claude-anthropic-proxy
```

상태 확인:

```bash
sudo systemctl status claude-anthropic-proxy
journalctl -u claude-anthropic-proxy -f
```

---

## Docker 사용법

파일:

- `Dockerfile`
- `.dockerignore`

### 빌드

```bash
docker build -t claude-anthropic-proxy .
```

### 실행

호스트의 Claude 로그인 정보를 재사용하려면 `~/.claude` 를 마운트해야 합니다.

```bash
docker run --rm \
  -p 8080:8080 \
  --env-file .env \
  -v "$HOME/.claude:/home/node/.claude:ro" \
  claude-anthropic-proxy
```

---

## docker compose 사용법

파일:

- `docker-compose.yml`

실행:

```bash
docker compose up -d --build
```

로그 확인:

```bash
docker compose logs -f
```

종료:

```bash
docker compose down
```

기본적으로:

- `.env` 를 컨테이너에 전달
- 호스트의 `${HOME}/.claude` 를 `/home/node/.claude` 에 read-only 마운트

따라서 compose 를 실행하는 사용자 계정에서 `claude auth login` 이 되어 있어야 합니다.

---

## 요청 예시

### 기본 대화

```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 1024,
  "messages": [
    {"role": "user", "content": "hello"}
  ]
}
```

### system 포함

```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 1024,
  "system": "너는 간결하게 답하는 assistant다.",
  "messages": [
    {"role": "user", "content": "자기소개 해줘"}
  ]
}
```

### stop_sequences 포함

```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 1024,
  "stop_sequences": ["\nEND"],
  "messages": [
    {"role": "user", "content": "목록 작성하고 마지막에 END 붙여"}
  ]
}
```

---

## Helm chart

Helm chart는 아래 경로에 추가했습니다.

```text
charts/claude-anthropic-proxy
```

빠른 설치 예시:

```bash
kubectl create namespace claude-proxy
kubectl create secret generic claude-auth \
  -n claude-proxy \
  --from-file=credentials.json=$HOME/.claude/.credentials.json \
  --from-file=settings.json=$HOME/.claude/settings.json

helm upgrade --install claude-proxy ./charts/claude-anthropic-proxy \
  -n claude-proxy \
  --create-namespace \
  --set image.repository=claude-anthropic-proxy \
  --set image.tag=latest \
  --set claudeAuth.existingSecret=claude-auth
```

자세한 값과 예시는 `charts/claude-anthropic-proxy/README.md` 참고.

추가 예시 파일:

- `charts/claude-anthropic-proxy/values-prod.yaml`
- `charts/claude-anthropic-proxy/examples/external-secret.yaml`
- `charts/claude-anthropic-proxy/examples/sealed-secret.yaml`
- `charts/claude-anthropic-proxy/examples/values-ingress-cert-manager.yaml`
- `charts/claude-anthropic-proxy/examples/clusterissuer-letsencrypt.yaml`

---

## 에러 처리

Anthropic 스타일 에러 형식으로 응답합니다.

예:

```json
{
  "type": "error",
  "error": {
    "type": "authentication_error",
    "message": "claude-cli is not logged in. Run `claude auth login` first."
  },
  "request_id": "req_..."
}
```

대표 케이스:

- 잘못된 JSON → `invalid_request_error`
- 미지원 필드(`tools`, `tool_choice`) → `invalid_request_error`
- `claude` 미로그인/인증 실패 → `authentication_error`
- 내부 예외 → `api_error`

---

## 테스트

```bash
npm test
```

현재 테스트 범위:

- 일반 `/v1/messages` 응답
- `stream: true` SSE 응답
- backend 인증 실패 매핑
- 미지원 `tools` 요청 차단
- 프롬프트 변환 / stop sequence 처리

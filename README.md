# claude-anthropic-proxy

`claude` CLI를 뒤에서 호출해서, 바깥에서는 Anthropic Messages API처럼 보이게 만드는 프록시입니다.

## 동작 방식

1. 브라우저가 `/` 로 접속하면 `/docs` 로 이동
2. 클라이언트가 `POST /v1/messages` 로 요청
3. 프록시가 Anthropic 요청을 `claude` CLI 프롬프트로 변환
4. `claude` CLI 실행
5. 결과를 Anthropic Messages API 형식으로 재포장해서 응답

---

## 지원 범위

- `POST /v1/messages`
- `GET /v1/models`
- `GET /health` 프로세스 liveness 상태
- `GET /ready` Redis 연결/readiness 상태
- `GET /metrics` 요청/메시지/Claude CLI/Redis/키 로테이션 상태 JSON
- `GET /` 브라우저면 `/docs` 로 리다이렉트, 비브라우저면 JSON 메타 정보
- `GET /docs` 비밀번호 로그인 가능한 문서 화면
- `GET /login` 문서 화면 로그인 폼
- `POST /login` 문서 화면 로그인 세션 생성
- `POST /logout` 문서 화면 로그인 세션 종료
- `GET /api-info` JSON 메타 정보
- `GET /claude-auth/status` Claude CLI 로그인 상태 조회 (문서 로그인 필요)
- `GET /claude-auth/operation` Claude CLI 로그인/로그아웃 작업 상태 조회 (문서 로그인 필요)
- `POST /claude-auth/login` 웹에서 Claude CLI 로그인 시작 (문서 로그인 필요)
- `POST /claude-auth/logout` 웹에서 Claude CLI 로그아웃 시작 (문서 로그인 필요)
- `GET /proxy-api-key` 현재 런타임 x-api-key 상태 조회 (문서 로그인 필요)
- `POST /proxy-api-key` 런타임 x-api-key 저장/리셋 (문서 로그인 필요)
- `GET /logs/recent` 최근 프록시 로그 + 동시성 상태 조회 (문서 로그인 필요)
- `DELETE /logs/recent` 최근 프록시 로그 비우기 (문서 로그인 필요)
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

전역 커맨드로 쓰려면:

```bash
npm install -g git+https://github.com/tkfka1/claude-proxy.git
claude-anthropic-proxy
```

---

## 빠른 시작

### 1. Claude 로그인 확인

```bash
claude auth status
```

### 2. `.env` 수정

서버 시작 전 최소한 문서 화면 비밀번호를 설정해야 합니다.
`WEB_PASSWORD` 또는 `WEB_PASSWORD_HASH` 중 하나를 실제 값으로 채웁니다.

```dotenv
WEB_PASSWORD=docs-password-32chars-min-example
```

필요하면 포트, Claude CLI 경로, 프록시 API key 정책 등도 수정합니다.

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

### 4. health / readiness check

프로세스 liveness 확인:

```bash
curl http://localhost:8080/health
```

Redis까지 포함한 readiness 확인:

```bash
curl http://localhost:8080/ready
```

metrics 확인:

```bash
curl http://localhost:8080/metrics
```

### 5. 브라우저에서 열기

```text
http://localhost:8080/docs
```

브라우저로 루트(`/`)에 들어가도 자동으로 `/docs` 로 이동합니다.
실제 API 경로는 그대로 유지되고, 서버는 시작 전에 `WEB_PASSWORD` 또는
`WEB_PASSWORD_HASH` 가 반드시 필요합니다. 로그인 후에는 문서 화면에서
Claude CLI 로그인 상태를 확인하고, 웹에서 `claude auth login` / `logout` 을 실행하고,
런타임 `x-api-key` 값도 바로 바꿀 수 있습니다.

JSON 메타 정보가 필요하면:

```bash
curl http://localhost:8080/api-info
```

### 6. 메시지 요청

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
- `ENABLE_REQUEST_LOGGING`: stdout 요청 로그 출력 여부
- `MAX_CONCURRENT_MESSAGE_REQUESTS`: 동시에 실행할 `/v1/messages` 개수(기본값 `4`, `0`이면 무제한)
- `MAX_QUEUED_MESSAGE_REQUESTS`: 실행 슬롯을 기다릴 큐 길이(기본값 `16`)
- `MAX_MESSAGE_QUEUE_WAIT_MS`: 큐에서 기다릴 최대 시간(ms). 초과 시 `429 rate_limit_error` 반환 (기본값 `30000`, `0`이면 무기한 대기)
- `RECENT_LOG_LIMIT`: `/docs` 와 `/logs/recent` 에서 유지할 최근 로그 개수(기본값 `200`)
- `CLAUDE_REQUEST_TIMEOUT_MS`: `claude` child process 전체 요청 timeout(ms). 초과 시 child process를 종료하고 `504 api_error` 반환(기본값 `300000`, `0`이면 비활성화)
- `CLAUDE_STREAM_IDLE_TIMEOUT_MS`: 스트리밍 중 새 CLI 이벤트가 들어오지 않을 때의 idle timeout(ms). 초과 시 SSE `error` 이벤트를 보내고 child process를 종료(기본값 `60000`, `0`이면 비활성화)
- `SHUTDOWN_GRACE_MS`: SIGTERM/SIGINT graceful shutdown 최대 대기 시간(ms). 큐를 비우고 in-flight CLI process를 abort한 뒤 Redis/log store를 정리(기본값 `10000`)
- `REDIS_URL`: Redis backend 주소. **운영 실행에 필수**이며 x-api-key state / recent logs / 웹 로그인 세션 / 로그인 시도 제한 / 메시지 동시성 상태를 Redis에 저장합니다. docker compose는 `redis://redis:6379/0`, 로컬 직접 실행은 예를 들어 `redis://localhost:6379/0` 를 사용합니다. Redis가 없으면 서버는 시작하지 않습니다.
- `REDIS_KEY_PREFIX`: Redis key prefix (기본값 `claude-anthropic-proxy`)
- `PROXY_STATE_FILE`, `RECENT_LOG_FILE`: Redis를 쓰지 않는 격리 테스트/local fallback에서만 쓰는 파일 경로입니다. 운영 기본 경로에서는 Redis가 우선합니다.

### 웹 문서 로그인 설정

- `WEB_PASSWORD`: `/docs` 문서 화면 접근용 평문 비밀번호. 서버 시작 전에 반드시 필요
- `WEB_PASSWORD_HASH`: `/docs` 문서 화면 접근용 scrypt 해시 비밀번호. 설정하면 `WEB_PASSWORD` 보다 우선
- `WEB_SESSION_TTL_HOURS`: 로그인 세션 유지 시간(시간 단위, 기본값 `12`)
- `WEB_LOGIN_MAX_ATTEMPTS`: 같은 클라이언트 IP 기준 로그인 최대 실패 횟수(기본값 `5`, `0`이면 비활성화)
- `WEB_LOGIN_WINDOW_MINUTES`: 로그인 실패 제한 윈도우/차단 시간(분 단위, 기본값 `15`)

예:

```dotenv
WEB_PASSWORD=replace-with-strong-docs-password
WEB_SESSION_TTL_HOURS=12
WEB_LOGIN_MAX_ATTEMPTS=5
WEB_LOGIN_WINDOW_MINUTES=15
```

해시를 쓰려면 예를 들어:

```bash
node --input-type=module -e "import { createScryptPasswordHash } from './src/web-auth.js'; console.log(createScryptPasswordHash('change-this-password'));"
```

출력값을 `.env` 에 넣습니다:

```dotenv
WEB_PASSWORD_HASH=scrypt$<salt-hex>$<digest-hex>
```

둘 다 비워 두면 서버가 시작되지 않습니다.
또한 `replace-with-...`, `change-this-...`, `<set-a-password>` 같은 placeholder 값도
그대로 두면 시작 단계에서 거부합니다.

### 웹에서 x-api-key 설정

- `/docs` 로그인 후 문서 페이지에서 바로 설정 가능
- 로그인 상태에서는 현재 x-api-key 원문을 바로 확인 가능
- 저장한 값은 현재 서버 프로세스 메모리에 반영되고, 즉시 `/v1/messages` 의 `x-api-key` 검증에 사용됨
- `리셋` 버튼은 새 랜덤 x-api-key 를 다시 발급하고 이전 키는 grace period 동안만 임시 허용
- `PROXY_API_KEY_GRACE_PERIOD_SECONDS`: 로테이션 직전 키를 허용할 유예 시간(기본값 `300`, `0`이면 이전 키 즉시 무효화)
- `PROXY_API_KEY_HISTORY_LIMIT`: `/proxy-api-key` / `/metrics` 에 노출할 masked key history 개수(기본값 `5`, `0`이면 history 비활성화)
- Redis에 저장되므로 서버/Pod를 재시작해도 다시 불러옴
- `PROXY_API_KEY` 는 **초기 bootstrap 용도**이고, Redis에 저장된 값이 생긴 뒤에는 저장된 값이 계속 우선함
- 빈 값 대신 8자 이상 문자열만 허용
- `/docs` 와 `/logs/recent` 에서 최근 프록시 로그와 동시성 상태도 같이 볼 수 있음
- 최근 로그 패널은 검색, 레벨 필터, 자동 새로고침 on/off, JSON 저장, 로그 비우기를 지원
- HTTP access log는 method/path/status/duration을 남기되 `/logs/recent`, `/health`, `/ready`, `/metrics` 같은 poll/probe 경로는 제외해서 노이즈를 줄임
- 최근 로그도 Redis에 저장되므로 재시작 후 다시 볼 수 있음
- 최근 로그가 Redis에 저장될 때는 로그인 client IP / email 같은 민감 필드는 redaction 후 저장
- `/docs` 로그인 세션과 로그인 시도 제한도 Redis에 저장되어 여러 Pod 사이에서 공유됨

### 메시지 동시성 / 큐

- `/v1/messages` 는 설정한 동시성 제한 안에서만 `claude` child process 를 실행
- 슬롯이 꽉 차면 큐에서 기다리고, 큐까지 다 차면 `429 rate_limit_error` 반환
- 큐에서 `MAX_MESSAGE_QUEUE_WAIT_MS` 를 넘기면 `429 rate_limit_error` 로 timeout 반환
- 스트리밍 요청도 동일한 슬롯을 점유하므로 오래 걸리는 응답이 많으면 큐 대기가 늘어날 수 있음
- 현재 상태는 `/docs` 의 최근 로그 패널 또는 `GET /logs/recent` 에서 확인 가능
- 실행 슬롯은 **Redis 기반 전역 semaphore** 로 관리되어 여러 Pod 사이에서도 active 개수를 공유
- FIFO 대기열도 Redis에 올라가며, `/logs/recent` 에서 전역 active/global queued/local queued 상태를 같이 볼 수 있음
- 다만 `MAX_QUEUED_MESSAGE_REQUESTS` 는 여전히 **pod당 local waiting cap** 으로도 같이 쓰므로, 한 pod가 너무 많은 대기 요청을 쌓는 것은 막음
- SIGTERM/SIGINT 시 새 요청은 `/health` 를 제외하고 `503` 으로 막고, 대기열과 진행 중인 `claude` child process를 정리한 뒤 Redis 연결을 닫음


### health / readiness

- `GET /health`: 프로세스 liveness용. Redis client 상태 요약을 포함하지만, Kubernetes livenessProbe처럼 프로세스 생존 확인에 사용합니다.
- `GET /ready`: Redis `PING`, log store 상태, message concurrency 상태를 확인합니다. Redis가 준비되지 않으면 `503` 을 반환하므로 Kubernetes readinessProbe에 사용합니다.
- `GET /metrics`: uptime, request status, message 성공/실패/abort, Claude CLI timeout, x-api-key rotation/grace match, Redis/log/concurrency 상태를 JSON으로 확인합니다.

### Claude CLI 웹 로그인

- `/docs` 문서 화면 로그인 후 사용 가능
- 웹 버튼은 서버 호스트에서 `claude auth login` / `claude auth logout` 을 실행
- Claude Code 공식 문서 기준으로 인증은 브라우저 프롬프트 기반으로 진행됨
- `Claude.ai` / `Anthropic Console` 선택 가능, 필요하면 SSO 강제 가능
- 로그인 명령 출력에서 URL이 감지되면 웹 화면에 바로 링크로 표시
- 원격 서버에 띄운 경우 브라우저가 **서버 쪽 환경**에서 열릴 수 있으니 주의

### Claude CLI 설정

- `CLAUDE_BIN`: `claude` 실행 파일 경로
- `CLAUDE_DEFAULT_MODEL`: 기본 CLI 모델 alias (`sonnet` 등)
- `CLAUDE_MODEL_MAP_JSON`: 외부 모델명 → CLI 모델 alias 매핑 JSON 문자열
- `CLAUDE_EXTRA_ARGS_JSON`: `claude` 실행 시 추가 인자 JSON 배열 문자열
- `CLAUDE_REQUEST_TIMEOUT_MS`, `CLAUDE_STREAM_IDLE_TIMEOUT_MS`: 오래 걸리거나 멈춘 CLI 호출을 watchdog으로 종료

예:

```dotenv
CLAUDE_MODEL_MAP_JSON={"claude-sonnet-4-20250514":"sonnet","claude-opus-4-20250514":"opus"}
CLAUDE_EXTRA_ARGS_JSON=["--verbose"]
```

### 프록시 인증 설정

- `PROXY_API_KEY`: 프록시 자체 API 키 초기 bootstrap 값. 첫 저장 전 기본값으로만 사용되고, 이후에는 Redis에 저장된 값이 계속 사용됨
- `PROXY_STATE_FILE`: Redis를 쓰지 않는 격리 테스트/local fallback에서만 쓰는 파일 경로. 운영 기본 경로에서는 사용하지 않음
- `REDIS_URL`: x-api-key state / recent logs / 웹 로그인 세션 / 로그인 시도 제한 / 메시지 동시성 상태를 저장할 Redis 주소
- `REDIS_KEY_PREFIX`: Redis key namespace prefix
- `ALLOW_MISSING_API_KEY_HEADER`: `x-api-key` 없는 요청 허용 여부
- `REQUIRE_ANTHROPIC_VERSION`: `anthropic-version` 헤더 필수 여부
- `DEFAULT_ANTHROPIC_VERSION`: 기본 버전 문자열
- `PROXY_API_KEY_GRACE_PERIOD_SECONDS`: 키 로테이션 후 이전 키 유예 시간
- `PROXY_API_KEY_HISTORY_LIMIT`: masked key history 보관 개수

API 키 강제 예시:

```dotenv
PROXY_API_KEY=local-proxy-key
ALLOW_MISSING_API_KEY_HEADER=false
```

또는 서버를 띄운 뒤 `/docs` 에서 `x-api-key` 를 저장하면, 그 시점부터 `/v1/messages` 는
헤더 없이는 들어오지 않고, 저장된 값은 Redis에 남아 재시작 후에도 유지됩니다.

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
make pack-dry-run
make health
make docker-build
make docker-buildx
make docker-buildx-push
make docker-run
make helm-lint
make helm-template
make helm-template-prod
make k8s-create-claude-secret
make k8s-create-proxy-secret
make k8s-deploy
make k8s-dry-run
make compose-up
make compose-up-external-redis
make compose-down
make compose-logs
make pm2-start
make pm2-restart
```

---

## 릴리즈 / 배포 자동화

추가된 GitHub Actions:

- `.github/workflows/ci.yml`
  - Node 20 / 22 / 24 테스트
  - Helm lint / template 검증
  - `linux/amd64`, `linux/arm64` Docker 빌드 검증
  - `main` push 가 성공하면 GHCR 멀티아키 이미지 `:main`, `:sha-<7자리>` 자동 push
- `.github/workflows/auto-release.yml`
  - `main` CI 성공 후 `package.json` / `package-lock.json` 버전을 자동 bump
  - 자동으로 `vX.Y.Z` 태그와 GitHub Release 생성
  - GHCR 멀티아키 이미지 `:latest`, `:X.Y.Z`, `:X.Y`, `:sha-<7자리>` push
  - `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN` 이 있으면 Docker Hub도 같이 push
- `.github/workflows/release.yml`
  - 수동 fallback: `main` 에서 딴 `v*.*.*` 태그만 릴리즈 허용
  - 이미 생성된 태그도 `workflow_dispatch` 의 `tag` 입력으로 다시 릴리즈 가능
  - GitHub Release 생성
  - GHCR 멀티아키 이미지(`linux/amd64`, `linux/arm64`) push
  - 선택적으로 Docker Hub도 같이 push

### 릴리즈 절차

기본 경로는 **자동 릴리즈**입니다.

1. PR을 `main` 에 merge
2. CI가 통과
3. `auto-release.yml` 이 버전을 자동 bump하고 `vX.Y.Z` 태그 생성
4. GitHub Release와 GHCR release image 생성

버전 bump 규칙:

- commit message에 `BREAKING CHANGE` 또는 conventional commit `!` 이 있으면 major
- Redis 필수화처럼 배포 호환성을 깨는 Redis requirement diff가 감지되면 major
- `feat:` / `feature:` / `Add ...` / `Create ...` / `Introduce ...` 패턴이면 minor
- 그 외는 patch

수동 태그 릴리즈도 fallback으로 남겨 두었습니다. 직접 태그를 push하면 `release.yml` 이 실행됩니다.
이미 태그가 만들어진 뒤 컨테이너 이미지나 GitHub Release를 다시 생성해야 하는 경우에는
`release.yml` 을 수동 실행하고 `tag` 에 예를 들어 `v2.0.0` 을 입력하면 같은 태그를 다시 검증한 뒤
GitHub Release/컨테이너 publish를 재시도합니다.

### npm publish 정책

이 저장소는 npm registry로 publish하지 않습니다.

- 공개 배포는 GitHub 저장소, GitHub Release, GHCR 컨테이너 이미지를 기준으로 합니다.
- Node 전역 커맨드는 Git URL 설치(`npm install -g git+https://github.com/tkfka1/claude-proxy.git`)를 사용합니다.
- GitHub Actions 릴리즈 workflow도 npm publish 단계를 실행하지 않습니다.

### 컨테이너 이미지

기본 push 대상:

- `ghcr.io/tkfka1/claude-proxy`
  - `:main` , 최신 `main` 브랜치 성공 빌드
  - `:sha-<7자리>` , 특정 커밋 고정용 edge 이미지
  - `:latest`, `:2.0.0`, `:2.0`, `:sha-...` 는 공식 release 태그 push 때 생성

선택 push 대상:

- Docker Hub (`DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN` secret 이 둘 다 있을 때만 활성화)

로컬 multi-arch 예시:

```bash
make docker-buildx DOCKER_PLATFORM=linux/amd64
make docker-buildx DOCKER_PLATFORM=linux/arm64
make docker-buildx-push DOCKER_IMAGE=ghcr.io/tkfka1/claude-proxy DOCKER_TAG=v1.1.0
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

Buildx 로 아키텍처별 빌드:

```bash
docker buildx build --platform linux/amd64 -t claude-anthropic-proxy:amd64 --load .
docker buildx build --platform linux/arm64 -t claude-anthropic-proxy:arm64 --load .
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

릴리즈 후 GHCR 이미지 사용 예시:

```bash
docker run --rm \
  -p 8080:8080 \
  --env-file .env \
  -v "$HOME/.claude:/home/node/.claude:ro" \
  ghcr.io/tkfka1/claude-proxy:latest
```

최신 `main` 브랜치 빌드를 바로 써보고 싶으면:

```bash
docker run --rm \
  -p 8080:8080 \
  --env-file .env \
  -v "$HOME/.claude:/home/node/.claude:ro" \
  ghcr.io/tkfka1/claude-proxy:main
```

---

## docker compose 사용법

파일:

- `docker-compose.yml`: Redis를 같이 띄우는 기본 compose
- `docker-compose.external-redis.yml`: 외부 Redis를 쓰는 compose

실행(내부 Redis 포함):

```bash
docker compose up -d --build
```

외부 Redis 사용:

```bash
EXTERNAL_REDIS_URL=redis://redis.example.com:6379/0 \
  docker compose -f docker-compose.external-redis.yml up -d --build
```

로그 확인:

```bash
docker compose logs -f
```

종료:

```bash
docker compose down
```

기본 `docker-compose.yml` 은:

- Redis 컨테이너를 같이 올림
- 프록시 컨테이너에는 `REDIS_URL=redis://redis:6379/0` 를 주입
- Redis named volume `redis-data` 에 x-api-key, 최근 로그, 문서 로그인 세션, 로그인 시도 제한, 메시지 동시성 상태를 유지
- `.env` 를 프록시 컨테이너에 전달
- 호스트의 `${HOME}/.claude` 를 `/home/node/.claude` 에 read-only 마운트

`docker-compose.external-redis.yml` 은 Redis 컨테이너를 만들지 않고 `EXTERNAL_REDIS_URL` 값을 프록시의 `REDIS_URL` 로 주입합니다.

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

실제 클러스터 배포 helper script:

```text
deploy/k8s/
```

빠른 설치 예시:

```bash
./deploy/k8s/create-claude-auth-secret.sh
./deploy/k8s/deploy-helm.sh
```

기본 `values-prod.yaml` 은 내부 Redis를 같이 올립니다.
`/v1/messages` 동시성/큐, `/docs` 에서 저장한 x-api-key, 최근 로그, 문서 로그인 세션/시도 제한은 Redis에 유지됩니다.
Kubernetes readinessProbe는 `/ready`, livenessProbe는 `/health` 를 사용하고, Pod 종료 시 `terminationGracePeriodSeconds` 안에서 SIGTERM graceful shutdown을 수행합니다.
처음부터 `PROXY_API_KEY` 를 Secret으로 넣고 싶을 때만 `deploy/k8s/create-proxy-env-secret.sh` 를 추가로 사용합니다.
외부 Redis를 쓰려면 `EXTERNAL_REDIS_URL=redis://... ./deploy/k8s/deploy-helm.sh` 또는 Helm `--set redis.enabled=false --set env.REDIS_URL=...` 를 사용합니다.

prod dry-run 예시:

```bash
DRY_RUN=true ./deploy/k8s/deploy-helm.sh
```

Ingress 예시:

```bash
EXTRA_VALUES_FILE=charts/claude-anthropic-proxy/examples/values-ingress-cert-manager.yaml \
./deploy/k8s/deploy-helm.sh
```

IDC HTTP ingress 예시:

```bash
EXTRA_VALUES_FILE=charts/claude-anthropic-proxy/examples/values-ingress-idc-http.yaml \
./deploy/k8s/deploy-helm.sh
```

자세한 값과 예시는 아래 문서 참고:

- `deploy/k8s/README.md`
- `charts/claude-anthropic-proxy/README.md`

추가 예시 파일:

- `charts/claude-anthropic-proxy/values-prod.yaml`
- `charts/claude-anthropic-proxy/examples/external-secret.yaml`
- `charts/claude-anthropic-proxy/examples/sealed-secret.yaml`
- `charts/claude-anthropic-proxy/examples/values-ingress-cert-manager.yaml`
- `charts/claude-anthropic-proxy/examples/values-ingress-idc-http.yaml`
- `charts/claude-anthropic-proxy/examples/values-proxy-state-pvc.yaml`
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
- `claude` CLI request/stream idle timeout → `api_error` + HTTP `504`
- 내부 예외 → `api_error`

---

## 테스트

```bash
npm test
```

현재 테스트 범위:

- `/`, `/docs`, `/login`, `/logout`, `/api-info` 라우팅
- 문서 화면 로그인 세션, 비밀번호 실패, rate limit
- Claude CLI 로그인 상태 조회와 웹 로그인/로그아웃 작업
- 런타임 `x-api-key` 조회, 저장, 리셋, 이전 키 grace period, 요청 인증 강제
- 최근 로그 조회/비우기, HTTP access log, 영속 저장, 민감 필드 redaction
- 로컬 `/v1/messages` 동시성 제한, 큐 제한, 큐 timeout
- Redis 기반 전역 message semaphore, Redis 대기열 timeout
- Redis state store 기반 x-api-key / 최근 로그 저장
- 일반 `/v1/messages` 응답
- `stream: true` SSE 응답과 idle timeout SSE error
- `GET /metrics` 카운터/상태 응답
- Claude CLI request timeout `504` 처리
- 스트리밍 클라이언트 disconnect 시 슬롯 해제와 aborted 로그
- backend 인증 실패 매핑
- 미지원 `tools` 요청 차단
- 프롬프트 변환, system prompt 정규화, stop sequence 처리
- 웹 비밀번호 scrypt hash 생성/검증

---

## 라이선스

이 패키지는 `PolyForm-Noncommercial-1.0.0` 라이선스로 배포됩니다.

- 비상업적 사용은 허용됩니다.
- 상업적 사용은 허용되지 않습니다.
- 전체 조건은 [`LICENSE`](./LICENSE)를 확인하세요.

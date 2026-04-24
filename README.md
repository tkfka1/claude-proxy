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
- `GET /health`
- `GET /` 브라우저면 `/docs` 로 리다이렉트, 비브라우저면 JSON 메타 정보
- `GET /docs` 비밀번호 로그인 가능한 문서 화면
- `GET /api-info` JSON 메타 정보
- `GET /claude-auth/status` Claude CLI 로그인 상태 조회 (문서 로그인 필요)
- `GET /claude-auth/operation` Claude CLI 로그인/로그아웃 작업 상태 조회 (문서 로그인 필요)
- `POST /claude-auth/login` 웹에서 Claude CLI 로그인 시작 (문서 로그인 필요)
- `POST /claude-auth/logout` 웹에서 Claude CLI 로그아웃 시작 (문서 로그인 필요)
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
npm install -g claude-anthropic-proxy
claude-anthropic-proxy
```

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

### 5. 브라우저에서 열기

```text
http://localhost:8080/docs
```

브라우저로 루트(`/`)에 들어가도 자동으로 `/docs` 로 이동합니다.
실제 API 경로는 그대로 유지되고, `WEB_PASSWORD` 또는 `WEB_PASSWORD_HASH` 를 설정하면
먼저 비밀번호 로그인 화면이 뜹니다. 로그인 후에는 문서 화면에서
Claude CLI 로그인 상태를 확인하고 웹에서 `claude auth login` / `logout` 을 실행할 수 있습니다.

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
- `ENABLE_REQUEST_LOGGING`: 요청 로그 출력 여부

### 웹 문서 로그인 설정

- `WEB_PASSWORD`: `/docs` 문서 화면 접근용 평문 비밀번호
- `WEB_PASSWORD_HASH`: `/docs` 문서 화면 접근용 scrypt 해시 비밀번호. 설정하면 `WEB_PASSWORD` 보다 우선
- `WEB_SESSION_TTL_HOURS`: 로그인 세션 유지 시간(시간 단위, 기본값 `12`)
- `WEB_LOGIN_MAX_ATTEMPTS`: 같은 클라이언트 IP 기준 로그인 최대 실패 횟수(기본값 `5`, `0`이면 비활성화)
- `WEB_LOGIN_WINDOW_MINUTES`: 로그인 실패 제한 윈도우/차단 시간(분 단위, 기본값 `15`)

예:

```dotenv
WEB_PASSWORD=change-this-password
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
  - `npm pack --dry-run` 으로 npm 배포 산출물 검증
  - Helm lint / template 검증
  - `linux/amd64`, `linux/arm64` Docker 빌드 검증
  - `main` push 가 성공하면 GHCR 멀티아키 이미지 `:main`, `:sha-<7자리>` 자동 push
- `.github/workflows/release.yml`
  - `main` 에서 딴 `v*.*.*` 태그만 릴리즈 허용
  - `NPM_TOKEN` 이 있을 때만 npm 패키지 publish
  - GitHub Release 생성
  - GHCR 멀티아키 이미지(`linux/amd64`, `linux/arm64`) push
  - 선택적으로 Docker Hub도 같이 push

### 릴리즈 절차

`main` push 는 edge 이미지 배포까지만 자동으로 합니다.
공식 릴리즈(`:latest`, `vX.Y.Z`, GitHub Release, optional npm publish)는 아래처럼 태그 push 때만 만듭니다.

1. `main` 에 머지
2. `package.json` 버전 확인
3. 태그 생성 및 push

```bash
git checkout main
git pull --ff-only
git tag v1.1.0
git push origin main --tags
```

### npm publish 인증

기본 동작은 **npm optional** 입니다.

- `NPM_TOKEN` secret 이 있으면 release workflow 에서 npm publish 수행
- `NPM_TOKEN` 이 없으면 npm publish 는 자동으로 skip 되고, GitHub Release + 컨테이너 릴리즈만 진행

최초 npm 배포가 아직 없는 패키지는 trusted publishing 만으로 바로 시작할 수 없습니다.

- npm trusted publishing 설정 전에는 token 기반 첫 배포가 필요할 수 있음
- workflow 파일명은 **정확히** `.github/workflows/release.yml` 이어야 함
- `package.json` 의 `repository.url` 이 GitHub 저장소와 정확히 일치해야 함

토큰 방식 fallback 도 지원합니다.

- `NPM_TOKEN` GitHub Actions secret 추가 시 token 기반 publish 사용

### 컨테이너 이미지

기본 push 대상:

- `ghcr.io/tkfka1/claude-proxy`
  - `:main` , 최신 `main` 브랜치 성공 빌드
  - `:sha-<7자리>` , 특정 커밋 고정용 edge 이미지
  - `:latest`, `:1.1.0`, `:1.1`, `:sha-...` 는 공식 release 태그 push 때 생성

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

실제 클러스터 배포 helper script:

```text
deploy/k8s/
```

빠른 설치 예시:

```bash
./deploy/k8s/create-claude-auth-secret.sh
PROXY_API_KEY='replace-with-strong-random-value' ./deploy/k8s/create-proxy-env-secret.sh
./deploy/k8s/deploy-helm.sh
```

prod dry-run 예시:

```bash
DRY_RUN=true ./deploy/k8s/deploy-helm.sh
```

Ingress 예시:

```bash
EXTRA_VALUES_FILE=charts/claude-anthropic-proxy/examples/values-ingress-cert-manager.yaml \
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

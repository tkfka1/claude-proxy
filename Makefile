.PHONY: install start test pack-dry-run health helm-lint helm-template compose-up compose-down compose-logs docker-build docker-buildx docker-buildx-push docker-run pm2-start pm2-restart

DOCKER_IMAGE ?= claude-anthropic-proxy
DOCKER_TAG ?= dev
DOCKER_PLATFORM ?= linux/amd64
DOCKER_PLATFORMS ?= linux/amd64,linux/arm64

install:
	npm install

start:
	npm start

test:
	npm test

pack-dry-run:
	npm run pack:dry-run

health:
	curl -fsS http://localhost:$${PORT:-8080}/health

helm-lint:
	helm lint charts/claude-anthropic-proxy

helm-template:
	helm template claude-proxy charts/claude-anthropic-proxy

compose-up:
	docker compose up -d --build

compose-down:
	docker compose down

compose-logs:
	docker compose logs -f

docker-build:
	docker build -t $(DOCKER_IMAGE):$(DOCKER_TAG) .

docker-buildx:
	docker buildx build \
		--platform $(DOCKER_PLATFORM) \
		-t $(DOCKER_IMAGE):$(DOCKER_TAG) \
		--load \
		.

docker-buildx-push:
	docker buildx build \
		--platform $(DOCKER_PLATFORMS) \
		-t $(DOCKER_IMAGE):$(DOCKER_TAG) \
		--push \
		.

docker-run:
	docker run --rm \
		-p $${PORT:-8080}:8080 \
		--env-file .env \
		-v $$HOME/.claude:/home/node/.claude:ro \
		$(DOCKER_IMAGE):$(DOCKER_TAG)

pm2-start:
	pm2 start ecosystem.config.cjs --update-env

pm2-restart:
	pm2 restart claude-anthropic-proxy --update-env

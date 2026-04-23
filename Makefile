.PHONY: install start test health helm-lint helm-template compose-up compose-down compose-logs docker-build docker-run pm2-start pm2-restart

install:
	npm install

start:
	npm start

test:
	npm test

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
	docker build -t claude-anthropic-proxy .

docker-run:
	docker run --rm \
		-p $${PORT:-8080}:8080 \
		--env-file .env \
		-v $$HOME/.claude:/home/node/.claude:ro \
		claude-anthropic-proxy

pm2-start:
	pm2 start ecosystem.config.cjs --update-env

pm2-restart:
	pm2 restart claude-anthropic-proxy --update-env

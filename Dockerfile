FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080

RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY bin ./bin
COPY src ./src
COPY .env.example ./.env.example
COPY README.md ./README.md

USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const http=require('node:http');const port=process.env.PORT||8080;const req=http.get({host:'127.0.0.1',port,path:'/health'},(res)=>process.exit(res.statusCode===200?0:1));req.on('error',()=>process.exit(1));"

CMD ["./bin/claude-anthropic-proxy.js"]

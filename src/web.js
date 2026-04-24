export const serviceMetadata = {
  ok: true,
  service: 'claude-anthropic-proxy',
  endpoints: ['/health', '/v1/messages', '/v1/models'],
  docs_path: '/docs',
};

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderLayout({ title, eyebrow, body }) {
  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #09101f;
        --panel: rgba(18, 25, 51, 0.94);
        --text: #ebf0ff;
        --muted: #94a3b8;
        --line: rgba(148, 163, 184, 0.2);
        --accent: #60a5fa;
        --danger: #f87171;
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: var(--text);
        background:
          radial-gradient(circle at top, rgba(59, 130, 246, 0.18), transparent 32%),
          linear-gradient(180deg, #050913 0%, var(--bg) 100%);
      }

      main {
        width: min(1120px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 48px 0 80px;
      }

      .shell,
      .panel {
        border: 1px solid var(--line);
        border-radius: 22px;
        background: var(--panel);
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.26);
      }

      .shell {
        padding: 32px;
        margin-bottom: 22px;
      }

      .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 12px;
        border-radius: 999px;
        font-size: 13px;
        color: #bfdbfe;
        background: rgba(96, 165, 250, 0.14);
        margin-bottom: 16px;
      }

      h1, h2, h3, p { margin-top: 0; }

      h1 {
        font-size: clamp(2rem, 4vw, 3.1rem);
        margin-bottom: 12px;
      }

      h2 {
        font-size: 1.3rem;
        margin-bottom: 12px;
      }

      p, li {
        line-height: 1.6;
      }

      .lede {
        max-width: 840px;
        color: #dbe4ff;
        margin-bottom: 0;
      }

      .grid,
      .split {
        display: grid;
        gap: 20px;
      }

      .grid {
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      }

      .split {
        grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
      }

      .panel {
        padding: 24px;
      }

      .muted {
        color: var(--muted);
      }

      .inline-code,
      .method {
        display: inline-block;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
        font-size: 0.9rem;
        padding: 5px 10px;
        border-radius: 999px;
        border: 1px solid var(--line);
        background: rgba(8, 12, 28, 0.9);
      }

      .endpoint-list {
        display: grid;
        gap: 12px;
        list-style: none;
        padding: 0;
        margin: 0;
      }

      .link-list {
        display: grid;
        gap: 10px;
        list-style: none;
        padding: 0;
        margin: 0;
      }

      .link-list a {
        color: #bfdbfe;
        word-break: break-all;
      }

      .endpoint-list li {
        border: 1px solid var(--line);
        border-radius: 16px;
        padding: 14px 16px;
        background: rgba(8, 12, 28, 0.55);
      }

      .endpoint-path {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
        font-size: 0.95rem;
      }

      form {
        display: grid;
        gap: 14px;
      }

      label {
        display: grid;
        gap: 8px;
        font-size: 14px;
      }

      input,
      select,
      button {
        font: inherit;
      }

      input,
      select {
        width: 100%;
        padding: 12px 14px;
        border-radius: 14px;
        border: 1px solid rgba(148, 163, 184, 0.28);
        background: rgba(8, 12, 28, 0.88);
        color: var(--text);
        outline: none;
      }

      input:focus,
      select:focus {
        border-color: rgba(96, 165, 250, 0.8);
        box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.15);
      }

      button {
        width: fit-content;
        border: none;
        border-radius: 14px;
        padding: 12px 16px;
        background: linear-gradient(180deg, #60a5fa 0%, #2563eb 100%);
        color: white;
        font-weight: 700;
        cursor: pointer;
      }

      button.secondary {
        background: rgba(148, 163, 184, 0.14);
        border: 1px solid var(--line);
      }

      .checkbox-row {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .checkbox-row input {
        width: auto;
      }

      pre {
        margin: 0;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
        padding: 16px;
        border-radius: 16px;
        border: 1px solid var(--line);
        background: rgba(8, 12, 28, 0.88);
      }

      .banner {
        padding: 14px 16px;
        border-radius: 16px;
        border: 1px solid var(--line);
        background: rgba(8, 12, 28, 0.55);
      }

      .error {
        border-color: rgba(248, 113, 113, 0.35);
        color: #fecaca;
        background: rgba(127, 29, 29, 0.18);
      }

      .topbar {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 18px;
      }
    </style>
  </head>
  <body>
    <main>
      <section class="shell">
        <div class="eyebrow">${escapeHtml(eyebrow)}</div>
        ${body}
      </section>
    </main>
  </body>
</html>`;
}

export function renderLoginPage({ errorMessage = '', loginPath = '/login' } = {}) {
  const errorBlock = errorMessage
    ? `<div class="banner error">${escapeHtml(errorMessage)}</div>`
    : '';

  return renderLayout({
    title: 'claude-anthropic-proxy login',
    eyebrow: 'Password-protected docs',
    body: `
      <h1>문서 페이지 로그인</h1>
      <p class="lede">
        <span class="inline-code">/docs</span> 문서 화면은 비밀번호로 보호됩니다. API 경로는 별도로 유지되고,
        로그인 후에는 엔드포인트 설명과 호출 예제만 보여줍니다.
      </p>
      <div class="split" style="margin-top: 24px;">
        <article class="panel">
          <h2>접속 방법</h2>
          <p class="muted">
            환경 변수 <span class="inline-code">WEB_PASSWORD</span> 또는
            <span class="inline-code">WEB_PASSWORD_HASH</span> 로 설정한 비밀번호를 입력하세요.
          </p>
          ${errorBlock}
          <form method="post" action="${escapeHtml(loginPath)}">
            <label>
              비밀번호
              <input type="password" name="password" autocomplete="current-password" required />
            </label>
            <button type="submit">로그인</button>
          </form>
        </article>
        <article class="panel">
          <h2>들어가면 보이는 것</h2>
          <ul class="endpoint-list">
            <li><span class="method">GET</span> <span class="endpoint-path">/health</span> 상태 확인</li>
            <li><span class="method">GET</span> <span class="endpoint-path">/v1/models</span> 모델 alias 확인</li>
            <li><span class="method">POST</span> <span class="endpoint-path">/v1/messages</span> Anthropic Messages API 호환 요청</li>
          </ul>
        </article>
      </div>
    `,
  });
}

export function renderHomePage(config) {
  const defaultAnthropicVersion = escapeHtml(config.defaultAnthropicVersion);
  const defaultModel = escapeHtml(config.claudeDefaultModel);
  const baseUrl = escapeHtml(`http://localhost:${config.port}`);
  const webDocsAuthEnabled = Boolean(config.webPassword || config.webPasswordHash);
  const apiKeyNote = config.proxyApiKey
    ? '이 서버는 PROXY_API_KEY 가 설정되어 있으니 x-api-key 헤더도 같이 보내야 합니다.'
    : 'PROXY_API_KEY 를 설정하지 않았다면 x-api-key 헤더는 생략해도 됩니다.';
  const authHeaderLine = config.proxyApiKey
    ? "  -H 'x-api-key: <your-proxy-api-key>' \\\n"
    : '';

  const healthExample = escapeHtml(`curl ${baseUrl}/health`);
  const modelsExample = escapeHtml(`curl ${baseUrl}/v1/models`);
  const messageExample = escapeHtml(`curl ${baseUrl}/v1/messages \\
  -H 'content-type: application/json' \\
  -H 'anthropic-version: ${config.defaultAnthropicVersion}' \\
${authHeaderLine}  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 512,
    "messages": [
      {"role": "user", "content": "안녕하세요"}
    ]
  }'`);
  const streamExample = escapeHtml(`curl -N ${baseUrl}/v1/messages \\
  -H 'content-type: application/json' \\
  -H 'anthropic-version: ${config.defaultAnthropicVersion}' \\
${authHeaderLine}  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 512,
    "stream": true,
    "messages": [
      {"role": "user", "content": "짧게 자기소개 해줘"}
    ]
  }'`);
  const claudeAuthSection = webDocsAuthEnabled
    ? `
      <section class="split" style="margin-top: 20px;">
        <article class="panel">
          <h2>Claude CLI 로그인</h2>
          <p class="muted">
            아래 버튼은 서버 호스트에서 <span class="inline-code">claude auth login</span> /
            <span class="inline-code">claude auth logout</span> 를 실행합니다.
            Claude Code 공식 문서 기준으로 인증은 브라우저 프롬프트를 통해 진행됩니다.
          </p>
          <div class="banner" style="margin-bottom: 16px;">
            <div id="claude-auth-summary"><strong>상태 확인 중...</strong></div>
            <div id="claude-auth-detail" class="muted" style="margin-top: 8px;">잠시만 기다려 주세요.</div>
          </div>
          <form id="claude-auth-login-form">
            <label>
              로그인 방식
              <select id="claude-auth-provider" name="provider">
                <option value="claudeai">Claude.ai</option>
                <option value="console">Anthropic Console</option>
              </select>
            </label>
            <label>
              이메일 (optional)
              <input id="claude-auth-email" name="email" placeholder="you@example.com" />
            </label>
            <label class="checkbox-row">
              <input id="claude-auth-sso" name="sso" type="checkbox" />
              <span>SSO 강제 사용</span>
            </label>
            <div style="display:flex; gap:12px; flex-wrap:wrap;">
              <button id="claude-auth-login-button" type="submit">Claude 로그인 시작</button>
              <button id="claude-auth-logout-button" type="button" class="secondary">Claude 로그아웃</button>
            </div>
          </form>
        </article>
        <article class="panel">
          <h2>실행 로그 / 링크</h2>
          <p class="muted">
            로그인 명령 출력이 여기에 표시됩니다. 브라우저가 자동으로 열리지 않으면
            여기 나온 안내 또는 URL을 따라가면 됩니다.
          </p>
          <div class="banner" style="margin-bottom: 16px;">
            <div><strong>브라우저가 서버에서 안 열리면:</strong></div>
            <div class="muted" style="margin-top: 8px;">아래 링크가 보이면 직접 열어서 인증을 이어가세요.</div>
            <ul id="claude-auth-links" class="link-list" style="margin-top: 12px;">
              <li class="muted">아직 감지된 로그인 링크가 없습니다.</li>
            </ul>
          </div>
          <pre id="claude-auth-operation">아직 실행된 Claude 인증 작업이 없습니다.</pre>
        </article>
      </section>
      <script>
        const claudeAuthSummary = document.getElementById('claude-auth-summary');
        const claudeAuthDetail = document.getElementById('claude-auth-detail');
        const claudeAuthOperation = document.getElementById('claude-auth-operation');
        const claudeAuthLoginForm = document.getElementById('claude-auth-login-form');
        const claudeAuthLoginButton = document.getElementById('claude-auth-login-button');
        const claudeAuthLogoutButton = document.getElementById('claude-auth-logout-button');
        const claudeAuthProvider = document.getElementById('claude-auth-provider');
        const claudeAuthEmail = document.getElementById('claude-auth-email');
        const claudeAuthSso = document.getElementById('claude-auth-sso');
        const claudeAuthLinks = document.getElementById('claude-auth-links');
        let claudeAuthPollTimer = null;

        async function fetchJson(url, options) {
          const response = await fetch(url, options);
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(payload.error || ('Request failed: ' + response.status));
          }
          return payload;
        }

        function renderStatus(status) {
          if (!status || !status.loggedIn) {
            claudeAuthSummary.innerHTML = '<strong>Claude CLI: 로그아웃 상태</strong>';
            claudeAuthDetail.textContent = '웹에서 Claude 로그인을 시작할 수 있습니다.';
            return;
          }

          claudeAuthSummary.innerHTML = '<strong>Claude CLI: 로그인됨</strong>';
          claudeAuthDetail.textContent =
            [status.email, status.authMethod, status.subscriptionType].filter(Boolean).join(' · ') || '인증 정보 확인됨';
        }

        function formatOperation(operation) {
          if (!operation || operation.status === 'idle') {
            return '아직 실행된 Claude 인증 작업이 없습니다.';
          }

          const lines = [
            'kind: ' + (operation.kind || '-'),
            'status: ' + (operation.status || '-'),
            'startedAt: ' + (operation.startedAt || '-'),
            'endedAt: ' + (operation.endedAt || '-'),
            'exitCode: ' + (operation.exitCode == null ? '-' : operation.exitCode),
          ];

          if (operation.options && Object.keys(operation.options).length) {
            lines.push('options: ' + JSON.stringify(operation.options));
          }

          if (operation.error) {
            lines.push('error: ' + operation.error);
          }

          if (operation.authStatus) {
            lines.push('authStatus: ' + JSON.stringify(operation.authStatus, null, 2));
          }

          if (operation.output) {
            lines.push('', operation.output);
          }

          return lines.join('\\n');
        }

        function renderOperationLinks(operation) {
          const links = Array.isArray(operation && operation.links) ? operation.links : [];
          claudeAuthLinks.replaceChildren();

          if (!links.length) {
            const empty = document.createElement('li');
            empty.className = 'muted';
            empty.textContent = '아직 감지된 로그인 링크가 없습니다.';
            claudeAuthLinks.appendChild(empty);
            return;
          }

          for (const url of links) {
            const item = document.createElement('li');
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.target = '_blank';
            anchor.rel = 'noreferrer noopener';
            anchor.textContent = url;
            item.appendChild(anchor);
            claudeAuthLinks.appendChild(item);
          }
        }

        function syncButtons(running) {
          claudeAuthLoginButton.disabled = running;
          claudeAuthLogoutButton.disabled = running;
          claudeAuthProvider.disabled = running;
          claudeAuthEmail.disabled = running;
          claudeAuthSso.disabled = running;
        }

        async function refreshClaudeAuthStatus() {
          try {
            const payload = await fetchJson('/claude-auth/status');
            renderStatus(payload.status);
          } catch (error) {
            claudeAuthSummary.innerHTML = '<strong>Claude CLI 상태 확인 실패</strong>';
            claudeAuthDetail.textContent = error.message;
          }
        }

        async function refreshClaudeAuthOperation() {
          try {
            const payload = await fetchJson('/claude-auth/operation');
            const operation = payload.operation;
            claudeAuthOperation.textContent = formatOperation(operation);
            renderOperationLinks(operation);
            const running = operation && operation.status === 'running';
            syncButtons(running);

            if (running) {
              if (!claudeAuthPollTimer) {
                claudeAuthPollTimer = setInterval(refreshClaudeAuthOperation, 1500);
              }
            } else if (claudeAuthPollTimer) {
              clearInterval(claudeAuthPollTimer);
              claudeAuthPollTimer = null;
              await refreshClaudeAuthStatus();
            }
          } catch (error) {
            claudeAuthOperation.textContent = error.message;
            syncButtons(false);
            if (claudeAuthPollTimer) {
              clearInterval(claudeAuthPollTimer);
              claudeAuthPollTimer = null;
            }
          }
        }

        claudeAuthLoginForm.addEventListener('submit', async (event) => {
          event.preventDefault();
          syncButtons(true);
          try {
            const payload = await fetchJson('/claude-auth/login', {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
              },
              body: JSON.stringify({
                provider: claudeAuthProvider.value,
                email: claudeAuthEmail.value.trim(),
                sso: claudeAuthSso.checked,
              }),
            });
            claudeAuthOperation.textContent = formatOperation(payload.operation);
            renderOperationLinks(payload.operation);
            await refreshClaudeAuthOperation();
          } catch (error) {
            claudeAuthOperation.textContent = error.message;
            syncButtons(false);
          }
        });

        claudeAuthLogoutButton.addEventListener('click', async () => {
          syncButtons(true);
          try {
            const payload = await fetchJson('/claude-auth/logout', {
              method: 'POST',
            });
            claudeAuthOperation.textContent = formatOperation(payload.operation);
            renderOperationLinks(payload.operation);
            await refreshClaudeAuthOperation();
          } catch (error) {
            claudeAuthOperation.textContent = error.message;
            syncButtons(false);
          }
        });

        refreshClaudeAuthStatus();
        refreshClaudeAuthOperation();
      </script>
    `
    : `
      <section class="panel" style="margin-top: 20px;">
        <h2>Claude CLI 웹 로그인</h2>
        <p class="muted">
          웹에서 Claude 로그인/로그아웃을 실행하려면 먼저 문서 화면 비밀번호를 켜세요.
          <span class="inline-code">WEB_PASSWORD</span> 또는
          <span class="inline-code">WEB_PASSWORD_HASH</span> 를 설정하면 이 기능이 활성화됩니다.
        </p>
      </section>
    `;

  return renderLayout({
    title: 'claude-anthropic-proxy docs',
    eyebrow: 'Authenticated endpoint guide',
    body: `
      <div class="topbar">
        <div>
          <h1>claude-anthropic-proxy</h1>
          <p class="lede">
            이 웹 화면은 간단한 문서 페이지입니다.
            실제 호출은 별도 API 경로로 진행하면 되고, 여기서는 엔드포인트와 기본 예제만 제공합니다.
          </p>
        </div>
        ${webDocsAuthEnabled
          ? `<form method="post" action="/logout"><button type="submit" class="secondary">로그아웃</button></form>`
          : ''}
      </div>

      <div class="grid">
        <article class="panel">
          <h2>기본 정보</h2>
          <p>기본 Anthropic 버전: <span class="inline-code">${defaultAnthropicVersion}</span></p>
          <p>기본 Claude 모델 alias: <span class="inline-code">${defaultModel}</span></p>
          <p class="muted">${escapeHtml(apiKeyNote)}</p>
        </article>
        <article class="panel">
          <h2>웹 인증</h2>
          <p>
            ${config.webPasswordHash
              ? '문서 화면은 해시된 비밀번호 검증 후 접근됩니다.'
              : config.webPassword
                ? '문서 화면은 비밀번호 로그인 후 접근됩니다.'
                : '현재 WEB_PASSWORD / WEB_PASSWORD_HASH 가 비어 있어 문서 화면은 바로 열립니다.'}
          </p>
          <p class="muted">API 사용 자체는 /v1/messages, /v1/models, /health 경로로 분리되어 있습니다.</p>
        </article>
      </div>

      <section class="panel" style="margin-top: 20px;">
        <h2>엔드포인트</h2>
        <ul class="endpoint-list">
          <li>
            <div><span class="method">GET</span> <span class="endpoint-path">/health</span></div>
            <div class="muted">서버 생존 여부 확인</div>
          </li>
          <li>
            <div><span class="method">GET</span> <span class="endpoint-path">/v1/models</span></div>
            <div class="muted">사용 가능한 Claude CLI alias 확인</div>
          </li>
          <li>
            <div><span class="method">POST</span> <span class="endpoint-path">/v1/messages</span></div>
            <div class="muted">Anthropic Messages API 호환 요청</div>
          </li>
        </ul>
      </section>

      <section class="split" style="margin-top: 20px;">
        <article class="panel">
          <h2>예제 1 · health</h2>
          <pre>${healthExample}</pre>
        </article>
        <article class="panel">
          <h2>예제 2 · models</h2>
          <pre>${modelsExample}</pre>
        </article>
      </section>

      <section class="split" style="margin-top: 20px;">
        <article class="panel">
          <h2>예제 3 · 일반 메시지 요청</h2>
          <pre>${messageExample}</pre>
        </article>
        <article class="panel">
          <h2>예제 4 · 스트리밍 요청</h2>
          <pre>${streamExample}</pre>
        </article>
      </section>

      ${claudeAuthSection}
    `,
  });
}

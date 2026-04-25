export const serviceMetadata = {
  ok: true,
  service: 'claude-anthropic-proxy',
  endpoints: ['/health', '/ready', '/metrics', '/v1/messages', '/v1/models'],
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

      button.danger {
        background: rgba(127, 29, 29, 0.18);
        border: 1px solid rgba(248, 113, 113, 0.38);
        color: #fecaca;
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

      .log-controls {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
      }

      .log-controls {
        margin-top: 14px;
      }

      .log-controls label {
        min-width: 180px;
        flex: 1 1 180px;
      }

      .log-list {
        display: grid;
        gap: 12px;
        max-height: 520px;
        overflow: auto;
        padding-right: 4px;
      }

      .log-entry {
        border: 1px solid var(--line);
        border-left: 4px solid var(--accent);
        border-radius: 16px;
        padding: 14px;
        background: rgba(8, 12, 28, 0.62);
      }

      .log-entry.level-warn { border-left-color: #fbbf24; }
      .log-entry.level-error { border-left-color: var(--danger); }

      .log-entry-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        margin-bottom: 8px;
      }

      .log-event {
        font-weight: 800;
      }

      .log-meta {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        color: var(--muted);
        font-size: 0.85rem;
      }

      .log-chip {
        display: inline-flex;
        align-items: center;
        border: 1px solid var(--line);
        border-radius: 999px;
        padding: 4px 8px;
        background: rgba(15, 23, 42, 0.85);
      }

      .log-details {
        margin-top: 10px;
        font-size: 0.86rem;
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
            <li><span class="method">GET</span> <span class="endpoint-path">/health</span> 프로세스 상태 확인</li>
            <li><span class="method">GET</span> <span class="endpoint-path">/ready</span> Redis 포함 readiness 확인</li>
            <li><span class="method">GET</span> <span class="endpoint-path">/metrics</span> JSON 운영 지표 확인</li>
            <li><span class="method">GET</span> <span class="endpoint-path">/v1/models</span> 모델 alias 확인</li>
            <li><span class="method">POST</span> <span class="endpoint-path">/v1/messages</span> Anthropic Messages API 호환 요청</li>
          </ul>
        </article>
      </div>
    `,
  });
}

function buildMessageExamples({ baseUrl, defaultAnthropicVersion, includeApiKeyHeader }) {
  const authHeaderLine = includeApiKeyHeader ? "  -H 'x-api-key: <your-proxy-api-key>' \\\n" : '';

  return {
    messageExample: `curl ${baseUrl}/v1/messages \\
  -H 'content-type: application/json' \\
  -H 'anthropic-version: ${defaultAnthropicVersion}' \\
${authHeaderLine}  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 512,
    "messages": [
      {"role": "user", "content": "안녕하세요"}
    ]
  }'`,
    streamExample: `curl -N ${baseUrl}/v1/messages \\
  -H 'content-type: application/json' \\
  -H 'anthropic-version: ${defaultAnthropicVersion}' \\
${authHeaderLine}  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 512,
    "stream": true,
    "messages": [
      {"role": "user", "content": "짧게 자기소개 해줘"}
    ]
  }'`,
  };
}

export function renderHomePage(config) {
  const defaultAnthropicVersion = escapeHtml(config.defaultAnthropicVersion);
  const defaultModel = escapeHtml(config.claudeDefaultModel);
  const baseUrl = `http://localhost:${config.port}`;
  const headerRequired = Boolean(config.proxyApiKey) || !config.allowMissingApiKeyHeader;
  const apiKeyNote = config.proxyApiKey
    ? '이 서버는 고정 x-api-key 가 설정되어 있으니 /v1/messages 호출 때 같은 값을 헤더로 보내야 합니다.'
    : headerRequired
      ? '현재 고정 x-api-key 는 없지만, 설정상 /v1/messages 호출 때 x-api-key 헤더 자체는 필요합니다.'
      : '아직 런타임 x-api-key 가 없어서 /v1/messages 호출은 헤더 없이도 들어옵니다.';
  const { messageExample, streamExample } = buildMessageExamples({
    baseUrl,
    defaultAnthropicVersion: config.defaultAnthropicVersion,
    includeApiKeyHeader: headerRequired,
  });

  return renderLayout({
    title: 'claude-anthropic-proxy docs',
    eyebrow: 'Authenticated endpoint guide',
    body: `
      <div class="topbar">
        <div>
          <h1>claude-anthropic-proxy</h1>
          <p class="lede">
            이 웹 화면은 간단한 운영 문서 페이지입니다.
            문서 비밀번호는 항상 필요하고, 로그인 후에는 엔드포인트 예제와 x-api-key, Claude CLI 로그인 상태를 같이 관리할 수 있습니다.
          </p>
        </div>
        <form method="post" action="/logout"><button type="submit" class="secondary">로그아웃</button></form>
      </div>

      <div class="grid">
        <article class="panel">
          <h2>기본 정보</h2>
          <p>기본 Anthropic 버전: <span class="inline-code">${defaultAnthropicVersion}</span></p>
          <p>기본 Claude 모델 alias: <span class="inline-code">${defaultModel}</span></p>
          <p class="muted" id="proxy-api-key-note">${escapeHtml(apiKeyNote)}</p>
        </article>
        <article class="panel">
          <h2>웹 인증</h2>
          <p>
            ${config.webPasswordHash
              ? '문서 화면은 해시된 비밀번호 검증 후 접근됩니다.'
              : '문서 화면은 비밀번호 로그인 후 접근됩니다.'}
          </p>
          <p class="muted">
            서버는 시작 전에 <span class="inline-code">WEB_PASSWORD</span> 또는
            <span class="inline-code">WEB_PASSWORD_HASH</span> 가 반드시 필요합니다.
          </p>
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
            <div class="muted">Anthropic Messages API 호환 요청. x-api-key 를 여기서 요구하도록 바꿀 수 있습니다.</div>
          </li>
          <li>
            <div><span class="method">GET</span> <span class="endpoint-path">/logs/recent</span></div>
            <div class="muted">문서 로그인 후 최근 프록시 로그와 동시성 상태 확인</div>
          </li>
        </ul>
      </section>

      <section class="split" style="margin-top: 20px;">
        <article class="panel">
          <h2>x-api-key 설정</h2>
          <p class="muted">
            문서 로그인 후 여기서 프록시가 검사할 <span class="inline-code">x-api-key</span> 값을 바꿀 수 있습니다.
            값은 상태 파일에 저장되고, 서버를 재시작해도 다시 불러옵니다.
          </p>
          <div class="banner" style="margin-bottom: 16px;">
            <div id="proxy-api-key-summary"><strong>상태 확인 중...</strong></div>
            <div id="proxy-api-key-detail" class="muted" style="margin-top: 8px;">잠시만 기다려 주세요.</div>
          </div>
          <form id="proxy-api-key-form">
            <label>
              새 x-api-key
              <input id="proxy-api-key-input" type="password" minlength="8" placeholder="8자 이상 입력" required />
            </label>
            <div style="display:flex; gap:12px; flex-wrap:wrap;">
              <button id="proxy-api-key-submit" type="submit">x-api-key 저장</button>
              <button id="proxy-api-key-reset" type="button" class="secondary">리셋</button>
            </div>
          </form>
        </article>
        <article class="panel">
          <h2>현재 키 / 전달 메모</h2>
          <p class="muted">
            문서 로그인 상태에서는 현재 x-api-key 원문을 볼 수 있습니다.
            리셋은 새 랜덤 키를 즉시 발급하고 이전 키는 바로 무효화합니다.
          </p>
          <pre id="proxy-api-key-preview">현재 설정된 x-api-key 가 없습니다.</pre>
        </article>
      </section>

      <section class="split" style="margin-top: 20px;">
        <article class="panel">
          <h2>예제 1 · health</h2>
          <pre>${escapeHtml(`curl ${baseUrl}/health`)}</pre>
        </article>
        <article class="panel">
          <h2>예제 2 · models</h2>
          <pre>${escapeHtml(`curl ${baseUrl}/v1/models`)}</pre>
        </article>
      </section>

      <section class="split" style="margin-top: 20px;">
        <article class="panel">
          <h2>예제 3 · 일반 메시지 요청</h2>
          <pre id="message-example">${escapeHtml(messageExample)}</pre>
        </article>
        <article class="panel">
          <h2>예제 4 · 스트리밍 요청</h2>
          <pre id="stream-example">${escapeHtml(streamExample)}</pre>
        </article>
      </section>

      <section class="panel" style="margin-top: 20px;">
        <div class="topbar">
          <div>
          <h2>최근 로그 / 동시성 상태</h2>
          <p class="muted">
            최근 요청, 인증, 키 변경, Claude 실행 이벤트를 한 화면에서 확인합니다.
            검색과 레벨 필터로 장애 원인을 빠르게 좁히고, 필요하면 JSON으로 내려받을 수 있습니다.
          </p>
          </div>
          <button id="recent-log-refresh" type="button" class="secondary">지금 새로고침</button>
        </div>
        <div class="banner">
            <div id="recent-log-summary"><strong>로그 상태 확인 중...</strong></div>
            <div class="muted" style="margin-top: 8px;">로그 새로고침 요청 자체는 로그에 남기지 않아 화면이 스스로를 오염시키지 않습니다.</div>
        </div>
        <div class="log-controls">
          <label>
            로그 검색
            <input id="recent-log-search" type="search" placeholder="event, requestId, statusCode 검색" />
          </label>
          <label>
            레벨 필터
            <select id="recent-log-level">
              <option value="all">전체</option>
              <option value="error">error</option>
              <option value="warn">warn</option>
              <option value="info">info</option>
            </select>
          </label>
          <label class="checkbox-row" style="flex: 0 1 auto; min-width: 210px;">
            <input id="recent-log-auto-refresh" type="checkbox" checked />
            <span>3초 자동 새로고침</span>
          </label>
          <button id="recent-log-export" type="button" class="secondary">JSON 저장</button>
          <button id="recent-log-clear" type="button" class="danger">로그 비우기</button>
        </div>
        <div id="recent-log-output" class="log-list" aria-live="polite" style="margin-top: 16px;">
          <div class="banner muted">아직 읽어온 로그가 없습니다.</div>
        </div>
      </section>

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
        const docsBaseUrl = ${JSON.stringify(baseUrl)};
        const docsAnthropicVersion = ${JSON.stringify(config.defaultAnthropicVersion)};
        const proxyApiKeySummary = document.getElementById('proxy-api-key-summary');
        const proxyApiKeyDetail = document.getElementById('proxy-api-key-detail');
        const proxyApiKeyPreview = document.getElementById('proxy-api-key-preview');
        const proxyApiKeyNote = document.getElementById('proxy-api-key-note');
        const proxyApiKeyForm = document.getElementById('proxy-api-key-form');
        const proxyApiKeyInput = document.getElementById('proxy-api-key-input');
        const proxyApiKeySubmit = document.getElementById('proxy-api-key-submit');
        const proxyApiKeyReset = document.getElementById('proxy-api-key-reset');
        const messageExamplePre = document.getElementById('message-example');
        const streamExamplePre = document.getElementById('stream-example');
        const recentLogSummary = document.getElementById('recent-log-summary');
        const recentLogOutput = document.getElementById('recent-log-output');
        const recentLogRefresh = document.getElementById('recent-log-refresh');
        const recentLogSearch = document.getElementById('recent-log-search');
        const recentLogLevel = document.getElementById('recent-log-level');
        const recentLogAutoRefresh = document.getElementById('recent-log-auto-refresh');
        const recentLogExport = document.getElementById('recent-log-export');
        const recentLogClear = document.getElementById('recent-log-clear');

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
        let recentLogTimer = null;
        let recentLogEntries = [];
        let recentLogPayload = { entries: [], messageExecution: {}, logStore: { healthy: true } };
        let proxyApiKeyConfigured = ${JSON.stringify(Boolean(config.proxyApiKey))};
        let proxyApiKeyHeaderRequired = ${JSON.stringify(headerRequired)};

        async function fetchJson(url, options) {
          const response = await fetch(url, options);
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(payload.error || ('Request failed: ' + response.status));
          }
          return payload;
        }

        function buildMessageExample(stream) {
          const lines = [
            'curl' + (stream ? ' -N ' : ' ') + docsBaseUrl + '/v1/messages \\\\',
            "  -H 'content-type: application/json' \\\\",
            "  -H 'anthropic-version: " + docsAnthropicVersion + "' \\\\",
          ];

          if (proxyApiKeyHeaderRequired) {
            lines.push("  -H 'x-api-key: <your-proxy-api-key>' \\\\");
          }

          lines.push("  -d '{");
          lines.push('    "model": "claude-sonnet-4-20250514",');
          lines.push('    "max_tokens": 512,');

          if (stream) {
            lines.push('    "stream": true,');
          }

          lines.push('    "messages": [');
          lines.push(
            stream
              ? '      {"role": "user", "content": "짧게 자기소개 해줘"}'
              : '      {"role": "user", "content": "안녕하세요"}',
          );
          lines.push('    ]');
          lines.push("  }'");

          return lines.join('\\n');
        }

        function renderProxyApiKeyState(settings, apiKey) {
          proxyApiKeyConfigured = Boolean(settings && settings.configured);
          proxyApiKeyHeaderRequired = Boolean(settings && settings.headerRequired);
          proxyApiKeySummary.innerHTML = proxyApiKeyConfigured
            ? '<strong>x-api-key: 설정됨</strong>'
            : '<strong>x-api-key: 아직 없음</strong>';
          proxyApiKeyDetail.textContent = proxyApiKeyConfigured
            ? [
                settings.maskedApiKey,
                settings.updatedAt ? new Date(settings.updatedAt).toLocaleString() : '',
              ]
                .filter(Boolean)
                .join(' · ')
            : proxyApiKeyHeaderRequired
              ? '현재 고정 x-api-key 는 없지만, 설정상 /v1/messages 요청에는 x-api-key 헤더가 필요합니다.'
              : '아직 런타임 x-api-key 가 없습니다. 저장하면 이후 /v1/messages 요청에 헤더가 필요합니다.';
          proxyApiKeyPreview.textContent = apiKey
            ? '현재 x-api-key\\n' + apiKey
            : proxyApiKeyConfigured
              ? '현재 마스킹된 값\\n' + (settings.maskedApiKey || '')
              : '현재 설정된 x-api-key 가 없습니다.';
          proxyApiKeyNote.textContent = proxyApiKeyConfigured
            ? '이 서버는 고정 x-api-key 가 설정되어 있으니 /v1/messages 호출 때 같은 값을 헤더로 보내야 합니다.'
            : proxyApiKeyHeaderRequired
              ? '현재 고정 x-api-key 는 없지만, 설정상 /v1/messages 호출 때 x-api-key 헤더 자체는 필요합니다.'
              : '아직 런타임 x-api-key 가 없어서 /v1/messages 호출은 헤더 없이도 들어옵니다.';
          messageExamplePre.textContent = buildMessageExample(false);
          streamExamplePre.textContent = buildMessageExample(true);
        }

        function syncProxyApiKeyButtons(disabled) {
          proxyApiKeyInput.disabled = disabled;
          proxyApiKeySubmit.disabled = disabled;
          proxyApiKeyReset.disabled = disabled;
        }

        async function refreshProxyApiKeyState() {
          try {
            const payload = await fetchJson('/proxy-api-key');
            renderProxyApiKeyState(payload.settings, payload.apiKey);
          } catch (error) {
            proxyApiKeySummary.innerHTML = '<strong>x-api-key 상태 확인 실패</strong>';
            proxyApiKeyDetail.textContent = error.message;
          }
        }

        function renderRecentLogSummary(payload, visibleEntries) {
          const stats = payload.messageExecution || {};
          const entries = Array.isArray(payload.entries) ? payload.entries : [];
          const errorCount = entries.filter((entry) => entry.level === 'error').length;
          const warnCount = entries.filter((entry) => entry.level === 'warn').length;
          const concurrencyLabel = stats.enabled
            ? (
              stats.backend === 'redis-global'
                ? ('global active ' + stats.globalActive + '/' + stats.maxConcurrent + ' · global queued ' + stats.globalQueued + ' · local queued ' + stats.queued + '/' + stats.maxQueued)
                : ('active ' + stats.active + '/' + stats.maxConcurrent + ' · queued ' + stats.queued + '/' + stats.maxQueued)
            )
            : 'unlimited';
          const status = payload.logStore || {};

          recentLogSummary.replaceChildren();
          const primary = document.createElement('div');
          const primaryStrong = document.createElement('strong');
          primaryStrong.textContent = '동시성 ';
          primary.append(primaryStrong, document.createTextNode(concurrencyLabel));

          const secondary = document.createElement('div');
          secondary.className = 'muted';
          secondary.style.marginTop = '8px';
          secondary.textContent = '표시 ' + visibleEntries.length + '/' + entries.length
            + ' · error ' + errorCount
            + ' · warn ' + warnCount
            + ' · 저장소 ' + (status.healthy ? '정상' : '오류');

          recentLogSummary.append(primary, secondary);
        }

        function createLogChip(text) {
          const chip = document.createElement('span');
          chip.className = 'log-chip';
          chip.textContent = text;
          return chip;
        }

        function createLogEntryElement(entry) {
          const item = document.createElement('article');
          const level = String(entry.level || 'info').toLowerCase();
          item.className = 'log-entry level-' + level;

          const header = document.createElement('div');
          header.className = 'log-entry-header';

          const title = document.createElement('div');
          title.className = 'log-event';
          title.textContent = entry.event || '(unknown event)';

          const meta = document.createElement('div');
          meta.className = 'log-meta';
          meta.append(
            createLogChip(level.toUpperCase()),
            createLogChip(entry.at ? new Date(entry.at).toLocaleString() : '-'),
          );

          if (entry.details && entry.details.statusCode) {
            meta.append(createLogChip('HTTP ' + entry.details.statusCode));
          }

          if (entry.details && entry.details.durationMs != null) {
            meta.append(createLogChip(entry.details.durationMs + 'ms'));
          }

          header.append(title, meta);
          item.appendChild(header);

          if (entry.details && Object.keys(entry.details).length) {
            const details = document.createElement('pre');
            details.className = 'log-details';
            details.textContent = JSON.stringify(entry.details, null, 2);
            item.appendChild(details);
          }

          return item;
        }

        function filteredRecentLogEntries() {
          const selectedLevel = recentLogLevel.value;
          const search = recentLogSearch.value.trim().toLowerCase();

          return recentLogEntries.filter((entry) => {
            if (selectedLevel !== 'all' && String(entry.level || '').toLowerCase() !== selectedLevel) {
              return false;
            }

            if (!search) {
              return true;
            }

            return [
              entry.at,
              entry.level,
              entry.event,
              JSON.stringify(entry.details || {}),
            ].join(' ').toLowerCase().includes(search);
          });
        }

        function renderRecentLogEntries(payload) {
          const visibleEntries = filteredRecentLogEntries();
          renderRecentLogSummary(payload, visibleEntries);
          recentLogOutput.replaceChildren();

          if (!visibleEntries.length) {
            const empty = document.createElement('div');
            empty.className = 'banner muted';
            empty.textContent = recentLogEntries.length
              ? '현재 필터에 맞는 로그가 없습니다.'
              : '아직 최근 로그가 없습니다.';
            recentLogOutput.appendChild(empty);
            return;
          }

          for (const entry of visibleEntries) {
            recentLogOutput.appendChild(createLogEntryElement(entry));
          }
        }

        function renderRecentLogs(payload) {
          recentLogPayload = payload;
          recentLogEntries = Array.isArray(payload.entries) ? payload.entries : [];
          renderRecentLogEntries(payload);
        }

        async function refreshRecentLogs() {
          try {
            const payload = await fetchJson('/logs/recent');
            renderRecentLogs(payload);
          } catch (error) {
            recentLogSummary.innerHTML = '<strong>최근 로그 확인 실패</strong>';
            recentLogOutput.textContent = error.message;
          }
        }

        function syncRecentLogTimer() {
          if (recentLogTimer) {
            clearInterval(recentLogTimer);
            recentLogTimer = null;
          }

          if (recentLogAutoRefresh.checked) {
            recentLogTimer = setInterval(refreshRecentLogs, 3000);
          }
        }

        proxyApiKeyForm.addEventListener('submit', async (event) => {
          event.preventDefault();
          syncProxyApiKeyButtons(true);
          try {
            const payload = await fetchJson('/proxy-api-key', {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
              },
              body: JSON.stringify({
                apiKey: proxyApiKeyInput.value.trim(),
              }),
            });
            proxyApiKeyInput.value = '';
            renderProxyApiKeyState(payload.settings, payload.apiKey);
          } catch (error) {
            proxyApiKeyPreview.textContent = error.message;
          } finally {
            syncProxyApiKeyButtons(false);
          }
        });

        recentLogRefresh.addEventListener('click', () => {
          void refreshRecentLogs();
        });

        recentLogSearch.addEventListener('input', () => {
          renderRecentLogEntries(recentLogPayload);
        });

        recentLogLevel.addEventListener('change', () => {
          renderRecentLogEntries(recentLogPayload);
        });

        recentLogAutoRefresh.addEventListener('change', syncRecentLogTimer);

        recentLogExport.addEventListener('click', () => {
          const data = JSON.stringify(filteredRecentLogEntries(), null, 2);
          const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = 'claude-proxy-recent-logs.json';
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
          setTimeout(() => URL.revokeObjectURL(url), 0);
        });

        recentLogClear.addEventListener('click', async () => {
          if (!confirm('최근 로그를 비울까요? 이 작업은 저장된 최근 로그 버퍼를 삭제합니다.')) {
            return;
          }

          recentLogClear.disabled = true;
          try {
            const payload = await fetchJson('/logs/recent', { method: 'DELETE' });
            renderRecentLogs(payload);
          } catch (error) {
            recentLogSummary.textContent = error.message;
          } finally {
            recentLogClear.disabled = false;
          }
        });

        proxyApiKeyReset.addEventListener('click', async () => {
          syncProxyApiKeyButtons(true);
          try {
            const payload = await fetchJson('/proxy-api-key', {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
              },
              body: JSON.stringify({
                reset: true,
              }),
            });
            proxyApiKeyInput.value = '';
            renderProxyApiKeyState(payload.settings, payload.apiKey);
          } catch (error) {
            proxyApiKeyPreview.textContent = error.message;
          } finally {
            syncProxyApiKeyButtons(false);
          }
        });

        function renderClaudeStatus(status) {
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

        function syncClaudeButtons(running) {
          claudeAuthLoginButton.disabled = running;
          claudeAuthLogoutButton.disabled = running;
          claudeAuthProvider.disabled = running;
          claudeAuthEmail.disabled = running;
          claudeAuthSso.disabled = running;
        }

        async function refreshClaudeAuthStatus() {
          try {
            const payload = await fetchJson('/claude-auth/status');
            renderClaudeStatus(payload.status);
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
            syncClaudeButtons(running);

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
            syncClaudeButtons(false);
            if (claudeAuthPollTimer) {
              clearInterval(claudeAuthPollTimer);
              claudeAuthPollTimer = null;
            }
          }
        }

        claudeAuthLoginForm.addEventListener('submit', async (event) => {
          event.preventDefault();
          syncClaudeButtons(true);
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
            syncClaudeButtons(false);
          }
        });

        claudeAuthLogoutButton.addEventListener('click', async () => {
          syncClaudeButtons(true);
          try {
            const payload = await fetchJson('/claude-auth/logout', {
              method: 'POST',
            });
            claudeAuthOperation.textContent = formatOperation(payload.operation);
            renderOperationLinks(payload.operation);
            await refreshClaudeAuthOperation();
          } catch (error) {
            claudeAuthOperation.textContent = error.message;
            syncClaudeButtons(false);
          }
        });

        refreshProxyApiKeyState();
        refreshRecentLogs();
        refreshClaudeAuthStatus();
        refreshClaudeAuthOperation();
        syncRecentLogTimer();
      </script>
    `,
  });
}

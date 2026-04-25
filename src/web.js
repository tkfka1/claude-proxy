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

function renderLayout({ title, eyebrow = '', body, pageClass = '' }) {
  const eyebrowBlock = eyebrow
    ? `<div class="eyebrow">${escapeHtml(eyebrow)}</div>`
    : '';

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #070806;
        --bg-soft: #0d120e;
        --panel: rgba(18, 23, 19, 0.78);
        --panel-strong: rgba(25, 31, 26, 0.92);
        --panel-soft: rgba(255, 255, 255, 0.045);
        --text: #f6f1e7;
        --muted: #a8b0a6;
        --line: rgba(246, 241, 231, 0.13);
        --line-strong: rgba(246, 241, 231, 0.24);
        --accent: #c8f56d;
        --accent-ink: #18210d;
        --amber: #f2b35d;
        --danger: #ff7a70;
        --warn: #f6c65f;
        --shadow: 0 24px 80px rgba(0, 0, 0, 0.42);
      }

      * { box-sizing: border-box; }

      html { min-height: 100%; }

      body {
        min-height: 100vh;
        margin: 0;
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", sans-serif;
        color: var(--text);
        background:
          radial-gradient(circle at 18% 12%, rgba(200, 245, 109, 0.15), transparent 26rem),
          radial-gradient(circle at 88% 8%, rgba(242, 179, 93, 0.13), transparent 22rem),
          linear-gradient(145deg, #050604 0%, #0c100d 54%, #11170f 100%);
        overflow-x: hidden;
      }

      body::before {
        content: "";
        position: fixed;
        inset: 0;
        pointer-events: none;
        background-image:
          linear-gradient(rgba(246, 241, 231, 0.035) 1px, transparent 1px),
          linear-gradient(90deg, rgba(246, 241, 231, 0.035) 1px, transparent 1px);
        background-size: 44px 44px;
        mask-image: linear-gradient(to bottom, black 0%, transparent 78%);
      }

      main {
        position: relative;
        z-index: 1;
        width: min(1180px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 40px 0 72px;
      }

      .login-page main {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 32px 0;
      }

      .shell,
      .panel,
      .stat-card {
        border: 1px solid var(--line);
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.075), rgba(255, 255, 255, 0.035));
        box-shadow: var(--shadow);
        backdrop-filter: blur(18px);
      }

      .shell {
        overflow: hidden;
        border-radius: 32px;
        padding: 32px;
      }

      .login-page .shell {
        width: 100%;
        min-height: 640px;
        display: grid;
        grid-template-columns: minmax(0, 1.1fr) minmax(360px, 420px);
        padding: 0;
      }

      .console-page .shell {
        display: grid;
        gap: 20px;
      }

      .eyebrow,
      .pill,
      .method,
      .inline-code,
      .log-chip {
        display: inline-flex;
        align-items: center;
        width: fit-content;
        border: 1px solid var(--line);
        border-radius: 999px;
        background: rgba(0, 0, 0, 0.24);
      }

      .eyebrow {
        gap: 8px;
        padding: 6px 11px;
        margin-bottom: 18px;
        color: var(--accent);
        font-size: 0.78rem;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      h1, h2, h3, p { margin-top: 0; }

      h1 {
        max-width: 820px;
        margin-bottom: 12px;
        font-size: clamp(2.3rem, 5vw, 5rem);
        line-height: 0.96;
        letter-spacing: -0.07em;
        text-wrap: balance;
        word-break: keep-all;
      }

      h2 {
        margin-bottom: 10px;
        font-size: 1.05rem;
        letter-spacing: -0.02em;
      }

      p, li {
        line-height: 1.58;
        word-break: keep-all;
      }

      a { color: var(--accent); }

      .lede {
        max-width: 680px;
        margin-bottom: 0;
        color: #d9ded1;
        font-size: 1.04rem;
      }

      .muted { color: var(--muted); }

      .wordmark {
        display: inline-flex;
        align-items: center;
        gap: 12px;
        color: var(--text);
        font-weight: 900;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .wordmark-mark {
        display: inline-grid;
        place-items: center;
        width: 42px;
        height: 42px;
        border: 1px solid rgba(200, 245, 109, 0.42);
        border-radius: 14px;
        background: var(--accent);
        color: var(--accent-ink);
        font-size: 0.82rem;
        box-shadow: 0 0 34px rgba(200, 245, 109, 0.24);
      }

      .login-hero {
        position: relative;
        min-height: 640px;
        padding: 52px;
        background:
          linear-gradient(135deg, rgba(200, 245, 109, 0.08), transparent 36%),
          linear-gradient(180deg, rgba(255, 255, 255, 0.035), transparent);
      }

      .login-hero::after {
        content: "";
        position: absolute;
        right: 42px;
        bottom: 36px;
        width: min(46vw, 500px);
        height: 180px;
        border: 1px solid rgba(200, 245, 109, 0.16);
        border-radius: 999px;
        background: radial-gradient(circle, rgba(200, 245, 109, 0.15), transparent 62%);
        filter: blur(2px);
        transform: rotate(-12deg);
        opacity: 0.62;
      }

      .hero-kicker {
        margin: 90px 0 14px;
        color: var(--amber);
        font-size: 0.8rem;
        font-weight: 900;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }

      .login-copy {
        max-width: 600px;
        color: #d9ded1;
        font-size: 1.18rem;
      }

      .login-signal {
        position: absolute;
        left: 52px;
        right: 52px;
        bottom: 46px;
        z-index: 1;
        display: grid;
        gap: 10px;
        max-width: 560px;
      }

      .signal-line {
        display: grid;
        grid-template-columns: 10px 120px 1fr;
        gap: 12px;
        align-items: center;
        padding: 12px 14px;
        border: 1px solid rgba(246, 241, 231, 0.1);
        border-radius: 16px;
        background: rgba(0, 0, 0, 0.28);
        color: #d9ded1;
      }

      .signal-line span {
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: var(--accent);
        box-shadow: 0 0 18px rgba(200, 245, 109, 0.7);
      }

      .signal-line strong { font-size: 0.86rem; }
      .signal-line em {
        color: var(--muted);
        font-style: normal;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .login-card {
        display: grid;
        align-items: center;
        padding: 42px;
        border-left: 1px solid var(--line);
        background: rgba(3, 5, 4, 0.44);
      }

      .login-card-inner {
        display: grid;
        gap: 16px;
      }

      .lock-icon {
        display: grid;
        place-items: center;
        width: 54px;
        height: 54px;
        border: 1px solid var(--line-strong);
        border-radius: 18px;
        color: var(--accent);
        background: rgba(200, 245, 109, 0.08);
        font-size: 1.3rem;
      }

      .login-footnote {
        margin: 2px 0 0;
        color: var(--muted);
        font-size: 0.88rem;
      }

      .grid,
      .split,
      .stats-grid {
        display: grid;
        gap: 16px;
      }

      .grid { grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); }
      .split { grid-template-columns: repeat(auto-fit, minmax(330px, 1fr)); }
      .stats-grid { grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); }

      .panel,
      .stat-card {
        border-radius: 24px;
        padding: 22px;
      }

      .stat-card {
        min-height: 118px;
        display: grid;
        align-content: space-between;
      }

      .stat-card span {
        color: var(--muted);
        font-size: 0.75rem;
        font-weight: 800;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }

      .stat-card strong {
        font-size: 1.15rem;
        word-break: break-word;
      }

      .inline-code,
      .method {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
        font-size: 0.85rem;
        padding: 4px 9px;
      }

      .method {
        color: var(--accent);
        border-color: rgba(200, 245, 109, 0.24);
      }

      .endpoint-list,
      .link-list {
        display: grid;
        gap: 10px;
        list-style: none;
        padding: 0;
        margin: 0;
      }

      .endpoint-list.compact {
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      }

      .endpoint-list li {
        display: grid;
        gap: 8px;
        border: 1px solid var(--line);
        border-radius: 18px;
        padding: 14px;
        background: rgba(0, 0, 0, 0.2);
      }

      .endpoint-path {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
        font-size: 0.94rem;
      }

      form { display: grid; gap: 14px; }

      label {
        display: grid;
        gap: 8px;
        color: #dfe5d8;
        font-size: 0.9rem;
        font-weight: 700;
      }

      input,
      select,
      button { font: inherit; }

      input,
      select {
        width: 100%;
        min-height: 48px;
        padding: 12px 14px;
        border-radius: 14px;
        border: 1px solid rgba(246, 241, 231, 0.16);
        background: rgba(0, 0, 0, 0.3);
        color: var(--text);
        outline: none;
      }

      input:focus,
      select:focus {
        border-color: rgba(200, 245, 109, 0.82);
        box-shadow: 0 0 0 4px rgba(200, 245, 109, 0.12);
      }

      button {
        min-height: 46px;
        width: fit-content;
        border: 1px solid rgba(200, 245, 109, 0.42);
        border-radius: 14px;
        padding: 12px 16px;
        background: linear-gradient(180deg, var(--accent) 0%, #9fdc45 100%);
        color: var(--accent-ink);
        font-weight: 900;
        cursor: pointer;
        transition: transform 140ms ease, border-color 140ms ease, background 140ms ease;
      }

      button:hover { transform: translateY(-1px); }
      button:disabled { opacity: 0.58; cursor: not-allowed; transform: none; }
      button.wide { width: 100%; }

      button.secondary {
        color: var(--text);
        background: rgba(255, 255, 255, 0.055);
        border-color: var(--line-strong);
      }

      button.danger {
        background: rgba(127, 29, 29, 0.18);
        border-color: rgba(255, 122, 112, 0.38);
        color: #ffd2cd;
      }

      .checkbox-row {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .checkbox-row input {
        width: auto;
        min-height: auto;
      }

      pre {
        margin: 0;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
        padding: 16px;
        border-radius: 18px;
        border: 1px solid var(--line);
        background: rgba(0, 0, 0, 0.34);
        color: #e5eadf;
      }

      .banner {
        padding: 14px 16px;
        border-radius: 18px;
        border: 1px solid var(--line);
        background: rgba(0, 0, 0, 0.22);
      }

      .error {
        border-color: rgba(255, 122, 112, 0.36);
        color: #ffd2cd;
        background: rgba(127, 29, 29, 0.18);
      }

      .topbar {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
      }

      .console-topbar {
        padding-bottom: 4px;
      }

      .top-actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        justify-content: flex-end;
      }

      .log-controls {
        display: flex;
        align-items: end;
        gap: 12px;
        flex-wrap: wrap;
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
        border-radius: 18px;
        padding: 14px;
        background: rgba(0, 0, 0, 0.24);
      }

      .log-entry.level-warn { border-color: rgba(246, 198, 95, 0.5); }
      .log-entry.level-error { border-color: rgba(255, 122, 112, 0.5); }

      .log-entry-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        margin-bottom: 8px;
      }

      .log-event { font-weight: 900; }

      .log-meta {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        color: var(--muted);
        font-size: 0.82rem;
      }

      .log-chip {
        padding: 4px 8px;
        background: rgba(0, 0, 0, 0.22);
      }

      .log-details {
        margin-top: 10px;
        font-size: 0.86rem;
      }

      @media (max-width: 860px) {
        .login-page .shell {
          grid-template-columns: 1fr;
        }

        .login-hero {
          min-height: auto;
          padding: 34px;
        }

        .hero-kicker { margin-top: 54px; }

        .login-signal {
          position: relative;
          left: auto;
          right: auto;
          bottom: auto;
          margin-top: 34px;
        }

        .login-card {
          border-left: 0;
          border-top: 1px solid var(--line);
          padding: 34px;
        }

        .topbar { flex-direction: column; }
        .top-actions { justify-content: flex-start; }
      }

      @media (max-width: 560px) {
        main { width: min(100% - 20px, 1180px); padding: 10px 0 28px; }
        .shell { border-radius: 22px; padding: 20px; }
        .login-page .shell { border-radius: 24px; }
        .login-hero, .login-card { padding: 24px; }
        h1 { font-size: clamp(2.05rem, 12vw, 3.2rem); }
        .split { grid-template-columns: 1fr; }
        .signal-line { grid-template-columns: 10px 1fr; }
        .signal-line em { grid-column: 2; }
      }
    </style>
  </head>
  <body class="${escapeHtml(pageClass)}">
    <main>
      <section class="shell">
        ${eyebrowBlock}
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
    title: 'Claude Proxy Console',
    pageClass: 'login-page',
    body: `
      <section class="login-hero">
        <div class="wordmark">
          <span class="wordmark-mark">CP</span>
          <span>Claude Proxy</span>
        </div>
        <p class="hero-kicker">Private AI gateway</p>
        <h1>Claude를<br />사내 API처럼.</h1>
        <p class="login-copy">키, 로그, 세션만 남긴 운영 콘솔. 들어가서 바로 조치합니다.</p>
        <div class="login-signal" aria-label="service signals">
          <div class="signal-line"><span></span><strong>Ingress</strong><em>claude-proxy.idc.hkyo.kr</em></div>
          <div class="signal-line"><span></span><strong>State</strong><em>Redis-backed runtime</em></div>
          <div class="signal-line"><span></span><strong>Logs</strong><em>Live request trail</em></div>
        </div>
      </section>
      <aside class="login-card">
        <div class="login-card-inner">
          <div class="lock-icon" aria-hidden="true">⌁</div>
          <div>
            <h2>운영자 로그인</h2>
            <p class="muted" style="margin-bottom: 0;">비밀번호만 입력하세요.</p>
          </div>
          ${errorBlock}
          <form method="post" action="${escapeHtml(loginPath)}">
            <label>
              Access password
              <input type="password" name="password" autocomplete="current-password" placeholder="••••••••" required />
            </label>
            <button type="submit" class="wide">Enter console</button>
          </form>
          <p class="login-footnote">로그인 후 proxy key · logs · Claude session 관리</p>
        </div>
      </aside>
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
    ? 'required'
    : headerRequired
      ? 'header required'
      : 'open until saved';
  const { messageExample, streamExample } = buildMessageExamples({
    baseUrl,
    defaultAnthropicVersion: config.defaultAnthropicVersion,
    includeApiKeyHeader: headerRequired,
  });

  return renderLayout({
    title: 'Claude Proxy Console',
    eyebrow: 'Operator console',
    pageClass: 'console-page',
    body: `
      <div class="topbar console-topbar">
        <div>
          <div class="wordmark" style="margin-bottom: 22px;">
            <span class="wordmark-mark">CP</span>
            <span>Claude Proxy</span>
          </div>
          <h1>Control room.</h1>
          <p class="lede">프록시 키, 라이브 로그, Claude 세션. 운영에 필요한 것만 남겼습니다.</p>
        </div>
        <form method="post" action="/logout" class="top-actions"><button type="submit" class="secondary">로그아웃</button></form>
      </div>

      <div class="stats-grid">
        <article class="stat-card">
          <span>Anthropic version</span>
          <strong>${defaultAnthropicVersion}</strong>
        </article>
        <article class="stat-card">
          <span>Default model</span>
          <strong>${defaultModel}</strong>
        </article>
        <article class="stat-card">
          <span>Proxy key</span>
          <strong id="proxy-api-key-note">${escapeHtml(apiKeyNote)}</strong>
        </article>
        <article class="stat-card">
          <span>Console auth</span>
          <strong>${config.webPasswordHash ? 'hashed password' : 'password'}</strong>
        </article>
      </div>

      <section class="panel">
        <div class="topbar">
          <div>
            <h2>Routes</h2>
            <p class="muted" style="margin-bottom: 0;">외부 연동에 필요한 경로만 표시합니다.</p>
          </div>
        </div>
        <ul class="endpoint-list compact" style="margin-top: 16px;">
          <li><div><span class="method">GET</span> <span class="endpoint-path">/health</span></div><div class="muted">liveness</div></li>
          <li><div><span class="method">GET</span> <span class="endpoint-path">/v1/models</span></div><div class="muted">model aliases</div></li>
          <li><div><span class="method">POST</span> <span class="endpoint-path">/v1/messages</span></div><div class="muted">Messages API</div></li>
          <li><div><span class="method">GET</span> <span class="endpoint-path">/logs/recent</span></div><div class="muted">recent events</div></li>
        </ul>
      </section>

      <section class="split">
        <article class="panel">
          <h2>Proxy key</h2>
          <p class="muted">저장하면 <span class="inline-code">/v1/messages</span>가 이 키만 받습니다.</p>
          <div class="banner" style="margin-bottom: 16px;">
            <div id="proxy-api-key-summary"><strong>상태 확인 중...</strong></div>
            <div id="proxy-api-key-detail" class="muted" style="margin-top: 8px;">잠시만 기다려 주세요.</div>
          </div>
          <form id="proxy-api-key-form">
            <label>
              새 x-api-key
              <input id="proxy-api-key-input" type="password" minlength="8" placeholder="8자 이상" required />
            </label>
            <div style="display:flex; gap:12px; flex-wrap:wrap;">
              <button id="proxy-api-key-submit" type="submit">키 저장</button>
              <button id="proxy-api-key-reset" type="button" class="secondary">새 키 발급</button>
            </div>
          </form>
        </article>
        <article class="panel">
          <h2>Current key</h2>
          <p class="muted">로그인한 운영자에게만 원문을 보여줍니다.</p>
          <pre id="proxy-api-key-preview">현재 설정된 x-api-key 가 없습니다.</pre>
        </article>
      </section>

      <section class="split">
        <article class="panel">
          <h2>Message</h2>
          <pre id="message-example">${escapeHtml(messageExample)}</pre>
        </article>
        <article class="panel">
          <h2>Stream</h2>
          <pre id="stream-example">${escapeHtml(streamExample)}</pre>
        </article>
      </section>

      <section class="panel">
        <div class="topbar">
          <div>
            <h2>Live logs</h2>
            <p class="muted" style="margin-bottom: 0;">검색, 레벨 필터, JSON 저장.</p>
          </div>
          <button id="recent-log-refresh" type="button" class="secondary">새로고침</button>
        </div>
        <div class="banner" style="margin-top: 16px;">
          <div id="recent-log-summary"><strong>로그 상태 확인 중...</strong></div>
        </div>
        <div class="log-controls">
          <label>
            로그 검색
            <input id="recent-log-search" type="search" placeholder="event, requestId, statusCode" />
          </label>
          <label>
            레벨
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

      <section class="split">
        <article class="panel">
          <h2>Claude session</h2>
          <p class="muted">서버의 Claude CLI 인증 상태입니다.</p>
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
              이메일 optional
              <input id="claude-auth-email" name="email" placeholder="you@example.com" />
            </label>
            <label class="checkbox-row">
              <input id="claude-auth-sso" name="sso" type="checkbox" />
              <span>SSO 강제 사용</span>
            </label>
            <div style="display:flex; gap:12px; flex-wrap:wrap;">
              <button id="claude-auth-login-button" type="submit">로그인 시작</button>
              <button id="claude-auth-logout-button" type="button" class="secondary">로그아웃</button>
            </div>
          </form>
        </article>
        <article class="panel">
          <h2>Auth output</h2>
          <p class="muted">감지된 링크가 있으면 여기서 바로 엽니다.</p>
          <div class="banner" style="margin-bottom: 16px;">
            <ul id="claude-auth-links" class="link-list">
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
              ? 'x-api-key 헤더가 필요합니다. 새 키를 저장하세요.'
              : '키를 저장하면 이후 요청부터 검사합니다.';
          proxyApiKeyPreview.textContent = apiKey
            ? '현재 x-api-key\\n' + apiKey
            : proxyApiKeyConfigured
              ? '현재 마스킹된 값\\n' + (settings.maskedApiKey || '')
              : '현재 설정된 x-api-key 가 없습니다.';
          proxyApiKeyNote.textContent = proxyApiKeyConfigured
            ? 'required'
            : proxyApiKeyHeaderRequired
              ? 'header required'
              : 'open until saved';
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

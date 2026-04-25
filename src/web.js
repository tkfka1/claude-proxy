import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';

export const serviceMetadata = {
  ok: true,
  service: 'claude-anthropic-proxy',
  endpoints: ['/health', '/ready', '/metrics', '/v1/messages', '/v1/models'],
  docs_path: '/docs',
};

export const faviconIco = readFileSync(new URL('./assets/favicon.ico', import.meta.url));

export const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="18" fill="#070806"/>
  <circle cx="49" cy="14" r="24" fill="#c8f56d" opacity=".18"/>
  <rect x="9" y="9" width="46" height="46" rx="14" fill="#0d120e" stroke="#c8f56d" stroke-width="3"/>
  <text x="32" y="40" text-anchor="middle" font-family="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="22" font-weight="900" letter-spacing="-1.5" fill="#f6f1e7">CP</text>
  <path d="M17 48h30" stroke="#c8f56d" stroke-width="3" stroke-linecap="round" opacity=".9"/>
</svg>
`;

export const manifestJson = {
  name: 'Claude Proxy',
  short_name: 'Claude Proxy',
  description: 'Claude Proxy',
  id: '/docs',
  start_url: '/docs',
  scope: '/',
  display: 'standalone',
  background_color: '#070806',
  theme_color: '#070806',
  icons: [
    {
      src: '/favicon.svg',
      sizes: 'any',
      type: 'image/svg+xml',
      purpose: 'any maskable',
    },
    {
      src: '/favicon.ico',
      sizes: '48x48',
      type: 'image/x-icon',
    },
  ],
};

const faviconVersion = crypto
  .createHash('sha256')
  .update(faviconIco)
  .update(faviconSvg)
  .digest('hex')
  .slice(0, 12);

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
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#070806" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="Claude Proxy" />
    <meta name="mobile-web-app-capable" content="yes" />
    <link rel="manifest" href="/manifest.webmanifest?v=${faviconVersion}" />
    <link rel="icon" href="/favicon.svg?v=${faviconVersion}" type="image/svg+xml" />
    <link rel="shortcut icon" href="/favicon.ico?v=${faviconVersion}" />
    <link rel="apple-touch-icon" href="/favicon.svg?v=${faviconVersion}" />
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

      html {
        min-height: 100%;
        scroll-behavior: smooth;
      }

      body {
        min-height: 100vh;
        margin: 0;
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", sans-serif;
        color: var(--text);
        -webkit-text-size-adjust: 100%;
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
        padding: max(40px, env(safe-area-inset-top)) 0 calc(72px + env(safe-area-inset-bottom));
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
        position: relative;
        width: 100%;
        min-height: 680px;
        display: grid;
        grid-template-columns: minmax(0, 1.15fr) minmax(360px, 430px);
        padding: 0;
      }

      .login-page .shell::before,
      .login-page .shell::after {
        content: "";
        position: absolute;
        pointer-events: none;
        border-radius: 999px;
        filter: blur(4px);
        opacity: 0.72;
      }

      .login-page .shell::before {
        inset: -140px auto auto -120px;
        width: 360px;
        height: 360px;
        background: radial-gradient(circle, rgba(200, 245, 109, 0.18), transparent 68%);
      }

      .login-page .shell::after {
        right: -120px;
        bottom: -150px;
        width: 420px;
        height: 420px;
        background: radial-gradient(circle, rgba(242, 179, 93, 0.14), transparent 66%);
      }

      .console-page .shell {
        display: grid;
        gap: 20px;
      }

      .eyebrow,
      .pill,
      .method,
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
        z-index: 1;
        min-height: 680px;
        padding: 52px;
        display: grid;
        align-content: space-between;
        gap: 32px;
        overflow: hidden;
        background:
          radial-gradient(circle at 20% 18%, rgba(200, 245, 109, 0.16), transparent 30%),
          radial-gradient(circle at 78% 72%, rgba(242, 179, 93, 0.12), transparent 28%),
          linear-gradient(135deg, rgba(200, 245, 109, 0.08), transparent 38%),
          linear-gradient(180deg, rgba(255, 255, 255, 0.04), transparent);
      }

      .login-hero::before {
        content: "";
        position: absolute;
        inset: 28px;
        border: 1px solid rgba(246, 241, 231, 0.075);
        border-radius: 28px;
        background-image:
          linear-gradient(rgba(200, 245, 109, 0.08) 1px, transparent 1px),
          linear-gradient(90deg, rgba(200, 245, 109, 0.08) 1px, transparent 1px);
        background-size: 54px 54px;
        mask-image: radial-gradient(circle at 48% 52%, black, transparent 74%);
        opacity: 0.42;
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

      .login-hero > * {
        position: relative;
        z-index: 1;
      }

      .hero-copy {
        display: grid;
        gap: 18px;
        margin-top: 24px;
      }

      .hero-badge,
      .status-chip {
        display: inline-flex;
        align-items: center;
        width: fit-content;
        gap: 8px;
        border: 1px solid rgba(200, 245, 109, 0.22);
        border-radius: 999px;
        background: rgba(0, 0, 0, 0.24);
        color: var(--accent);
        font-size: 0.78rem;
        font-weight: 900;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }

      .hero-badge { padding: 7px 12px; }

      .status-chip { padding: 7px 10px; }

      .pulse {
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: var(--accent);
        box-shadow: 0 0 0 7px rgba(200, 245, 109, 0.12);
      }

      .hero-title {
        margin: 0;
        max-width: 620px;
        font-size: clamp(3.8rem, 8vw, 7.2rem);
      }

      .proxy-visual {
        position: relative;
        min-height: 240px;
        margin: 8px 0;
      }

      .orbit-ring {
        position: absolute;
        inset: 50% auto auto 50%;
        border: 1px solid rgba(200, 245, 109, 0.18);
        border-radius: 999px;
        transform: translate(-50%, -50%) rotate(-10deg);
      }

      .ring-one {
        width: min(520px, 72vw);
        height: 166px;
      }

      .ring-two {
        width: min(390px, 58vw);
        height: 118px;
        transform: translate(-50%, -50%) rotate(13deg);
      }

      .core-mark {
        position: absolute;
        left: 50%;
        top: 50%;
        display: grid;
        place-items: center;
        width: 104px;
        height: 104px;
        border: 1px solid rgba(200, 245, 109, 0.46);
        border-radius: 32px;
        background:
          linear-gradient(180deg, rgba(200, 245, 109, 0.95), rgba(153, 213, 64, 0.95));
        color: var(--accent-ink);
        font-weight: 1000;
        letter-spacing: -0.06em;
        font-size: 1.55rem;
        box-shadow: 0 22px 70px rgba(200, 245, 109, 0.24);
        transform: translate(-50%, -50%) rotate(-6deg);
      }

      .node-card {
        position: absolute;
        min-width: 148px;
        padding: 13px 14px;
        border: 1px solid rgba(246, 241, 231, 0.12);
        border-radius: 18px;
        background: rgba(5, 8, 6, 0.72);
        box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
      }

      .node-card span,
      .hero-meta-grid span {
        display: block;
        margin-bottom: 5px;
        color: var(--muted);
        font-size: 0.68rem;
        font-weight: 900;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }

      .node-card strong,
      .hero-meta-grid strong {
        font-size: 0.94rem;
      }

      .node-api { left: 0; top: 22px; }
      .node-auth { right: 0; top: 66px; }
      .node-logs { left: 18%; bottom: 8px; }

      .hero-meta-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
      }

      .hero-meta-grid > div {
        min-height: 86px;
        padding: 15px;
        border: 1px solid rgba(246, 241, 231, 0.1);
        border-radius: 18px;
        background: rgba(0, 0, 0, 0.22);
      }

      .login-card {
        position: relative;
        z-index: 1;
        display: grid;
        align-items: center;
        padding: 42px;
        border-left: 1px solid var(--line);
        background:
          radial-gradient(circle at 80% 20%, rgba(200, 245, 109, 0.08), transparent 28%),
          rgba(3, 5, 4, 0.52);
      }

      .login-card-inner {
        display: grid;
        gap: 18px;
        padding: 26px;
        border: 1px solid rgba(246, 241, 231, 0.1);
        border-radius: 28px;
        background: rgba(0, 0, 0, 0.16);
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
      textarea,
      button { font: inherit; }

      input,
      select,
      textarea {
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
      select:focus,
      textarea:focus {
        border-color: rgba(200, 245, 109, 0.82);
        box-shadow: 0 0 0 4px rgba(200, 245, 109, 0.12);
      }

      textarea {
        min-height: 104px;
        resize: vertical;
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
        touch-action: manipulation;
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

      .mobile-quick-nav {
        display: none;
      }

      .anchor-target {
        scroll-margin-top: 96px;
      }

      .panel-actions,
      .button-row,
      .output-toolbar,
      .prompt-chips {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }

      .panel-actions {
        align-items: center;
        justify-content: flex-end;
      }

      .button-row {
        align-items: center;
      }

      .output-toolbar {
        align-items: center;
        justify-content: space-between;
        margin-top: 16px;
      }

      .output-toolbar + pre {
        margin-top: 10px;
      }

      .prompt-chips {
        margin: 10px 0 0;
      }

      .prompt-chip,
      .copy-button {
        min-height: 38px;
        padding: 8px 11px;
        color: var(--text);
        border-color: var(--line-strong);
        background: rgba(255, 255, 255, 0.055);
        font-size: 0.84rem;
      }

      .copy-feedback {
        min-height: 1.2em;
        color: var(--accent);
        font-size: 0.86rem;
        font-weight: 800;
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

      .system-status-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
        gap: 12px;
        margin-top: 16px;
      }

      .system-status-card {
        min-height: 112px;
        display: grid;
        gap: 8px;
        align-content: space-between;
        padding: 14px;
        border: 1px solid var(--line);
        border-radius: 18px;
        background: rgba(0, 0, 0, 0.2);
      }

      .system-status-card > span {
        color: var(--muted);
        font-size: 0.72rem;
        font-weight: 900;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }

      .system-status-value {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 1rem;
        font-weight: 950;
      }

      .status-dot {
        width: 10px;
        height: 10px;
        flex: 0 0 auto;
        border-radius: 999px;
        background: var(--muted);
        box-shadow: 0 0 0 6px rgba(168, 176, 166, 0.09);
      }

      .status-ok .status-dot {
        background: var(--accent);
        box-shadow: 0 0 0 6px rgba(200, 245, 109, 0.12);
      }

      .status-warn .status-dot {
        background: var(--warn);
        box-shadow: 0 0 0 6px rgba(246, 198, 95, 0.12);
      }

      .status-error .status-dot {
        background: var(--danger);
        box-shadow: 0 0 0 6px rgba(255, 122, 112, 0.12);
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

        .proxy-visual {
          min-height: 220px;
        }

        .login-card {
          border-left: 0;
          border-top: 1px solid var(--line);
          padding: 34px;
        }

        .hero-meta-grid {
          grid-template-columns: 1fr;
        }

        .topbar { flex-direction: column; }
        .top-actions { justify-content: flex-start; }
      }

      @media (max-width: 720px) {
        .console-page .shell {
          gap: 14px;
        }

        .mobile-quick-nav {
          position: sticky;
          top: max(8px, env(safe-area-inset-top));
          z-index: 4;
          display: flex;
          gap: 8px;
          margin: -4px -4px 2px;
          padding: 8px;
          overflow-x: auto;
          border: 1px solid var(--line);
          border-radius: 18px;
          background: rgba(6, 8, 6, 0.84);
          box-shadow: 0 16px 50px rgba(0, 0, 0, 0.28);
          backdrop-filter: blur(18px);
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
        }

        .mobile-quick-nav::-webkit-scrollbar {
          display: none;
        }

        .mobile-quick-nav a {
          flex: 0 0 auto;
          min-height: 38px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 8px 12px;
          border: 1px solid var(--line);
          border-radius: 999px;
          color: var(--text);
          background: rgba(255, 255, 255, 0.055);
          font-size: 0.84rem;
          font-weight: 900;
          text-decoration: none;
          white-space: nowrap;
        }

        .stats-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }

        .stat-card {
          min-height: 96px;
          padding: 16px;
        }

        .panel {
          padding: 18px;
        }

        .endpoint-list.compact {
          grid-template-columns: 1fr;
        }

        .split {
          grid-template-columns: 1fr;
        }

        .topbar,
        .panel-actions,
        .button-row,
        .output-toolbar,
        .log-controls {
          align-items: stretch;
          width: 100%;
        }

        .top-actions,
        .panel-actions,
        .button-row,
        .log-controls {
          justify-content: stretch;
        }

        .top-actions button,
        .panel-actions button,
        .button-row button,
        .log-controls button,
        form > button {
          width: 100%;
        }

        .prompt-chip,
        .copy-button {
          flex: 1 1 130px;
        }

        .log-controls label {
          min-width: 100%;
          flex-basis: 100%;
        }

        .log-list {
          max-height: 420px;
        }

        pre {
          max-height: 340px;
          padding: 14px;
          font-size: 0.84rem;
        }

        #call-test-output {
          max-height: 280px;
        }
      }

      @media (max-width: 560px) {
        main {
          width: min(100% - 20px, 1180px);
          padding: max(10px, env(safe-area-inset-top)) 0 calc(28px + env(safe-area-inset-bottom));
        }
        .shell { border-radius: 22px; padding: 20px; }
        .login-page .shell { border-radius: 24px; }
        .login-hero, .login-card { padding: 24px; }
        h1 { font-size: clamp(2.05rem, 12vw, 3.2rem); }
        .hero-title { font-size: clamp(3rem, 17vw, 4.5rem); }
        .proxy-visual { min-height: 260px; }
        .node-card { min-width: 132px; }
        .node-api { left: 0; top: 8px; }
        .node-auth { right: 0; top: 106px; }
        .node-logs { left: 0; bottom: 8px; }
        .wordmark { letter-spacing: 0.04em; }
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
        <div class="hero-copy">
          <div class="hero-badge"><span class="pulse" aria-hidden="true"></span>Console</div>
          <h1 class="hero-title">Claude Proxy</h1>
        </div>
        <div class="proxy-visual" aria-hidden="true">
          <div class="orbit-ring ring-one"></div>
          <div class="orbit-ring ring-two"></div>
          <div class="core-mark">CP</div>
          <div class="node-card node-api"><span>API</span><strong>/v1/messages</strong></div>
          <div class="node-card node-auth"><span>Auth</span><strong>Protected</strong></div>
          <div class="node-card node-logs"><span>Logs</span><strong>Live</strong></div>
        </div>
        <div class="hero-meta-grid" aria-hidden="true">
          <div><span>Mode</span><strong>Proxy</strong></div>
          <div><span>Access</span><strong>Login</strong></div>
          <div><span>Status</span><strong>Ready</strong></div>
        </div>
      </section>
      <aside class="login-card">
        <div class="login-card-inner">
          <div class="status-chip"><span class="pulse" aria-hidden="true"></span>Secure</div>
          <div class="lock-icon" aria-hidden="true">⌁</div>
          <div>
            <h2>Login</h2>
          </div>
          ${errorBlock}
          <form method="post" action="${escapeHtml(loginPath)}">
            <label>
              Password
              <input type="password" name="password" autocomplete="current-password" placeholder="••••••••" required />
            </label>
            <button type="submit" class="wide">Enter</button>
          </form>
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
    pageClass: 'console-page',
    body: `
      <div class="topbar console-topbar">
        <div>
          <div class="wordmark" style="margin-bottom: 22px;">
            <span class="wordmark-mark">CP</span>
            <span>Claude Proxy</span>
          </div>
          <h1>Claude Proxy</h1>
        </div>
        <form method="post" action="/logout" class="top-actions"><button type="submit" class="secondary">로그아웃</button></form>
      </div>

      <nav class="mobile-quick-nav" aria-label="빠른 이동">
        <a href="#system-status">상태</a>
        <a href="#proxy-key">키</a>
        <a href="#call-test">테스트</a>
        <a href="#logs">로그</a>
        <a href="#claude-auth">인증</a>
      </nav>

      <div id="overview" class="stats-grid">
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
          <strong id="web-password-note">${config.webPasswordHash ? 'hashed password' : 'password'}</strong>
        </article>
      </div>

      <section id="system-status" class="panel anchor-target">
        <div class="topbar">
          <div>
            <h2>System status</h2>
            <div class="muted">/ready 기준으로 Redis, 로그 저장소, 메시지 큐, Claude auth sync를 확인합니다.</div>
          </div>
          <button id="system-status-refresh" type="button" class="secondary">상태 새로고침</button>
        </div>
        <div class="banner" style="margin-top: 16px;">
          <div id="system-status-summary"><strong>시스템 상태 확인 중...</strong></div>
          <div id="system-status-detail" class="muted" style="margin-top: 8px;">잠시만 기다려 주세요.</div>
        </div>
        <div id="system-status-grid" class="system-status-grid" aria-live="polite">
          <article class="system-status-card status-warn">
            <span>Loading</span>
            <div class="system-status-value"><i class="status-dot"></i>확인 중</div>
            <div class="muted">초기 상태를 불러옵니다.</div>
          </article>
        </div>
      </section>

      <section id="routes" class="panel anchor-target">
        <div class="topbar">
          <div>
            <h2>Routes</h2>
          </div>
        </div>
        <ul class="endpoint-list compact" style="margin-top: 16px;">
          <li><div><span class="method">GET</span> <span class="endpoint-path">/health</span></div><div class="muted">liveness</div></li>
          <li><div><span class="method">GET</span> <span class="endpoint-path">/v1/models</span></div><div class="muted">model aliases</div></li>
          <li><div><span class="method">POST</span> <span class="endpoint-path">/v1/messages</span></div><div class="muted">Messages API</div></li>
          <li><div><span class="method">GET</span> <span class="endpoint-path">/logs/recent</span></div><div class="muted">recent events</div></li>
        </ul>
      </section>

      <section id="password" class="split anchor-target">
        <article class="panel">
          <h2>Console password</h2>
          <div class="banner" style="margin-bottom: 16px;">
            <div id="web-password-summary"><strong>상태 확인 중...</strong></div>
            <div id="web-password-detail" class="muted" style="margin-top: 8px;">잠시만 기다려 주세요.</div>
          </div>
        </article>
        <article class="panel">
          <h2>Change password</h2>
          <form id="web-password-form">
            <label>
              현재 비밀번호
              <input id="web-password-current" type="password" autocomplete="current-password" required />
            </label>
            <label>
              새 비밀번호
              <input id="web-password-next" type="password" autocomplete="new-password" placeholder="새 비밀번호" required />
            </label>
            <label>
              새 비밀번호 확인
              <input id="web-password-confirm" type="password" autocomplete="new-password" required />
            </label>
            <button id="web-password-submit" type="submit">비밀번호 변경</button>
          </form>
        </article>
      </section>

      <section id="proxy-key" class="split anchor-target">
        <article class="panel">
          <h2>Proxy key</h2>
          <div class="banner" style="margin-bottom: 16px;">
            <div id="proxy-api-key-summary"><strong>상태 확인 중...</strong></div>
            <div id="proxy-api-key-detail" class="muted" style="margin-top: 8px;">잠시만 기다려 주세요.</div>
          </div>
          <form id="proxy-api-key-form">
            <label>
              새 x-api-key
              <input id="proxy-api-key-input" type="password" minlength="8" placeholder="8자 이상" required />
            </label>
            <div class="button-row">
              <button id="proxy-api-key-submit" type="submit">키 저장</button>
              <button id="proxy-api-key-reset" type="button" class="secondary">새 키 발급</button>
            </div>
          </form>
        </article>
        <article class="panel">
          <h2>Current key</h2>
          <pre id="proxy-api-key-preview">현재 설정된 x-api-key 가 없습니다.</pre>
        </article>
      </section>

      <section id="examples" class="split anchor-target">
        <article class="panel">
          <div class="topbar">
            <h2>Message</h2>
            <button type="button" class="copy-button" data-copy-target="message-example">복사</button>
          </div>
          <pre id="message-example">${escapeHtml(messageExample)}</pre>
        </article>
        <article class="panel">
          <div class="topbar">
            <h2>Stream</h2>
            <button type="button" class="copy-button" data-copy-target="stream-example">복사</button>
          </div>
          <pre id="stream-example">${escapeHtml(streamExample)}</pre>
        </article>
      </section>

      <section id="call-test" class="panel anchor-target">
        <div class="topbar">
          <div>
            <h2>Call test</h2>
            <div class="muted">저장된 x-api-key로 /v1/messages를 실제 호출합니다.</div>
          </div>
          <div class="panel-actions">
            <button id="call-test-copy" type="button" class="copy-button" disabled>결과 복사</button>
            <button id="call-test-submit" type="submit" form="call-test-form">호출 테스트</button>
          </div>
        </div>
        <form id="call-test-form" style="margin-top: 16px;">
          <div class="split" style="align-items: end;">
            <label>
              Model
              <input id="call-test-model" value="claude-sonnet-4-20250514" required />
            </label>
            <label>
              Max tokens
              <input id="call-test-max-tokens" type="number" min="1" max="1024" value="32" required />
            </label>
          </div>
          <label>
            Prompt
            <textarea id="call-test-prompt" maxlength="2000" required>Reply only OK.</textarea>
          </label>
          <div class="prompt-chips" aria-label="프롬프트 빠른 선택">
            <button type="button" class="prompt-chip" data-prompt="Reply only OK.">OK</button>
            <button type="button" class="prompt-chip" data-prompt="현재 프록시 호출이 정상인지 한 문장으로 답해줘.">상태 확인</button>
            <button type="button" class="prompt-chip" data-prompt="다음 문장을 한국어 한 줄로 요약해줘: Claude Proxy 호출 테스트입니다.">한 줄 요약</button>
          </div>
        </form>
        <div class="output-toolbar">
          <span class="muted">Response</span>
          <span id="call-test-copy-status" class="copy-feedback" role="status" aria-live="polite"></span>
        </div>
        <pre id="call-test-output">아직 호출 테스트를 실행하지 않았습니다.</pre>
      </section>

      <section id="logs" class="panel anchor-target">
        <div class="topbar">
          <div>
            <h2>Live logs</h2>
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

      <section id="claude-auth" class="split anchor-target">
        <article class="panel">
          <h2>Claude session</h2>
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
            <div class="button-row">
              <button id="claude-auth-login-button" type="submit">로그인 시작</button>
              <button id="claude-auth-logout-button" type="button" class="secondary">로그아웃</button>
            </div>
          </form>
        </article>
        <article class="panel">
          <h2>Auth output</h2>
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
        const webPasswordNote = document.getElementById('web-password-note');
        const systemStatusSummary = document.getElementById('system-status-summary');
        const systemStatusDetail = document.getElementById('system-status-detail');
        const systemStatusGrid = document.getElementById('system-status-grid');
        const systemStatusRefresh = document.getElementById('system-status-refresh');
        const webPasswordSummary = document.getElementById('web-password-summary');
        const webPasswordDetail = document.getElementById('web-password-detail');
        const webPasswordForm = document.getElementById('web-password-form');
        const webPasswordCurrent = document.getElementById('web-password-current');
        const webPasswordNext = document.getElementById('web-password-next');
        const webPasswordConfirm = document.getElementById('web-password-confirm');
        const webPasswordSubmit = document.getElementById('web-password-submit');
        const proxyApiKeyForm = document.getElementById('proxy-api-key-form');
        const proxyApiKeyInput = document.getElementById('proxy-api-key-input');
        const proxyApiKeySubmit = document.getElementById('proxy-api-key-submit');
        const proxyApiKeyReset = document.getElementById('proxy-api-key-reset');
        const messageExamplePre = document.getElementById('message-example');
        const streamExamplePre = document.getElementById('stream-example');
        const copyButtons = Array.from(document.querySelectorAll('[data-copy-target]'));
        const callTestForm = document.getElementById('call-test-form');
        const callTestSubmit = document.getElementById('call-test-submit');
        const callTestCopy = document.getElementById('call-test-copy');
        const callTestCopyStatus = document.getElementById('call-test-copy-status');
        const callTestModel = document.getElementById('call-test-model');
        const callTestMaxTokens = document.getElementById('call-test-max-tokens');
        const callTestPrompt = document.getElementById('call-test-prompt');
        const callTestOutput = document.getElementById('call-test-output');
        const promptChips = Array.from(document.querySelectorAll('[data-prompt]'));
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
        let callTestCanCopy = false;
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

        async function fetchJsonWithStatus(url, options) {
          const response = await fetch(url, options);
          const payload = await response.json().catch(() => ({}));
          return { response, payload };
        }

        async function copyToClipboard(text) {
          if (!String(text || '').trim()) {
            throw new Error('복사할 내용이 없습니다.');
          }

          if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return;
          }

          const textarea = document.createElement('textarea');
          textarea.value = text;
          textarea.setAttribute('readonly', '');
          textarea.style.position = 'fixed';
          textarea.style.top = '-1000px';
          textarea.style.left = '-1000px';
          document.body.appendChild(textarea);
          textarea.select();

          try {
            if (!document.execCommand('copy')) {
              throw new Error('브라우저가 복사를 차단했습니다.');
            }
          } finally {
            textarea.remove();
          }
        }

        function showCopyState(button, statusNode, message) {
          const originalText = button.dataset.originalText || button.textContent;
          button.dataset.originalText = originalText;
          button.textContent = message;
          if (statusNode) {
            statusNode.textContent = message;
          }

          setTimeout(() => {
            button.textContent = originalText;
            if (statusNode && statusNode.textContent === message) {
              statusNode.textContent = '';
            }
          }, 1400);
        }

        async function copyElementText(target, button, statusNode) {
          try {
            await copyToClipboard(target.textContent || '');
            showCopyState(button, statusNode, '복사됨');
          } catch (error) {
            showCopyState(button, statusNode, error.message);
          }
        }

        function statusLevel(healthy, neutral = false) {
          if (neutral) return 'warn';
          return healthy ? 'ok' : 'error';
        }

        function statusLabel(healthy, neutralLabel = '사용 안 함') {
          if (healthy === null) return neutralLabel;
          return healthy ? '정상' : '확인 필요';
        }

        function appendSystemStatusCard({ label, value, detail, level }) {
          const card = document.createElement('article');
          card.className = 'system-status-card status-' + level;

          const labelNode = document.createElement('span');
          labelNode.textContent = label;

          const valueNode = document.createElement('div');
          valueNode.className = 'system-status-value';
          const dot = document.createElement('i');
          dot.className = 'status-dot';
          valueNode.append(dot, document.createTextNode(value));

          const detailNode = document.createElement('div');
          detailNode.className = 'muted';
          detailNode.textContent = detail || '-';

          card.append(labelNode, valueNode, detailNode);
          systemStatusGrid.appendChild(card);
        }

        function renderSystemStatus(payload, httpStatus) {
          payload = payload || {};
          const ready = Boolean(payload && payload.ok);
          const redis = payload && payload.redis;
          const logs = payload && payload.logStore || {};
          const execution = payload && payload.messageExecution || {};
          const authSync = payload && payload.claudeAuthSync || {};

          systemStatusSummary.innerHTML = ready
            ? '<strong>시스템 Ready</strong>'
            : '<strong>시스템 확인 필요</strong>';
          systemStatusDetail.textContent = [
            'HTTP ' + httpStatus,
            'state ' + (payload.stateBackend || '-'),
            'service ' + (payload.service || '-'),
          ].join(' · ');

          systemStatusGrid.replaceChildren();
          appendSystemStatusCard({
            label: 'Readiness',
            value: ready ? 'Ready' : 'Not ready',
            detail: ready ? '요청 처리 가능' : '하위 상태를 확인하세요',
            level: statusLevel(ready),
          });

          appendSystemStatusCard({
            label: 'Redis',
            value: redis ? statusLabel(Boolean(redis.healthy)) : statusLabel(null),
            detail: redis
              ? ['ping ' + (redis.ping || '-'), redis.ready ? 'ready' : 'not ready'].join(' · ')
              : 'file/local backend',
            level: redis ? statusLevel(Boolean(redis.healthy)) : statusLevel(false, true),
          });

          appendSystemStatusCard({
            label: 'Recent logs',
            value: statusLabel(logs.healthy !== false),
            detail: 'entries ' + (logs.entryCount ?? 0) + (logs.enabled ? ' · persistent' : ' · memory'),
            level: statusLevel(logs.healthy !== false),
          });

          appendSystemStatusCard({
            label: 'Message queue',
            value: execution.enabled === false ? 'unlimited' : ((execution.active ?? 0) + '/' + (execution.maxConcurrent ?? '-')),
            detail: 'queued ' + (execution.globalQueued ?? execution.queued ?? 0) + '/' + (execution.maxQueued ?? '-')
              + ' · ' + (execution.backend || '-'),
            level: statusLevel(execution.healthy !== false),
          });

          appendSystemStatusCard({
            label: 'Claude auth sync',
            value: authSync.enabled ? 'enabled' : 'disabled',
            detail: authSync.lastAppliedAt ? ('last applied ' + new Date(authSync.lastAppliedAt).toLocaleString()) : 'no shared snapshot applied yet',
            level: authSync.enabled ? 'ok' : 'warn',
          });
        }

        async function refreshSystemStatus() {
          systemStatusRefresh.disabled = true;
          try {
            const { response, payload } = await fetchJsonWithStatus('/ready');
            renderSystemStatus(payload, response.status);
          } catch (error) {
            systemStatusSummary.innerHTML = '<strong>시스템 상태 확인 실패</strong>';
            systemStatusDetail.textContent = error.message;
            systemStatusGrid.replaceChildren();
            appendSystemStatusCard({
              label: 'Readiness',
              value: '오류',
              detail: error.message,
              level: 'error',
            });
          } finally {
            systemStatusRefresh.disabled = false;
          }
        }

        function renderWebPasswordStatus(status) {
          const configured = Boolean(status && status.configured);
          const source = String(status && status.source || '');
          const sourceLabel = source === 'runtime'
            ? 'runtime'
            : source === 'env-hash'
              ? 'env hash'
              : 'env password';
          webPasswordSummary.innerHTML = configured
            ? '<strong>Console password: 설정됨</strong>'
            : '<strong>Console password: 아직 없음</strong>';
          webPasswordDetail.textContent = configured
            ? [
                sourceLabel,
                status.updatedAt ? new Date(status.updatedAt).toLocaleString() : '',
              ]
                .filter(Boolean)
                .join(' · ')
            : 'WEB_PASSWORD 또는 WEB_PASSWORD_HASH가 필요합니다.';
          webPasswordNote.textContent = sourceLabel;
        }

        function syncWebPasswordButtons(disabled) {
          webPasswordCurrent.disabled = disabled;
          webPasswordNext.disabled = disabled;
          webPasswordConfirm.disabled = disabled;
          webPasswordSubmit.disabled = disabled;
        }

        async function refreshWebPasswordStatus() {
          try {
            const payload = await fetchJson('/web-password');
            renderWebPasswordStatus(payload.status);
          } catch (error) {
            webPasswordSummary.innerHTML = '<strong>Console password 상태 확인 실패</strong>';
            webPasswordDetail.textContent = error.message;
          }
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

        function syncCallTest(disabled) {
          callTestSubmit.disabled = disabled;
          callTestCopy.disabled = disabled || !callTestCanCopy;
          callTestModel.disabled = disabled;
          callTestMaxTokens.disabled = disabled;
          callTestPrompt.disabled = disabled;
          for (const chip of promptChips) {
            chip.disabled = disabled;
          }
        }

        function setCallTestOutput(text, canCopy) {
          callTestCanCopy = Boolean(canCopy);
          callTestOutput.textContent = text;
          callTestCopy.disabled = !callTestCanCopy;
          callTestCopyStatus.textContent = '';
        }

        function extractCallTestText(response) {
          const content = response && Array.isArray(response.content) ? response.content : [];
          return content
            .filter((block) => block && block.type === 'text')
            .map((block) => String(block.text || ''))
            .join('\\n')
            .trim();
        }

        function formatCallTestResult(payload) {
          const request = payload.request || {};
          const lines = [
            (payload.ok ? 'OK' : 'FAILED') + ' · HTTP ' + payload.proxyStatus + ' · ' + payload.elapsedMs + 'ms',
            'requestId: ' + (payload.requestId || '-'),
            'proxyRequestId: ' + (payload.proxyRequestId || '-'),
            'model: ' + (request.model || '-'),
            'max_tokens: ' + (request.max_tokens || '-'),
          ];
          const text = extractCallTestText(payload.response);

          if (text) {
            lines.push('', text);
          } else if (payload.response) {
            lines.push('', JSON.stringify(payload.response, null, 2));
          }

          return lines.join('\\n');
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

        for (const button of copyButtons) {
          button.addEventListener('click', () => {
            const target = document.getElementById(button.dataset.copyTarget || '');
            if (!target) {
              showCopyState(button, null, '대상 없음');
              return;
            }
            void copyElementText(target, button, null);
          });
        }

        for (const chip of promptChips) {
          chip.addEventListener('click', () => {
            callTestPrompt.value = chip.dataset.prompt || '';
            callTestPrompt.focus();
          });
        }

        callTestCopy.addEventListener('click', () => {
          void copyElementText(callTestOutput, callTestCopy, callTestCopyStatus);
        });

        callTestForm.addEventListener('submit', async (event) => {
          event.preventDefault();
          syncCallTest(true);
          setCallTestOutput('호출 중...', false);
          try {
            const payload = await fetchJson('/call-test', {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
              },
              body: JSON.stringify({
                model: callTestModel.value.trim(),
                max_tokens: Number(callTestMaxTokens.value),
                prompt: callTestPrompt.value,
              }),
            });
            setCallTestOutput(formatCallTestResult(payload), true);
            await refreshRecentLogs();
          } catch (error) {
            setCallTestOutput(error.message, true);
          } finally {
            syncCallTest(false);
          }
        });

        webPasswordForm.addEventListener('submit', async (event) => {
          event.preventDefault();
          const nextPassword = webPasswordNext.value;
          if (nextPassword !== webPasswordConfirm.value) {
            webPasswordDetail.textContent = '새 비밀번호가 서로 다릅니다.';
            return;
          }

          syncWebPasswordButtons(true);
          try {
            const payload = await fetchJson('/web-password', {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
              },
              body: JSON.stringify({
                currentPassword: webPasswordCurrent.value,
                newPassword: nextPassword,
              }),
            });
            webPasswordCurrent.value = '';
            webPasswordNext.value = '';
            webPasswordConfirm.value = '';
            renderWebPasswordStatus(payload.status);
            webPasswordDetail.textContent = '변경 완료. 다시 로그인합니다.';
            setTimeout(() => {
              window.location.href = '/login';
            }, 800);
          } catch (error) {
            webPasswordDetail.textContent = error.message;
          } finally {
            syncWebPasswordButtons(false);
          }
        });

        recentLogRefresh.addEventListener('click', () => {
          void refreshRecentLogs();
        });

        systemStatusRefresh.addEventListener('click', () => {
          void refreshSystemStatus();
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

        refreshSystemStatus();
        refreshProxyApiKeyState();
        refreshWebPasswordStatus();
        refreshRecentLogs();
        refreshClaudeAuthStatus();
        refreshClaudeAuthOperation();
        syncRecentLogTimer();
      </script>
    `,
  });
}

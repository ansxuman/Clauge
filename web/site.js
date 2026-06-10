/* Clauge — site.js · v3
   Header/footer injection · scroll state · reveal-on-scroll
   Live 8-mode demo engine · OS-aware download wiring (GitHub releases) */

/* ── Site header — single source of truth, injected on every page ── */
(() => {
  const mount = document.getElementById('site-header');
  if (!mount) return;

  mount.classList.add('site-header');

  const path = (location.pathname || '/').replace(/\/$/, '');
  const file = path.split('/').pop() || '';
  const isHome = file === '' || file === 'index.html';
  const homeHref = isHome ? '#modes' : 'index.html#modes';
  const active = (f) => (file === f ? ' class="is-active"' : '');

  mount.innerHTML = `
    <div class="header-wrap">
      <a class="brand" href="./" aria-label="Clauge home">
        <img src="clauge-mark.svg" alt="" />
        <span>Clauge</span>
      </a>
      <nav class="site-nav" aria-label="Primary">
        <a href="${homeHref}">Modes</a>
        <a href="docs.html"${active('docs.html')}>Docs</a>
        <a href="pricing.html"${active('pricing.html')}>Pricing</a>
        <a href="changelog.html"${active('changelog.html')}>Changelog</a>
        <a href="enterprise.html"${active('enterprise.html')}>Enterprise</a>
        <a href="https://github.com/ansxuman/Clauge" target="_blank" rel="noopener" class="nav-gh">
          <i class="fa-brands fa-github" aria-hidden="true"></i> GitHub
          <span class="gh-stars" id="gh-stars" style="display: none" title="GitHub stars">
            <i class="fa-solid fa-star" aria-hidden="true"></i><span data-stars></span>
          </span>
        </a>
      </nav>
    </div>
  `;

  const onScroll = () => mount.classList.toggle('scrolled', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* star count badge — fetched from the repo API, 30-min localStorage cache */
  (() => {
    const badge = document.getElementById('gh-stars');
    if (!badge) return;
    const fmt = (n) => {
      if (n < 1000) return String(n);
      const k = Math.floor(n / 100) / 10;
      return (k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)) + 'k';
    };
    const show = (stars) => {
      if (!stars && stars !== 0) return;
      const out = badge.querySelector('[data-stars]');
      if (out) out.textContent = fmt(stars);
      badge.style.display = '';
    };
    const CACHE_KEY = 'clauge-gh-stars';
    const CACHE_TTL_MS = 30 * 60 * 1000;
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const { ts, stars } = JSON.parse(raw);
        if (Date.now() - ts < CACHE_TTL_MS) { show(stars); return; }
      }
    } catch {}
    fetch('https://api.github.com/repos/ansxuman/Clauge', {
      headers: { 'Accept': 'application/vnd.github+json' }
    })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(repo => {
        if (typeof repo.stargazers_count !== 'number') return;
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), stars: repo.stargazers_count })); } catch {}
        show(repo.stargazers_count);
      })
      .catch(() => { /* rate-limit / offline: badge stays hidden */ });
  })();
})();

/* ── Site footer — injected on every page ── */
(() => {
  const mount = document.getElementById('site-footer');
  if (!mount) return;

  mount.classList.add('site-footer');
  const year = new Date().getFullYear();

  mount.innerHTML = `
    <div class="footer-grid">
      <div>
        <a class="brand" href="./">
          <img src="clauge-mark.svg" alt="" />
          <span>Clauge</span>
        </a>
        <p class="footer-tag">An AI-powered super-app for developers. Eight modes, one keyboard, one shell.</p>
      </div>
      <div>
        <h6>Product</h6>
        <ul>
          <li><a href="index.html#modes">Modes</a></li>
          <li><a href="docs.html">Docs</a></li>
          <li><a href="pricing.html">Pricing</a></li>
          <li><a href="changelog.html">Changelog</a></li>
          <li><a href="enterprise.html">Enterprise</a></li>
        </ul>
      </div>
      <div>
        <h6>Open</h6>
        <ul>
          <li><a href="https://github.com/ansxuman/Clauge" target="_blank" rel="noopener">GitHub</a></li>
          <li><a href="https://github.com/ansxuman/Clauge/issues" target="_blank" rel="noopener">Report an issue</a></li>
          <li><a href="https://github.com/ansxuman/Clauge/releases" target="_blank" rel="noopener">Releases</a></li>
          <li><a href="https://github.com/ansxuman/Clauge/blob/main/LICENSE" target="_blank" rel="noopener">License</a></li>
        </ul>
      </div>
      <div>
        <h6>Legal</h6>
        <ul>
          <li><a href="terms.html">Terms of Service</a></li>
          <li><a href="privacy.html">Privacy Policy</a></li>
          <li><a href="mailto:support@clauge.in">Commercial licensing</a></li>
        </ul>
      </div>
    </div>
    <div class="footer-meta">
      <span>© ${year} CLAUGE.IN</span>
      <span>MADE FOR DEVELOPERS · macOS · WINDOWS · LINUX</span>
    </div>
  `;
})();

/* ── data-alpha-only: hide alpha surfaces unless CLAUGE_FLAGS.showAlpha ── */
(() => {
  const showAlpha = window.CLAUGE_FLAGS && window.CLAUGE_FLAGS.showAlpha === true;
  if (showAlpha) return;
  document.querySelectorAll('[data-alpha-only]').forEach(el => { el.style.display = 'none'; });
})();

/* ── reveal on scroll ── */
(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const reveals = Array.from(document.querySelectorAll('.reveal'));
  if (!reveals.length) return;
  if (reduceMotion || !('IntersectionObserver' in window)) {
    reveals.forEach(el => el.classList.add('is-in'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  reveals.forEach(el => io.observe(el));
})();

/* ═══════════════════════════════════════════════════════════════
   LIVE DEMO — 8-mode auto-cycling app window (homepage hero)
   ═══════════════════════════════════════════════════════════════ */
(() => {
  const stage = document.getElementById('demo');
  if (!stage) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (sel) => stage.querySelector(sel);

  const railHost = $('#demo-rail');
  const sideTitle = $('#demo-side-title');
  const sideList = $('#demo-side-list');
  const tabsHost = $('#demo-tabs');
  const canvas = $('#demo-canvas');
  const aiLog = $('#demo-ai-log');
  const aiPill = $('#demo-ai-pill');
  const aiText = $('#demo-ai-text');
  const modePill = $('#demo-mode-pill');
  const sbLeft = $('#demo-sb-left');
  const sbRight = $('#demo-sb-right');

  const MODES = {
    agent: {
      icon: 'fa-solid fa-robot', label: 'Agent',
      sideTitle: 'Sessions',
      side: [
        { g: 'CC', name: 'payments-refactor', meta: 'Claude · worktree', active: true },
        { g: 'CX', name: 'api-hardening', meta: 'Codex · running' },
        { g: 'GM', name: 'docs-sweep', meta: 'Gemini · idle' },
      ],
      tabs: ['payments-refactor', '+ new session'],
      canvas: `<pre class="code-block"><span class="c-d">$</span> claude <span class="c-s">"extract the retry logic into a shared helper"</span>
<span class="c-ok">●</span> Reading <span class="c-f">src/billing/charge.ts</span> …
<span class="c-ok">●</span> Created <span class="c-f">src/lib/retry.ts</span>
<span class="c-ok">●</span> Updated <span class="c-f">3 call sites</span> · tests passing <span class="c-ok">✓</span></pre>
        <div class="row-list">
          <div class="data-row"><b>worktree</b> agent/payments-refactor <span class="ok">isolated</span></div>
          <div class="data-row"><b>purpose</b> refactor · context pinned · <span class="ok">2 agents in parallel</span></div>
        </div>`,
      ai: { pill: 'AGENT', type: 'Run Codex on the API hardening task too.',
        log: ['Spawned <b>api-hardening</b> in its own worktree — running alongside Claude.'] },
      sbL: 'agent · 3 sessions', sbR: '2 RUNNING',
    },

    workspace: {
      icon: 'fa-solid fa-table-columns', label: 'Workspace',
      sideTitle: 'Boards',
      side: [
        { g: 'SP', name: 'sprint-12', meta: '14 cards · 3 coworkers', active: true },
        { g: 'BL', name: 'backlog', meta: '38 cards' },
      ],
      tabs: ['sprint-12', 'notes'],
      canvas: `<div class="kan">
          <div class="kan-col"><h6>To do</h6>
            <div class="kan-card">Rate-limit uploads<span class="kan-meta">GH #214 · imported</span></div>
            <div class="kan-card">Dark-mode emails<span class="kan-meta">unassigned</span></div></div>
          <div class="kan-col"><h6>In progress</h6>
            <div class="kan-card is-hot">Webhook retries<span class="kan-meta">⚡ coworker: claude</span></div></div>
          <div class="kan-col"><h6>Done</h6>
            <div class="kan-card">S3 lifecycle rules<span class="kan-meta">PR merged ✓</span></div></div>
        </div>`,
      ai: { pill: 'BOARD', type: 'Assign the webhook card to a coworker.',
        log: ['Claimed by <b>coworker/claude</b> — branch created, PR will link back to the card.'] },
      sbL: 'workspace · sprint-12', sbR: 'MCP CONNECTED',
    },

    rest: {
      icon: 'fa-solid fa-bolt', label: 'REST',
      sideTitle: 'Collections',
      side: [
        { g: 'PA', name: 'payments-api', meta: '12 requests · staging', active: true },
        { g: 'ID', name: 'identity', meta: '8 requests' },
      ],
      tabs: ['POST /charges', 'GET /customers'],
      canvas: `<pre class="code-block"><span class="c-k">POST</span> <span class="c-f">{{base}}/v1/charges</span>  <span class="c-d">· env: staging</span></pre>
        <div class="row-list">
          <div class="data-row"><span class="ok">201 Created</span> <b>142 ms</b> · 1.2 KB</div>
          <div class="data-row">{ <b>"id"</b>: "ch_3PqX…", <b>"status"</b>: <span class="ok">"succeeded"</span> }</div>
          <div class="data-row"><b>batch</b> 12/12 passed <span class="ok">✓</span> · AI runner</div>
        </div>`,
      ai: { pill: 'REST', type: 'Run the whole collection against staging.',
        log: ['Batch complete — <b>12/12</b> green. External agents can drive this too, over <code>MCP</code>.'] },
      sbL: 'rest · payments-api', sbR: '201 · 142MS',
    },

    sql: {
      icon: 'fa-solid fa-database', label: 'SQL',
      sideTitle: 'Connections',
      side: [
        { g: 'PG', name: 'prod-replica', meta: 'PostgreSQL · :5432', active: true },
        { g: 'CH', name: 'events', meta: 'ClickHouse · :8443' },
        { g: 'D1', name: 'edge-kv', meta: 'Cloudflare D1' },
      ],
      tabs: ['query.sql', 'schema'],
      canvas: `<pre class="code-block"><span class="ln">1</span><span class="c-k">SELECT</span> plan, <span class="c-f">count</span>(*) <span class="c-k">AS</span> users
<span class="ln">2</span><span class="c-k">FROM</span> accounts <span class="c-k">WHERE</span> last_seen &gt; <span class="c-f">now</span>() - <span class="c-s">'30 d'</span>::interval
<span class="ln">3</span><span class="c-k">GROUP BY</span> plan <span class="c-k">ORDER BY</span> users <span class="c-k">DESC</span>;</pre>
        <div class="row-list">
          <div class="data-row"><b>pro</b> · 4,218 <span class="c-d">│</span> <b>team</b> · 1,034 <span class="c-d">│</span> <b>free</b> · 28,402</div>
          <div class="data-row"><span class="ok">33,654 rows scanned</span> · 38 ms · schema-aware AI</div>
        </div>`,
      ai: { pill: 'SQL', type: 'Translate this to ClickHouse.',
        log: ['Rewrote with <code>toIntervalDay(30)</code> — dialect-checked against your <b>events</b> schema.'] },
      sbL: 'sql · prod-replica', sbR: '38MS · 3 ENGINES',
    },

    nosql: {
      icon: 'fa-solid fa-leaf', label: 'NoSQL',
      sideTitle: 'Stores',
      side: [
        { g: 'M', name: 'atlas', meta: 'MongoDB · :27017', active: true },
        { g: 'R', name: 'atlas-cache', meta: 'Redis · :6379' },
      ],
      tabs: ['users.find', 'redis console'],
      canvas: `<pre class="code-block">db.<span class="c-f">users</span>.<span class="c-f">aggregate</span>([
  { <span class="c-k">$match</span>: { plan: <span class="c-s">"pro"</span>, churn_risk: { <span class="c-k">$gt</span>: <span class="c-n">0.7</span> } } },
  { <span class="c-k">$sort</span>: { last_seen: <span class="c-n">1</span> } }
])</pre>
        <div class="row-list">
          <div class="data-row">{ <b>email</b>: "r.bauer@northwind.io", <b>risk</b>: <span class="warn">0.91</span> }</div>
          <div class="data-row">{ <b>email</b>: "m.tanaka@yamashita.co", <b>risk</b>: <span class="warn">0.84</span> }</div>
        </div>`,
      ai: { pill: 'NOSQL', type: 'Build a pipeline for at-risk Pro users.',
        log: ['Pipeline staged — <b>219</b> matches. Cached the cohort in <code>Redis</code> next door.'] },
      sbL: 'nosql · atlas', sbR: '219 DOCS',
    },

    ssh: {
      icon: 'fa-solid fa-terminal', label: 'SSH',
      sideTitle: 'Profiles',
      side: [
        { g: 'P', name: 'prod-01.clauge.in', meta: 'deploy@ · ed25519', active: true },
        { g: 'S', name: 'staging-eu', meta: 'root@ · keychain' },
      ],
      tabs: ['prod-01 · 1', 'prod-01 · 2'],
      canvas: `<pre class="code-block"><span class="c-ok">deploy@prod-01</span><span class="c-d">:~$</span> systemctl status api
<span class="c-ok">●</span> api.service — <span class="c-ok">active (running)</span> · 14 d uptime
<span class="c-d">mem 412 MB · cpu 2.1%</span>

<span class="c-ok">deploy@prod-01</span><span class="c-d">:~$</span> <span class="c-f">tail -f /var/log/api/error.log</span>
<span class="c-d">… ECONNRESET upstream redis (x3)</span></pre>`,
      ai: { pill: 'AI', type: 'Why is the API dropping Redis connections?',
        log: ['Found <code>timeout 0</code> in redis.conf — idle sockets never close. Fix is one line; <b>permission-gated</b>, so you approve it first.'] },
      sbL: 'ssh · prod-01 · tunnel :6379', sbR: 'AI: GATED',
    },

    explorer: {
      icon: 'fa-solid fa-folder-tree', label: 'Explorer',
      sideTitle: 'Storages',
      side: [
        { g: 'S3', name: 'prod-assets', meta: 's3 · eu-west-1', active: true },
        { g: 'AZ', name: 'cold-archive', meta: 'Azure Blob' },
        { g: 'FS', name: 'local', meta: '~/projects' },
      ],
      tabs: ['s3://prod-assets', 'sftp://backup'],
      canvas: `<div class="row-list" style="margin-top:0">
          <div class="data-row"><b>builds/</b> 1,204 objects · 8.2 GB</div>
          <div class="data-row"><b>invoices-2026/</b> 312 objects · 1.1 GB</div>
          <div class="data-row"><b>tmp-exports/</b> 96 objects · <span class="warn">14.6 GB</span></div>
          <div class="data-row"><span class="ok">⇄ drag-and-drop</span> local ↔ S3 ↔ SFTP · one window</div>
        </div>`,
      ai: { pill: 'SCAN', type: 'What is eating space in this bucket?',
        log: ['<code>tmp-exports/</code> holds <b>14.6 GB</b> of stale CSVs — nothing referenced in 90 days.'] },
      sbL: 'explorer · s3://prod-assets', sbR: '23.9 GB',
    },

    atlas: {
      icon: 'fa-solid fa-vector-square', label: 'Atlas',
      sideTitle: 'Layouts',
      side: [
        { g: 'OP', name: 'on-call', meta: '4 windows', active: true },
        { g: 'DV', name: 'deep-work', meta: '2 windows' },
      ],
      tabs: ['on-call canvas'],
      noAi: true,
      canvas: `<div class="atlas-stage">
          <div class="atlas-win" style="left:3%;top:6%;width:31%">
            <header><i class="fa-solid fa-terminal"></i> ssh · prod-01 <span class="aw-key">⌘6</span></header>
            <div class="aw-body">tail -f error.log<br><span class="c-d">… watching</span></div>
          </div>
          <div class="atlas-win" style="left:38%;top:14%;width:30%">
            <header><i class="fa-solid fa-database"></i> sql · postgres <span class="aw-key">⌘4</span></header>
            <div class="aw-body"><span class="c-d">"top customers q2" →</span><br>SELECT name, sum(total)…<br>Acme Corp <span class="c-ok">48,210</span><br>Northwind <span class="c-ok">31,904</span></div>
          </div>
          <div class="atlas-win" style="left:72%;top:4%;width:25%">
            <header><i class="fa-solid fa-bolt"></i> rest · staging <span class="aw-key">⌘3</span></header>
            <div class="aw-body">POST /v1/charges<br><span class="c-ok">201</span> · 142 ms</div>
          </div>
          <div class="atlas-win" style="left:16%;top:56%;width:33%">
            <header><i class="fa-solid fa-robot"></i> agent · hotfix <span class="aw-key">⌘1</span></header>
            <div class="aw-body"><span class="c-ok">●</span> patching retry logic<br>tests passing <span class="c-ok">✓</span></div>
          </div>
          <div class="atlas-hint"><b>●</b> drag the tiles · they snap</div>
        </div>`,
      sbL: 'atlas · on-call · pan / zoom', sbR: '4 LIVE TABS',
    },
  };

  /* matches the in-app mode order: Atlas sits right after Agent */
  const ORDER = ['agent', 'atlas', 'workspace', 'rest', 'sql', 'nosql', 'ssh', 'explorer'];
  let timers = [];
  let typeTimer = null;

  const clearScript = () => {
    timers.forEach(clearTimeout); timers = [];
    if (typeTimer) { clearInterval(typeTimer); typeTimer = null; }
  };

  /* build rail once — icon + text label so each mode is identifiable */
  railHost.innerHTML = ORDER.map(key => `
    <button type="button" class="rail-btn" data-mode="${key}" title="${MODES[key].label}" aria-label="${MODES[key].label} mode">
      <i class="${MODES[key].icon}" aria-hidden="true"></i>
      <span class="rail-label">${MODES[key].label}</span>
    </button>`).join('');

  const typeInto = (el, text, done) => {
    if (reduceMotion) { el.textContent = text; if (done) done(); return; }
    let i = 0;
    el.textContent = '';
    typeTimer = setInterval(() => {
      el.textContent = text.slice(0, ++i);
      if (i >= text.length) { clearInterval(typeTimer); typeTimer = null; if (done) done(); }
    }, 26);
  };

  /* draggable, snap-to-grid tiles for the Atlas canvas */
  const enableAtlasDrag = (stageEl) => {
    if (!stageEl) return;
    const SNAP = 18; /* matches the dot-grid background */
    let z = 5;
    stageEl.querySelectorAll('.atlas-win').forEach(tile => {
      tile.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        pausedUntil = Date.now() + 16000; /* don't cycle away mid-drag */
        const rect = tile.getBoundingClientRect();
        const host = stageEl.getBoundingClientRect();
        const dx = e.clientX - rect.left;
        const dy = e.clientY - rect.top;
        tile.style.zIndex = ++z;
        tile.style.left = (rect.left - host.left) + 'px';
        tile.style.top = (rect.top - host.top) + 'px';
        tile.style.right = 'auto';
        tile.style.bottom = 'auto';
        tile.classList.add('dragging');
        try { tile.setPointerCapture(e.pointerId); } catch {}
        const clamp = (v, max) => Math.max(0, Math.min(v, max));
        const move = (ev) => {
          tile.style.left = clamp(ev.clientX - host.left - dx, host.width - rect.width) + 'px';
          tile.style.top = clamp(ev.clientY - host.top - dy, host.height - rect.height) + 'px';
        };
        const up = () => {
          tile.classList.remove('dragging');
          const x = Math.round(parseFloat(tile.style.left) / SNAP) * SNAP;
          const y = Math.round(parseFloat(tile.style.top) / SNAP) * SNAP;
          tile.style.left = clamp(x, host.width - rect.width) + 'px';
          tile.style.top = clamp(y, host.height - rect.height) + 'px';
          tile.removeEventListener('pointermove', move);
          tile.removeEventListener('pointerup', up);
          tile.removeEventListener('pointercancel', up);
        };
        tile.addEventListener('pointermove', move);
        tile.addEventListener('pointerup', up);
        tile.addEventListener('pointercancel', up);
      });
    });
  };

  const setMode = (key) => {
    const def = MODES[key];
    if (!def) return;
    clearScript();

    stage.dataset.mode = key;
    railHost.querySelectorAll('.rail-btn').forEach(b =>
      b.classList.toggle('is-active', b.dataset.mode === key));

    if (modePill) modePill.textContent = def.label;
    if (sideTitle) sideTitle.textContent = def.sideTitle;
    if (sideList) sideList.innerHTML = def.side.map(s => `
      <li class="side-item${s.active ? ' is-active' : ''}">
        <span class="side-glyph">${s.g}</span>
        <span><span class="side-name">${s.name}</span><br><span class="side-meta">${s.meta}</span></span>
      </li>`).join('');
    if (tabsHost) tabsHost.innerHTML = def.tabs.map((t, i) => `
      <span class="demo-tab${i === 0 ? ' is-active' : ''}">${i === 0 ? '<span class="tab-dot"></span>' : ''}${t}</span>`).join('');
    if (canvas) canvas.innerHTML = def.canvas;
    if (sbLeft) sbLeft.textContent = def.sbL;
    if (sbRight) sbRight.innerHTML = `<span class="sb-chip">${def.sbR}</span>`;

    /* Atlas has no AI prompt — it's a spatial canvas with draggable tiles */
    stage.classList.toggle('no-ai', !!def.noAi);
    if (def.noAi) {
      if (canvas) enableAtlasDrag(canvas.querySelector('.atlas-stage'));
      return;
    }

    if (aiPill) aiPill.textContent = def.ai.pill;
    if (aiLog) aiLog.innerHTML = '';
    if (aiText) aiText.textContent = '';

    /* play: type the user ask, echo it, then drop AI replies */
    timers.push(setTimeout(() => {
      typeInto(aiText, def.ai.type, () => {
        timers.push(setTimeout(() => {
          aiText.textContent = '';
          const u = document.createElement('div');
          u.className = 'ai-bubble from-user';
          u.textContent = def.ai.type;
          aiLog.appendChild(u);
          def.ai.log.forEach((html, i) => {
            timers.push(setTimeout(() => {
              const b = document.createElement('div');
              b.className = 'ai-bubble';
              b.innerHTML = html;
              aiLog.appendChild(b);
            }, 600 + i * 700));
          });
        }, 350));
      });
    }, reduceMotion ? 0 : 500));
  };

  /* auto-cycle */
  let cycleIndex = 0;
  let cycleTimer = null;
  let pausedUntil = 0;
  const CYCLE_MS = 9000;

  const tick = () => {
    if (Date.now() < pausedUntil) return;
    cycleIndex = (cycleIndex + 1) % ORDER.length;
    setMode(ORDER[cycleIndex]);
  };
  const startCycle = () => { if (reduceMotion || cycleTimer) return; cycleTimer = setInterval(tick, CYCLE_MS); };
  const stopCycle = () => { if (cycleTimer) { clearInterval(cycleTimer); cycleTimer = null; } };

  railHost.addEventListener('click', (e) => {
    const btn = e.target.closest('.rail-btn');
    if (!btn) return;
    pausedUntil = Date.now() + 16000;
    cycleIndex = ORDER.indexOf(btn.dataset.mode);
    setMode(btn.dataset.mode);
  });

  stage.addEventListener('mouseenter', stopCycle);
  stage.addEventListener('mouseleave', startCycle);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopCycle(); else startCycle(); });

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) { if (e.isIntersecting) startCycle(); else stopCycle(); }
    }, { threshold: 0.25 });
    io.observe(stage);
  } else {
    startCycle();
  }

  setMode('agent');
})();

/* ═══════════════════════════════════════════════════════════════
   DOWNLOADS — ported from production app.js. DO NOT ALTER LOGIC.
   ═══════════════════════════════════════════════════════════════ */

/* ── Direct-download wiring: map every [data-os-arch] to the matching asset URL
      from the latest GitHub release. Falls back to releases/latest if no match. ── */
(() => {
  const slots = Array.from(document.querySelectorAll('[data-os-arch]'));
  if (!slots.length) return;

  /* slot key → predicate that matches an asset name. Tolerates Tauri 1.x
     names (no arch in filename) by accepting bare .dmg/.app.tar.gz for the
     mac slots when no arch hint is present. */
  const MATCHERS = {
    'mac-arm':       n => /\.(dmg|pkg)$/i.test(n) && /(aarch64|arm64)/i.test(n),
    'mac-intel':     n => /\.(dmg|pkg)$/i.test(n) && /(x64|x86_64|intel)/i.test(n),
    'win-x64':       n => /\.(exe|msi)$/i.test(n) && /(x64|x86_64)/i.test(n) && !/arm/i.test(n),
    'win-arm':       n => /\.(exe|msi)$/i.test(n) && /(aarch64|arm64)/i.test(n),
    'linux-arm-deb': n => /\.deb$/i.test(n) && /(aarch64|arm64)/i.test(n),
    'linux-x64-deb': n => /\.deb$/i.test(n) && /(amd64|x64|x86_64)/i.test(n),
    'linux-arm-rpm': n => /\.rpm$/i.test(n) && /(aarch64|arm64)/i.test(n),
    'linux-x64-rpm': n => /\.rpm$/i.test(n) && /(x64|x86_64)/i.test(n) && !/arm/i.test(n),
  };

  /* detect user's OS to fill the 'auto' slot */
  const detectOsArch = () => {
    const ua = (navigator.userAgent || '').toLowerCase();
    const isMac = ua.includes('mac');
    const isWin = ua.includes('windows');
    const isLinux = ua.includes('linux') && !ua.includes('android');
    if (isMac) {
      // Apple Silicon vs Intel: WebGL renderer heuristic
      let arch = 'arm';
      try {
        const gl = document.createElement('canvas').getContext('webgl');
        const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
        if (ext) {
          const r = (gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '').toLowerCase();
          if (r.includes('intel') && !r.includes('apple')) arch = 'intel';
        }
      } catch {}
      return arch === 'intel' ? 'mac-intel' : 'mac-arm';
    }
    if (isWin) return 'win-x64';
    if (isLinux) return 'linux-x64-deb';
    return 'mac-arm';
  };

  const REPO = 'ansxuman/Clauge';
  const showAlpha = window.CLAUGE_FLAGS && window.CLAUGE_FLAGS.showAlpha === true;

  /* showAlpha=true  → /releases?per_page=1  (most recent, alpha or stable)
     showAlpha=false → /releases/latest      (latest non-prerelease per GitHub) */
  const url = showAlpha
    ? `https://api.github.com/repos/${REPO}/releases?per_page=1`
    : `https://api.github.com/repos/${REPO}/releases/latest`;

  /* localStorage cache so we don't hit the 60-req/hr unauth API limit on
     every page load. Cached release survives 30 min; lets reloads skip the
     network entirely. */
  const CACHE_KEY = `clauge-rel-${showAlpha ? 'any' : 'stable'}`;
  const CACHE_TTL_MS = 30 * 60 * 1000;
  const cached = (() => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const { ts, release } = JSON.parse(raw);
      if (Date.now() - ts < CACHE_TTL_MS) return release;
    } catch {}
    return null;
  })();

  const applyRelease = (release) => {
    const assets = release.assets || [];

    /* slot → asset URL */
    const urls = {};
    for (const [slot, match] of Object.entries(MATCHERS)) {
      const hit = assets.find(a => match(a.name));
      if (hit) urls[slot] = hit.browser_download_url;
    }

    /* Resolve the 'auto' slot to whatever the detected OS slot is */
    const autoSlot = detectOsArch();
    urls['auto'] = urls[autoSlot] || urls['mac-arm'];

    slots.forEach(a => {
      const slot = a.dataset.osArch;
      const url = urls[slot];
      if (url) {
        a.href = url;
        a.removeAttribute('target');  /* same-tab download for direct binaries */
        a.setAttribute('download', '');
      }
      /* else: leave the static href alone — once stable ships builds for
         every OS, every slot will match and this branch is unreachable. */
    });
  };

  /* Use cache if fresh; otherwise hit the API. */
  if (cached) {
    applyRelease(cached);
    return;
  }

  fetch(url, { headers: { 'Accept': 'application/vnd.github+json' } })
    .then(r => r.ok ? r.json() : Promise.reject(r.status))
    .then(payload => {
      const release = Array.isArray(payload) ? payload[0] : payload;
      if (!release) return;
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), release }));
      } catch {}
      applyRelease(release);
    })
    .catch(() => { /* rate-limit / offline: leave static hrefs in place */ });
})();

/* ── Total download count badge on the hero CTA.
      Sums download_count across every asset of every release.
      Rounded down to the nearest 100: 9,031 → "9k", 9,100 → "9.1k". ── */
(() => {
  const badge = document.getElementById('dl-count');
  if (!badge) return;

  const fmt = (n) => {
    if (n < 1000) return String(n);
    const k = Math.floor(n / 100) / 10;
    return (k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)) + 'k';
  };

  const show = (total) => {
    if (!total) return; /* zero / missing: keep the badge hidden */
    const out = badge.querySelector('[data-count]');
    if (out) out.textContent = fmt(total);
    badge.style.display = '';
  };

  /* same 30-min localStorage cache strategy as the release-asset wiring */
  const CACHE_KEY = 'clauge-dl-total';
  const CACHE_TTL_MS = 30 * 60 * 1000;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const { ts, total } = JSON.parse(raw);
      if (Date.now() - ts < CACHE_TTL_MS) { show(total); return; }
    }
  } catch {}

  fetch('https://api.github.com/repos/ansxuman/Clauge/releases?per_page=100', {
    headers: { 'Accept': 'application/vnd.github+json' }
  })
    .then(r => r.ok ? r.json() : Promise.reject(r.status))
    .then(releases => {
      if (!Array.isArray(releases)) return;
      const total = releases.reduce((sum, rel) =>
        sum + (rel.assets || []).reduce((s, a) => s + (a.download_count || 0), 0), 0);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), total })); } catch {}
      show(total);
    })
    .catch(() => { /* rate-limit / offline: badge stays hidden */ });
})();

/* ── OS-aware downloads: customize hero CTA + bottom card based on detected OS ── */
(() => {
  const card = document.getElementById('dl-primary');
  const cta  = document.getElementById('cta-download');
  if (!card && !cta) return;
  const ua = (navigator.userAgent || '').toLowerCase();
  const isMac   = ua.includes('mac');
  const isWin   = ua.includes('windows');
  const isLinux = ua.includes('linux') && !ua.includes('android');

  /* Apple Silicon vs Intel for Mac via WebGL renderer heuristic */
  let macArch = 'arm';
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) {
      const r = (gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '').toLowerCase();
      if (r.includes('intel') && !r.includes('apple')) macArch = 'intel';
    }
  } catch {}

  /* Compute the per-OS plan, then apply to both hero CTA and bottom download card. */
  /* altKind picks which alt slot is visible:
       'intel'   → single anchor (Mac Intel/Apple Silicon swap, or Mac/Win single-build)
       'arm-pkg' → multi-chip span (.deb + .rpm) for Linux ARM
       'win-arm' → single anchor for Windows ARM64
       null      → hide all alt slots */
  let plan;
  if (isWin) {
    plan = {
      headline:   'Get Clauge for Windows.',
      iconClass:  'fa-brands fa-windows',
      btn1: { osArch: 'win-x64', label: 'Download for Windows', archChip: 'x64' },
      btn2: null,
      altKind: 'win-arm',
    };
  } else if (isLinux) {
    plan = {
      headline:   'Get Clauge for Linux.',
      iconClass:  'fa-brands fa-linux',
      btn1: { osArch: 'linux-x64-deb', label: 'Download for Linux', archChip: 'x64 · .deb' },
      btn2: { osArch: 'linux-x64-rpm', label: 'Download for Linux', archChip: 'x64 · .rpm' },
      altKind: 'arm-pkg',
    };
  } else if (macArch === 'intel') {
    plan = {
      headline:   'Get Clauge for Mac.',
      iconClass:  'fa-brands fa-apple',
      btn1: { osArch: 'mac-intel', label: 'Download for Mac', archChip: 'Intel' },
      btn2: null,
      altKind: 'intel',
      altHtml: 'On Apple Silicon? <u>Get the Apple Silicon build</u>',
      altOsArch: 'mac-arm',
    };
  } else {
    plan = {
      headline:   'Get Clauge for Mac.',
      iconClass:  'fa-brands fa-apple',
      btn1: { osArch: 'mac-arm', label: 'Download for Mac', archChip: 'Apple Silicon' },
      btn2: null,
      altKind: 'intel',
      altHtml: 'On Intel? <u>Get the Intel build</u>',
      altOsArch: 'mac-intel',
    };
  }

  const applyPlan = (refs) => {
    if (refs.headline && plan.headline) refs.headline.textContent = plan.headline;
    if (refs.btn1) {
      refs.btn1.setAttribute('data-os-arch', plan.btn1.osArch);
      if (refs.icon1)  refs.icon1.className  = plan.iconClass;
      if (refs.label1) refs.label1.textContent = plan.btn1.label;
      if (refs.arch1)  refs.arch1.textContent  = plan.btn1.archChip;
    }
    if (refs.btn2) {
      if (plan.btn2) {
        refs.btn2.style.display = '';
        refs.btn2.setAttribute('data-os-arch', plan.btn2.osArch);
        if (refs.icon2)  refs.icon2.className  = plan.iconClass;
        if (refs.label2) refs.label2.textContent = plan.btn2.label;
        if (refs.arch2)  refs.arch2.textContent  = plan.btn2.archChip;
      } else {
        refs.btn2.style.display = 'none';
      }
    }
    /* alt slots — three flavors. Show whichever matches plan.altKind, hide the others. */
    const show = (el, on) => { if (el) el.style.display = on ? '' : 'none'; };
    show(refs.altIntel,  plan.altKind === 'intel');
    show(refs.altArmPkg, plan.altKind === 'arm-pkg');
    show(refs.altWinArm, plan.altKind === 'win-arm');
    if (plan.altKind === 'intel' && refs.altIntel) {
      refs.altIntel.setAttribute('data-os-arch', plan.altOsArch);
      if (refs.altIntelLabel) refs.altIntelLabel.innerHTML = plan.altHtml;
    }
  };

  /* hero CTA surface */
  if (cta) {
    applyPlan({
      headline: null,
      btn1:    cta,
      icon1:   document.querySelector('[data-cta-icon]'),
      label1:  document.querySelector('[data-cta-label]'),
      arch1:   document.querySelector('[data-cta-arch]'),
      btn2:    document.getElementById('cta-download-2'),
      icon2:   document.querySelector('[data-cta-icon-2]'),
      label2:  document.querySelector('[data-cta-label-2]'),
      arch2:   document.querySelector('[data-cta-arch-2]'),
      altIntel:      document.getElementById('intel-link'),
      altIntelLabel: document.querySelector('[data-cta-alt-label]'),
      altArmPkg:     document.getElementById('intel-link-arm'),
      altWinArm:     document.getElementById('intel-link-win-arm'),
    });
  }

  /* bottom download card surface */
  if (card) {
    applyPlan({
      headline: document.querySelector('[data-dl-headline]'),
      btn1:    card,
      icon1:   document.querySelector('[data-dl-icon]'),
      label1:  document.querySelector('[data-dl-label]'),
      arch1:   document.querySelector('[data-dl-arch]'),
      btn2:    document.getElementById('dl-primary-2'),
      icon2:   document.querySelector('[data-dl-icon-2]'),
      label2:  document.querySelector('[data-dl-label-2]'),
      arch2:   document.querySelector('[data-dl-arch-2]'),
      altIntel:      document.getElementById('dl-alt'),
      altIntelLabel: document.querySelector('[data-dl-alt-label]'),
      altArmPkg:     document.getElementById('dl-alt-arm'),
      altWinArm:     document.getElementById('dl-alt-win-arm'),
    });
  }
})();

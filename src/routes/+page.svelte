<script>
  import { onMount } from "svelte";
  import { invoke, Channel } from "@tauri-apps/api/core";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import "@xterm/xterm/css/xterm.css";

  let profiles = $state([]);
  let activeProfile = $state(null);
  let showModal = $state(false);
  let showSettings = $state(false);
  let settingsTab = $state('settings');
  let claudePlugins = $state([]);
  let marketplacePlugins = $state([]);
  let pluginSearch = $state('');
  let installingPlugin = $state('');
  let pluginTab = $state('installed');
  let currentTerminalId = null;
  let terminalEl;
  let statusMsg = $state("Ready");
  let tokenUsage = $state(null);
  let tokenInterval = null;
  let usageLimits = $state(null);
  let sessionKeyInput = $state('');
  let appVersion = $state('');
  let claudePlan = $state('');
  let updateReady = $state(null); // { version, body } — only set after download complete
  let updateDismissed = $state(false);
  let showUpdateModal = $state(false);
  let showWhatsNew = $state(false);
  let whatsNewBody = $state('');
  let sessionKeyConfigured = $state(false);
  let usageError = $state('');
  let showKeyEdit = $state(false);
  let usageRefreshInterval = null;
  let sidebarCollapsed = $state(
    typeof localStorage !== 'undefined' ? localStorage.getItem('clauge-sidebar-collapsed') === 'true' : false
  );

  function toggleSidebar() {
    sidebarCollapsed = !sidebarCollapsed;
    localStorage.setItem('clauge-sidebar-collapsed', String(sidebarCollapsed));
    // Refit all terminals after transition
    setTimeout(() => {
      for (const [, entry] of terminalMap) {
        if (entry.fitAddon && entry.container.offsetWidth > 0) {
          try { entry.fitAddon.fit(); } catch(_) {}
        }
      }
    }, 250);
  }

  // Expand/collapse state — persisted to localStorage
  let expandedGroups = $state(
    typeof localStorage !== 'undefined'
      ? JSON.parse(localStorage.getItem('clauge-expanded') || '{}')
      : {}
  );

  function toggleGroup(name) {
    expandedGroups[name] = !expandedGroups[name];
    expandedGroups = { ...expandedGroups }; // trigger reactivity
    localStorage.setItem('clauge-expanded', JSON.stringify(expandedGroups));
  }

  function isGroupExpanded(name) {
    // Default to expanded if not set
    return expandedGroups[name] !== false;
  }

  // Delete confirmation
  let deleteConfirm = $state(null); // profile to confirm delete
  let menuProfile = $state(null); // profile whose ellipsis menu is open
  let profileMenuOpen = $state(false);
  let sessionActivity = $state({}); // profileId → 'active' | 'done' | null
  let gitChanges = $state({}); // profileId → count of changes

  // Theme state
  let currentTheme = $state(typeof localStorage !== 'undefined' ? (localStorage.getItem('clauge-theme') || 'dark') : 'dark');
  let accentColor = $state(typeof localStorage !== 'undefined' ? (localStorage.getItem('clauge-accent') || '#58a6ff') : '#58a6ff');

  // Terminal management — one xterm per profile, switch between them
  const terminalMap = new Map();
  let activeTermEntry = null;

  // Shell terminal management — one shell per profile
  let shellOpenMap = $state({}); // profileId → boolean
  let shellOpen = $derived(activeProfile ? (shellOpenMap[activeProfile.id] ?? false) : false);
  let shellEl;
  let wrapperEl;
  const shellMap = new Map(); // profileId → { term, fitAddon, container, terminalId }
  let activeShellEntry = null;
  let shellWidthMap = $state({});  // profileId → width percent
  let isDraggingDivider = $state(false);
  let focusedPanel = $state('claude'); // 'claude' | 'shell'

  function getShellWidth(profileId) { return shellWidthMap[profileId] ?? 50; }

  // Modal state
  let modalPath = $state("");
  let modalTitle = $state("");
  let modalPurpose = $state("");
  let modalSkipPermissions = $state(false);
  let modalExistingSessions = $state([]);
  let modalSelectedSession = $state("");
  let modalCustomPrompt = $state("");

  const purposes = [
    { label: "Brainstorming", color: "#d2a8ff" },
    { label: "Development", color: "#3fb950" },
    { label: "Code Review", color: "#58a6ff" },
    { label: "PR Review", color: "#d29922" },
    { label: "Debugging", color: "#f85149" },
    { label: "Custom", color: "#8b949e" },
  ];
  const purposeColors = Object.fromEntries(purposes.map(p => [p.label, p.color]));

  // Theme definitions
  const themes = {
    dark: {
      bg: "transparent", sidebarBg: "rgba(22, 27, 34, 0.75)", termBg: "rgba(13, 17, 23, 0.85)",
      border: "#30363d", textPrimary: "#e6edf3", textSecondary: "#8b949e",
      termTheme: {
        background: "#0d1117", foreground: "#e6edf3", cursor: "#58a6ff", cursorAccent: "#0d1117",
        selectionBackground: "rgba(88, 166, 255, 0.3)",
        black: "#484f58", red: "#ff7b72", green: "#3fb950", yellow: "#d29922",
        blue: "#58a6ff", magenta: "#bc8cff", cyan: "#39d353", white: "#b1bac4",
        brightBlack: "#6e7681", brightRed: "#ffa198", brightGreen: "#56d364",
        brightYellow: "#e3b341", brightBlue: "#79c0ff", brightMagenta: "#d2a8ff",
        brightCyan: "#56d364", brightWhite: "#f0f6fc",
      }
    },
    light: {
      bg: "transparent", sidebarBg: "rgba(246, 248, 250, 0.8)", termBg: "rgba(255, 255, 255, 0.9)",
      border: "#d0d7de", textPrimary: "#1f2328", textSecondary: "#656d76",
      termTheme: {
        background: "#ffffff", foreground: "#1f2328", cursor: "#0969da", cursorAccent: "#ffffff",
        selectionBackground: "rgba(9, 105, 218, 0.2)",
        black: "#24292f", red: "#cf222e", green: "#116329", yellow: "#4d2d00",
        blue: "#0969da", magenta: "#8250df", cyan: "#1b7c83", white: "#6e7781",
        brightBlack: "#57606a", brightRed: "#a40e26", brightGreen: "#1a7f37",
        brightYellow: "#633c01", brightBlue: "#218bff", brightMagenta: "#a475f9",
        brightCyan: "#3192aa", brightWhite: "#8c959f",
      }
    }
  };

  function applyTheme(themeName) {
    currentTheme = themeName;
    localStorage.setItem('clauge-theme', themeName);
    const t = themes[themeName];
    const root = document.documentElement;
    root.style.setProperty('--sidebar-bg', t.sidebarBg);
    root.style.setProperty('--term-bg', t.termBg);
    root.style.setProperty('--border', t.border);
    root.style.setProperty('--text-primary', t.textPrimary);
    root.style.setProperty('--text-secondary', t.textSecondary);
    root.style.setProperty('--accent', accentColor);
    root.style.setProperty('--modal-bg', themeName === 'light' ? 'rgba(255, 255, 255, 0.95)' : '#161b22');
    root.style.setProperty('--input-bg', themeName === 'light' ? '#f6f8fa' : '#0d1117');
    root.style.setProperty('--hover-bg', themeName === 'light' ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.06)');
    root.style.setProperty('--btn-bg', themeName === 'light' ? '#f0f2f4' : '#21262d');
    // Update all existing terminals
    for (const [, entry] of terminalMap) {
      if (entry.term) entry.term.options.theme = { ...t.termTheme, cursor: accentColor };
    }
  }

  function applyAccent(color) {
    accentColor = color;
    localStorage.setItem('clauge-accent', color);
    document.documentElement.style.setProperty('--accent', color);
    const theme = { ...themes[currentTheme].termTheme, cursor: color };
    for (const [, entry] of terminalMap) { if (entry.term) entry.term.options.theme = theme; }
    for (const [, entry] of shellMap) { if (entry.term) entry.term.options.theme = theme; }
  }

  async function loadProfiles() {
    try {
      profiles = await invoke("refresh_session_ids");
    } catch (e) {
      try { profiles = await invoke("get_profiles"); } catch (e2) { statusMsg = "Load failed: " + e2; }
    }
  }

  // Terminal font/opacity settings (persisted)
  let termFontSize = $state(typeof localStorage !== 'undefined' ? parseInt(localStorage.getItem('clauge-font-size') || '13') : 13);

  function getTermConfig() {
    return {
      theme: { ...themes[currentTheme].termTheme, cursor: accentColor },
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", "SF Mono", "Source Code Pro", "IBM Plex Mono", "Menlo", "Monaco", "Consolas", monospace',
      fontSize: termFontSize, lineHeight: 1.4, cursorBlink: true, cursorStyle: "bar",
      scrollback: 10000,
    };
  }

  async function loadWebGLAddon(term) {
    try {
      const { WebglAddon } = await import("@xterm/addon-webgl");
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => { webgl.dispose(); });
      term.loadAddon(webgl);
    } catch(_) {} // Falls back to canvas renderer silently
  }

  function createTermEntry(profileId) {
    const t = new Terminal(getTermConfig());
    const fa = new FitAddon();
    t.loadAddon(fa);

    const container = document.createElement("div");
    container.style.cssText = "width:100%;height:100%;display:none;";
    terminalEl.appendChild(container);
    t.open(container);
    loadWebGLAddon(t);

    t.onData((data) => {
      const entry = terminalMap.get(profileId);
      if (entry?.terminalId) invoke("write_to_terminal", { terminalId: entry.terminalId, data });
    });

    new ResizeObserver(() => {
      if (fa && container.offsetWidth > 0) requestAnimationFrame(() => { try { fa.fit(); } catch(_) {} });
    }).observe(container);

    const entry = { term: t, fitAddon: fa, container, terminalId: null, channel: null };
    terminalMap.set(profileId, entry);
    return entry;
  }

  function showTermEntry(entry) {
    if (activeTermEntry && activeTermEntry !== entry) {
      activeTermEntry.container.style.display = "none";
      // Reduce scrollback on inactive terminal to save memory
      try { activeTermEntry.term.options.scrollback = 1000; } catch(_) {}
    }
    entry.container.style.display = "block";
    // Restore full scrollback on active terminal
    try { entry.term.options.scrollback = 10000; } catch(_) {}
    activeTermEntry = entry;
    currentTerminalId = entry.terminalId;
    requestAnimationFrame(() => { try { entry.fitAddon.fit(); } catch(_) {} });
  }

  function createShellEntry(profileId) {
    const t = new Terminal({ ...getTermConfig(), scrollback: 5000 });
    const fa = new FitAddon();
    t.loadAddon(fa);

    const container = document.createElement("div");
    container.style.cssText = "width:100%;height:100%;display:none;";
    shellEl.appendChild(container);
    t.open(container);
    loadWebGLAddon(t);

    t.onData((data) => {
      const sEntry = shellMap.get(profileId);
      if (sEntry?.terminalId) {
        invoke("write_to_terminal", { terminalId: sEntry.terminalId, data }).catch(() => {
          // Shell process died — close shell panel
          sEntry.terminalId = null;
          if (activeProfile) {
            shellOpenMap[activeProfile.id] = false;
            shellOpenMap = {...shellOpenMap};
            // Refit Claude terminal to full width with PTY resize
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                handleWindowResize();
              });
            });
          }
        });
      }
    });

    new ResizeObserver(() => {
      if (fa && container.offsetWidth > 0) requestAnimationFrame(() => { try { fa.fit(); } catch(_) {} });
    }).observe(container);

    const sEntry = { term: t, fitAddon: fa, container, terminalId: null };
    shellMap.set(profileId, sEntry);
    return sEntry;
  }

  function showShellEntry(sEntry) {
    if (activeShellEntry && activeShellEntry !== sEntry) {
      activeShellEntry.container.style.display = "none";
      try { activeShellEntry.term.options.scrollback = 500; } catch(_) {}
    }
    sEntry.container.style.display = "block";
    try { sEntry.term.options.scrollback = 5000; } catch(_) {}
    activeShellEntry = sEntry;
    requestAnimationFrame(() => { try { sEntry.fitAddon.fit(); } catch(_) {} });
  }

  async function spawnShellForProfile(profile) {
    if (!shellEl) return;
    let sEntry = shellMap.get(profile.id);
    if (sEntry && sEntry.terminalId) {
      showShellEntry(sEntry);
      return;
    }
    if (!sEntry) {
      sEntry = createShellEntry(profile.id);
    } else {
      // Respawning after exit — clear old content
      sEntry.term.clear();
    }
    showShellEntry(sEntry);

    const projectPath = profile.worktreePath || profile.projectPath;
    const channel = new Channel();
    channel.onmessage = (msg) => {
      if (!msg.data) return;
      const bytes = Uint8Array.from(atob(msg.data), c => c.charCodeAt(0));
      sEntry.term.write(bytes);
    };

    try {
      sEntry.terminalId = await invoke("spawn_shell", { projectPath, onOutput: channel });
    } catch(e) {
      sEntry.term.write(`\r\nFailed to spawn shell: ${e}\r\n`);
    }
  }

  function startDividerDrag(e) {
    e.preventDefault();
    const wrapper = wrapperEl;
    if (!wrapper) return;

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    isDraggingDivider = true;

    let fitTimer = null;
    function onMove(ev) {
      const rect = wrapper.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const pct = (x / rect.width) * 100;
      if (activeProfile) {
        shellWidthMap[activeProfile.id] = Math.max(20, Math.min(80, 100 - pct));
        shellWidthMap = {...shellWidthMap};
      }
      // Throttle fit calls to every 100ms during drag — prevents xterm jank
      if (!fitTimer) {
        fitTimer = setTimeout(() => {
          fitTimer = null;
          try { activeTermEntry?.fitAddon?.fit(); } catch(_) {}
          try { activeShellEntry?.fitAddon?.fit(); } catch(_) {}
        }, 100);
      }
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      isDraggingDivider = false;
      if (fitTimer) { clearTimeout(fitTimer); fitTimer = null; }
      // Final fit + PTY resize after drag ends
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          handleWindowResize();
        });
      });
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  async function toggleShell() {
    if (!activeProfile && !shellOpen) return;
    const newState = !shellOpen;
    if (activeProfile) {
      shellOpenMap[activeProfile.id] = newState;
      shellOpenMap = {...shellOpenMap};
    }
    if (newState && activeProfile) {
      // Wait for DOM to render the shell panel
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          spawnShellForProfile(activeProfile);
          // Refit Claude terminal since width changed
          if (activeTermEntry?.fitAddon) {
            try {
              activeTermEntry.fitAddon.fit();
              if (activeTermEntry.terminalId) {
                const dims = activeTermEntry.fitAddon.proposeDimensions();
                if (dims) invoke("resize_terminal", { terminalId: activeTermEntry.terminalId, cols: dims.cols, rows: dims.rows }).catch(() => {});
              }
            } catch(_) {}
          }
        });
      });
    } else {
      // Refit Claude terminal to take full width — double rAF to wait for layout
      if (activeTermEntry?.fitAddon) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            try {
              activeTermEntry.fitAddon.fit();
              if (activeTermEntry.terminalId) {
                const dims = activeTermEntry.fitAddon.proposeDimensions();
                if (dims) invoke("resize_terminal", { terminalId: activeTermEntry.terminalId, cols: dims.cols, rows: dims.rows }).catch(() => {});
              }
            } catch(_) {}
          });
        });
      }
    }
  }

  async function selectProfile(profile) {
    activeProfile = profile;
    // Clear activity indicator when switching to this session
    if (sessionActivity[profile.id]) {
      delete sessionActivity[profile.id];
      sessionActivity = { ...sessionActivity };
    }
    let entry = terminalMap.get(profile.id);

    if (entry && entry.terminalId) {
      showTermEntry(entry);
      if (shellOpen) spawnShellForProfile(profile);
      statusMsg = profile.title;
      // Refresh git status badge
      const gitPath = profile.worktreePath || profile.projectPath;
      invoke("get_git_status", { projectPath: gitPath }).then(changes => {
        gitChanges[profile.id] = changes.length;
        gitChanges = {...gitChanges};
      }).catch(() => {});
    } else {
      statusMsg = "Spawning...";
      if (!entry) {
        entry = createTermEntry(profile.id);
      } else {
        // Terminal exited (terminalId is null) — clear old content for respawn
        entry.term.clear();
        entry.term.write('\r\n\x1b[2mResuming session...\x1b[0m\r\n\r\n');
      }

      try {
        await invoke("update_last_used", { id: profile.id });

        // Every session gets its own worktree — full isolation
        let spawnPath = profile.worktreePath || profile.projectPath;

        if (!profile.worktreePath && !profile.claudeSessionId) {
          try {
            const isGit = await invoke("is_git_repo", { path: profile.projectPath });
            if (isGit) {
              const rawBranch = `clauge/${profile.purpose.toLowerCase().replace(/\s+/g, '-')}-${profile.title.toLowerCase().replace(/\s+/g, '-')}`;
              const branchName = rawBranch.replace(/[^a-zA-Z0-9/_\-.]/g, '').replace(/\.{2,}/g, '.').replace(/\.lock/g, '');
              const worktreePath = await invoke("create_worktree", { projectPath: profile.projectPath, branchName });
              spawnPath = worktreePath;
              await invoke("update_profile_worktree", { id: profile.id, worktreePath, worktreeBranch: branchName });
              profile.worktreePath = worktreePath;
              profile.worktreeBranch = branchName;
              await loadProfiles();
            }
          } catch(e) {
            console.warn("Worktree creation failed, using original path:", e);
          }
        }

        // Get existing session IDs BEFORE spawning
        let existingSessionIds = [];
        if (!profile.claudeSessionId) {
          try {
            const existing = await invoke("discover_sessions", { projectPath: spawnPath });
            existingSessionIds = existing.map(s => s.sessionId);
          } catch(e) {}
        }

        // Flatten prompt to single line for shell compatibility
        // Use frontend purpose prompt for fixed purposes, fall back to profile.contextPrompt for Custom
        const rawPrompt = getPurposePrompt(profile.purpose) || profile.contextPrompt || '';
        const purposePrompt = rawPrompt.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();

        let outputReceived = false;
        let activityTimer = null;
        const profileId = profile.id;
        const onOutput = new Channel();
        onOutput.onmessage = (payload) => {
          if (entry.term) {
            try {
              const binary = atob(payload.data);
              const bytes = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
              entry.term.write(bytes);
            } catch(e) {}
          }
          // Detect action-required prompts and notify if window not focused
          checkForActionPrompt(payload.data, profile.title);
          // Detect Claude session exit (Ctrl+C, exit, /exit)
          // Buffer recent output to catch multi-chunk patterns
          if (!entry._exitBuffer) entry._exitBuffer = '';
          try {
            const text = atob(payload.data);
            entry._exitBuffer += text;
            // Keep buffer small — only last 500 chars
            if (entry._exitBuffer.length > 500) entry._exitBuffer = entry._exitBuffer.slice(-500);
            // Strip ANSI codes for matching
            const clean = entry._exitBuffer.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');

            if (/Resume this session with:/.test(clean) || /claude --resume [a-f0-9-]+/.test(clean)) {
              entry.terminalId = null;
              entry._exitBuffer = '';
              const resumeMatch = clean.match(/claude --resume ([a-f0-9-]+)/);
              if (resumeMatch && !profile.claudeSessionId) {
                const extractedSessionId = resumeMatch[1];
                invoke("update_session_id", { id: profile.id, claudeSessionId: extractedSessionId }).then(() => {
                  profile.claudeSessionId = extractedSessionId;
                  loadProfiles();
                }).catch(() => {});
              }
              sessionActivity[profileId] = 'done';
              sessionActivity = { ...sessionActivity };
              // Auto-close: hide terminal, switch to another session or show empty state
              entry.container.style.display = "none";
              if (activeProfile?.id === profileId) {
                const otherProfile = profiles.find(p => p.id !== profileId && terminalMap.get(p.id)?.terminalId);
                if (otherProfile) {
                  selectProfile(otherProfile);
                } else {
                  activeProfile = null;
                  activeTermEntry = null;
                  currentTerminalId = null;
                }
              }
            }
          } catch(_) {}
          // Track activity for background sessions
          if (activeProfile?.id !== profileId) {
            sessionActivity[profileId] = 'active';
            sessionActivity = { ...sessionActivity };
            // After 2s of no new output, mark as done (Claude finished responding)
            if (activityTimer) clearTimeout(activityTimer);
            activityTimer = setTimeout(() => {
              if (sessionActivity[profileId] === 'active') {
                sessionActivity[profileId] = 'done';
                sessionActivity = { ...sessionActivity };
              }
            }, 2000);
          }
          // Capture session ID — retry every 3s until found (up to 30s)
          if (!outputReceived && !profile.claudeSessionId) {
            outputReceived = true;
            let attempts = 0;
            const captureInterval = setInterval(async () => {
              attempts++;
              if (attempts > 10 || profile.claudeSessionId) { clearInterval(captureInterval); return; }
              try {
                const allSessions = await invoke("discover_sessions", { projectPath: spawnPath });
                const newSession = allSessions.find(s => !existingSessionIds.includes(s.sessionId));
                if (newSession) {
                  await invoke("update_session_id", { id: profile.id, claudeSessionId: newSession.sessionId });
                  profile.claudeSessionId = newSession.sessionId;
                  await loadProfiles();
                  console.log("[Clauge] Session ID saved:", newSession.sessionId);
                  clearInterval(captureInterval);
                }
              } catch(e) {}
            }, 3000);
          }
        };
        entry.channel = onOutput;

        const tid = await invoke("spawn_terminal", {
          sessionId: profile.claudeSessionId || null,
          projectPath: spawnPath,
          contextPrompt: purposePrompt || null,
          skipPermissions: profile.skipPermissions || false,
          gitName: profile.gitName || null,
          gitEmail: profile.gitEmail || null,
          onOutput: onOutput,
        });
        entry.terminalId = tid;
        currentTerminalId = tid;
        statusMsg = profile.title;
        showTermEntry(entry);
        if (shellOpen) spawnShellForProfile(profile);

        // Fetch git status for badge
        invoke("get_git_status", { projectPath: spawnPath }).then(changes => {
          gitChanges[profile.id] = changes.length;
          gitChanges = {...gitChanges};
        }).catch(() => {});

        entry.fitAddon.fit();
        const dims = entry.fitAddon.proposeDimensions();
        if (dims) await invoke("resize_terminal", { terminalId: tid, cols: dims.cols, rows: dims.rows });
      } catch (e) {
        statusMsg = "ERROR: " + String(e);
        entry.term.writeln("\r\n\x1b[31mError: " + String(e) + "\x1b[0m");
        showTermEntry(entry);
      }
    }

    async function refreshTokens() {
      try {
        tokenUsage = await invoke("get_session_tokens", { projectPath: profile.projectPath, sessionId: profile.claudeSessionId || null });
      } catch(e) { tokenUsage = null; }
    }
    await refreshTokens();
    if (tokenInterval) clearInterval(tokenInterval);
    tokenInterval = setInterval(refreshTokens, 10000);
  }

  async function createSession() {
    if (!modalPath || !modalTitle || !modalPurpose) return;
    try {
      const profile = await invoke("create_profile", {
        title: modalTitle,
        purpose: modalPurpose,
        projectPath: modalPath,
        skipPermissions: modalSkipPermissions,
        customPrompt: modalPurpose === 'Custom' && modalCustomPrompt.trim() ? modalCustomPrompt.trim() : null,
      });
      // Link existing session if selected (Custom purpose only)
      if (modalSelectedSession) {
        await invoke("update_session_id", { id: profile.id, claudeSessionId: modalSelectedSession });
        profile.claudeSessionId = modalSelectedSession;
      }
      showModal = false;
      modalPath = ""; modalTitle = ""; modalPurpose = ""; modalSkipPermissions = false;
      modalExistingSessions = []; modalSelectedSession = ""; modalCustomPrompt = "";
      await loadProfiles();
      await selectProfile(profile);
    } catch (e) { statusMsg = "Create failed: " + e; }
  }

  function deleteProfile(e, profile) {
    e.preventDefault();
    e.stopPropagation();
    deleteConfirm = profile;
  }

  async function confirmDelete() {
    if (!deleteConfirm) return;
    const deletedProfile = { ...deleteConfirm };
    const deletedId = deletedProfile.id;

    // Clean up worktree
    if (deletedProfile.worktreePath && deletedProfile.projectPath) {
      try { await invoke("remove_worktree", { projectPath: deletedProfile.projectPath, worktreePath: deletedProfile.worktreePath, branchName: deletedProfile.worktreeBranch || null }); } catch(e) {}
    }

    await invoke("delete_profile", { id: deletedId });

    // Clean up terminal (backend PTY + child process)
    const entry = terminalMap.get(deletedId);
    if (entry) {
      if (entry.terminalId) {
        try { await invoke("kill_terminal", { terminalId: entry.terminalId }); } catch(e) {}
      }
      entry.container.style.display = "none";
      if (entry.term) entry.term.dispose();
      terminalMap.delete(deletedId);
    }

    // Clean up shell (backend PTY + child process)
    const sEntry = shellMap.get(deletedId);
    if (sEntry) {
      if (sEntry.terminalId) {
        try { await invoke("kill_terminal", { terminalId: sEntry.terminalId }); } catch(e) {}
      }
      sEntry.container.style.display = "none";
      if (sEntry.term) sEntry.term.dispose();
      shellMap.delete(deletedId);
    }

    if (activeProfile?.id === deletedId) {
      activeProfile = null;
      activeTermEntry = null;
      activeShellEntry = null;
      currentTerminalId = null;
    }
    delete shellOpenMap[deletedId];
    delete shellWidthMap[deletedId];
    shellOpenMap = {...shellOpenMap};
    shellWidthMap = {...shellWidthMap};

    deleteConfirm = null;
    await loadProfiles();
  }

  function relativeTime(iso) {
    if (!iso) return "";
    const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (sec < 60) return "just now";
    if (sec < 3600) return Math.floor(sec/60) + "m ago";
    if (sec < 86400) return Math.floor(sec/3600) + "h ago";
    return Math.floor(sec/86400) + "d ago";
  }

  function groupByProject(list) {
    const g = {};
    for (const p of list) {
      const name = p.projectName || "Unknown";
      if (!g[name]) g[name] = [];
      g[name].push(p);
    }
    return g;
  }

  let grouped = $derived(groupByProject(profiles));

  async function loadExistingSessions(path) {
    try {
      const sessions = await invoke("discover_sessions", { projectPath: path });
      // Filter out sessions already linked to a profile
      const linkedIds = new Set(profiles.filter(p => p.claudeSessionId).map(p => p.claudeSessionId));
      modalExistingSessions = sessions.filter(s => !linkedIds.has(s.sessionId));
      modalSelectedSession = "";
    } catch(_) { modalExistingSessions = []; }
  }

  async function browsePath() {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false, title: "Select Project Folder" });
      if (selected) {
        modalPath = selected;
        if (!modalTitle) modalTitle = selected.split("/").filter(Boolean).pop() || "";
        loadExistingSessions(selected);
      }
    } catch(e) { statusMsg = "Browse failed: " + e; }
  }

  function handleGlobalKeydown(e) {
    if (e.metaKey && e.key === 'n') { e.preventDefault(); showModal = true; }
    if (e.metaKey && e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      const idx = parseInt(e.key) - 1;
      if (profiles[idx]) selectProfile(profiles[idx]);
    }
    if (e.metaKey && e.key === 'b') { e.preventDefault(); toggleSidebar(); }
    if (e.metaKey && e.key === 'l') { e.preventDefault(); toggleShell(); }
    if (e.key === 'Escape') { showModal = false; showSettings = false; modalExistingSessions = []; modalSelectedSession = ""; modalCustomPrompt = ""; }
  }

  function handleWindowResize() {
    requestAnimationFrame(() => {
      if (activeTermEntry?.fitAddon && activeTermEntry.container.offsetWidth > 0) {
        try {
          activeTermEntry.fitAddon.fit();
          if (activeTermEntry.terminalId) {
            const dims = activeTermEntry.fitAddon.proposeDimensions();
            if (dims) invoke("resize_terminal", { terminalId: activeTermEntry.terminalId, cols: dims.cols, rows: dims.rows }).catch(() => {});
          }
        } catch(_) {}
      }
      if (activeShellEntry?.fitAddon && activeShellEntry.container.offsetWidth > 0) {
        try {
          activeShellEntry.fitAddon.fit();
          if (activeShellEntry.terminalId) {
            const dims = activeShellEntry.fitAddon.proposeDimensions();
            if (dims) invoke("resize_terminal", { terminalId: activeShellEntry.terminalId, cols: dims.cols, rows: dims.rows }).catch(() => {});
          }
        } catch(_) {}
      }
    });
  }

  let pendingUpdate = null; // holds the downloaded update object

  async function checkAndDownloadUpdate() {
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (!update) return;

      // Always download — Tauri updater doesn't persist downloads across restarts
      await update.download();
      pendingUpdate = update;
      updateReady = { version: update.version, body: update.body || '' };
    } catch(e) {
      // Silently ignore — no update or network issue
    }
  }

  async function restartToUpdate() {
    if (!pendingUpdate) {
      // Re-check and download if pendingUpdate was lost
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();
        if (update) {
          await update.download();
          pendingUpdate = update;
        }
      } catch(_) {}
    }
    if (!pendingUpdate) return;
    try {
      await pendingUpdate.install();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch(e) {
      console.error("Update restart failed:", e);
    }
  }

  function checkWhatsNew(version) {
    const lastSeen = typeof localStorage !== 'undefined' ? localStorage.getItem('clauge-last-seen-version') : null;
    if (lastSeen && lastSeen !== version) {
      // Version changed since last launch — fetch release notes
      fetch(`https://api.github.com/repos/ansxuman/Clauge/releases/tags/v${version}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data?.body) {
            whatsNewBody = data.body;
            showWhatsNew = true;
          }
        })
        .catch(() => {});
    }
    if (typeof localStorage !== 'undefined') localStorage.setItem('clauge-last-seen-version', version);
  }

  function getPurposePrompt(purpose) {
    const prompts = {
      "Brainstorming": `You are in a brainstorming session. Follow these rules strictly:

HARD RULE: Do NOT write implementation code unless the user explicitly asks for it.

Your process:
1. Understand the problem — ask clarifying questions before proposing solutions
2. Explore 2-3 different approaches with tradeoffs for each
3. Think out loud — share risks, assumptions, and alternatives
4. Challenge the user's assumptions if something seems off
5. Summarize with pros/cons before the user decides
6. Only move to implementation details when the user picks a direction

Anti-patterns to avoid:
- Jumping to code when the user is still exploring
- Proposing only one approach
- Agreeing with everything without pushback`,

      "Development": `You are in a development session. Follow these rules strictly:

Your process:
1. Understand what needs to change before touching code
2. Read existing code first — follow the patterns already in the codebase
3. Make small, focused changes — one thing at a time
4. Verify each change works before moving to the next
5. If requirements are unclear, ask — do not guess

Quality gates:
- Does this change follow existing conventions?
- Are error cases handled?
- Would this break anything else?
- Is this the simplest solution that works?

Anti-patterns to avoid:
- Rewriting large sections when a small edit works
- Adding features that weren't asked for
- Skipping verification after changes`,

      "Code Review": `You are in a code review session. Follow these rules strictly:

Your process:
1. Read all recent changes systematically — do not skip files
2. For each change, check: bugs, security issues, performance, edge cases
3. Reference specific files and line numbers
4. Suggest concrete fixes, not vague advice
5. Flag anything that could break in production

What to check:
- Error handling — are failures handled gracefully?
- Security — input validation, auth checks, injection risks
- Edge cases — null values, empty arrays, concurrent access
- Missing tests — is new behavior tested?

Anti-patterns to avoid:
- Nitpicking style when there are real bugs
- Being vague ("this could be better")
- Missing the forest for the trees`,

      "PR Review": `You are in a PR review session. Follow these rules strictly:

Your process:
1. Ask which branch to review AND which base branch to compare against (do not assume main)
2. Run git diff <base>...<branch> to see only the incoming changes
3. Review ONLY the changes in the diff — do not review unrelated code
4. Review every changed file — do not skip any
5. Summarize: what the PR does, what's good, what needs fixing
6. Give a clear verdict: approve, request changes, or needs discussion

What to check:
- Does the PR do what it claims?
- Are there breaking changes or missing migrations?
- Is test coverage adequate for new code?
- Are there security implications?

Anti-patterns to avoid:
- Reviewing only part of the diff
- Approving without thorough review
- Mixing style feedback with functional issues`,

      "Debugging": `You are in a debugging session. Follow these rules strictly:

HARD RULE: Do NOT guess fixes. Trace the root cause first.

Your process — follow these phases in order:
1. REPRODUCE — Confirm the symptoms. If you can't reproduce, gather more information
2. HYPOTHESIZE — Form a specific hypothesis about the cause
3. VERIFY — Test the hypothesis with evidence (logs, output, traces). If wrong, go back to step 2
4. ROOT CAUSE — Explain exactly why the bug happens before proposing any fix
5. FIX — Make the minimal change that addresses the root cause
6. VERIFY FIX — Confirm the original issue is resolved and no new issues introduced

Red flags that you're doing it wrong:
- Trying random fixes without understanding the cause
- Each fix reveals a new problem in a different place (architectural issue)
- Unable to explain WHY the bug happens

Anti-patterns to avoid:
- Applying fixes before understanding root cause
- Changing multiple things at once
- Ignoring related symptoms`,
    };
    return prompts[purpose] || null;
  }

  function openExternal(url) {
    import("@tauri-apps/plugin-opener").then(m => m.openUrl(url)).catch(() => window.open(url, "_blank"));
  }


  async function handleDragStart(e) {
    if (e.buttons === 1) {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      if (e.detail === 2) {
        getCurrentWindow().toggleMaximize();
      } else {
        getCurrentWindow().startDragging();
      }
    }
  }

  // Notification for action-required prompts
  let lastNotifyTime = 0;
  let soundRepeatInterval = null;
  let outputBuffer = '';
  let bufferTimer = null;

  function checkForActionPrompt(base64Data, sessionTitle) {
    // Decode base64 to text, strip ANSI escape codes
    const raw = atob(base64Data);
    const text = raw.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
    outputBuffer += text;

    // Check on every chunk if unfocused (timers may be throttled in background)
    if (!document.hasFocus()) checkBuffer();
    // Also debounce for when data arrives in small chunks
    if (bufferTimer) clearTimeout(bufferTimer);
    bufferTimer = setTimeout(checkBuffer, 300);

    function checkBuffer() {
      const buf = outputBuffer;
      outputBuffer = '';
      if (!buf) return;

      // Throttle — max one notification per 10 seconds
      if (Date.now() - lastNotifyTime < 10000) return;

      // Only notify if window is not focused
      if (document.hasFocus()) return;

      const patterns = [
        /Do you want to proceed/i,
        /1\.\s*Yes/,
        /\(y\/n\)/i,
        /\[Y\/n\]/i,
        /\[y\/N\]/i,
        /Press Enter/i,
        /Allow.*Deny/i,
        /approve this/i,
        /Yes, and don.t ask/i,
      ];

      if (patterns.some(p => p.test(buf))) {
        lastNotifyTime = Date.now();
        sendActionNotification(sessionTitle);
        // Bounce Dock icon
        import("@tauri-apps/api/window").then(({ getCurrentWindow, UserAttentionType }) => {
          getCurrentWindow().requestUserAttention(UserAttentionType.Critical);
        }).catch(() => {});
        playNotificationSound();
        // Repeat sound every 3s until focused
        if (soundRepeatInterval) clearInterval(soundRepeatInterval);
        soundRepeatInterval = setInterval(() => {
          if (document.hasFocus()) { clearInterval(soundRepeatInterval); soundRepeatInterval = null; return; }
          playNotificationSound();
        }, 3000);
      }
    }
  }

  function playNotificationSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880; // A5 note
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.08, ctx.currentTime); // Very quiet
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
      // Play a second tone for a pleasant chime
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.frequency.value = 1320; // E6 note
      osc2.type = 'sine';
      gain2.gain.setValueAtTime(0.05, ctx.currentTime + 0.1);
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc2.start(ctx.currentTime + 0.1);
      osc2.stop(ctx.currentTime + 0.4);
    } catch(_) {}
  }

  async function sendActionNotification(sessionTitle) {
    try {
      const { isPermissionGranted, requestPermission, sendNotification } = await import("@tauri-apps/plugin-notification");
      let granted = await isPermissionGranted();
      if (!granted) {
        const permission = await requestPermission();
        granted = permission === 'granted';
      }
      if (granted) {
        sendNotification({ title: `Action Required`, body: `${sessionTitle} — Claude is waiting for your input` });
      }
    } catch(_) {}
  }

  async function loadClaudePlugins() {
    try { claudePlugins = await invoke("get_claude_plugins"); } catch(_) { claudePlugins = []; }
    try { marketplacePlugins = await invoke("get_marketplace_plugins"); } catch(_) { marketplacePlugins = []; }
  }
  async function togglePlugin(plugin) {
    const key = `${plugin.name}@${plugin.marketplace}`;
    try { await invoke("toggle_claude_plugin", { pluginKey: key, enabled: !plugin.enabled }); await loadClaudePlugins(); } catch(_) {}
  }
  async function installPlugin(plugin) {
    installingPlugin = plugin.name;
    try {
      await invoke("install_plugin", { name: plugin.name, marketplace: plugin.marketplace });
      await invoke("toggle_claude_plugin", { pluginKey: `${plugin.name}@${plugin.marketplace}`, enabled: true });
      await loadClaudePlugins();
    } catch(e) { console.error('Install failed:', e); }
    installingPlugin = '';
  }
  async function uninstallPlugin(plugin) {
    try {
      await invoke("uninstall_plugin", { name: plugin.name, marketplace: plugin.marketplace });
      await loadClaudePlugins();
    } catch(e) { console.error('Uninstall failed:', e); }
  }

  async function loadUsageLimits() {
    usageError = '';
    try {
      const key = await invoke("load_session_key");
      if (!key) { sessionKeyConfigured = false; return; }

      const usage = await invoke("fetch_usage_limits", { sessionKey: key });

      usageLimits = {
        sessionPercent: usage.five_hour?.utilization || 0,
        sessionResets: usage.five_hour?.resets_at || "",
        weeklyAllPercent: usage.seven_day?.utilization || 0,
        weeklyAllResets: usage.seven_day?.resets_at || "",
        weeklySonnetPercent: usage.seven_day_sonnet?.utilization ?? null,
        weeklySonnetResets: usage.seven_day_sonnet?.resets_at ?? null,
      };
      usageError = '';

      const s = Math.round(usageLimits.sessionPercent);
      const w = Math.round(usageLimits.weeklyAllPercent);
      await invoke("update_tray_title", { title: `S:${s}% W:${w}%` }).catch(() => {});
    } catch(e) {
      console.error("Usage limits failed:", e);
      const err = String(e).toLowerCase();
      usageLimits = null;
      await invoke("update_tray_title", { title: "" }).catch(() => {});

      // Detect auth failures — session key expired or invalid
      if (err.includes('permission') || err.includes('unauthorized') || err.includes('invalid') || err.includes('403') || err.includes('401')) {
        sessionKeyConfigured = false;
        usageError = 'Session key expired or invalid. Please reconnect.';
        if (usageRefreshInterval) { clearInterval(usageRefreshInterval); usageRefreshInterval = null; }
      } else {
        usageError = 'Failed to fetch usage data. Try again.';
      }
    }
  }


  onMount(() => {
    applyTheme(currentTheme);
    invoke("get_app_version").then(v => {
      appVersion = v;
      checkWhatsNew(v);
      checkAndDownloadUpdate();
    }).catch(() => {});
    invoke("get_claude_plan").then(p => { if (p) claudePlan = p; }).catch(() => {});


    // Priority 1: Load profiles (fast, <10ms)
    loadProfiles();

    // Priority 2: Load session key + usage limits (fast key read, then ~1.5s API call)
    invoke("load_session_key").then(savedKey => {
      if (savedKey) {
        sessionKeyInput = savedKey;
        sessionKeyConfigured = true;
        loadUsageLimits();
        usageRefreshInterval = setInterval(loadUsageLimits, 5 * 60 * 1000);
      }
    }).catch(() => {});

  });
</script>

<svelte:window onkeydown={handleGlobalKeydown} onresize={handleWindowResize} onclick={() => { menuProfile = null; profileMenuOpen = false; }} oncontextmenu={(e) => { if (!import.meta.env.DEV) e.preventDefault(); }} />

<div class="app-wrapper">
<div class="app">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="drag-bar" onmousedown={handleDragStart}></div>
  <aside class="sidebar" class:collapsed={sidebarCollapsed}>
    <div class="sidebar-header">
      <span class="app-title">Clauge {#if claudePlan}<span class="plan-badge">{claudePlan}</span>{/if}</span>
      <div class="header-actions">
        <button class="new-btn" onclick={() => showModal = true} title="New Session (Cmd+N)">+</button>
      </div>
    </div>
    <div class="sidebar-content">
      {#if profiles.length === 0}
        <div class="empty-sidebar">No sessions yet. Click + to create one.</div>
      {:else}
        {#each Object.entries(grouped) as [projectName, items]}
          <div class="project-group">
            <button class="project-header" onclick={() => toggleGroup(projectName)}>
              <svg class="chevron" class:collapsed={!isGroupExpanded(projectName)} width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                <path d="M3 2l4 3-4 3z"/>
              </svg>
              {projectName}
              <span class="project-count">{items.length}</span>
            </button>
            {#if isGroupExpanded(projectName)}
              {#each items as profile}
                  <button
                    class="profile-item"
                    class:active={activeProfile?.id === profile.id}
                    onclick={() => selectProfile(profile)}
                  >
                    <div class="profile-title">
                      <span class="status-dot" class:active={activeProfile?.id === profile.id} class:bg-active={sessionActivity[profile.id] === 'active'} class:bg-done={sessionActivity[profile.id] === 'done'}></span>
                      {profile.title}
                    </div>
                    <div class="profile-meta">
                      <span class="badge" style="color:{purposeColors[profile.purpose] || '#8b949e'}; background:{purposeColors[profile.purpose] || '#8b949e'}22">{profile.purpose}</span>
                      {#if profile.worktreeBranch}
                        <span class="wt-badge" title="Isolated worktree: {profile.worktreeBranch}">WT</span>
                      {/if}
                      {#if gitChanges[profile.id] > 0}
                        <span class="git-badge">{gitChanges[profile.id]} changes</span>
                      {/if}
                      <span class="time">{relativeTime(profile.lastUsedAt)}</span>
                    </div>
                    <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
                    <span class="ellipsis-btn" onclick={(e) => { e.stopPropagation(); menuProfile = menuProfile?.id === profile.id ? null : profile; }}>
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="3" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="8" cy="13" r="1.5"/></svg>
                    </span>
                    {#if menuProfile?.id === profile.id}
                      <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
                      <div class="session-menu" onclick={(e) => e.stopPropagation()}>
                        <button class="session-menu-item danger" onclick={() => { menuProfile = null; deleteConfirm = profile; }}>
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M6.5 1.75a.25.25 0 01.25-.25h2.5a.25.25 0 01.25.25V3h-3V1.75zM11 3V1.75A1.75 1.75 0 009.25 0h-2.5A1.75 1.75 0 005 1.75V3H2.75a.75.75 0 000 1.5h.928l.747 10.218A1.75 1.75 0 006.172 16h3.656a1.75 1.75 0 001.747-1.282L12.322 4.5h.928a.75.75 0 000-1.5H11zm-5.522 1.5l.735 10.06a.25.25 0 00.249.19h3.076a.25.25 0 00.249-.19l.735-10.06H5.478z"/></svg>
                          Delete
                        </button>
                      </div>
                    {/if}
                  </button>
              {/each}
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  </aside>

  <button class="sidebar-toggle" onclick={toggleSidebar} title={sidebarCollapsed ? 'Expand sidebar (Cmd+B)' : 'Collapse sidebar (Cmd+B)'}>
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
      {#if sidebarCollapsed}
        <path d="M4 1l5 5-5 5z"/>
      {:else}
        <path d="M8 1L3 6l5 5z"/>
      {/if}
    </svg>
  </button>

  <div class="terminal-wrapper" bind:this={wrapperEl}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="terminal-area" class:panel-focused={focusedPanel === 'claude'} onclick={() => focusedPanel = 'claude'}>
      {#if !activeProfile}
        <div class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--border)" stroke-width="1.5">
            <polyline points="4 17 10 11 4 5"></polyline>
            <line x1="12" y1="19" x2="20" y2="19"></line>
          </svg>
          <p class="empty-title">No active session</p>
          <p class="empty-sub">Select a session from the sidebar or create a new one</p>
        </div>
      {/if}
      {#if activeProfile}
        <div class="purpose-glow" style="background: linear-gradient(180deg, {purposeColors[activeProfile.purpose] || accentColor}15 0%, transparent 100%);"></div>
      {/if}
      <div class="terminal-panel" bind:this={terminalEl}></div>
    </div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="shell-divider" style="display:{shellOpen ? 'block' : 'none'}" onmousedown={startDividerDrag}></div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="shell-area" class:no-transition={isDraggingDivider} class:panel-focused={focusedPanel === 'shell'} onclick={() => focusedPanel = 'shell'} style="display:{shellOpen ? 'flex' : 'none'};width:{getShellWidth(activeProfile?.id)}%;flex:none;">
      <div class="shell-panel" bind:this={shellEl}></div>
    </div>
  </div>
</div>
<div class="bottom-bar">
  <div class="bottom-left">
    <div class="profile-wrap">
      <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
      <div onclick={(e) => { e.stopPropagation(); profileMenuOpen = !profileMenuOpen; }}>
        <button class="profile-avatar" title="Profile"><span class="avatar-letter">CG</span></button>
      </div>
      {#if profileMenuOpen}
        <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
        <div class="profile-menu" onclick={(e) => e.stopPropagation()}>
          <button class="pm-item" onclick={() => { profileMenuOpen = false; showSettings = true; settingsTab = 'settings'; }}>
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z"/></svg>
            Settings
          </button>
          <button class="pm-item" onclick={() => { profileMenuOpen = false; showSettings = true; settingsTab = 'plugins'; loadClaudePlugins(); }}>
            <svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
            Plugins
          </button>
          <div class="pm-sep"></div>
          <button class="pm-item" onclick={() => { profileMenuOpen = false; openExternal('https://clauge.ssh-i.in/changelog.html'); }}>
            <svg viewBox="0 0 24 24"><path d="M12 2L15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26z"/></svg>
            What's New
            <svg class="pm-external" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </button>
          <button class="pm-item" onclick={() => { profileMenuOpen = false; openExternal('https://github.com/ansxuman/Clauge/issues'); }}>
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
            Report Issue
            <svg class="pm-external" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </button>
          <button class="pm-item pm-coffee" onclick={() => { profileMenuOpen = false; openExternal('https://buymeacoffee.com/ansxuman'); }}>
            <svg viewBox="0 0 24 24"><path d="M17 8h1a4 4 0 110 8h-1"/><path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8z"/><line x1="6" y1="2" x2="6" y2="4"/><line x1="10" y1="2" x2="10" y2="4"/><line x1="14" y1="2" x2="14" y2="4"/></svg>
            Buy Me a Coffee
            <svg class="pm-external" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </button>
        </div>
      {/if}
    </div>
  </div>
  <div class="bottom-center">
    {#if usageLimits}
      {@const sColor = usageLimits.sessionPercent > 80 ? '#f85149' : usageLimits.sessionPercent > 50 ? '#d29922' : 'var(--accent)'}
      {@const wColor = usageLimits.weeklyAllPercent > 80 ? '#f85149' : usageLimits.weeklyAllPercent > 50 ? '#d29922' : 'var(--accent)'}
      <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
      <div class="usage-chips-clickable" onclick={() => { showSettings = true; settingsTab = 'usage'; }}>
        <div class="usage-chip"><span class="usage-dot" style="background:{sColor};box-shadow:0 0 6px {sColor}44;"></span><span class="usage-lbl">Session</span><span class="usage-val" style="color:{sColor}">{usageLimits.sessionPercent.toFixed(0)}%</span></div>
        <div class="usage-sep"></div>
        <div class="usage-chip"><span class="usage-dot" style="background:{wColor};box-shadow:0 0 6px {wColor}44;"></span><span class="usage-lbl">Weekly</span><span class="usage-val" style="color:{wColor}">{usageLimits.weeklyAllPercent.toFixed(0)}%</span></div>
        {#if usageLimits.weeklySonnetPercent != null}
          {@const snColor = usageLimits.weeklySonnetPercent > 80 ? '#f85149' : usageLimits.weeklySonnetPercent > 50 ? '#d29922' : 'var(--accent)'}
          <div class="usage-sep"></div>
          <div class="usage-chip"><span class="usage-dot" style="background:{snColor};box-shadow:0 0 6px {snColor}44;"></span><span class="usage-lbl">Sonnet</span><span class="usage-val" style="color:{snColor}">{usageLimits.weeklySonnetPercent.toFixed(0)}%</span></div>
        {/if}
      </div>
    {:else}
      <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
      <span class="limit-loading" onclick={() => { showSettings = true; settingsTab = 'usage'; }} style="cursor:pointer;">
        Set up usage tracking in Settings
      </span>
    {/if}
  </div>
  <div class="bottom-right">
    <button class="shell-toggle-btn" class:active={shellOpen} disabled={!activeProfile && !shellOpen} onclick={toggleShell} title="Toggle shell (Cmd+L)">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="4 17 10 11 4 5"></polyline>
        <line x1="12" y1="19" x2="20" y2="19"></line>
      </svg>
    </button>
    {#if appVersion}<span class="bottom-version">v{appVersion}</span>{/if}
  </div>
</div>

{#if updateReady && !updateDismissed}
  <div class="update-notif">
    <div class="un-header">
      <svg class="un-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
      <div class="un-text">
        <span class="un-title">Clauge v{updateReady.version} is available</span>
        <span class="un-desc">A new version has been downloaded. Restart to apply.</span>
      </div>
      <button class="un-close" onclick={() => updateDismissed = true}>&times;</button>
    </div>
    <div class="un-actions">
      <button class="un-btn primary" onclick={() => { restartToUpdate(); }}>Restart to Update</button>
      <button class="un-btn secondary" onclick={() => openExternal('https://clauge.ssh-i.in/changelog.html')}>
        What's New
        <svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      </button>
    </div>
  </div>
{/if}
</div>

{#if showModal}
<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div class="modal-backdrop" onclick={(e) => { if (e.target === e.currentTarget) { showModal = false; modalExistingSessions = []; modalSelectedSession = ""; modalCustomPrompt = ""; } }}>
  <div class="modal">
    <h2>New Session</h2>
    <label>Project Folder
      <div class="row">
        <input bind:value={modalPath} placeholder="/path/to/project" />
        <button onclick={browsePath}>Browse</button>
      </div>
    </label>
    <label>Title
      <input bind:value={modalTitle} placeholder="e.g. Auth Refactor" />
    </label>
    <label>Purpose
      <div class="chips">
        {#each purposes as p}
          {#if !modalPath.trim()}
            <button class="chip" disabled style="opacity:0.3;cursor:not-allowed;">{p.label}</button>
          {:else if p.label !== 'Custom' && profiles.some(pr => pr.projectPath === modalPath && pr.purpose === p.label)}
            <button class="chip" disabled style="opacity:0.3;cursor:not-allowed;" title="{p.label} already active for this project">{p.label}</button>
          {:else}
            <button class="chip" class:selected={modalPurpose === p.label}
              style={modalPurpose === p.label ? `background:${p.color}33;color:${p.color};border-color:${p.color}` : ''}
              onclick={() => { modalPurpose = p.label; if (p.label === 'Custom' && modalPath.trim()) loadExistingSessions(modalPath); }}>{p.label}</button>
          {/if}
        {/each}
      </div>
    </label>
    {#if modalPurpose === 'Custom'}
      {#if modalExistingSessions.length > 0}
        <label>Resume Existing Session
          <select class="session-select" bind:value={modalSelectedSession}>
            <option value="">Start fresh</option>
            {#each modalExistingSessions as s}
              <option value={s.sessionId}>{s.preview || s.sessionId.slice(0, 8)} — {new Date(s.modifiedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</option>
            {/each}
          </select>
        </label>
      {/if}
      <label>System Prompt <span style="font-size:10px;color:var(--text-secondary);font-weight:normal;">(optional)</span>
        <textarea class="custom-prompt" bind:value={modalCustomPrompt} placeholder="e.g. Focus on performance optimization, avoid breaking changes..." rows="3"></textarea>
      </label>
    {/if}
    <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
    <div class="toggle-row">
      <span class="toggle-label">Skip permissions
        <span class="toggle-tooltip">?</span>
      </span>
      <button class="toggle-switch" class:on={modalSkipPermissions} onclick={() => modalSkipPermissions = !modalSkipPermissions}>
        <span class="toggle-knob"></span>
      </button>
    </div>
    <div class="modal-actions">
      <button onclick={() => { showModal = false; modalExistingSessions = []; modalSelectedSession = ""; modalCustomPrompt = ""; }}>Cancel</button>
      <button class="create-btn" disabled={!modalPath || !modalTitle || !modalPurpose} onclick={createSession}>Create</button>
    </div>
  </div>
</div>
{/if}

{#if showSettings}
<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div class="modal-backdrop" onclick={(e) => { if (e.target === e.currentTarget) showSettings = false; }}>
  <div class="stg-modal">
    <div class="stg-header">
      <span class="stg-title">Settings</span>
      <button class="stg-close" onclick={() => showSettings = false}>&times;</button>
    </div>
    <div class="stg-layout">
      <div class="stg-tabs">
        <button class="stg-tab" class:active={settingsTab === 'settings'} onclick={() => settingsTab = 'settings'}>
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 3v1m0 16v1m-9-9h1m16 0h1m-2.636-6.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m11.314 11.314l.707.707" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
          Appearance
        </button>
        <button class="stg-tab" class:active={settingsTab === 'usage'} onclick={() => settingsTab = 'usage'}>
          <svg viewBox="0 0 24 24"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>
          Usage
        </button>
        <button class="stg-tab" class:active={settingsTab === 'plugins'} onclick={() => { settingsTab = 'plugins'; loadClaudePlugins(); }}>
          <svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
          Plugins
        </button>
        <button class="stg-tab" class:active={settingsTab === 'about'} onclick={() => settingsTab = 'about'}>
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
          About
        </button>
      </div>
      <div class="stg-content">

    {#if settingsTab === 'settings'}
      <div class="stg-section">
        <div class="stg-section-label">Appearance</div>
        <div class="stg-field">
          <span class="stg-label">Theme</span>
          <div class="chips">
            <button class="chip" class:selected={currentTheme === 'dark'} onclick={() => applyTheme('dark')}>Dark</button>
            <button class="chip" class:selected={currentTheme === 'light'} onclick={() => applyTheme('light')}>Light</button>
          </div>
        </div>
        <div class="stg-field">
          <span class="stg-label">Accent Color</span>
          <div class="accent-row">
            {#each ['#58a6ff', '#d2a8ff', '#3fb950', '#f85149', '#d29922', '#ff7b72'] as color}
              <button class="color-dot" style="background:{color};{accentColor === color ? 'box-shadow:0 0 0 2px var(--text-primary);' : ''}"
                onclick={() => applyAccent(color)} title={color}></button>
            {/each}
          </div>
        </div>
      </div>

      <div class="stg-section">
        <div class="stg-section-label">Terminal</div>
        <div class="stg-field">
          <span class="stg-label">Font Size</span>
          <div style="display:flex;align-items:center;gap:8px;">
            <input type="range" min="10" max="18" step="1" bind:value={termFontSize} class="stg-range"
              oninput={(e) => {
                const size = parseInt(e.target.value);
                termFontSize = size;
                localStorage.setItem('clauge-font-size', String(size));
                for (const [, en] of terminalMap) { if (en.term) { en.term.options.fontSize = size; try { en.fitAddon.fit(); } catch(_) {} } }
                for (const [, en] of shellMap) { if (en.term) { en.term.options.fontSize = size; try { en.fitAddon.fit(); } catch(_) {} } }
              }} />
            <span style="font-size:11px;color:var(--text-secondary);width:24px;text-align:right;font-variant-numeric:tabular-nums;">{termFontSize}px</span>
          </div>
        </div>
      </div>

    {:else if settingsTab === 'usage'}
      {#if sessionKeyConfigured}
        <div class="key-status">
          <div class="key-status-row">
            <span class="key-dot connected"></span>
            <span style="font-size:12px;color:var(--text-primary);">Session key configured</span>
            <span style="font-size:10px;color:var(--text-secondary);margin-left:auto;">Refreshes every 5 min</span>
          </div>
          {#if !showKeyEdit}
            <div style="display:flex;gap:8px;margin-top:8px;">
              <button class="save-key-btn" style="color:var(--text-secondary);border-color:var(--border);" onclick={() => showKeyEdit = true}>Edit Key</button>
            </div>
            {#if usageError}
              <p style="font-size:11px;color:#f85149;margin:6px 0 0;">{usageError}</p>
            {/if}
          {:else}
            <div style="margin-top:8px;">
              <input type="password" bind:value={sessionKeyInput} placeholder="sk-ant-sid01-..." style="font-size:12px;margin-bottom:4px;" />
              <p style="font-size:10px;color:var(--text-secondary);margin:0 0 8px;">Open <strong>claude.ai</strong> → DevTools (F12) → Application → Cookies → copy <strong>sessionKey</strong> value</p>
              <div style="display:flex;gap:8px;">
                <button class="save-key-btn" onclick={async () => {
                  if (sessionKeyInput.trim()) {
                    await invoke("save_session_key", { key: sessionKeyInput.trim() });
                    sessionKeyConfigured = true;
                    showKeyEdit = false;
                    await loadUsageLimits();
                  }
                }}>Save</button>
                <button class="save-key-btn" style="color:var(--text-secondary);border-color:var(--border);" onclick={() => showKeyEdit = false}>Cancel</button>
              </div>
            </div>
          {/if}
        </div>

        {#if usageLimits}
          <div style="margin-top:16px;border-top:1px solid var(--border);padding-top:16px;">
            <div class="usage-detail-row">
              <div class="usage-detail-label">Session</div>
              <div class="usage-detail-bar">
                <div class="usage-detail-fill" style="width:{usageLimits.sessionPercent}%;background:{usageLimits.sessionPercent > 80 ? '#f85149' : usageLimits.sessionPercent > 50 ? '#d29922' : 'var(--accent)'}"></div>
              </div>
              <div class="usage-detail-pct" style="color:{usageLimits.sessionPercent > 80 ? '#f85149' : usageLimits.sessionPercent > 50 ? '#d29922' : 'var(--accent)'}">{usageLimits.sessionPercent.toFixed(1)}%</div>
            </div>
            {#if usageLimits.sessionResets}
              <div class="usage-detail-resets">Resets {new Date(usageLimits.sessionResets).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
            {/if}

            <div class="usage-detail-row" style="margin-top:14px;">
              <div class="usage-detail-label">Weekly</div>
              <div class="usage-detail-bar">
                <div class="usage-detail-fill" style="width:{usageLimits.weeklyAllPercent}%;background:{usageLimits.weeklyAllPercent > 80 ? '#f85149' : usageLimits.weeklyAllPercent > 50 ? '#d29922' : 'var(--accent)'}"></div>
              </div>
              <div class="usage-detail-pct" style="color:{usageLimits.weeklyAllPercent > 80 ? '#f85149' : usageLimits.weeklyAllPercent > 50 ? '#d29922' : 'var(--accent)'}">{usageLimits.weeklyAllPercent.toFixed(1)}%</div>
            </div>
            {#if usageLimits.weeklyAllResets}
              <div class="usage-detail-resets">Resets {new Date(usageLimits.weeklyAllResets).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
            {/if}

            {#if usageLimits.weeklySonnetPercent != null}
              <div class="usage-detail-row" style="margin-top:14px;">
                <div class="usage-detail-label">Sonnet</div>
                <div class="usage-detail-bar">
                  <div class="usage-detail-fill" style="width:{usageLimits.weeklySonnetPercent}%;background:{usageLimits.weeklySonnetPercent > 80 ? '#f85149' : usageLimits.weeklySonnetPercent > 50 ? '#d29922' : 'var(--accent)'}"></div>
                </div>
                <div class="usage-detail-pct" style="color:{usageLimits.weeklySonnetPercent > 80 ? '#f85149' : usageLimits.weeklySonnetPercent > 50 ? '#d29922' : 'var(--accent)'}">{usageLimits.weeklySonnetPercent.toFixed(1)}%</div>
              </div>
              {#if usageLimits.weeklySonnetResets}
                <div class="usage-detail-resets">Resets {new Date(usageLimits.weeklySonnetResets).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
              {/if}
            {/if}

            {#if claudePlan}
              <div style="margin-top:14px;font-size:11px;color:var(--text-secondary);">Plan: <span style="text-transform:capitalize;color:var(--text-primary);">{claudePlan}</span></div>
            {/if}
          </div>
        {/if}
      {:else}
        <div class="session-key-setup">
          {#if usageError}
            <p style="font-size:11px;color:#f85149;margin:0 0 8px;">{usageError}</p>
          {:else}
            <p style="font-size:12px;color:var(--text-primary);margin:0 0 8px;">Connect to claude.ai to see live usage limits</p>
          {/if}
          <label style="margin-bottom:6px;">Session Key
            <input type="password" bind:value={sessionKeyInput} placeholder="sk-ant-sid01-..." style="margin-top:4px;font-size:12px;" />
          </label>
          <p style="font-size:10px;color:var(--text-secondary);margin:0 0 10px;">Open <strong>claude.ai</strong> → DevTools (F12) → Application → Cookies → copy <strong>sessionKey</strong> value</p>
          <button class="save-key-btn" onclick={async () => {
            if (sessionKeyInput.trim()) {
              await invoke("save_session_key", { key: sessionKeyInput.trim() });
              sessionKeyConfigured = true;
              usageError = '';
              await loadUsageLimits();
              usageRefreshInterval = setInterval(loadUsageLimits, 5 * 60 * 1000);
            }
          }}>Connect</button>
        </div>
      {/if}

    {:else if settingsTab === 'plugins'}
      <div class="plugin-subtabs">
        <button class="plugin-subtab" class:active={pluginTab === 'installed'} onclick={() => pluginTab = 'installed'}>Installed ({claudePlugins.length})</button>
        <button class="plugin-subtab" class:active={pluginTab === 'marketplace'} onclick={() => pluginTab = 'marketplace'}>Marketplace</button>
      </div>

      {#if pluginTab === 'installed'}
        {#if claudePlugins.length === 0}
          <div class="plugin-empty">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--border)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
            <p>No plugins installed</p>
            <button class="plugin-browse-btn" onclick={() => pluginTab = 'marketplace'}>Browse Marketplace</button>
          </div>
        {:else}
          <div class="plugins-list">
            {#each claudePlugins as plugin}
              <div class="plugin-card">
                <div class="plugin-icon">{plugin.name.charAt(0).toUpperCase()}</div>
                <div class="plugin-info">
                  <span class="plugin-name">{plugin.name}</span>
                  <span class="plugin-cmd">{plugin.marketplace}{plugin.version && plugin.version !== 'unknown' ? ` · v${plugin.version}` : ''}</span>
                </div>
                <div class="plugin-actions">
                  <button class="toggle-switch plugin-toggle" class:on={plugin.enabled} onclick={() => togglePlugin(plugin)}>
                    <span class="toggle-knob"></span>
                  </button>
                  <button class="plugin-uninstall" onclick={() => uninstallPlugin(plugin)} title="Uninstall">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M6.5 1.75a.25.25 0 01.25-.25h2.5a.25.25 0 01.25.25V3h-3V1.75zM11 3V1.75A1.75 1.75 0 009.25 0h-2.5A1.75 1.75 0 005 1.75V3H2.75a.75.75 0 000 1.5h.928l.747 10.218A1.75 1.75 0 006.172 16h3.656a1.75 1.75 0 001.747-1.282L12.322 4.5h.928a.75.75 0 000-1.5H11z"/></svg>
                  </button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      {:else}
        <div style="margin-bottom:12px;">
          <input class="plugin-search full" type="text" bind:value={pluginSearch} placeholder="Search plugins..." />
        </div>
        <div class="plugins-list marketplace">
          {#each marketplacePlugins.filter(p => !p.installed && (!pluginSearch || p.name.toLowerCase().includes(pluginSearch.toLowerCase()) || (p.description || '').toLowerCase().includes(pluginSearch.toLowerCase()))) as plugin}
            <div class="plugin-card">
              <div class="plugin-icon mp">{plugin.name.charAt(0).toUpperCase()}</div>
              <div class="plugin-info">
                <span class="plugin-name">{plugin.name}</span>
                <span class="plugin-cmd">{plugin.description || ''}</span>
              </div>
              {#if plugin.installs}
                <span class="plugin-installs">{plugin.installs >= 1000 ? `${(plugin.installs / 1000).toFixed(0)}k` : plugin.installs}</span>
              {/if}
              <button class="plugin-install-btn" disabled={installingPlugin === plugin.name} onclick={() => installPlugin(plugin)}>
                {installingPlugin === plugin.name ? 'Installing...' : 'Install'}
              </button>
            </div>
          {:else}
            <div class="plugin-empty">
              <p>No plugins found</p>
            </div>
          {/each}
        </div>
      {/if}

    {:else if settingsTab === 'about'}
      <div class="about-content">
        <div class="about-header">
          <span class="about-app-name">Clauge</span>
          <span class="about-version">v{appVersion || '1.0.0'}</span>
        </div>
        <p class="about-desc">A developer toolkit for managing sessions, terminals, and workflows — all in one window.</p>

        <div class="about-section-label">TECH STACK</div>
        <div class="about-tech-grid">
          <span class="about-tech-pill">
            <svg viewBox="0 0 24 24" class="tech-icon"><circle cx="12" cy="12" r="3"/><path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z"/></svg>
            Rust
          </span>
          <span class="about-tech-pill">
            <svg viewBox="0 0 24 24" class="tech-icon"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/></svg>
            Tauri v2
          </span>
          <span class="about-tech-pill">
            <svg viewBox="0 0 24 24" class="tech-icon"><path d="M12.1 2L1 21h22L12.1 2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
            SvelteKit
          </span>
          <span class="about-tech-pill">
            <svg viewBox="0 0 24 24" class="tech-icon"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
            xterm.js
          </span>
        </div>

        <div class="about-section-label">LINKS</div>
        <div class="about-links">
          <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
          <span class="about-link-btn" onclick={() => openExternal('https://github.com/ansxuman/Clauge')}>
            <svg viewBox="0 0 24 24"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 00-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0020 4.77 5.07 5.07 0 0019.91 1S18.73.65 16 2.48a13.38 13.38 0 00-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 005 4.77a5.44 5.44 0 00-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 009 18.13V22"/></svg>
            <span>GitHub</span>
          </span>
          <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
          <span class="about-link-btn" onclick={() => openExternal('https://github.com/ansxuman/Clauge/issues')}>
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
            <span>Report Issue</span>
          </span>
          <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
          <span class="about-link-btn" onclick={() => openExternal('https://github.com/ansxuman')}>
            <svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            <span>Developer</span>
          </span>
          <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
          <span class="about-link-btn" onclick={() => openExternal('https://clauge.ssh-i.in')}>
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>
            <span>Website</span>
          </span>
        </div>

        <div class="about-section-label">SUPPORT</div>
        <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
        <span class="about-coffee" onclick={() => openExternal('https://buymeacoffee.com/ansxuman')}>
          <svg viewBox="0 0 24 24"><path d="M17 8h1a4 4 0 110 8h-1"/><path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8z"/><line x1="6" y1="2" x2="6" y2="4"/><line x1="10" y1="2" x2="10" y2="4"/><line x1="14" y1="2" x2="14" y2="4"/></svg>
          Buy me a coffee
        </span>

      </div>
    {/if}
      </div>
    </div>
  </div>
</div>
{/if}

{#if showWhatsNew && updateReady}
<div class="modal-backdrop" onclick={(e) => { if (e.target === e.currentTarget) showWhatsNew = false; }}>
  <div class="modal whats-new-modal">
    <h2>v{updateReady.version}</h2>
    <div class="whats-new-body">{@html (updateReady.body || '')
      .replace(/\r\n/g, '\n')
      .replace(/^### (.+)$/gm, '<h4>$1</h4>')
      .replace(/^## (.+)$/gm, '<h3>$1</h3>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/^\s*[-*] (.+)$/gm, '<li>$1</li>')
      .replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>')
      .replace(/\n\n+/g, '<br>')
      .replace(/\n/g, '<br>')
    }</div>
    <div class="modal-actions">
      <button onclick={() => showWhatsNew = false}>Later</button>
      <button class="create-btn" onclick={() => { showWhatsNew = false; restartToUpdate(); }}>Restart</button>
    </div>
  </div>
</div>
{/if}

{#if deleteConfirm}
<div class="modal-backdrop" style="animation:fadeIn 0.1s ease-out;">
  <div class="modal" style="max-width:360px;animation:slideIn 0.15s ease-out;">
    <div style="text-align:center;padding:20px 20px 0;">
      <svg width="32" height="32" viewBox="0 0 16 16" fill="#f85149" style="margin-bottom:12px;"><path d="M6.5 1.75a.25.25 0 01.25-.25h2.5a.25.25 0 01.25.25V3h-3V1.75zM11 3V1.75A1.75 1.75 0 009.25 0h-2.5A1.75 1.75 0 005 1.75V3H2.75a.75.75 0 000 1.5h.928l.747 10.218A1.75 1.75 0 006.172 16h3.656a1.75 1.75 0 001.747-1.282L12.322 4.5h.928a.75.75 0 000-1.5H11zm-5.522 1.5l.735 10.06a.25.25 0 00.249.19h3.076a.25.25 0 00.249-.19l.735-10.06H5.478z"/></svg>
      <h2 style="font-size:15px;margin-bottom:8px;">Delete this session?</h2>
      <p style="font-size:13px;color:var(--text-secondary);line-height:1.5;">
        Are you sure you want to delete the <strong style="color:var(--text-primary);">{deleteConfirm.projectName} — {deleteConfirm.purpose}</strong> session?
      </p>
    </div>
    <div class="modal-actions" style="padding:16px 20px;">
      <button onclick={() => deleteConfirm = null}>Cancel</button>
      <button style="background:#f85149 !important;border-color:transparent !important;color:#fff !important;" onclick={confirmDelete}>Delete</button>
    </div>
  </div>
</div>
{/if}


<style>
  :global(:root) {
    --sidebar-bg: rgba(22, 27, 34, 0.75);
    --term-bg: rgba(13, 17, 23, 0.85);
    --border: #30363d;
    --text-primary: #e6edf3;
    --text-secondary: #8b949e;
    --accent: #58a6ff;
  }
  :global(body) { margin: 0; padding: 0; overflow: hidden; background: transparent; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; color: var(--text-primary); }
  .drag-bar { position: fixed; top: 0; left: 0; right: 0; height: 38px; z-index: 9999; cursor: default; }
  .app-wrapper { display: flex; flex-direction: column; height: 100vh; width: 100vw; overflow: hidden; }
  .app { display: flex; flex: 1; min-height: 0; overflow: hidden; background: transparent; }

  .sidebar { width: 220px; min-width: 220px; background: var(--sidebar-bg); border-right: 1px solid var(--border); display: flex; flex-direction: column; user-select: none; transition: width 0.2s ease, min-width 0.2s ease, opacity 0.2s ease; overflow: hidden; }
  .sidebar.collapsed { width: 0; min-width: 0; border-right: none; opacity: 0; pointer-events: none; }
  .sidebar-toggle { position: absolute; left: 220px; top: 50%; transform: translateY(-50%); z-index: 50; width: 12px; height: 28px; border: none; border-radius: 0 4px 4px 0; background: transparent; color: var(--text-secondary); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: left 0.2s ease, background 0.15s, opacity 0.15s; -webkit-app-region: no-drag; opacity: 0; }
  .sidebar-toggle:hover, .app:hover .sidebar-toggle { opacity: 1; background: rgba(255,255,255,0.06); color: var(--text-primary); }
  .sidebar.collapsed ~ .sidebar-toggle { left: 0; }
  .sidebar-header { display: flex; align-items: center; justify-content: space-between; padding: 14px; padding-top: 38px; border-bottom: 1px solid var(--border); }
  .app-title { font-size: 15px; font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 6px; }
  .plan-badge { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; padding: 2px 6px; border-radius: 4px; background: linear-gradient(135deg, rgba(255,215,0,0.15), rgba(255,170,50,0.1)); color: #ffd700; border: 1px solid rgba(255,215,0,0.3); position: relative; overflow: hidden; }
  .plan-badge::after { content: ''; position: absolute; top: -50%; left: -100%; width: 60%; height: 200%; background: linear-gradient(90deg, transparent, rgba(255,215,0,0.2), transparent); animation: shine 3s ease-in-out infinite; }
  @keyframes shine { 0% { left: -100%; } 50% { left: 150%; } 100% { left: 150%; } }
  .header-actions { display: flex; gap: 6px; align-items: center; -webkit-app-region: no-drag; }
  .profile-wrap { position: relative; }
  .profile-avatar { width: 22px; height: 22px; border-radius: 50%; border: none; background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 60%, #000)); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: opacity 0.15s; padding: 0; overflow: hidden; }
  .profile-avatar:hover { opacity: 0.85; }
  .avatar-letter { font-size: 8px; font-weight: 700; text-transform: uppercase; }
  .profile-menu { position: absolute; bottom: calc(100% + 8px); left: 0; background: var(--sidebar-bg); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); z-index: 200; min-width: 180px; padding: 4px; animation: pmIn 0.12s ease; backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); }
  @keyframes pmIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
  .pm-item { width: 100%; display: flex; align-items: center; gap: 10px; padding: 8px 12px; border: none; background: transparent; color: var(--text-secondary); font-size: 12px; font-family: inherit; cursor: pointer; border-radius: 5px; transition: background 0.08s; white-space: nowrap; }
  .pm-item:hover { background: rgba(255,255,255,0.06); color: var(--text-primary); }
  .pm-item svg { width: 14px; height: 14px; stroke: var(--text-secondary); fill: none; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; flex-shrink: 0; }
  .pm-item:hover svg { stroke: var(--text-primary); }
  .pm-sep { height: 1px; background: var(--border); margin: 4px 8px; }
  .pm-coffee:hover { color: #e3b341; }
  .pm-coffee:hover svg { stroke: #e3b341; }
  .pm-external { width: 11px !important; height: 11px !important; margin-left: auto; opacity: 0.4; }
  .new-btn { width: 28px; height: 28px; border-radius: 6px; border: 1px solid var(--border); background: transparent; color: var(--text-primary); font-size: 18px; cursor: pointer; display: flex; align-items: center; justify-content: center; -webkit-app-region: no-drag; transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1); }
  .new-btn:hover { background: var(--border); transform: scale(1.1); }
  .new-btn:active { transform: scale(0.95); }

  .sidebar-content { flex: 1; overflow-y: auto; padding: 8px 0; -webkit-app-region: no-drag; }
  .empty-sidebar { padding: 24px 14px; text-align: center; color: var(--text-secondary); font-size: 13px; }
  .project-group { margin-bottom: 2px; }
  .project-header { display: flex; align-items: center; gap: 4px; width: 100%; padding: 6px 14px; font-size: 11px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; border: none; background: transparent; cursor: pointer; font-family: inherit; transition: color 0.15s; }
  .project-header:hover { color: var(--text-primary); }
  .chevron { transition: transform 0.15s; flex-shrink: 0; }
  .chevron.collapsed { transform: rotate(0deg); }
  .chevron:not(.collapsed) { transform: rotate(90deg); }
  .project-count { margin-left: auto; font-size: 10px; color: var(--text-secondary); opacity: 0.6; font-weight: 400; }
  .delete-confirm { padding: 8px 14px; font-size: 12px; color: var(--text-primary); display: flex; flex-direction: column; gap: 6px; animation: fadeIn 0.15s ease-out; }
  .delete-actions { display: flex; gap: 6px; }
  .del-yes { padding: 3px 10px; border-radius: 4px; border: 1px solid #f85149; background: transparent; color: #f85149; font-size: 11px; cursor: pointer; font-family: inherit; transition: all 0.15s; }
  .del-yes:hover { background: #f85149; color: #fff; }
  .del-no { padding: 3px 10px; border-radius: 4px; border: 1px solid var(--border); background: transparent; color: var(--text-secondary); font-size: 11px; cursor: pointer; font-family: inherit; }
  .del-no:hover { color: var(--text-primary); }
  .profile-item { width: 100%; display: block; text-align: left; padding: 8px 14px; border: none; background: transparent; cursor: pointer; border-left: 3px solid transparent; font-family: inherit; -webkit-app-region: no-drag; position: relative; }
  .profile-item:hover { background: var(--hover-bg, rgba(255,255,255,0.06)); }
  .profile-item.active { background: rgba(31,111,235,0.15); border-left-color: var(--accent); box-shadow: inset 0 0 20px rgba(88, 166, 255, 0.08); }
  .profile-title { font-size: 13px; font-weight: 500; color: var(--text-primary); margin-bottom: 3px; }
  .profile-meta { display: flex; align-items: center; justify-content: space-between; }
  .badge { font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 10px; }
  .wt-badge { font-size: 8px; font-weight: 700; padding: 1px 4px; border-radius: 3px; background: rgba(210, 168, 255, 0.2); color: #d2a8ff; letter-spacing: 0.5px; }
  .git-badge { font-size: 8px; font-weight: 600; padding: 1px 4px; border-radius: 3px; background: rgba(63, 185, 80, 0.2); color: #3fb950; }

  .profile-item { padding-right: 28px; }
  .ellipsis-btn { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); opacity: 0; padding: 4px; border-radius: 4px; color: var(--text-secondary); cursor: pointer; transition: opacity 0.15s, background 0.15s; z-index: 2; }
  .profile-item:hover .ellipsis-btn { opacity: 1; }
  .ellipsis-btn:hover { background: var(--hover-bg, rgba(255,255,255,0.08)); color: var(--text-primary); }

  .session-menu { position: absolute; right: 6px; top: calc(50% + 14px); background: #1c2128; border: 1px solid var(--border); border-radius: 8px; padding: 4px; min-width: 110px; box-shadow: 0 8px 24px rgba(0,0,0,0.4); z-index: 10; animation: fadeIn 0.1s ease-out; }
  .session-menu-item { display: flex; align-items: center; gap: 6px; width: 100%; padding: 6px 10px; border: none; background: transparent; color: var(--text-secondary); font-size: 12px; font-family: inherit; cursor: pointer; border-radius: 5px; transition: background 0.12s; }
  .session-menu-item:hover { background: rgba(255,255,255,0.06); }
  .session-menu-item.danger:hover { background: rgba(248,81,73,0.12); color: #f85149; }
  .time { font-size: 11px; color: var(--text-secondary); }
  .bottom-bar { display: flex; align-items: center; padding: 3px 16px; background: var(--sidebar-bg); border-top: 1px solid var(--border); flex-shrink: 0; }
  .bottom-left { width: 120px; flex-shrink: 0; }
  .bottom-center { flex: 1; display: flex; align-items: center; justify-content: center; gap: 12px; }
  .bottom-right { width: 120px; flex-shrink: 0; display: flex; align-items: center; justify-content: flex-end; }
  .bottom-version { font-size: 9px; color: var(--text-secondary); font-family: monospace; opacity: 0.4; }
  .update-hint { display: flex; align-items: center; gap: 4px; border: none; background: none; color: var(--accent); font-size: 10px; font-family: inherit; cursor: pointer; padding: 0; transition: opacity 0.15s; }
  .update-hint:hover { opacity: 0.7; }
  .update-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 6px color-mix(in srgb, var(--accent) 50%, transparent); animation: pulse 2s ease-in-out infinite; }
  .usage-chip { display: flex; align-items: center; gap: 5px; }
  .usage-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .usage-lbl { font-size: 10px; color: var(--text-secondary); font-weight: 500; }
  .usage-val { font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .usage-sep { width: 1px; height: 10px; background: var(--border); opacity: 0.5; }
  .usage-chips-clickable { display: flex; align-items: center; gap: 12px; cursor: pointer; padding: 2px 6px; border-radius: 6px; transition: background 0.15s; }
  .usage-chips-clickable:hover { background: rgba(255,255,255,0.04); }

  .usage-detail-row { display: flex; align-items: center; gap: 10px; }
  .usage-detail-label { font-size: 11px; font-weight: 500; color: var(--text-secondary); width: 52px; flex-shrink: 0; }
  .usage-detail-bar { flex: 1; height: 6px; background: rgba(255,255,255,0.06); border-radius: 3px; overflow: hidden; }
  .usage-detail-fill { height: 100%; border-radius: 3px; transition: width 0.5s ease; }
  .usage-detail-pct { font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; width: 42px; text-align: right; }
  .usage-detail-resets { font-size: 10px; color: var(--text-secondary); margin-top: 3px; padding-left: 62px; opacity: 0.7; }
  .limit-loading { font-size: 10px; color: var(--text-secondary); }


  .whats-new-modal { max-height: 70vh; display: flex; flex-direction: column; }
  .whats-new-body { flex: 1; overflow-y: auto; font-size: 13px; color: var(--text-secondary); line-height: 1.7; padding: 4px 0 12px; }
  .whats-new-body :global(h2) { font-size: 15px; color: var(--text-primary); margin: 14px 0 6px; font-weight: 600; }
  .whats-new-body :global(h3) { font-size: 15px; color: var(--text-primary); margin: 14px 0 6px; font-weight: 600; }
  .whats-new-body :global(h4) { font-size: 13px; color: var(--text-primary); margin: 10px 0 4px; font-weight: 500; }
  .whats-new-body :global(ul) { padding-left: 16px; margin: 4px 0; }
  .whats-new-body :global(li) { margin-bottom: 3px; }
  .whats-new-body :global(code) { font-family: monospace; font-size: 11px; background: rgba(255,255,255,0.06); padding: 1px 4px; border-radius: 3px; }
  .whats-new-body :global(strong) { color: var(--text-primary); font-weight: 600; }
  .session-key-setup, .key-status { margin-bottom: 14px; padding-bottom: 14px; border-bottom: 1px solid var(--border); }
  .key-status-row { display: flex; align-items: center; gap: 8px; }
  .key-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .key-dot.connected { background: #3fb950; box-shadow: 0 0 6px rgba(63, 185, 80, 0.5); }
  .save-key-btn { padding: 5px 14px; border-radius: 6px; border: 1px solid var(--accent); background: transparent; color: var(--accent); font-size: 11px; cursor: pointer; font-family: inherit; transition: all 0.15s; }
  .save-key-btn:hover { background: var(--accent); color: #fff; }

  .stg-modal { width: 600px; max-height: 80vh; background: var(--sidebar-bg); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 24px 48px rgba(0,0,0,0.5); overflow: hidden; animation: modalUp 0.18s ease; backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); }
  @keyframes modalUp { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: none; } }
  .stg-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--border); }
  .stg-title { font-size: 14px; font-weight: 600; color: var(--text-primary); }
  .stg-close { width: 24px; height: 24px; border: none; background: transparent; color: var(--text-secondary); font-size: 18px; cursor: pointer; display: flex; align-items: center; justify-content: center; border-radius: 4px; line-height: 1; transition: color 0.1s; }
  .stg-close:hover { color: var(--text-primary); }
  .stg-layout { display: flex; min-height: 400px; max-height: calc(80vh - 52px); }
  .stg-tabs { width: 140px; flex-shrink: 0; border-right: 1px solid var(--border); padding: 6px 0; display: flex; flex-direction: column; gap: 1px; background: rgba(0,0,0,0.1); }
  .stg-tab { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border: none; border-left: 2px solid transparent; background: transparent; color: var(--text-secondary); font-size: 12px; font-family: inherit; cursor: pointer; transition: all 0.08s; white-space: nowrap; }
  .stg-tab:hover { background: rgba(255,255,255,0.04); color: var(--text-primary); }
  .stg-tab.active { border-left-color: var(--accent); background: rgba(255,255,255,0.06); color: var(--text-primary); }
  .stg-tab svg { width: 15px; height: 15px; stroke: currentColor; fill: none; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; flex-shrink: 0; }
  .stg-content { flex: 1; padding: 20px 24px; overflow-y: auto; min-width: 0; }
  .stg-section { margin-bottom: 20px; }
  .stg-section-label { font-size: 11px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 10px; }
  .stg-field { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
  .stg-label { font-size: 12px; color: var(--text-secondary); }
  .stg-range { -webkit-appearance: none; width: 100px; height: 4px; border-radius: 2px; background: var(--border); outline: none; cursor: pointer; }
  .stg-range::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: var(--accent); cursor: pointer; border: 2px solid var(--sidebar-bg); box-shadow: 0 1px 3px rgba(0,0,0,0.3); }

  .plugins-list { display: flex; flex-direction: column; gap: 6px; }
  .plugin-card { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; background: rgba(255,255,255,0.02); transition: background 0.1s; }
  .plugin-card:hover { background: rgba(255,255,255,0.04); }
  .plugin-info { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
  .plugin-name { font-size: 12px; font-weight: 600; color: var(--text-primary); }
  .plugin-cmd { font-size: 10px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .plugin-toggle { flex-shrink: 0; }
  .plugin-search { padding: 4px 8px; border-radius: 4px; border: 1px solid var(--border); background: transparent; color: var(--text-primary); font-size: 11px; font-family: inherit; width: 120px; }
  .plugin-search::placeholder { color: var(--text-secondary); }
  .plugin-search:focus { border-color: var(--accent); outline: none; }
  .plugins-list.marketplace { max-height: 240px; overflow-y: auto; }
  .plugin-icon { width: 28px; height: 28px; border-radius: 6px; background: rgba(255,255,255,0.06); color: var(--text-secondary); font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .plugin-icon.mp { background: rgba(255,255,255,0.03); color: var(--text-secondary); }
  .plugin-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
  .plugin-uninstall { border: none; background: transparent; color: var(--text-secondary); cursor: pointer; padding: 3px; border-radius: 4px; display: flex; align-items: center; opacity: 0; transition: all 0.1s; }
  .plugin-card:hover .plugin-uninstall { opacity: 1; }
  .plugin-uninstall:hover { background: rgba(248,81,73,0.12); color: #f85149; }
  .plugin-install-btn { padding: 4px 12px; border-radius: 5px; border: 1px solid var(--accent); background: transparent; color: var(--accent); font-size: 11px; font-family: inherit; cursor: pointer; transition: all 0.15s; flex-shrink: 0; white-space: nowrap; }
  .plugin-install-btn:hover:not(:disabled) { background: var(--accent); color: #fff; }
  .plugin-install-btn:disabled { opacity: 0.5; cursor: wait; }
  .plugin-installs { font-size: 10px; color: var(--text-secondary); opacity: 0.5; flex-shrink: 0; font-variant-numeric: tabular-nums; }
  .plugin-subtabs { display: flex; gap: 0; margin-bottom: 16px; border-bottom: 1px solid var(--border); }
  .plugin-subtab { flex: 1; padding: 8px; border: none; background: transparent; color: var(--text-secondary); font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; border-bottom: 2px solid transparent; transition: all 0.15s; }
  .plugin-subtab.active { color: var(--accent); border-bottom-color: var(--accent); }
  .plugin-subtab:hover { color: var(--text-primary); }
  .plugin-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 40px 0; color: var(--text-secondary); font-size: 12px; }
  .plugin-browse-btn { padding: 6px 16px; border-radius: 6px; border: 1px solid var(--accent); background: transparent; color: var(--accent); font-size: 12px; font-family: inherit; cursor: pointer; transition: all 0.15s; margin-top: 4px; }
  .plugin-browse-btn:hover { background: var(--accent); color: #fff; }
  .plugin-search.full { width: 100%; }
  .plugins-list.marketplace { max-height: none; overflow-y: auto; }

  .update-notif { position: fixed; bottom: 40px; right: 16px; width: 320px; background: var(--sidebar-bg); border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 8px 32px rgba(0,0,0,0.5); padding: 14px; z-index: 900; animation: unSlideUp 0.25s cubic-bezier(0.4, 0, 0.2, 1); display: flex; flex-direction: column; gap: 12px; backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); }
  @keyframes unSlideUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
  .un-header { display: flex; align-items: flex-start; gap: 10px; }
  .un-icon { width: 18px; height: 18px; stroke: var(--accent); fill: none; stroke-width: 1.6; stroke-linecap: round; flex-shrink: 0; margin-top: 1px; }
  .un-text { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .un-title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
  .un-desc { font-size: 11px; color: var(--text-secondary); }
  .un-close { width: 20px; height: 20px; border: none; background: transparent; color: var(--text-secondary); font-size: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center; border-radius: 4px; flex-shrink: 0; line-height: 1; transition: color 0.1s; }
  .un-close:hover { color: var(--text-primary); }
  .un-actions { display: flex; gap: 8px; }
  .un-btn { height: 30px; padding: 0 14px; border-radius: 6px; font-size: 12px; font-family: inherit; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 5px; transition: opacity 0.12s; }
  .un-btn.primary { border: none; background: var(--accent); color: #fff; }
  .un-btn.primary:hover { opacity: 0.85; }
  .un-btn.secondary { border: 1px solid var(--border); background: transparent; color: var(--text-secondary); }
  .un-btn.secondary:hover { border-color: var(--text-secondary); color: var(--text-primary); }

  .about-content { display: flex; flex-direction: column; gap: 18px; }
  .about-header { display: flex; align-items: baseline; gap: 10px; }
  .about-app-name { font-size: 24px; font-weight: 700; color: var(--text-primary); letter-spacing: -0.5px; }
  .about-version { font-size: 12px; color: var(--accent); font-family: monospace; font-weight: 600; background: color-mix(in srgb, var(--accent) 12%, transparent); padding: 2px 8px; border-radius: 4px; }
  .about-desc { font-size: 12px; color: var(--text-secondary); line-height: 1.5; margin: 0; }
  .about-section-label { font-size: 10px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.6; }
  .about-tech-grid { display: flex; flex-wrap: wrap; gap: 6px; }
  .about-tech-pill { font-size: 11px; font-family: monospace; color: var(--text-secondary); background: rgba(255,255,255,0.04); border: 1px solid var(--border); padding: 5px 12px; border-radius: 6px; display: flex; align-items: center; gap: 6px; }
  .about-tech-pill .tech-icon { width: 14px; height: 14px; stroke: var(--text-secondary); fill: none; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; flex-shrink: 0; }
  .about-links { display: flex; gap: 8px; flex-wrap: wrap; }
  .about-link-btn { display: flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--border); background: transparent; color: var(--text-secondary); font-size: 11px; cursor: pointer; transition: all 0.12s; }
  .about-link-btn:hover { border-color: var(--text-secondary); color: var(--text-primary); background: rgba(255,255,255,0.03); }
  .about-link-btn svg { width: 14px; height: 14px; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .about-coffee { display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-radius: 8px; border: 1px solid rgba(245,166,35,0.3); background: rgba(245,166,35,0.06); color: #f5a623; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.12s; }
  .about-coffee:hover { background: rgba(245,166,35,0.12); border-color: rgba(245,166,35,0.5); }
  .about-coffee svg { width: 18px; height: 18px; stroke: #f5a623; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }


  .terminal-wrapper { flex: 1; min-width: 0; display: flex; height: 100%; overflow: hidden; }
  .terminal-area { flex: 1; min-width: 0; height: 100%; background: var(--term-bg); position: relative; overflow: hidden; -webkit-app-region: no-drag; }
  .terminal-panel { width: 100%; height: 100%; padding: 4px; -webkit-app-region: no-drag; }
  .shell-divider { width: 4px; background: transparent; flex-shrink: 0; cursor: col-resize; position: relative; }
  .shell-divider::after { content: ''; position: absolute; left: 1px; top: 0; bottom: 0; width: 1px; background: var(--border); }
  .shell-divider:hover::after { background: var(--accent); width: 2px; left: 1px; }
  .shell-area { min-width: 0; height: 100%; display: flex; flex-direction: column; background: var(--term-bg); overflow: hidden; transition: width 0.15s ease; }
  .shell-area.no-transition { transition: none; }
  .shell-panel { flex: 1; padding: 4px; min-width: 0; overflow: hidden; }
  .shell-panel :global(.xterm) { height: 100%; }
  .shell-panel :global(.xterm-viewport) { overflow-y: auto !important; }
  .shell-panel :global(.xterm-viewport::-webkit-scrollbar) { width: 8px; }
  .shell-panel :global(.xterm-viewport::-webkit-scrollbar-thumb) { background: var(--border); border-radius: 4px; }
  .shell-toggle-btn { border: none; background: transparent; color: var(--text-secondary); cursor: pointer; padding: 2px; border-radius: 4px; display: flex; align-items: center; justify-content: center; transition: all 0.15s; margin-right: 6px; }
  .shell-toggle-btn:hover:not(:disabled) { color: var(--text-primary); }
  .shell-toggle-btn.active { color: var(--accent); }
  .shell-toggle-btn:disabled { opacity: 0.3; cursor: default; }
  .terminal-panel :global(.xterm) { height: 100%; }
  .terminal-panel :global(.xterm-viewport) { overflow-y: auto !important; }
  .terminal-panel :global(.xterm-viewport::-webkit-scrollbar) { width: 8px; }
  .terminal-panel :global(.xterm-viewport::-webkit-scrollbar-thumb) { background: var(--border); border-radius: 4px; }
  .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 12px; position: absolute; inset: 0; }
  .empty-title { font-size: 16px; font-weight: 500; color: var(--text-primary); }
  .empty-sub { font-size: 13px; color: var(--text-secondary); }

  .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 1000; animation: fadeIn 0.15s ease-out; }
  .modal { background: #161b22; border: 1px solid var(--border); border-radius: 12px; padding: 20px; width: 420px; max-width: 90vw; animation: slideIn 0.2s ease-out; }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes slideIn { from { opacity: 0; transform: translateY(-10px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
  .modal h2 { font-size: 15px; color: var(--text-primary); margin: 0 0 16px; }
  .modal label { display: block; font-size: 12px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 12px; }
  .modal input { width: 100%; background: var(--input-bg, #0d1117); border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; font-size: 13px; color: var(--text-primary); outline: none; box-sizing: border-box; margin-top: 4px; }
  .modal input:focus { border-color: var(--accent); }
  .row { display: flex; gap: 8px; margin-top: 4px; }
  .row input { flex: 1; margin-top: 0; }
  .row button { background: var(--btn-bg, #21262d); border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; color: var(--text-primary); font-size: 13px; cursor: pointer; white-space: nowrap; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
  .chip { padding: 5px 12px; border-radius: 14px; border: 1px solid var(--border); background: transparent; color: var(--text-secondary); font-size: 12px; cursor: pointer; font-family: inherit; transition: all 0.15s; }
  .chip:hover { border-color: var(--text-secondary); }
  .chip:focus { outline: none; }
  .chip.selected { font-weight: 600; }
  .session-select { width: 100%; margin-top: 6px; padding: 7px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--btn-bg, #21262d); color: var(--text-primary); font-size: 12px; font-family: inherit; appearance: none; cursor: pointer; }
  .session-select option { background: #1c2128; color: var(--text-primary); }
  .custom-prompt { width: 100%; margin-top: 6px; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--btn-bg, #21262d); color: var(--text-primary); font-size: 12px; font-family: inherit; resize: vertical; min-height: 60px; line-height: 1.5; }
  .custom-prompt::placeholder { color: var(--text-secondary); }
  .toggle-row { display: flex; align-items: center; justify-content: space-between; margin-top: 12px; }
  .toggle-label { font-size: 12px; color: var(--text-secondary); display: flex; align-items: center; gap: 6px; }
  .toggle-tooltip { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 50%; border: 1px solid var(--border); font-size: 10px; color: var(--text-secondary); cursor: default; position: relative; }
  .toggle-tooltip:hover::after { content: 'Bypasses all permission prompts. Claude will execute commands, edit files, and make changes without asking.'; position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%); background: #1c2128; border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; font-size: 11px; color: var(--text-primary); white-space: normal; width: 220px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); z-index: 100; line-height: 1.4; }
  .toggle-switch { width: 36px; height: 20px; border-radius: 10px; border: 1px solid var(--border); background: rgba(255,255,255,0.06); cursor: pointer; position: relative; transition: all 0.2s; padding: 0; }
  .toggle-switch.on { background: var(--accent); border-color: var(--accent); }
  .toggle-knob { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: var(--text-secondary); transition: all 0.2s; }
  .toggle-switch.on .toggle-knob { left: 18px; background: #fff; }
  .modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
  .modal-actions button { padding: 7px 16px; border-radius: 6px; font-size: 13px; cursor: pointer; border: 1px solid var(--border); background: var(--btn-bg, #21262d); color: var(--text-primary); font-family: inherit; }
  .create-btn { background: var(--accent) !important; border-color: transparent !important; color: #fff !important; }
  .create-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .status-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #484f58; margin-right: 6px; vertical-align: middle; transition: background 0.3s; }
  .status-dot.active { background: #3fb950; box-shadow: 0 0 6px rgba(63, 185, 80, 0.5); }
  .status-dot.bg-active { background: var(--accent); box-shadow: 0 0 6px color-mix(in srgb, var(--accent) 50%, transparent); animation: bgPulse 0.8s ease-in-out infinite; }
  .status-dot.bg-done { background: #d29922; box-shadow: 0 0 6px rgba(210, 153, 34, 0.5); }
  @keyframes bgPulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.7); } }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
  .purpose-glow { position: absolute; top: 0; left: 0; right: 0; height: 60px; z-index: 1; pointer-events: none; animation: glowFadeIn 0.5s ease-out; }
  @keyframes glowFadeIn { from { opacity: 0; } to { opacity: 1; } }

  /* Settings modal */
  .modal { background: var(--modal-bg, #161b22); }
  .accent-row { display: flex; gap: 10px; margin-top: 8px; }
  .color-dot { width: 28px; height: 28px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; transition: transform 0.15s; }
  .color-dot:hover { transform: scale(1.15); }

</style>

<script>
  import { onMount } from "svelte";
  import { invoke, Channel } from "@tauri-apps/api/core";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import "@xterm/xterm/css/xterm.css";
  import { theme } from "$lib/stores/theme.svelte";
  import { notifications } from "$lib/stores/notifications.svelte";
  import { updater } from "$lib/stores/updater.svelte";
  import { pluginsStore } from "$lib/stores/plugins.svelte";
  import { contextsStore } from "$lib/stores/contexts.svelte";
  import { usageStore } from "$lib/stores/usage.svelte";
  import { gitStore } from "$lib/stores/git.svelte";
  import { terminalStore } from "$lib/stores/terminal.svelte";
  import { shellStore } from "$lib/stores/shell.svelte";
  import DeleteConfirmModal from "$lib/components/DeleteConfirmModal.svelte";
  import UpdateToast from "$lib/components/UpdateToast.svelte";
  import BottomBar from "$lib/components/BottomBar.svelte";
  import SettingsModal from "$lib/components/SettingsModal.svelte";
  import UsageDashboard from "$lib/components/UsageDashboard.svelte";

  let profiles = $state([]);
  let activeProfile = $state(null);
  let showModal = $state(false);
  let showSettings = $state(false);
  let settingsTab = $state('settings');
  // Context manager — state lives in contextsStore
  let terminalEl;
  let statusMsg = $state("Ready");
  let tokenUsage = $state(null);
  let tokenInterval = null;
  let appVersion = $state('');
  let claudePlan = $state('');
  let sidebarCollapsed = $state(
    typeof localStorage !== 'undefined' ? localStorage.getItem('clauge-sidebar-collapsed') === 'true' : false
  );

  function toggleSidebar() {
    sidebarCollapsed = !sidebarCollapsed;
    localStorage.setItem('clauge-sidebar-collapsed', String(sidebarCollapsed));
    // Refit all terminals after transition
    setTimeout(() => {
      for (const [, entry] of terminalStore.terminalMap) {
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
  // Git state lives in gitStore

  // Terminal management — one xterm per profile, switch between them (state in terminalStore)
  let shellEl;
  let wrapperEl;
  // Shell terminal management — one shell per profile (state in shellStore)
  let shellOpen = $derived(activeProfile ? (shellStore.shellStore.shellOpenMap[activeProfile.id] ?? false) : false);

  // Modal state
  let modalPath = $state("");
  let modalTitle = $state("");
  let modalPurpose = $state("");
  let modalSkipPermissions = $state(false);
  let modalExistingSessions = $state([]);
  let modalSelectedSession = $state("");
  let modalCustomPrompt = $state("");
  let modalGitEnabled = $state(false);
  let modalGitName = $state("");
  let modalGitEmail = $state("");

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
  function applyTheme(themeName) {
    const { termTheme, cursor } = theme.applyTheme(themeName);
    // Update all existing terminals
    for (const [, entry] of terminalStore.terminalMap) {
      if (entry.term) entry.term.options.theme = { ...termTheme, cursor };
    }
  }

  function applyAccent(color) {
    const { termTheme, cursor } = theme.applyAccent(color);
    for (const [, entry] of terminalStore.terminalMap) { if (entry.term) entry.term.options.theme = { ...termTheme, cursor }; }
    for (const [, entry] of shellStore.shellMap) { if (entry.term) entry.term.options.theme = { ...termTheme, cursor }; }
  }

  async function loadProfiles() {
    try {
      profiles = await invoke("refresh_session_ids");
    } catch (e) {
      try { profiles = await invoke("get_profiles"); } catch (e2) { statusMsg = "Load failed: " + e2; }
    }
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
    const t = new Terminal(terminalStore.getTermConfig());
    const fa = new FitAddon();
    t.loadAddon(fa);

    const container = document.createElement("div");
    container.style.cssText = "width:100%;height:100%;display:none;";
    terminalEl.appendChild(container);
    t.open(container);
    loadWebGLAddon(t);

    t.onData((data) => {
      const entry = terminalStore.terminalMap.get(profileId);
      if (entry?.terminalId) invoke("write_to_terminal", { terminalId: entry.terminalId, data });
    });

    new ResizeObserver(() => {
      if (fa && container.offsetWidth > 0) requestAnimationFrame(() => { try { fa.fit(); } catch(_) {} });
    }).observe(container);

    const entry = { term: t, fitAddon: fa, container, terminalId: null, channel: null };
    terminalStore.terminalMap.set(profileId, entry);
    return entry;
  }

  function showTermEntry(entry) {
    if (terminalStore.activeTermEntry && terminalStore.activeTermEntry !== entry) {
      terminalStore.activeTermEntry.container.style.display = "none";
      // Reduce scrollback on inactive terminal to save memory
      try { terminalStore.activeTermEntry.term.options.scrollback = 1000; } catch(_) {}
    }
    entry.container.style.display = "block";
    // Restore full scrollback on active terminal
    try { entry.term.options.scrollback = 10000; } catch(_) {}
    terminalStore.activeTermEntry = entry;
    terminalStore.currentTerminalId = entry.terminalId;
    requestAnimationFrame(() => { try { entry.fitAddon.fit(); } catch(_) {} });
  }

  function createShellEntry(profileId) {
    const t = new Terminal({ ...terminalStore.getTermConfig(), scrollback: 5000 });
    const fa = new FitAddon();
    t.loadAddon(fa);

    const container = document.createElement("div");
    container.style.cssText = "width:100%;height:100%;display:none;";
    shellEl.appendChild(container);
    t.open(container);
    loadWebGLAddon(t);

    t.onData((data) => {
      const sEntry = shellStore.shellMap.get(profileId);
      if (sEntry?.terminalId) {
        invoke("write_to_terminal", { terminalId: sEntry.terminalId, data }).catch(() => {
          // Shell process died — close shell panel
          sEntry.terminalId = null;
          if (activeProfile) {
            shellStore.shellOpenMap[activeProfile.id] = false;
            shellStore.shellOpenMap = {...shellStore.shellOpenMap};
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
    shellStore.shellMap.set(profileId, sEntry);
    return sEntry;
  }

  function showShellEntry(sEntry) {
    if (shellStore.activeShellEntry && shellStore.activeShellEntry !== sEntry) {
      shellStore.activeShellEntry.container.style.display = "none";
      try { shellStore.activeShellEntry.term.options.scrollback = 500; } catch(_) {}
    }
    sEntry.container.style.display = "block";
    try { sEntry.term.options.scrollback = 5000; } catch(_) {}
    shellStore.activeShellEntry = sEntry;
    requestAnimationFrame(() => { try { sEntry.fitAddon.fit(); } catch(_) {} });
  }

  async function spawnShellForProfile(profile) {
    if (!shellEl) return;
    let sEntry = shellStore.shellMap.get(profile.id);
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
    shellStore.isDraggingDivider = true;

    let fitTimer = null;
    function onMove(ev) {
      const rect = wrapper.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const pct = (x / rect.width) * 100;
      if (activeProfile) {
        shellStore.shellWidthMap[activeProfile.id] = Math.max(20, Math.min(80, 100 - pct));
        shellStore.shellWidthMap = {...shellStore.shellWidthMap};
      }
      // Throttle fit calls to every 100ms during drag — prevents xterm jank
      if (!fitTimer) {
        fitTimer = setTimeout(() => {
          fitTimer = null;
          try { terminalStore.activeTermEntry?.fitAddon?.fit(); } catch(_) {}
          try { shellStore.activeShellEntry?.fitAddon?.fit(); } catch(_) {}
        }, 100);
      }
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      shellStore.isDraggingDivider = false;
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
      shellStore.shellOpenMap[activeProfile.id] = newState;
      shellStore.shellOpenMap = {...shellStore.shellOpenMap};
    }
    if (newState && activeProfile) {
      // Wait for DOM to render the shell panel
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          spawnShellForProfile(activeProfile);
          // Refit Claude terminal since width changed
          if (terminalStore.activeTermEntry?.fitAddon) {
            try {
              terminalStore.activeTermEntry.fitAddon.fit();
              if (terminalStore.activeTermEntry.terminalId) {
                const dims = terminalStore.activeTermEntry.fitAddon.proposeDimensions();
                if (dims) invoke("resize_terminal", { terminalId: terminalStore.activeTermEntry.terminalId, cols: dims.cols, rows: dims.rows }).catch(() => {});
              }
            } catch(_) {}
          }
        });
      });
    } else {
      // Refit Claude terminal to take full width — double rAF to wait for layout
      if (terminalStore.activeTermEntry?.fitAddon) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            try {
              terminalStore.activeTermEntry.fitAddon.fit();
              if (terminalStore.activeTermEntry.terminalId) {
                const dims = terminalStore.activeTermEntry.fitAddon.proposeDimensions();
                if (dims) invoke("resize_terminal", { terminalId: terminalStore.activeTermEntry.terminalId, cols: dims.cols, rows: dims.rows }).catch(() => {});
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
    if (terminalStore.sessionActivity[profile.id]) {
      delete terminalStore.sessionActivity[profile.id];
      terminalStore.sessionActivity = { ...terminalStore.sessionActivity };
    }
    let entry = terminalStore.terminalMap.get(profile.id);

    if (entry && entry.terminalId) {
      showTermEntry(entry);
      if (shellOpen) spawnShellForProfile(profile);
      statusMsg = profile.title;
      refreshGitStatus();
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
          notifications.checkForActionPrompt(payload.data, profile.title);
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
              terminalStore.sessionActivity[profileId] = 'done';
              terminalStore.sessionActivity = { ...terminalStore.sessionActivity };
              // Auto-close: hide terminal, switch to another session or show empty state
              entry.container.style.display = "none";
              if (activeProfile?.id === profileId) {
                const otherProfile = profiles.find(p => p.id !== profileId && terminalStore.terminalMap.get(p.id)?.terminalId);
                if (otherProfile) {
                  selectProfile(otherProfile);
                } else {
                  activeProfile = null;
                  terminalStore.activeTermEntry = null;
                  terminalStore.currentTerminalId = null;
                }
              }
            }
          } catch(_) {}
          // Track activity for background sessions
          if (activeProfile?.id !== profileId) {
            terminalStore.sessionActivity[profileId] = 'active';
            terminalStore.sessionActivity = { ...terminalStore.sessionActivity };
            // After 2s of no new output, mark as done (Claude finished responding)
            if (activityTimer) clearTimeout(activityTimer);
            activityTimer = setTimeout(() => {
              if (terminalStore.sessionActivity[profileId] === 'active') {
                terminalStore.sessionActivity[profileId] = 'done';
                terminalStore.sessionActivity = { ...terminalStore.sessionActivity };
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
        terminalStore.currentTerminalId = tid;
        statusMsg = profile.title;
        showTermEntry(entry);
        if (shellOpen) spawnShellForProfile(profile);

        refreshGitStatus();

        // Inject attached contexts into CLAUDE.md
        if (profile.contexts && profile.contexts.length > 0) {
          invoke("inject_session_context", { projectPath: spawnPath, contextNames: profile.contexts }).catch(() => {});
        }

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
        gitName: modalGitEnabled && modalGitName.trim() ? modalGitName.trim() : null,
        gitEmail: modalGitEnabled && modalGitEmail.trim() ? modalGitEmail.trim() : null,
        contexts: contextsStore.modalContexts.length > 0 ? contextsStore.modalContexts : null,
      });
      // Link existing session if selected (Custom purpose only)
      if (modalSelectedSession) {
        await invoke("update_session_id", { id: profile.id, claudeSessionId: modalSelectedSession });
        profile.claudeSessionId = modalSelectedSession;
      }
      showModal = false;
      modalPath = ""; modalTitle = ""; modalPurpose = ""; modalSkipPermissions = false;
      modalExistingSessions = []; modalSelectedSession = ""; modalCustomPrompt = "";
      modalGitEnabled = false; modalGitName = ""; modalGitEmail = ""; contextsStore.modalContexts = []; contextsStore.modalContextEnabled = false; contextsStore.showContextDropdown = false;
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
    const entry = terminalStore.terminalMap.get(deletedId);
    if (entry) {
      if (entry.terminalId) {
        try { await invoke("kill_terminal", { terminalId: entry.terminalId }); } catch(e) {}
      }
      entry.container.style.display = "none";
      if (entry.term) entry.term.dispose();
      terminalStore.terminalMap.delete(deletedId);
    }

    // Clean up shell (backend PTY + child process)
    const sEntry = shellStore.shellMap.get(deletedId);
    if (sEntry) {
      if (sEntry.terminalId) {
        try { await invoke("kill_terminal", { terminalId: sEntry.terminalId }); } catch(e) {}
      }
      sEntry.container.style.display = "none";
      if (sEntry.term) sEntry.term.dispose();
      shellStore.shellMap.delete(deletedId);
    }

    if (activeProfile?.id === deletedId) {
      activeProfile = null;
      terminalStore.activeTermEntry = null;
      shellStore.activeShellEntry = null;
      terminalStore.currentTerminalId = null;
    }
    delete shellStore.shellOpenMap[deletedId];
    delete shellStore.shellWidthMap[deletedId];
    shellStore.shellOpenMap = {...shellStore.shellOpenMap};
    shellStore.shellWidthMap = {...shellStore.shellWidthMap};

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

  // Git helpers — delegates to gitStore, passing resolved projectPath
  function gitPath() { return activeProfile?.worktreePath || activeProfile?.projectPath || ''; }
  function gitProfileId() { return activeProfile?.id; }
  function refreshGitStatus() { if (activeProfile) gitStore.refreshGitStatus(gitPath(), gitProfileId()); }
  function doGitCommit() { if (activeProfile) gitStore.doGitCommit(gitPath()); }
  function doGitCommitStaged() { if (activeProfile) gitStore.doGitCommitStaged(gitPath()); }
  function doGitPush() { if (activeProfile) gitStore.doGitPush(gitPath()); }
  function doGitPull() { if (activeProfile) gitStore.doGitPull(gitPath()); }
  function viewDiff(file) { if (activeProfile) gitStore.viewDiff(gitPath(), file); }
  function toggleStageFile(file) { if (activeProfile) gitStore.toggleStageFile(gitPath(), gitProfileId(), file); }
  function loadGitHistory() { if (activeProfile) gitStore.loadGitHistory(gitPath()); }
  function loadGitBranches() { if (activeProfile) gitStore.loadGitBranches(gitPath()); }
  function switchBranch(branchName) { if (activeProfile) gitStore.switchBranch(gitPath(), gitProfileId(), branchName); }
  function doGitStash() { if (activeProfile) gitStore.doGitStash(gitPath(), gitProfileId()); }
  function doGitStashPop() { if (activeProfile) gitStore.doGitStashPop(gitPath(), gitProfileId()); }

  function handleFileDrop(e) {
    if (!terminalStore.activeTermEntry?.terminalId) return;
    // Try web File API path (Tauri exposes file.path)
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      const paths = Array.from(files).map(f => f.path || f.name).filter(Boolean);
      if (paths.length > 0) {
        const text = paths.map(p => p.includes(' ') ? `"${p}"` : p).join(' ');
        invoke("write_to_terminal", { terminalId: terminalStore.activeTermEntry.terminalId, data: text }).catch(() => {});
        return;
      }
    }
    // Fallback: try text/uri-list
    const uriList = e.dataTransfer?.getData('text/uri-list');
    if (uriList) {
      const paths = uriList.split('\n').filter(l => l && !l.startsWith('#')).map(u => {
        try { return decodeURIComponent(new URL(u).pathname); } catch(_) { return u; }
      });
      if (paths.length > 0) {
        const text = paths.map(p => p.includes(' ') ? `"${p}"` : p).join(' ');
        invoke("write_to_terminal", { terminalId: terminalStore.activeTermEntry.terminalId, data: text }).catch(() => {});
      }
    }
  }

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
    if (e.key === 'Escape') { showModal = false; showSettings = false; modalExistingSessions = []; modalSelectedSession = ""; modalCustomPrompt = ""; modalGitEnabled = false; modalGitName = ""; modalGitEmail = ""; contextsStore.modalContexts = []; contextsStore.modalContextEnabled = false; contextsStore.showContextDropdown = false; }
  }

  function handleWindowResize() {
    requestAnimationFrame(() => {
      if (terminalStore.activeTermEntry?.fitAddon && terminalStore.activeTermEntry.container.offsetWidth > 0) {
        try {
          terminalStore.activeTermEntry.fitAddon.fit();
          if (terminalStore.activeTermEntry.terminalId) {
            const dims = terminalStore.activeTermEntry.fitAddon.proposeDimensions();
            if (dims) invoke("resize_terminal", { terminalId: terminalStore.activeTermEntry.terminalId, cols: dims.cols, rows: dims.rows }).catch(() => {});
          }
        } catch(_) {}
      }
      if (shellStore.activeShellEntry?.fitAddon && shellStore.activeShellEntry.container.offsetWidth > 0) {
        try {
          shellStore.activeShellEntry.fitAddon.fit();
          if (shellStore.activeShellEntry.terminalId) {
            const dims = shellStore.activeShellEntry.fitAddon.proposeDimensions();
            if (dims) invoke("resize_terminal", { terminalId: shellStore.activeShellEntry.terminalId, cols: dims.cols, rows: dims.rows }).catch(() => {});
          }
        } catch(_) {}
      }
    });
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



  onMount(() => {
    applyTheme(theme.currentTheme);
    invoke("get_app_version").then(v => {
      appVersion = v;
      updater.checkWhatsNew(v);
      updater.checkAndDownloadUpdate();
    }).catch(() => {});
    invoke("get_claude_plan").then(p => { if (p) claudePlan = p; }).catch(() => {});


    // Listen for Tauri native file drop events
    import("@tauri-apps/api/webviewWindow").then(({ getCurrentWebviewWindow }) => {
      getCurrentWebviewWindow().onDragDropEvent((event) => {
        if (event.payload.type === 'drop' && terminalStore.activeTermEntry?.terminalId) {
          const paths = event.payload.paths || [];
          if (paths.length > 0) {
            const text = paths.map(p => p.includes(' ') ? `"${p}"` : p).join(' ');
            invoke("write_to_terminal", { terminalId: terminalStore.activeTermEntry.terminalId, data: text }).catch(() => {});
          }
        }
      });
    }).catch(() => {});

    // Priority 1: Load profiles (fast, <10ms)
    loadProfiles();

    // Priority 2: Load session key + usage limits (fast key read, then ~1.5s API call)
    invoke("load_session_key").then(savedKey => {
      if (savedKey) {
        usageStore.sessionKeyInput = savedKey;
        usageStore.sessionKeyConfigured = true;
        usageStore.loadUsageLimits();
        usageStore.startRefreshInterval();
      }
    }).catch(() => {});

    // Poll git status every 5 seconds when a session is active
    setInterval(() => { if (activeProfile) refreshGitStatus(); }, 5000);

  });
</script>

<svelte:window onkeydown={handleGlobalKeydown} onresize={handleWindowResize} onclick={() => { menuProfile = null; profileMenuOpen = false; gitStore.gitPanelOpen = false; contextsStore.showContextDropdown = false; }} oncontextmenu={(e) => { if (!import.meta.env.DEV) e.preventDefault(); }} />

<div class="app-wrapper">
<div class="app">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="drag-bar" onmousedown={handleDragStart}></div>
  <aside class="sidebar" class:collapsed={sidebarCollapsed}>
    <div class="sidebar-header">
      <span class="app-title">Clauge {#if claudePlan}<span class="plan-badge">{claudePlan}</span>{/if}</span>
      <div class="header-actions">
        <button class="new-btn" onclick={() => { showModal = true; contextsStore.loadContextSnippets(); }} title="New Session (Cmd+N)">+</button>
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
                      <span class="status-dot" class:active={activeProfile?.id === profile.id} class:bg-active={terminalStore.sessionActivity[profile.id] === 'active'} class:bg-done={terminalStore.sessionActivity[profile.id] === 'done'}></span>
                      {profile.title}
                    </div>
                    <div class="profile-meta">
                      <span class="badge" style="color:{purposeColors[profile.purpose] || '#8b949e'}; background:{purposeColors[profile.purpose] || '#8b949e'}22">{profile.purpose}</span>
                      {#if profile.worktreeBranch}
                        <span class="wt-badge" title="Isolated worktree: {profile.worktreeBranch}">WT</span>
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
                        <button class="session-menu-item" onclick={() => { menuProfile = null; contextsStore.showContextPicker = profile; contextsStore.loadContextSnippets(); }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                          Add Contexts
                        </button>
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
    <div class="terminal-area" class:panel-focused={shellStore.focusedPanel === 'claude'} onclick={() => shellStore.focusedPanel = 'claude'}
      ondragover={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
      ondrop={(e) => { e.preventDefault(); handleFileDrop(e); }}>
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
        <div class="purpose-glow" style="background: linear-gradient(180deg, {purposeColors[activeProfile.purpose] || theme.accentColor}15 0%, transparent 100%);"></div>
      {/if}
      <div class="terminal-panel" bind:this={terminalEl}></div>
    </div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="shell-divider" style="display:{shellOpen ? 'block' : 'none'}" onmousedown={startDividerDrag}></div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="shell-area" class:no-transition={shellStore.isDraggingDivider} class:panel-focused={shellStore.focusedPanel === 'shell'} onclick={() => shellStore.focusedPanel = 'shell'} style="display:{shellOpen ? 'flex' : 'none'};width:{shellStore.getShellWidth(activeProfile?.id)}%;flex:none;">
      <div class="shell-panel" bind:this={shellEl}></div>
    </div>
  </div>
</div>
<BottomBar {activeProfile} {appVersion} {claudePlan} {shellOpen} bind:profileMenuOpen bind:showSettings bind:settingsTab onToggleShell={toggleShell} onOpenExternal={openExternal} />

<UpdateToast {appVersion} onOpenExternal={openExternal} />
</div>

{#if showModal}
<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div class="modal-backdrop">
  <div class="modal">
    <h2>New Session</h2>
    <label>Project Folder
      <div class="row">
        <input bind:value={modalPath} placeholder="/path/to/project" onblur={() => { if (modalPath.trim()) loadExistingSessions(modalPath); }} />
        <button onclick={browsePath}>Browse</button>
      </div>
    </label>
    <label>Title
      <input bind:value={modalTitle} placeholder="e.g. Auth Refactor" />
    </label>
    <div class="form-group">
      <span class="form-group-label">Purpose</span>
      <div class="chips">
        {#each purposes as p}
          {#if !modalPath.trim()}
            <span class="chip disabled">{p.label}</span>
          {:else if p.label !== 'Custom' && profiles.some(pr => pr.projectPath === modalPath && pr.purpose === p.label)}
            <span class="chip disabled" title="{p.label} already active for this project">{p.label}</span>
          {:else}
            <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
            <span class="chip" class:selected={modalPurpose === p.label}
              style={modalPurpose === p.label ? `background:${p.color}33;color:${p.color};border-color:${p.color}` : ''}
              onclick={() => { modalPurpose = p.label; if (p.label === 'Custom' && modalPath.trim()) loadExistingSessions(modalPath); }}>{p.label}</span>
          {/if}
        {/each}
      </div>
    </div>
    {#if modalExistingSessions.length > 0 && modalPurpose !== 'Custom'}
      <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
      <div class="session-found-hint" onclick={() => { modalPurpose = 'Custom'; }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
        <span>{modalExistingSessions.length} previous session{modalExistingSessions.length > 1 ? 's' : ''} found — <strong style="color:var(--accent);cursor:pointer;">resume via Custom</strong></span>
      </div>
    {/if}
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
        <textarea class="custom-prompt" bind:value={modalCustomPrompt} placeholder="Custom instructions for this session..." rows="2"></textarea>
      </label>
    {/if}

    <div class="stg-section-label" style="margin-top:12px;margin-bottom:6px;">Advanced</div>
    <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
    <div class="toggle-row">
      <span class="toggle-label">Skip permissions
        <span class="toggle-tooltip">?</span>
      </span>
      <button class="toggle-switch" class:on={modalSkipPermissions} onclick={() => modalSkipPermissions = !modalSkipPermissions}>
        <span class="toggle-knob"></span>
      </button>
    </div>
    <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
    <div class="toggle-row">
      <span class="toggle-label">Git Identity</span>
      <button class="toggle-switch" class:on={modalGitEnabled} onclick={() => modalGitEnabled = !modalGitEnabled}>
        <span class="toggle-knob"></span>
      </button>
    </div>
    {#if modalGitEnabled}
      <div class="advanced-section">
        <div class="advanced-row">
          <label class="advanced-label">Name <span class="required">*</span>
            <input type="text" bind:value={modalGitName} placeholder="e.g. John Doe" class="advanced-input" />
          </label>
          <label class="advanced-label">Email <span class="required">*</span>
            <input type="email" bind:value={modalGitEmail} placeholder="e.g. john@example.com" class="advanced-input" />
          </label>
        </div>
      </div>
    {/if}
    <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
    <div class="toggle-row">
      <span class="toggle-label">Attach Contexts</span>
      <button class="toggle-switch" class:on={contextsStore.modalContextEnabled} onclick={() => contextsStore.modalContextEnabled = !contextsStore.modalContextEnabled}>
        <span class="toggle-knob"></span>
      </button>
    </div>
    {#if contextsStore.modalContextEnabled}
      <div class="advanced-section">
        {#if contextsStore.modalContexts.length > 0}
          <div class="ctx-attached-chips">
            {#each contextsStore.modalContexts as name}
              <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
              <span class="ctx-attached-chip">
                {name}
                <span class="ctx-chip-remove" onclick={() => { contextsStore.modalContexts = contextsStore.modalContexts.filter(c => c !== name); }}>×</span>
              </span>
            {/each}
          </div>
        {/if}
        <div class="ctx-add-wrap">
          <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
          <button class="ctx-add-btn" onclick={(e) => { e.stopPropagation(); contextsStore.showContextDropdown = !contextsStore.showContextDropdown; }}>
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M7.75 2a.75.75 0 01.75.75V7h4.25a.75.75 0 010 1.5H8.5v4.25a.75.75 0 01-1.5 0V8.5H2.75a.75.75 0 010-1.5H7V2.75A.75.75 0 017.75 2z"/></svg>
            Add
          </button>
          {#if contextsStore.showContextDropdown}
            <div class="ctx-dropdown">
              {#each contextsStore.contextSnippets.filter(c => !contextsStore.modalContexts.includes(c.name)) as ctx}
                <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
                <div class="ctx-dropdown-item" onclick={() => { contextsStore.modalContexts = [...contextsStore.modalContexts, ctx.name]; contextsStore.showContextDropdown = false; }}>
                  <span class="ctx-dropdown-name">{ctx.name}</span>
                  <span class="ctx-dropdown-preview">{ctx.preview}</span>
                </div>
              {:else}
                <div class="ctx-dropdown-empty">No more contexts available</div>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    {/if}
    <div class="modal-actions">
      <button onclick={() => { showModal = false; modalExistingSessions = []; modalSelectedSession = ""; modalCustomPrompt = ""; modalGitEnabled = false; modalGitName = ""; modalGitEmail = ""; contextsStore.modalContexts = []; contextsStore.modalContextEnabled = false; contextsStore.showContextDropdown = false; }}>Cancel</button>
      <button class="create-btn" disabled={!modalPath || !modalTitle || !modalPurpose || (modalGitEnabled && (!modalGitName.trim() || !modalGitEmail.trim()))} onclick={createSession}>Create</button>
    </div>
  </div>
</div>
{/if}

<SettingsModal bind:show={showSettings} bind:settingsTab {appVersion} onOpenExternal={openExternal} onApplyTheme={applyTheme} onApplyAccent={applyAccent} />

<!-- UpdateToast handles both the toast and the what's new modal -->

<UsageDashboard {claudePlan} />

{#if contextsStore.showContextPicker}
<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div class="modal-backdrop">
  <div class="modal" style="max-width:400px;">
    <h2 style="font-size:14px;">Manage Contexts — {contextsStore.showContextPicker.title}</h2>
    {#if contextsStore.contextSnippets.length === 0}
      <p style="font-size:12px;color:var(--text-secondary);">No contexts created yet. Go to Settings → Contexts to create one.</p>
    {:else}
      <div class="ctx-picker-list">
        {#each contextsStore.contextSnippets as ctx}
          <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
          <div class="ctx-picker-item" onclick={() => {
            const p = contextsStore.showContextPicker;
            const attached = p.contexts || [];
            const projectPath = p.worktreePath || p.projectPath;
            if (attached.includes(ctx.name)) {
              const updated = attached.filter(c => c !== ctx.name);
              contextsStore.attachContextsToSession(p.id, projectPath, updated);
              p.contexts = updated;
            } else {
              const updated = [...attached, ctx.name];
              contextsStore.attachContextsToSession(p.id, projectPath, updated);
              p.contexts = updated;
            }
            contextsStore.showContextPicker = {...contextsStore.showContextPicker};
          }}>
            <span class="ctx-picker-check">
              {#if (contextsStore.showContextPicker.contexts || []).includes(ctx.name)}
                <svg width="12" height="12" viewBox="0 0 16 16" fill="var(--accent)"><path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/></svg>
              {:else}
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="var(--text-secondary)" stroke-width="1.5"><rect x="2" y="2" width="12" height="12" rx="2"/></svg>
              {/if}
            </span>
            <div class="ctx-picker-info">
              <span class="ctx-picker-name">{ctx.name}</span>
              <span class="ctx-picker-preview">{ctx.preview}</span>
            </div>
          </div>
        {/each}
      </div>
    {/if}
    <div class="modal-actions">
      <button onclick={() => contextsStore.showContextPicker = false}>Done</button>
    </div>
  </div>
</div>
{/if}

<DeleteConfirmModal profile={deleteConfirm} onConfirm={confirmDelete} onCancel={() => deleteConfirm = null} />

{#if pluginsStore.pluginUninstallConfirm}
<div class="modal-backdrop" style="z-index:1100;">
  <div class="modal" style="max-width:360px;animation:slideIn 0.15s ease-out;">
    <div style="text-align:center;padding:20px 20px 0;">
      <svg width="32" height="32" viewBox="0 0 16 16" fill="#f85149" style="margin-bottom:12px;"><path d="M6.5 1.75a.25.25 0 01.25-.25h2.5a.25.25 0 01.25.25V3h-3V1.75zM11 3V1.75A1.75 1.75 0 009.25 0h-2.5A1.75 1.75 0 005 1.75V3H2.75a.75.75 0 000 1.5h.928l.747 10.218A1.75 1.75 0 006.172 16h3.656a1.75 1.75 0 001.747-1.282L12.322 4.5h.928a.75.75 0 000-1.5H11z"/></svg>
      <h2 style="font-size:15px;margin-bottom:8px;">Uninstall plugin?</h2>
      <p style="font-size:13px;color:var(--text-secondary);line-height:1.5;">
        Are you sure you want to uninstall <strong style="color:var(--text-primary);">{pluginsStore.pluginUninstallConfirm.name}</strong>?
      </p>
    </div>
    <div class="modal-actions" style="padding:16px 20px;">
      <button onclick={() => pluginsStore.pluginUninstallConfirm = null}>Cancel</button>
      <button style="background:#f85149 !important;border-color:transparent !important;color:#fff !important;" onclick={() => pluginsStore.uninstallPlugin(pluginsStore.pluginUninstallConfirm)}>Uninstall</button>
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

  .profile-item { padding-right: 28px; }
  .ellipsis-btn { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); opacity: 0; padding: 4px; border-radius: 4px; color: var(--text-secondary); cursor: pointer; transition: opacity 0.15s, background 0.15s; z-index: 2; }
  .profile-item:hover .ellipsis-btn { opacity: 1; }
  .ellipsis-btn:hover { background: var(--hover-bg, rgba(255,255,255,0.08)); color: var(--text-primary); }

  .session-menu { position: absolute; right: 6px; top: calc(50% + 14px); background: #1c2128; border: 1px solid var(--border); border-radius: 8px; padding: 4px; min-width: 110px; box-shadow: 0 8px 24px rgba(0,0,0,0.4); z-index: 10; animation: fadeIn 0.1s ease-out; }
  .session-menu-item { display: flex; align-items: center; gap: 6px; width: 100%; padding: 6px 10px; border: none; background: transparent; color: var(--text-secondary); font-size: 12px; font-family: inherit; cursor: pointer; border-radius: 5px; transition: background 0.12s; }
  .session-menu-item:hover { background: rgba(255,255,255,0.06); }
  .session-menu-item.danger:hover { background: rgba(248,81,73,0.12); color: #f85149; }
  .time { font-size: 11px; color: var(--text-secondary); }
  .bottom-bar { display: flex; align-items: center; padding: 3px 16px; background: var(--sidebar-bg); border-top: 1px solid var(--border); flex-shrink: 0; position: relative; }
  .bottom-left { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .bottom-center { position: absolute; left: 50%; transform: translateX(-50%); display: flex; align-items: center; justify-content: center; gap: 12px; }
  .bottom-right { flex-shrink: 0; display: flex; align-items: center; justify-content: flex-end; margin-left: auto; }
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
  .plugin-msg { font-size: 11px; color: #3fb950; padding: 4px 0 8px; animation: gitMsgIn 0.2s ease; }
  .plugin-msg.error { color: #f85149; }
  .plugin-subtab { flex: 1; padding: 8px; border: none; background: transparent; color: var(--text-secondary); font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; border-bottom: 2px solid transparent; transition: all 0.15s; }
  .plugin-subtab.active { color: var(--accent); border-bottom-color: var(--accent); }
  .plugin-subtab:hover { color: var(--text-primary); }
  .plugin-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 40px 0; color: var(--text-secondary); font-size: 12px; }
  .plugin-browse-btn { padding: 6px 16px; border-radius: 6px; border: 1px solid var(--accent); background: transparent; color: var(--accent); font-size: 12px; font-family: inherit; cursor: pointer; transition: all 0.15s; margin-top: 4px; }
  .plugin-browse-btn:hover { background: var(--accent); color: #fff; }
  .plugin-search.full { width: 100%; }
  .plugins-list.marketplace { max-height: 260px; overflow-y: auto; }

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


  .git-status-bar { display: flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 4px; cursor: pointer; transition: background 0.1s; }
  .git-status-bar:hover { background: rgba(255,255,255,0.06); }
  .git-status-bar > svg { color: var(--text-secondary); flex-shrink: 0; }
  .git-bar-branch { font-size: 10px; color: var(--text-secondary); font-family: monospace; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .git-bar-ahead { font-size: 9px; font-weight: 600; color: #3fb950; }
  .git-bar-behind { font-size: 9px; font-weight: 600; color: #d29922; }
  .git-bar-changes { font-size: 9px; font-weight: 700; color: #fff; background: var(--accent); padding: 0 5px; border-radius: 8px; min-width: 16px; text-align: center; line-height: 16px; }
  .git-bar-msg { font-size: 9px; color: var(--text-secondary); font-style: italic; animation: gitMsgIn 0.2s ease; }
  @keyframes gitMsgIn { from { opacity: 0; } to { opacity: 1; } }
  .git-action-btn { border: none; background: transparent; color: var(--text-secondary); cursor: pointer; padding: 3px 5px; border-radius: 4px; display: flex; align-items: center; gap: 3px; font-size: 10px; font-family: inherit; transition: all 0.1s; }
  .git-action-btn:hover:not(:disabled) { background: rgba(255,255,255,0.06); color: var(--text-primary); }
  .git-action-btn:disabled { opacity: 0.4; cursor: wait; }
  .git-action-btn.has-tooltip { position: relative; }
  .btn-tooltip { display: none; position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%); background: #1c2128; border: 1px solid var(--border); border-radius: 4px; padding: 3px 8px; font-size: 10px; color: var(--text-primary); white-space: nowrap; z-index: 600; pointer-events: none; }
  .git-action-btn.has-tooltip:hover .btn-tooltip { display: block; }

  .git-status-wrap { position: relative; flex-shrink: 0; }
  .git-popup { position: absolute; bottom: calc(100% + 8px); left: 0; width: 420px; max-height: 400px; background: var(--sidebar-bg); border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 12px 40px rgba(0,0,0,0.5); z-index: 500; display: flex; flex-direction: column; overflow: visible; animation: gitPopupIn 0.15s ease; backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); }
  @keyframes gitPopupIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
  .git-popup-tabs { display: flex; align-items: center; border-bottom: 1px solid var(--border); padding: 0 4px; overflow: visible; position: relative; z-index: 1; }
  .git-popup-tab { padding: 8px 10px; border: none; background: transparent; color: var(--text-secondary); font-size: 11px; font-weight: 600; cursor: pointer; border-bottom: 2px solid transparent; transition: all 0.1s; font-family: inherit; }
  .git-popup-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
  .git-popup-tab:hover { color: var(--text-primary); }
  .git-popup-tab-actions { margin-left: auto; display: flex; gap: 1px; padding-right: 4px; overflow: visible; }

  .git-diff-header { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-bottom: 1px solid var(--border); background: rgba(255,255,255,0.02); }
  .git-diff-back { border: none; background: transparent; color: var(--text-secondary); cursor: pointer; padding: 2px; border-radius: 3px; display: flex; }
  .git-diff-back:hover { background: rgba(255,255,255,0.06); color: var(--text-primary); }
  .git-diff-filename { font-size: 11px; font-family: monospace; color: var(--text-primary); }
  .git-diff-view { max-height: 280px; overflow: auto; padding: 4px 0; font-family: monospace; font-size: 11px; line-height: 1.5; }
  .git-diff-line { padding: 0 12px; white-space: pre; }
  .git-diff-line.diff-add { background: rgba(63,185,80,0.12); color: #3fb950; }
  .git-diff-line.diff-del { background: rgba(248,81,73,0.12); color: #f85149; }
  .git-diff-line.diff-hunk { color: var(--accent); font-weight: 600; }

  .git-file-stage { cursor: pointer; display: flex; align-items: center; flex-shrink: 0; padding: 1px; border-radius: 3px; }
  .git-file-stage:hover { background: rgba(255,255,255,0.08); }

  .git-empty { padding: 24px; text-align: center; font-size: 11px; color: var(--text-secondary); }

  .git-history-list { max-height: 300px; overflow-y: auto; }
  .git-commit-item { display: flex; align-items: center; gap: 8px; padding: 6px 12px; font-size: 11px; border-bottom: 1px solid rgba(255,255,255,0.03); }
  .git-commit-item:hover { background: rgba(255,255,255,0.03); }
  .git-commit-hash { font-family: monospace; color: var(--accent); font-weight: 600; flex-shrink: 0; font-size: 10px; }
  .git-commit-message { color: var(--text-primary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .git-commit-date { color: var(--text-secondary); flex-shrink: 0; font-size: 10px; }

  .git-branch-list { max-height: 300px; overflow-y: auto; }
  .git-branch-item { display: flex; align-items: center; gap: 8px; padding: 7px 12px; font-size: 12px; cursor: pointer; transition: background 0.1s; }
  .git-branch-item:hover { background: rgba(255,255,255,0.04); }
  .git-branch-item.current { color: var(--accent); cursor: default; }
  .git-branch-item:not(.current) { color: var(--text-secondary); }
  .git-branch-name-item { font-family: monospace; font-size: 11px; }
  .git-file-list { max-height: 250px; overflow-y: auto; padding: 4px 0; }
  .git-file-item { display: flex; align-items: center; gap: 8px; padding: 3px 14px; font-size: 11px; }
  .git-file-item:hover { background: rgba(255,255,255,0.03); }
  .git-file-status { width: 16px; font-size: 10px; font-weight: 700; font-family: monospace; text-align: center; flex-shrink: 0; }
  .git-file-status.modified { color: #d29922; }
  .git-file-status.added { color: #3fb950; }
  .git-file-status.deleted { color: #f85149; }
  .git-file-status.renamed { color: #58a6ff; }
  .git-file-path { color: var(--text-secondary); font-family: monospace; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .git-commit-row { display: flex; gap: 6px; padding: 6px 10px; border-top: 1px solid var(--border); flex-shrink: 0; }
  .git-commit-input { flex: 1; padding: 5px 8px; border-radius: 4px; border: 1px solid var(--border); background: transparent; color: var(--text-primary); font-size: 11px; font-family: inherit; }
  .git-commit-input:focus { border-color: var(--accent); outline: none; }
  .git-commit-input::placeholder { color: var(--text-secondary); }
  .git-commit-btn { padding: 5px 12px; border-radius: 4px; border: none; background: var(--accent); color: #fff; font-size: 11px; font-weight: 600; font-family: inherit; cursor: pointer; transition: opacity 0.1s; flex-shrink: 0; }
  .git-commit-btn:hover:not(:disabled) { opacity: 0.85; }
  .git-commit-btn:disabled { opacity: 0.4; cursor: default; }

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
  .form-group { display: flex; flex-direction: column; gap: 6px; }
  .form-group-label { font-size: 13px; color: var(--text-primary); }
  .chip { padding: 5px 12px; border-radius: 14px; border: 1px solid var(--border); background: transparent; color: var(--text-secondary); font-size: 12px; cursor: pointer; font-family: inherit; transition: background 0.15s, color 0.15s; user-select: none; display: inline-block; }
  .chip:hover:not(.selected):not(.disabled) { background: rgba(255,255,255,0.06); }
  .chip.disabled { opacity: 0.3; cursor: not-allowed; }
  .chip.selected { font-weight: 600; border-color: var(--accent); color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); }
  .session-select { width: 100%; margin-top: 6px; padding: 7px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--btn-bg, #21262d); color: var(--text-primary); font-size: 12px; font-family: inherit; appearance: none; cursor: pointer; }
  .session-select option { background: #1c2128; color: var(--text-primary); }
  .custom-prompt { width: 100%; margin-top: 6px; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--btn-bg, #21262d); color: var(--text-primary); font-size: 12px; font-family: inherit; resize: vertical; min-height: 60px; line-height: 1.5; }
  .custom-prompt::placeholder { color: var(--text-secondary); }
  .advanced-section { padding: 4px 0 0; display: flex; flex-direction: column; gap: 8px; animation: advIn 0.12s ease; }
  @keyframes advIn { from { opacity: 0; } to { opacity: 1; } }
  .advanced-row { display: flex; gap: 8px; }
  .advanced-row > label { flex: 1; }
  .advanced-label { font-size: 11px; color: var(--text-secondary); display: flex; flex-direction: column; gap: 4px; }
  .advanced-input { padding: 6px 8px; border-radius: 6px; border: 1px solid var(--border); background: transparent; color: var(--text-primary); font-size: 12px; font-family: inherit; }
  .advanced-input:focus { border-color: var(--accent); outline: none; }
  .advanced-input::placeholder { color: var(--text-secondary); opacity: 0.6; }
  .required { color: #f85149; font-weight: 600; }
  .session-found-hint { display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px; border-radius: 6px; background: color-mix(in srgb, var(--accent) 8%, transparent); border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent); margin: 8px 0; }
  .session-found-hint svg { flex-shrink: 0; margin-top: 1px; }
  .session-found-hint span { font-size: 11px; color: var(--text-secondary); line-height: 1.4; }
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

  /* ─── Usage Dashboard ─── */
  .dash-modal { width: 900px; max-height: 85vh; background: var(--sidebar-bg); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 24px 48px rgba(0,0,0,0.5); overflow: hidden; animation: modalUp 0.18s ease; backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); display: flex; flex-direction: column; }
  .dash-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .dash-title { font-size: 14px; font-weight: 600; color: var(--text-primary); }
  .dash-header-right { display: flex; align-items: center; gap: 10px; }
  .dash-period { padding: 4px 8px; border-radius: 5px; border: 1px solid var(--border); background: transparent; color: var(--text-secondary); font-size: 11px; font-family: inherit; cursor: pointer; }
  .dash-loading { padding: 60px; text-align: center; font-size: 13px; color: var(--text-secondary); display: flex; flex-direction: column; align-items: center; gap: 12px; }
  .dash-spinner { width: 24px; height: 24px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.6s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .dash-body { padding: 18px; overflow-y: auto; display: flex; flex-direction: column; gap: 18px; }

  .dash-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; flex: 1; }
  .dash-stat { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 10px 6px; border-radius: 8px; background: rgba(255,255,255,0.03); border: 1px solid var(--border); }
  .dash-stat-value { font-size: 18px; font-weight: 700; color: var(--text-primary); font-variant-numeric: tabular-nums; }
  .dash-stat-label { font-size: 9px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.3px; margin-top: 3px; }

  .dash-section { flex: 1; min-width: 0; }
  .dash-section-label { font-size: 10px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px; }

  .dash-chart { display: flex; align-items: flex-end; gap: 3px; height: 80px; padding: 4px 0; }
  .dash-bar-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end; cursor: default; }
  .dash-bar { width: 100%; border-radius: 2px 2px 0 0; min-height: 2px; transition: height 0.3s ease; opacity: 0.8; background: var(--accent); }
  .dash-bar-wrap:hover .dash-bar { opacity: 1; }
  .dash-bar-label { font-size: 8px; color: var(--text-secondary); margin-top: 3px; opacity: 0.6; }

  .dash-tokens-bar { display: flex; gap: 16px; justify-content: center; padding: 8px 12px; border-radius: 6px; background: rgba(255,255,255,0.02); font-size: 10px; color: var(--text-secondary); }
  .dash-tokens-bar strong { color: var(--text-primary); font-weight: 500; }

  .dash-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .dash-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
  .dash-scroll { max-height: 160px; overflow-y: auto; }

  .dash-model-row { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 5px; }
  .dash-model-row:hover { background: rgba(255,255,255,0.03); }
  .dash-model-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .dash-model-name { font-size: 12px; font-weight: 500; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dash-model-meta { font-size: 10px; color: var(--text-secondary); }
  .dash-model-cost { font-size: 12px; font-weight: 600; color: var(--accent); font-variant-numeric: tabular-nums; flex-shrink: 0; }

  .dash-tool-row { display: flex; align-items: center; gap: 8px; padding: 4px 8px; font-size: 11px; }
  .dash-tool-name { width: 70px; flex-shrink: 0; color: var(--text-primary); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dash-tool-bar-bg { flex: 1; height: 4px; background: rgba(255,255,255,0.06); border-radius: 2px; overflow: hidden; }
  .dash-tool-bar-fill { height: 100%; background: var(--accent); border-radius: 2px; opacity: 0.7; }
  .dash-tool-count { width: 40px; text-align: right; color: var(--text-secondary); font-variant-numeric: tabular-nums; flex-shrink: 0; }

  .dash-plan-badge { font-size: 10px; font-weight: 600; text-transform: capitalize; color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); padding: 2px 8px; border-radius: 4px; margin-left: 8px; }
  .dash-live-bar { flex: 1; height: 6px; background: rgba(255,255,255,0.06); border-radius: 3px; overflow: hidden; }
  .dash-live-row { display: flex; align-items: center; gap: 8px; }
  .dash-live-lbl { font-size: 11px; color: var(--text-secondary); width: 50px; flex-shrink: 0; }
  .dash-live-pct { font-size: 12px; font-weight: 600; width: 40px; text-align: right; flex-shrink: 0; font-variant-numeric: tabular-nums; }
  .dash-refresh-select { padding: 3px 6px; border-radius: 4px; border: 1px solid var(--border); background: transparent; color: var(--text-secondary); font-size: 11px; font-family: inherit; cursor: pointer; }
  .dash-edit-key { border: none; background: transparent; color: var(--text-secondary); cursor: pointer; padding: 3px 6px; border-radius: 3px; display: flex; align-items: center; gap: 4px; margin-left: auto; font-size: 9px; font-family: inherit; opacity: 0.6; transition: all 0.1s; }
  .dash-edit-key:hover { opacity: 1; background: rgba(255,255,255,0.06); color: var(--text-primary); }
  /* ─── Context Manager ─── */
  .ctx-editor { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--border); border-radius: 6px; background: rgba(255,255,255,0.02); margin-bottom: 10px; }
  .ctx-name-input { padding: 6px 8px; border-radius: 4px; border: 1px solid var(--border); background: transparent; color: var(--text-primary); font-size: 12px; font-family: inherit; font-weight: 600; }
  .ctx-name-input:focus { border-color: var(--accent); outline: none; }
  .ctx-content-input { padding: 8px; border-radius: 4px; border: 1px solid var(--border); background: transparent; color: var(--text-primary); font-size: 11px; font-family: inherit; resize: vertical; min-height: 80px; line-height: 1.5; }
  .ctx-content-input:focus { border-color: var(--accent); outline: none; }
  .ctx-content-input::placeholder { color: var(--text-secondary); }
  .ctx-list { display: flex; flex-direction: column; gap: 4px; }
  .ctx-card { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; background: rgba(255,255,255,0.02); }
  .ctx-card:hover { background: rgba(255,255,255,0.04); }
  .ctx-card-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .ctx-card-name { font-size: 12px; font-weight: 600; color: var(--text-primary); }
  .ctx-card-preview { font-size: 10px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ctx-card-actions { display: flex; gap: 4px; flex-shrink: 0; }
  .ctx-action-btn { border: none; background: transparent; color: var(--text-secondary); cursor: pointer; padding: 4px; border-radius: 4px; display: flex; transition: all 0.1s; }
  .ctx-action-btn:hover { background: rgba(255,255,255,0.08); color: var(--text-primary); }
  .ctx-action-btn.danger:hover { background: rgba(248,81,73,0.12); color: #f85149; }
  .ctx-attached-chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .ctx-attached-chip { display: flex; align-items: center; gap: 4px; padding: 3px 6px 3px 10px; border-radius: 12px; background: color-mix(in srgb, var(--accent) 12%, transparent); border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent); color: var(--accent); font-size: 11px; font-weight: 500; }
  .ctx-chip-remove { cursor: pointer; font-size: 14px; line-height: 1; opacity: 0.6; transition: opacity 0.1s; display: flex; align-items: center; }
  .ctx-chip-remove:hover { opacity: 1; }
  .ctx-add-wrap { position: relative; }
  .ctx-add-btn { display: flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: 4px; border: 1px dashed var(--border); background: transparent; color: var(--text-secondary); font-size: 11px; font-family: inherit; cursor: pointer; transition: all 0.1s; }
  .ctx-add-btn:hover { border-color: var(--accent); color: var(--accent); }
  .ctx-dropdown { position: absolute; top: calc(100% + 4px); left: 0; width: 250px; background: var(--sidebar-bg); border: 1px solid var(--border); border-radius: 6px; box-shadow: 0 8px 24px rgba(0,0,0,0.4); z-index: 100; max-height: 180px; overflow-y: auto; padding: 4px; }
  .ctx-dropdown-item { padding: 6px 10px; border-radius: 4px; cursor: pointer; transition: background 0.1s; }
  .ctx-dropdown-item:hover { background: rgba(255,255,255,0.06); }
  .ctx-dropdown-name { font-size: 12px; font-weight: 500; color: var(--text-primary); display: block; }
  .ctx-dropdown-preview { font-size: 10px; color: var(--text-secondary); display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ctx-dropdown-empty { padding: 10px; text-align: center; font-size: 11px; color: var(--text-secondary); }
  .ctx-picker-list { display: flex; flex-direction: column; gap: 2px; max-height: 300px; overflow-y: auto; }
  .ctx-picker-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 5px; cursor: pointer; transition: background 0.1s; }
  .ctx-picker-item:hover { background: rgba(255,255,255,0.04); }
  .ctx-picker-check { flex-shrink: 0; display: flex; }
  .ctx-picker-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .ctx-picker-name { font-size: 12px; font-weight: 500; color: var(--text-primary); }
  .ctx-picker-preview { font-size: 10px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>

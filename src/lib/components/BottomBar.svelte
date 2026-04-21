<script>
  import { gitStore } from "$lib/stores/git.svelte";
  import { usageStore } from "$lib/stores/usage.svelte";
  import { shellStore } from "$lib/stores/shell.svelte";
  import { pluginsStore } from "$lib/stores/plugins.svelte";

  let {
    activeProfile,
    appVersion,
    claudePlan,
    shellOpen,
    profileMenuOpen = $bindable(),
    showSettings = $bindable(),
    settingsTab = $bindable(),
    onToggleShell,
    onOpenExternal,
  } = $props();

  // Git helpers — use resolved project path
  function gitPath() { return activeProfile?.worktreePath || activeProfile?.projectPath || ''; }
  function gitProfileId() { return activeProfile?.id; }
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
</script>

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
          <button class="pm-item" onclick={() => { profileMenuOpen = false; showSettings = true; settingsTab = 'plugins'; pluginsStore.loadClaudePlugins(); }}>
            <svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
            Plugins
          </button>
          <button class="pm-item" onclick={() => { profileMenuOpen = false; usageStore.showDashboard = true; usageStore.loadDashboard(); }}>
            <svg viewBox="0 0 24 24"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>
            Usage Dashboard
          </button>
          <div class="pm-sep"></div>
          <button class="pm-item" onclick={() => { profileMenuOpen = false; onOpenExternal('https://clauge.ssh-i.in/changelog.html'); }}>
            <svg viewBox="0 0 24 24"><path d="M12 2L15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26z"/></svg>
            What's New
            <svg class="pm-external" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </button>
          <button class="pm-item" onclick={() => { profileMenuOpen = false; onOpenExternal('https://github.com/ansxuman/Clauge/issues'); }}>
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
            Report Issue
            <svg class="pm-external" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </button>
          <button class="pm-item pm-coffee" onclick={() => { profileMenuOpen = false; onOpenExternal('https://buymeacoffee.com/ansxuman'); }}>
            <svg viewBox="0 0 24 24"><path d="M17 8h1a4 4 0 110 8h-1"/><path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8z"/><line x1="6" y1="2" x2="6" y2="4"/><line x1="10" y1="2" x2="10" y2="4"/><line x1="14" y1="2" x2="14" y2="4"/></svg>
            Buy Me a Coffee
            <svg class="pm-external" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </button>
        </div>
      {/if}
    </div>
    {#if activeProfile && gitStore.gitBranch}
    <div class="git-status-wrap">
      <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
      <div class="git-status-bar" onclick={(e) => { e.stopPropagation(); gitStore.gitPanelOpen = !gitStore.gitPanelOpen; }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 01-9 9"/></svg>
        <span class="git-bar-branch">{gitStore.gitBranch}</span>
        {#if gitStore.gitAhead > 0}
          <span class="git-bar-ahead" title="{gitStore.gitAhead} unpushed">↑{gitStore.gitAhead}</span>
        {/if}
        {#if gitStore.gitBehind > 0}
          <span class="git-bar-behind" title="{gitStore.gitBehind} to pull">↓{gitStore.gitBehind}</span>
        {/if}
        {#if gitStore.gitFiles.length > 0}
          <span class="git-bar-changes">{gitStore.gitFiles.length}</span>
        {/if}
        {#if gitStore.gitMsg}
          <span class="git-bar-msg">{gitStore.gitMsg}</span>
        {/if}
      </div>
      {#if gitStore.gitPanelOpen}
        <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
        <div class="git-popup" onclick={(e) => e.stopPropagation()}>
          <div class="git-popup-tabs">
            <button class="git-popup-tab" class:active={gitStore.gitTab === 'changes'} onclick={() => gitStore.gitTab = 'changes'}>Changes{gitStore.gitFiles.length > 0 ? ` (${gitStore.gitFiles.length})` : ''}</button>
            <button class="git-popup-tab" class:active={gitStore.gitTab === 'history'} onclick={() => { gitStore.gitTab = 'history'; loadGitHistory(); }}>History</button>
            <button class="git-popup-tab" class:active={gitStore.gitTab === 'branches'} onclick={() => { gitStore.gitTab = 'branches'; loadGitBranches(); }}>Branches</button>
            <div class="git-popup-tab-actions">
              <button class="git-action-btn has-tooltip" onclick={doGitStash}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>
                <span class="btn-tooltip">Stash</span>
              </button>
              <button class="git-action-btn has-tooltip" onclick={doGitStashPop}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2z"/><polyline points="12 8 12 16"/><polyline points="8 12 12 8 16 12"/></svg>
                <span class="btn-tooltip">Pop Stash</span>
              </button>
              <button class="git-action-btn has-tooltip" disabled={gitStore.gitLoading === 'pull'} onclick={doGitPull}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
                <span class="btn-tooltip">{gitStore.gitLoading === 'pull' ? 'Pulling...' : 'Pull'}</span>
              </button>
              <button class="git-action-btn has-tooltip" disabled={gitStore.gitLoading === 'push'} onclick={doGitPush}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
                <span class="btn-tooltip">{gitStore.gitLoading === 'push' ? 'Pushing...' : 'Push'}</span>
              </button>
            </div>
          </div>

          {#if gitStore.gitTab === 'changes'}
            {#if gitStore.gitDiffFile}
              <div class="git-diff-header">
                <button class="git-diff-back" onclick={() => { gitStore.gitDiffFile = ''; gitStore.gitDiff = ''; }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
                <span class="git-diff-filename">{gitStore.gitDiffFile}</span>
              </div>
              <div class="git-diff-view">
                {#each gitStore.gitDiff.split('\n') as line}
                  <div class="git-diff-line" class:diff-add={line.startsWith('+')} class:diff-del={line.startsWith('-')} class:diff-hunk={line.startsWith('@@')}>{line}</div>
                {/each}
              </div>
            {:else if gitStore.gitFiles.length > 0}
              <div class="git-file-list">
                {#each gitStore.gitFiles as file}
                  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
                  <div class="git-file-item" onclick={() => viewDiff(file)}>
                    <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
                    <span class="git-file-stage" onclick={(e) => { e.stopPropagation(); toggleStageFile(file); }} title={gitStore.stagedFiles.has(file.path) ? 'Unstage' : 'Stage'}>
                      {#if gitStore.stagedFiles.has(file.path)}
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="var(--accent)"><path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/></svg>
                      {:else}
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="var(--text-secondary)" stroke-width="1.5"><rect x="2" y="2" width="12" height="12" rx="2"/></svg>
                      {/if}
                    </span>
                    <span class="git-file-status" class:modified={file.status === 'M'} class:added={file.status === 'A' || file.status === '??'} class:deleted={file.status === 'D'} class:renamed={file.status === 'R'}>{file.status === '??' ? 'U' : file.status}</span>
                    <span class="git-file-path">{file.path}</span>
                  </div>
                {/each}
              </div>
              <div class="git-commit-row">
                <input class="git-commit-input" type="text" bind:value={gitStore.gitCommitMsg} placeholder="Commit message..." onkeydown={(e) => { if (e.key === 'Enter' && gitStore.gitCommitMsg.trim()) doGitCommitStaged(); }} />
                <button class="git-commit-btn" disabled={!gitStore.gitCommitMsg.trim() || gitStore.gitLoading === 'commit'} onclick={doGitCommitStaged}>
                  {gitStore.gitLoading === 'commit' ? '...' : 'Commit'}
                </button>
              </div>
            {:else}
              <div class="git-empty">Working tree clean</div>
            {/if}

          {:else if gitStore.gitTab === 'history'}
            <div class="git-history-list">
              {#each gitStore.gitCommits as commit}
                <div class="git-commit-item">
                  <span class="git-commit-hash">{commit.short}</span>
                  <span class="git-commit-message">{commit.message}</span>
                  <span class="git-commit-date">{commit.date}</span>
                </div>
              {:else}
                <div class="git-empty">No commits</div>
              {/each}
            </div>

          {:else if gitStore.gitTab === 'branches'}
            <div class="git-branch-list">
              {#each gitStore.gitBranches as branch}
                <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
                <div class="git-branch-item" class:current={branch.current} onclick={() => { if (!branch.current) switchBranch(branch.name); }}>
                  {#if branch.current}
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="var(--accent)"><path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/></svg>
                  {/if}
                  <span class="git-branch-name-item">{branch.name}</span>
                </div>
              {:else}
                <div class="git-empty">No branches</div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>
    {/if}
  </div>
  <div class="bottom-center">
    {#if usageStore.usageLimits}
      {@const sColor = usageStore.usageLimits.sessionPercent > 80 ? '#f85149' : usageStore.usageLimits.sessionPercent > 50 ? '#d29922' : 'var(--accent)'}
      {@const wColor = usageStore.usageLimits.weeklyAllPercent > 80 ? '#f85149' : usageStore.usageLimits.weeklyAllPercent > 50 ? '#d29922' : 'var(--accent)'}
      <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
      <div class="usage-chips-clickable" onclick={() => { usageStore.showDashboard = true; usageStore.loadDashboard(); }}>
        <div class="usage-chip"><span class="usage-dot" style="background:{sColor};box-shadow:0 0 6px {sColor}44;"></span><span class="usage-lbl">Session</span><span class="usage-val" style="color:{sColor}">{usageStore.usageLimits.sessionPercent.toFixed(0)}%</span></div>
        <div class="usage-sep"></div>
        <div class="usage-chip"><span class="usage-dot" style="background:{wColor};box-shadow:0 0 6px {wColor}44;"></span><span class="usage-lbl">Weekly</span><span class="usage-val" style="color:{wColor}">{usageStore.usageLimits.weeklyAllPercent.toFixed(0)}%</span></div>
        {#if usageStore.usageLimits.weeklySonnetPercent != null}
          {@const snColor = usageStore.usageLimits.weeklySonnetPercent > 80 ? '#f85149' : usageStore.usageLimits.weeklySonnetPercent > 50 ? '#d29922' : 'var(--accent)'}
          <div class="usage-sep"></div>
          <div class="usage-chip"><span class="usage-dot" style="background:{snColor};box-shadow:0 0 6px {snColor}44;"></span><span class="usage-lbl">Sonnet</span><span class="usage-val" style="color:{snColor}">{usageStore.usageLimits.weeklySonnetPercent.toFixed(0)}%</span></div>
        {/if}
      </div>
    {:else}
      <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
      <span class="limit-loading" onclick={() => { usageStore.showDashboard = true; usageStore.loadDashboard(); }} style="cursor:pointer;">
        Set up usage tracking
      </span>
    {/if}
  </div>
  <div class="bottom-right">
    <button class="shell-toggle-btn" class:active={shellOpen} disabled={!activeProfile && !shellOpen} onclick={onToggleShell} title="Toggle shell (Cmd+L)">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="4 17 10 11 4 5"></polyline>
        <line x1="12" y1="19" x2="20" y2="19"></line>
      </svg>
    </button>
    {#if appVersion}<span class="bottom-version">v{appVersion}</span>{/if}
  </div>
</div>

<style>
  .bottom-bar { display: flex; align-items: center; padding: 3px 16px; background: var(--sidebar-bg); border-top: 1px solid var(--border); flex-shrink: 0; position: relative; }
  .bottom-left { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .bottom-center { position: absolute; left: 50%; transform: translateX(-50%); display: flex; align-items: center; justify-content: center; gap: 12px; }
  .bottom-right { flex-shrink: 0; display: flex; align-items: center; justify-content: flex-end; margin-left: auto; }
  .bottom-version { font-size: 9px; color: var(--text-secondary); font-family: monospace; opacity: 0.4; }

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

  .usage-chip { display: flex; align-items: center; gap: 5px; }
  .usage-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .usage-lbl { font-size: 10px; color: var(--text-secondary); font-weight: 500; }
  .usage-val { font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .usage-sep { width: 1px; height: 10px; background: var(--border); opacity: 0.5; }
  .usage-chips-clickable { display: flex; align-items: center; gap: 12px; cursor: pointer; padding: 2px 6px; border-radius: 6px; transition: background 0.15s; }
  .usage-chips-clickable:hover { background: rgba(255,255,255,0.04); }
  .limit-loading { font-size: 10px; color: var(--text-secondary); }

  .shell-toggle-btn { border: none; background: transparent; color: var(--text-secondary); cursor: pointer; padding: 2px; border-radius: 4px; display: flex; align-items: center; justify-content: center; transition: all 0.15s; margin-right: 6px; }
  .shell-toggle-btn:hover:not(:disabled) { color: var(--text-primary); }
  .shell-toggle-btn.active { color: var(--accent); }
  .shell-toggle-btn:disabled { opacity: 0.3; cursor: default; }

  /* Git status bar & popup */
  .git-status-wrap { position: relative; flex-shrink: 0; }
  .git-status-bar { display: flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 4px; cursor: pointer; transition: background 0.1s; }
  .git-status-bar:hover { background: rgba(255,255,255,0.06); }
  .git-status-bar > svg { color: var(--text-secondary); flex-shrink: 0; }
  .git-bar-branch { font-size: 10px; color: var(--text-secondary); font-family: monospace; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .git-bar-ahead { font-size: 9px; font-weight: 600; color: #3fb950; }
  .git-bar-behind { font-size: 9px; font-weight: 600; color: #d29922; }
  .git-bar-changes { font-size: 9px; font-weight: 700; color: #fff; background: var(--accent); padding: 0 5px; border-radius: 8px; min-width: 16px; text-align: center; line-height: 16px; }
  .git-bar-msg { font-size: 9px; color: var(--text-secondary); font-style: italic; animation: gitMsgIn 0.2s ease; }
  @keyframes gitMsgIn { from { opacity: 0; } to { opacity: 1; } }

  .git-popup { position: absolute; bottom: calc(100% + 8px); left: 0; width: 420px; max-height: 400px; background: var(--sidebar-bg); border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 12px 40px rgba(0,0,0,0.5); z-index: 500; display: flex; flex-direction: column; overflow: visible; animation: gitPopupIn 0.15s ease; backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); }
  @keyframes gitPopupIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
  .git-popup-tabs { display: flex; align-items: center; border-bottom: 1px solid var(--border); padding: 0 4px; overflow: visible; position: relative; z-index: 1; }
  .git-popup-tab { padding: 8px 10px; border: none; background: transparent; color: var(--text-secondary); font-size: 11px; font-weight: 600; cursor: pointer; border-bottom: 2px solid transparent; transition: all 0.1s; font-family: inherit; }
  .git-popup-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
  .git-popup-tab:hover { color: var(--text-primary); }
  .git-popup-tab-actions { margin-left: auto; display: flex; gap: 1px; padding-right: 4px; overflow: visible; }

  .git-action-btn { border: none; background: transparent; color: var(--text-secondary); cursor: pointer; padding: 3px 5px; border-radius: 4px; display: flex; align-items: center; gap: 3px; font-size: 10px; font-family: inherit; transition: all 0.1s; }
  .git-action-btn:hover:not(:disabled) { background: rgba(255,255,255,0.06); color: var(--text-primary); }
  .git-action-btn:disabled { opacity: 0.4; cursor: wait; }
  .git-action-btn.has-tooltip { position: relative; }
  .btn-tooltip { display: none; position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%); background: #1c2128; border: 1px solid var(--border); border-radius: 4px; padding: 3px 8px; font-size: 10px; color: var(--text-primary); white-space: nowrap; z-index: 600; pointer-events: none; }
  .git-action-btn.has-tooltip:hover .btn-tooltip { display: block; }

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
</style>

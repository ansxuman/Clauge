<script>
  import { theme } from "$lib/stores/theme.svelte";
  import { pluginsStore } from "$lib/stores/plugins.svelte";
  import { contextsStore } from "$lib/stores/contexts.svelte";
  import { terminalStore } from "$lib/stores/terminal.svelte";
  import { shellStore } from "$lib/stores/shell.svelte";

  let {
    show = $bindable(),
    settingsTab = $bindable(),
    appVersion,
    onOpenExternal,
    onApplyTheme,
    onApplyAccent,
  } = $props();
</script>

{#if show}
<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div class="modal-backdrop">
  <div class="stg-modal">
    <div class="stg-header">
      <span class="stg-title">Settings</span>
      <button class="stg-close" onclick={() => show = false}>&times;</button>
    </div>
    <div class="stg-layout">
      <div class="stg-tabs">
        <button class="stg-tab" class:active={settingsTab === 'settings'} onclick={() => settingsTab = 'settings'}>
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 3v1m0 16v1m-9-9h1m16 0h1m-2.636-6.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m11.314 11.314l.707.707" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
          Appearance
        </button>
        <button class="stg-tab" class:active={settingsTab === 'plugins'} onclick={() => { settingsTab = 'plugins'; pluginsStore.loadClaudePlugins(); }}>
          <svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
          Plugins
        </button>
        <button class="stg-tab" class:active={settingsTab === 'contexts'} onclick={() => { settingsTab = 'contexts'; contextsStore.loadContextSnippets(); }}>
          <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
          Contexts
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
            <button class="chip" class:selected={theme.currentTheme === 'dark'} onclick={() => onApplyTheme('dark')}>Dark</button>
            <button class="chip" class:selected={theme.currentTheme === 'light'} onclick={() => onApplyTheme('light')}>Light</button>
          </div>
        </div>
        <div class="stg-field">
          <span class="stg-label">Accent Color</span>
          <div class="accent-row">
            {#each ['#58a6ff', '#d2a8ff', '#3fb950', '#f85149', '#d29922', '#ff7b72'] as color}
              <button class="color-dot" style="background:{color};{theme.accentColor === color ? 'box-shadow:0 0 0 2px var(--text-primary);' : ''}"
                onclick={() => onApplyAccent(color)} title={color}></button>
            {/each}
          </div>
        </div>
      </div>

      <div class="stg-section">
        <div class="stg-section-label">Terminal</div>
        <div class="stg-field">
          <span class="stg-label">Font Size</span>
          <div style="display:flex;align-items:center;gap:8px;">
            <input type="range" min="10" max="18" step="1" bind:value={terminalStore.termFontSize} class="stg-range"
              oninput={(e) => {
                const size = parseInt(e.target.value);
                terminalStore.termFontSize = size;
                localStorage.setItem('clauge-font-size', String(size));
                for (const [, en] of terminalStore.terminalMap) { if (en.term) { en.term.options.fontSize = size; try { en.fitAddon.fit(); } catch(_) {} } }
                for (const [, en] of shellStore.shellMap) { if (en.term) { en.term.options.fontSize = size; try { en.fitAddon.fit(); } catch(_) {} } }
              }} />
            <span style="font-size:11px;color:var(--text-secondary);width:24px;text-align:right;font-variant-numeric:tabular-nums;">{terminalStore.termFontSize}px</span>
          </div>
        </div>
      </div>

    {:else if settingsTab === 'plugins'}
      <div class="plugin-subtabs">
        <button class="plugin-subtab" class:active={pluginsStore.pluginTab === 'installed'} onclick={() => pluginsStore.pluginTab = 'installed'}>Installed ({pluginsStore.claudePlugins.length})</button>
        <button class="plugin-subtab" class:active={pluginsStore.pluginTab === 'marketplace'} onclick={() => pluginsStore.pluginTab = 'marketplace'}>Marketplace</button>
      </div>
      {#if pluginsStore.pluginMsg}
        <div class="plugin-msg" class:error={pluginsStore.pluginMsg.startsWith('Failed')}>{pluginsStore.pluginMsg}</div>
      {/if}

      {#if pluginsStore.pluginTab === 'installed'}
        {#if pluginsStore.claudePlugins.length === 0}
          <div class="plugin-empty">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--border)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
            <p>No plugins installed</p>
            <button class="plugin-browse-btn" onclick={() => pluginsStore.pluginTab = 'marketplace'}>Browse Marketplace</button>
          </div>
        {:else}
          <div class="plugins-list">
            {#each pluginsStore.claudePlugins as plugin}
              <div class="plugin-card">
                <div class="plugin-icon">{plugin.name.charAt(0).toUpperCase()}</div>
                <div class="plugin-info">
                  <span class="plugin-name">{plugin.name}</span>
                  <span class="plugin-cmd">{plugin.marketplace}{plugin.version && plugin.version !== 'unknown' ? ` · v${plugin.version}` : ''}</span>
                </div>
                <div class="plugin-actions">
                  <button class="toggle-switch plugin-toggle" class:on={plugin.enabled} onclick={() => pluginsStore.togglePlugin(plugin)}>
                    <span class="toggle-knob"></span>
                  </button>
                  <button class="plugin-uninstall" onclick={() => pluginsStore.pluginUninstallConfirm = plugin} title="Uninstall">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M6.5 1.75a.25.25 0 01.25-.25h2.5a.25.25 0 01.25.25V3h-3V1.75zM11 3V1.75A1.75 1.75 0 009.25 0h-2.5A1.75 1.75 0 005 1.75V3H2.75a.75.75 0 000 1.5h.928l.747 10.218A1.75 1.75 0 006.172 16h3.656a1.75 1.75 0 001.747-1.282L12.322 4.5h.928a.75.75 0 000-1.5H11z"/></svg>
                  </button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      {:else}
        <div style="margin-bottom:12px;">
          <input class="plugin-search full" type="text" bind:value={pluginsStore.pluginSearch} placeholder="Search plugins..." />
        </div>
        <div class="plugins-list marketplace">
          {#each pluginsStore.marketplacePlugins.filter(p => !p.installed && (!pluginsStore.pluginSearch || p.name.toLowerCase().includes(pluginsStore.pluginSearch.toLowerCase()) || (p.description || '').toLowerCase().includes(pluginsStore.pluginSearch.toLowerCase()))) as plugin}
            <div class="plugin-card">
              <div class="plugin-icon mp">{plugin.name.charAt(0).toUpperCase()}</div>
              <div class="plugin-info">
                <span class="plugin-name">{plugin.name}</span>
                <span class="plugin-cmd">{plugin.description || ''}</span>
              </div>
              {#if plugin.installs}
                <span class="plugin-installs">{plugin.installs >= 1000 ? `${(plugin.installs / 1000).toFixed(0)}k` : plugin.installs}</span>
              {/if}
              <button class="plugin-install-btn" disabled={pluginsStore.installingPlugin === plugin.name} onclick={() => pluginsStore.installPlugin(plugin)}>
                {pluginsStore.installingPlugin === plugin.name ? 'Installing...' : 'Install'}
              </button>
            </div>
          {:else}
            <div class="plugin-empty">
              <p>No plugins found</p>
            </div>
          {/each}
        </div>
      {/if}

    {:else if settingsTab === 'contexts'}
      <div class="stg-section">
        <div class="stg-section-label" style="display:flex;align-items:center;justify-content:space-between;">
          Saved Contexts ({contextsStore.contextSnippets.length})
          <button class="save-key-btn" style="font-size:10px;padding:3px 10px;" onclick={() => { contextsStore.contextEditing = { name: '', content: '' }; contextsStore.contextNewName = ''; contextsStore.contextNewContent = ''; }}>+ New</button>
        </div>

        {#if contextsStore.contextEditing}
          <div class="ctx-editor">
            <input type="text" class="ctx-name-input" bind:value={contextsStore.contextNewName} placeholder="Context name..." />
            <textarea class="ctx-content-input" bind:value={contextsStore.contextNewContent} placeholder="Write your context, rules, or instructions..." rows="6"></textarea>
            <div style="display:flex;gap:6px;justify-content:flex-end;">
              <button class="save-key-btn" style="color:var(--text-secondary);border-color:var(--border);" onclick={() => contextsStore.contextEditing = null}>Cancel</button>
              <button class="save-key-btn" disabled={!contextsStore.contextNewName.trim() || !contextsStore.contextNewContent.trim()} onclick={() => contextsStore.saveContextSnippet()}>Save</button>
            </div>
          </div>
        {/if}

        <div class="ctx-list">
          {#each contextsStore.contextSnippets as ctx}
            {#if !contextsStore.contextEditing || contextsStore.contextEditing.name !== ctx.name}
            <div class="ctx-card">
              <div class="ctx-card-info">
                <span class="ctx-card-name">{ctx.name}</span>
                <span class="ctx-card-preview">{ctx.preview}</span>
              </div>
              <div class="ctx-card-actions">
                <button class="ctx-action-btn" onclick={() => { contextsStore.contextEditing = ctx; contextsStore.contextNewName = ctx.name; contextsStore.contextNewContent = ctx.content; }} title="Edit">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button class="ctx-action-btn danger" onclick={() => contextsStore.deleteContextSnippet(ctx.name)} title="Delete">
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M6.5 1.75a.25.25 0 01.25-.25h2.5a.25.25 0 01.25.25V3h-3V1.75zM11 3V1.75A1.75 1.75 0 009.25 0h-2.5A1.75 1.75 0 005 1.75V3H2.75a.75.75 0 000 1.5h.928l.747 10.218A1.75 1.75 0 006.172 16h3.656a1.75 1.75 0 001.747-1.282L12.322 4.5h.928a.75.75 0 000-1.5H11z"/></svg>
                </button>
              </div>
            </div>
            {/if}
          {:else}
            {#if !contextsStore.contextEditing}
              <div style="padding:20px;text-align:center;font-size:12px;color:var(--text-secondary);">
                No contexts yet. Create one to attach to sessions.
              </div>
            {/if}
          {/each}
        </div>
      </div>

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
          <span class="about-link-btn" onclick={() => onOpenExternal('https://github.com/ansxuman/Clauge')}>
            <svg viewBox="0 0 24 24"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 00-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0020 4.77 5.07 5.07 0 0019.91 1S18.73.65 16 2.48a13.38 13.38 0 00-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 005 4.77a5.44 5.44 0 00-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 009 18.13V22"/></svg>
            <span>GitHub</span>
          </span>
          <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
          <span class="about-link-btn" onclick={() => onOpenExternal('https://github.com/ansxuman/Clauge/issues')}>
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
            <span>Report Issue</span>
          </span>
          <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
          <span class="about-link-btn" onclick={() => onOpenExternal('https://github.com/ansxuman')}>
            <svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            <span>Developer</span>
          </span>
          <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
          <span class="about-link-btn" onclick={() => onOpenExternal('https://clauge.ssh-i.in')}>
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>
            <span>Website</span>
          </span>
        </div>

        <div class="about-section-label">SUPPORT</div>
        <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
        <span class="about-coffee" onclick={() => onOpenExternal('https://buymeacoffee.com/ansxuman')}>
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

<style>
  .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 1000; animation: fadeIn 0.15s ease-out; }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

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

  .chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .chip { padding: 5px 12px; border-radius: 14px; border: 1px solid var(--border); background: transparent; color: var(--text-secondary); font-size: 12px; cursor: pointer; font-family: inherit; transition: background 0.15s, color 0.15s; user-select: none; display: inline-block; }
  .chip:hover:not(.selected) { background: rgba(255,255,255,0.06); }
  .chip.selected { font-weight: 600; border-color: var(--accent); color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); }

  .accent-row { display: flex; gap: 10px; margin-top: 8px; }
  .color-dot { width: 28px; height: 28px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; transition: transform 0.15s; }
  .color-dot:hover { transform: scale(1.15); }

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
  .plugin-search.full { width: 100%; }
  .plugins-list.marketplace { max-height: 260px; overflow-y: auto; }
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
  @keyframes gitMsgIn { from { opacity: 0; } to { opacity: 1; } }
  .plugin-subtab { flex: 1; padding: 8px; border: none; background: transparent; color: var(--text-secondary); font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; border-bottom: 2px solid transparent; transition: all 0.15s; }
  .plugin-subtab.active { color: var(--accent); border-bottom-color: var(--accent); }
  .plugin-subtab:hover { color: var(--text-primary); }
  .plugin-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 40px 0; color: var(--text-secondary); font-size: 12px; }
  .plugin-browse-btn { padding: 6px 16px; border-radius: 6px; border: 1px solid var(--accent); background: transparent; color: var(--accent); font-size: 12px; font-family: inherit; cursor: pointer; transition: all 0.15s; margin-top: 4px; }
  .plugin-browse-btn:hover { background: var(--accent); color: #fff; }

  .toggle-switch { width: 36px; height: 20px; border-radius: 10px; border: 1px solid var(--border); background: rgba(255,255,255,0.06); cursor: pointer; position: relative; transition: all 0.2s; padding: 0; }
  .toggle-switch.on { background: var(--accent); border-color: var(--accent); }
  .toggle-knob { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: var(--text-secondary); transition: all 0.2s; }
  .toggle-switch.on .toggle-knob { left: 18px; background: #fff; }

  .save-key-btn { padding: 5px 14px; border-radius: 6px; border: 1px solid var(--accent); background: transparent; color: var(--accent); font-size: 11px; cursor: pointer; font-family: inherit; transition: all 0.15s; }
  .save-key-btn:hover { background: var(--accent); color: #fff; }

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

  /* Context Manager */
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
</style>

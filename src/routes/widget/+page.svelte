<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { invoke } from "@tauri-apps/api/core";
    import { listen, emit, type UnlistenFn } from "@tauri-apps/api/event";
    import { getCurrentWindow } from "@tauri-apps/api/window";
    import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
    import { LogicalSize } from "@tauri-apps/api/dpi";
    import { MEETING_EVENT } from "$lib/shared/constants/events";
    import { MEETING_MODEL_MISSING } from "$lib/modes/workspace/commands";

    type DetectStatus = {
        enabled: boolean;
        app: string | null;
        active: boolean;
    };
    type RecordingStatus = {
        recording: boolean;
        stopping: boolean;
        meetingId: string | null;
        startedAt: string | null;
        sourceApp: string | null;
        systemAudio: boolean;
        elapsedSecs: number;
    };

    const WINDOW_WIDTH = 480;
    const COLLAPSED_HEIGHT = 80;
    const EXPANDED_HEIGHT = 236;

    let phase = $state<"prompt" | "starting" | "model-missing" | "recording">(
        "prompt",
    );
    let sourceApp = $state<string | null>(null);
    let systemAudio = $state(true);
    let stopping = $state(false);
    let menuOpen = $state(false);
    let errorMsg = $state<string | null>(null);
    let startedAtMs = $state(0);
    let nowMs = $state(Date.now());
    let unlistens: UnlistenFn[] = [];

    function cap(s: string): string {
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    function formatElapsed(total: number): string {
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        const mm = String(m).padStart(2, "0");
        const ss = String(s).padStart(2, "0");
        return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
    }

    const elapsedLabel = $derived(
        formatElapsed(Math.max(0, Math.floor((nowMs - startedAtMs) / 1000))),
    );
    const promptSubtitle = $derived(
        phase === "model-missing"
            ? "Download a transcription model in Settings first"
            : (errorMsg ??
                  (sourceApp ? `${cap(sourceApp)} call detected` : "Call detected")),
    );
    const recordingSubtitle = $derived(
        (sourceApp ? `${cap(sourceApp)} call` : "Call") +
            (systemAudio ? "" : " · mic only"),
    );

    $effect(() => {
        if (phase !== "recording") return;
        const id = setInterval(() => (nowMs = Date.now()), 1000);
        return () => clearInterval(id);
    });

    // The window is only as tall as the pill; the dropdown needs room, so
    // grow the (transparent) window while the menu is open.
    $effect(() => {
        const height = menuOpen ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT;
        getCurrentWindow()
            .setSize(new LogicalSize(WINDOW_WIDTH, height))
            .catch(() => {});
    });

    // Escape closes the menu. No arrow-key navigation: the menu items are
    // plain focusable buttons, so Tab already cycles through all three.
    $effect(() => {
        if (!menuOpen) return;
        const onKeydown = (e: KeyboardEvent) => {
            if (e.key === "Escape") menuOpen = false;
        };
        window.addEventListener("keydown", onKeydown);
        return () => window.removeEventListener("keydown", onKeydown);
    });

    function applyRecording(rec: RecordingStatus) {
        sourceApp = rec.sourceApp ?? sourceApp;
        systemAudio = rec.systemAudio;
        startedAtMs = Date.now() - rec.elapsedSecs * 1000;
        nowMs = Date.now();
        stopping = rec.stopping;
        phase = "recording";
    }

    async function refreshRecordingStatus() {
        try {
            const rec = await invoke<RecordingStatus>(
                "workspace_meeting_recording_status",
            );
            if (rec.recording || rec.stopping) applyRecording(rec);
        } catch {
            /* status refresh is best-effort */
        }
    }

    async function startTranscribing() {
        if (phase === "starting") return;
        menuOpen = false;
        errorMsg = null;
        phase = "starting";
        try {
            await invoke("workspace_meeting_start", { sourceApp });
        } catch (e) {
            if (String(e) === MEETING_MODEL_MISSING) {
                phase = "model-missing";
            } else {
                errorMsg = String(e);
                phase = "prompt";
            }
        }
    }

    async function stopRecording() {
        if (stopping) return;
        stopping = true;
        try {
            await invoke("workspace_meeting_stop");
        } catch {
            stopping = false;
        }
    }

    async function dismiss() {
        menuOpen = false;
        try {
            await invoke("workspace_meeting_detect_dismiss");
        } catch {
            /* closing anyway */
        }
        getCurrentWindow().close().catch(() => {});
    }

    async function disableDetect() {
        menuOpen = false;
        try {
            await invoke("workspace_meeting_detect_set_enabled", {
                enabled: false,
            });
        } catch {
            /* closing anyway */
        }
        getCurrentWindow().close().catch(() => {});
    }

    async function openSettings() {
        menuOpen = false;
        try {
            await emit(MEETING_EVENT.OPEN_SETTINGS);
            const main = await WebviewWindow.getByLabel("main");
            if (main) {
                await main.unminimize();
                await main.show();
                await main.setFocus();
            }
        } catch (e) {
            console.warn("[meeting-widget] focusing main window failed:", e);
        }
    }

    onMount(async () => {
        unlistens = await Promise.all([
            listen<{ app: string }>(MEETING_EVENT.CALL_DETECTED, (e) => {
                if (phase === "recording") return;
                sourceApp = e.payload.app;
                errorMsg = null;
                phase = "prompt";
            }),
            listen<{
                meetingId: string;
                startedAt: string;
                sourceApp: string | null;
                systemAudio: boolean;
            }>(MEETING_EVENT.RECORDING_STARTED, (e) => {
                sourceApp = e.payload.sourceApp ?? sourceApp;
                systemAudio = e.payload.systemAudio;
                startedAtMs = Date.parse(e.payload.startedAt) || Date.now();
                nowMs = Date.now();
                stopping = false;
                phase = "recording";
            }),
            listen(MEETING_EVENT.RECORDING_WARNING, () => {
                void refreshRecordingStatus();
            }),
            listen(MEETING_EVENT.RECORDING_STOPPED, () => {
                if (phase !== "recording") return;
                getCurrentWindow().close().catch(() => {});
            }),
            listen(MEETING_EVENT.RECORDING_ERROR, () => {
                if (phase !== "recording") return;
                getCurrentWindow().close().catch(() => {});
            }),
        ]);

        // The window may open before events arrive, and a running recording
        // must survive a widget reopen — resync from the live snapshots.
        try {
            const rec = await invoke<RecordingStatus>(
                "workspace_meeting_recording_status",
            );
            if (rec.recording || rec.stopping) {
                applyRecording(rec);
                return;
            }
        } catch {
            /* fall through to detection state */
        }
        try {
            const det = await invoke<DetectStatus>(
                "workspace_meeting_detect_status",
            );
            if (det.app) sourceApp = det.app;
        } catch {
            /* keep generic subtitle */
        }
    });

    onDestroy(() => {
        for (const unlisten of unlistens) unlisten();
    });
</script>

<svelte:window
    onmousedown={(e) => {
        if (
            menuOpen &&
            !(e.target as HTMLElement).closest(".menu, .menu-toggle")
        ) {
            menuOpen = false;
        }
    }}
/>

<div class="widget-root">
    <div class="pill" data-tauri-drag-region>
        {#if phase === "recording"}
            <span class="rec-dot" aria-hidden="true"></span>
            <div class="text">
                <span class="title">Recording meeting notes</span>
                <span class="subtitle">{recordingSubtitle}</span>
            </div>
            <span class="elapsed">{elapsedLabel}</span>
            <button
                class="stop-btn"
                onclick={stopRecording}
                disabled={stopping}
                aria-label="Stop recording"
                title="Stop recording"
            >
                {#if stopping}
                    <span class="spinner"></span>
                {:else}
                    <svg
                        width="12"
                        height="12"
                        viewBox="0 0 12 12"
                        fill="currentColor"
                        aria-hidden="true"
                    >
                        <rect x="1" y="1" width="10" height="10" rx="2" />
                    </svg>
                {/if}
            </button>
        {:else}
            <img class="logo" src="/clauge-icon.svg" alt="" />
            <div class="text">
                <span class="title">Start AI Meeting Note</span>
                <span class="subtitle" class:warn={phase === "model-missing"}
                    >{promptSubtitle}</span
                >
            </div>
            {#if phase === "model-missing"}
                <button class="primary solo" onclick={openSettings}>
                    Open Settings
                </button>
            {:else}
                <div class="actions">
                    <button
                        class="primary split-main"
                        onclick={startTranscribing}
                        disabled={phase === "starting"}
                    >
                        {#if phase === "starting"}
                            <span class="spinner light"></span>
                        {/if}
                        Start transcribing
                    </button>
                    <button
                        class="primary split-chevron menu-toggle"
                        onclick={() => (menuOpen = !menuOpen)}
                        aria-label="More options"
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                    >
                        <svg
                            width="10"
                            height="10"
                            viewBox="0 0 10 10"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.6"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            aria-hidden="true"
                        >
                            <path d="M2 3.5 5 6.5 8 3.5" />
                        </svg>
                    </button>
                </div>
            {/if}
        {/if}
    </div>

    {#if menuOpen}
        <div class="menu" role="menu">
            <button class="menu-item" role="menuitem" onclick={dismiss}>
                Dismiss for this call
            </button>
            <button class="menu-item" role="menuitem" onclick={disableDetect}>
                Don't auto-detect calls
            </button>
            <div class="menu-divider"></div>
            <button class="menu-item" role="menuitem" onclick={openSettings}>
                Meeting Notes settings…
            </button>
        </div>
    {/if}
</div>

<style>
    :global(html),
    :global(body) {
        background: transparent !important;
        margin: 0;
        overflow: hidden;
    }

    .widget-root {
        width: 100vw;
        height: 100vh;
        font-family:
            -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Ubuntu,
            sans-serif;
        -webkit-font-smoothing: antialiased;
        user-select: none;
        -webkit-user-select: none;
    }

    .pill {
        height: 60px;
        margin: 10px;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 0 10px 0 12px;
        background: #ffffff;
        border: 1px solid rgba(0, 0, 0, 0.08);
        border-radius: 14px;
        /* offset + blur must stay within the 10px window margin or the
           shadow gets clipped at the (transparent) window edge */
        box-shadow:
            0 3px 7px rgba(0, 0, 0, 0.22),
            0 1px 3px rgba(0, 0, 0, 0.1);
        box-sizing: border-box;
    }

    .logo {
        width: 30px;
        height: 30px;
        flex: none;
        pointer-events: none;
    }

    .rec-dot {
        width: 10px;
        height: 10px;
        margin: 0 6px 0 4px;
        flex: none;
        border-radius: 50%;
        background: #e5484d;
        animation: rec-pulse 1.6s ease-in-out infinite;
        pointer-events: none;
    }

    @keyframes rec-pulse {
        0%,
        100% {
            box-shadow: 0 0 0 0 rgba(229, 72, 77, 0.45);
        }
        50% {
            box-shadow: 0 0 0 5px rgba(229, 72, 77, 0);
        }
    }

    .text {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 1px;
        pointer-events: none;
    }

    .title {
        font-size: 13px;
        font-weight: 600;
        color: #1f1f21;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .subtitle {
        font-size: 11.5px;
        color: #6f6f76;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .subtitle.warn {
        color: #b54708;
    }

    .elapsed {
        font-size: 12.5px;
        font-variant-numeric: tabular-nums;
        color: #e5484d;
        font-weight: 600;
        pointer-events: none;
    }

    .actions {
        display: flex;
        flex: none;
    }

    .primary {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        height: 30px;
        padding: 0 12px;
        border: none;
        background: #2383e2;
        color: #ffffff;
        font-size: 12.5px;
        font-weight: 500;
        font-family: inherit;
        cursor: pointer;
        transition: background 0.12s;
    }

    .primary:hover {
        background: #1b74cd;
    }

    .primary:disabled {
        opacity: 0.75;
        cursor: default;
    }

    .primary.solo {
        border-radius: 8px;
    }

    .split-main {
        border-radius: 8px 0 0 8px;
    }

    .split-chevron {
        border-radius: 0 8px 8px 0;
        padding: 0 7px;
        border-left: 1px solid rgba(255, 255, 255, 0.3);
    }

    .stop-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 30px;
        flex: none;
        border: none;
        border-radius: 8px;
        background: #e5484d;
        color: #ffffff;
        cursor: pointer;
        transition: background 0.12s;
    }

    .stop-btn:hover {
        background: #d23339;
    }

    .stop-btn:disabled {
        opacity: 0.75;
        cursor: default;
    }

    .spinner {
        width: 12px;
        height: 12px;
        flex: none;
        border-radius: 50%;
        border: 2px solid rgba(255, 255, 255, 0.35);
        border-top-color: #ffffff;
        animation: spin 0.7s linear infinite;
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    .menu {
        margin: -2px 10px 0 auto;
        width: 220px;
        padding: 4px;
        background: #ffffff;
        border: 1px solid rgba(0, 0, 0, 0.08);
        border-radius: 10px;
        box-shadow:
            0 8px 24px rgba(0, 0, 0, 0.22),
            0 1px 3px rgba(0, 0, 0, 0.1);
        display: flex;
        flex-direction: column;
    }

    .menu-item {
        border: none;
        background: none;
        text-align: left;
        font-size: 12.5px;
        font-family: inherit;
        color: #1f1f21;
        padding: 7px 10px;
        border-radius: 6px;
        cursor: pointer;
        transition: background 0.12s;
    }

    .menu-item:hover {
        background: rgba(0, 0, 0, 0.06);
    }

    .menu-divider {
        height: 1px;
        margin: 4px 6px;
        background: rgba(0, 0, 0, 0.08);
    }

    @media (prefers-color-scheme: dark) {
        .pill,
        .menu {
            background: #28282c;
            border-color: rgba(255, 255, 255, 0.1);
        }
        .title,
        .menu-item {
            color: #f0f0f2;
        }
        .subtitle {
            color: #9d9da6;
        }
        .subtitle.warn {
            color: #f0a05a;
        }
        .menu-item:hover {
            background: rgba(255, 255, 255, 0.08);
        }
        .menu-divider {
            background: rgba(255, 255, 255, 0.1);
        }
    }
</style>

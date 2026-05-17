<script lang="ts">
    import { invoke } from "@tauri-apps/api/core";
    import { cloudConnected, upgradeModalOpen } from "$lib/stores/cloud";
    import { openSettingsTab } from "$lib/shared/stores/tabs";

    type Discount = { percent: number; code: string | null };
    type Plan = { id: string; price_usd: number; discount: Discount | null };
    type Pricing = { schema_version: number; plans: Plan[] };

    let pricing = $state<Pricing | null>(null);
    let loading = $state(false);
    let error = $state<string | null>(null);
    let busyPlan = $state<string | null>(null);
    let selectedPlan = $state<string>("lifetime"); // default selection — drives the upsell
    let copiedCode = $state<string | null>(null); // null when none active

    // ── Error handling ────────────────────────────────────────────────
    function friendlyError(stage: "pricing" | "checkout", raw: string): string {
        const lower = raw.toLowerCase();
        if (lower.includes("unauthorized") || lower.includes("401"))
            return "Your session expired. Please sign in again.";
        if (lower.includes("network") || lower.includes("failed to fetch"))
            return "Couldn't reach the Clauge cloud. Check your internet and try again.";
        if (stage === "checkout") {
            if (lower.includes("invalid plan"))
                return "That plan isn't available right now.";
            return "Couldn't start checkout. Please try again in a moment.";
        }
        return "Couldn't load pricing. Please try again in a moment.";
    }
    function setError(stage: "pricing" | "checkout", e: unknown) {
        console.error(`[UpgradeModal] ${stage} failed:`, e);
        error = friendlyError(stage, String(e));
    }

    // ── Pricing fetch ─────────────────────────────────────────────────
    $effect(() => {
        if (
            $upgradeModalOpen &&
            $cloudConnected &&
            pricing === null &&
            !loading
        ) {
            loadPricing();
        }
    });
    async function loadPricing() {
        loading = true;
        error = null;
        try {
            pricing = await invoke<Pricing>("cloud_get_pricing");
            // Snap default selection to a plan that actually exists in the
            // response — prevents a dead CTA if lifetime is ever missing
            // (worker misconfig, migration not applied, plan removed).
            const ids = new Set(pricing.plans.map((p) => p.id));
            if (!ids.has(selectedPlan)) {
                selectedPlan = ids.has("lifetime")
                    ? "lifetime"
                    : ids.has("yearly")
                      ? "yearly"
                      : (pricing.plans[0]?.id ?? "monthly");
            }
        } catch (e: unknown) {
            setError("pricing", e);
        } finally {
            loading = false;
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────
    function discountedPrice(p: Plan): number {
        if (!p.discount) return p.price_usd;
        return (
            Math.round(p.price_usd * (1 - p.discount.percent / 100) * 100) / 100
        );
    }
    // Per-row "Save N%" pill copy — for yearly, calculated against monthly
    // sticker × 12 (the upsell framing). For lifetime, we'd compare against
    // yearly × ~10 implied lifetime years (rough) — but UX-wise a static
    // "Best deal" pill conveys it more honestly than a fake math number.
    function yearlySavingsPct(
        yearly: Plan,
        monthly: Plan | undefined,
    ): number | null {
        if (!monthly) return null;
        const yearlyEff = discountedPrice(yearly);
        const monthlyEff = discountedPrice(monthly);
        const fullYear = monthlyEff * 12;
        if (yearlyEff >= fullYear) return null;
        return Math.round(((fullYear - yearlyEff) / fullYear) * 100);
    }

    async function copyDiscountCode(code: string) {
        try {
            await navigator.clipboard.writeText(code);
            copiedCode = code;
            setTimeout(() => {
                if (copiedCode === code) copiedCode = null;
            }, 2000);
        } catch {
            // Clipboard API may be restricted in some webviews — silently
            // fail; the code stays visible inline so the user can copy
            // manually.
        }
    }

    async function startCheckout(planId: string) {
        busyPlan = planId;
        error = null;
        try {
            const url = await invoke<string>("cloud_create_checkout", {
                plan: planId,
            });
            const opener = await import("@tauri-apps/plugin-opener").catch(
                () => null,
            );
            if (opener) {
                await opener.openUrl(url);
            } else {
                window.open(url, "_blank");
            }
        } catch (e: unknown) {
            setError("checkout", e);
        } finally {
            busyPlan = null;
        }
    }

    function close() {
        upgradeModalOpen.set(false);
        pricing = null;
        error = null;
    }

    function teleportToBody(node: HTMLElement) {
        document.body.appendChild(node);
        return {
            destroy() {
                if (node.parentElement === document.body) node.remove();
            },
        };
    }

    // Order plans for display: monthly → yearly → lifetime. Worker may
    // return them in any order so we normalize here.
    const PLAN_ORDER = ["monthly", "yearly", "lifetime"];
    function orderedPlans(p: Pricing | null): Plan[] {
        if (!p) return [];
        return [...p.plans].sort(
            (a, b) => PLAN_ORDER.indexOf(a.id) - PLAN_ORDER.indexOf(b.id),
        );
    }
    function planLabel(id: string): string {
        if (id === "monthly") return "Monthly";
        if (id === "yearly") return "Yearly";
        if (id === "lifetime") return "Lifetime";
        return id;
    }
    function priceSuffix(id: string): string {
        if (id === "monthly") return "/mo";
        if (id === "yearly") return "/yr";
        return "once";
    }

    // Plan-specific credit copy for the feature grid. Only credits differ
    // between plans — Managed AI / coworkers / themes are identical.
    function creditsCopy(id: string): string {
        if (id === "yearly") return "12,000 credits / year";
        if (id === "lifetime") return "20,000 credits / year, forever";
        return "1,000 credits / month";
    }
</script>

{#if $upgradeModalOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="overlay" onclick={close} use:teleportToBody>
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class="modal-wrap"
            onclick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
        >
            <div class="modal">
                <button class="close-btn" onclick={close} aria-label="Close">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path
                            d="M1 1l12 12M13 1L1 13"
                            stroke="currentColor"
                            stroke-width="1.5"
                            stroke-linecap="round"
                        />
                    </svg>
                </button>

                {#if !$cloudConnected}
                    <!-- Generic sign-in state — works for any Pro entry point -->
                    <div class="signin-state">
                        <div class="signin-icon" aria-hidden="true">
                            <svg
                                viewBox="0 0 24 24"
                                width="22"
                                height="22"
                                fill="currentColor"
                            >
                                <path
                                    d="M12 2l2.6 7.4L22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6L12 2z"
                                />
                            </svg>
                        </div>
                        <h2 class="signin-title">Sign in to continue</h2>
                        <p class="signin-sub">
                            A Clauge account keeps your subscription, sync, and
                            preferences tied to you across devices. It only
                            takes a moment.
                        </p>
                        <button
                            class="cta-btn"
                            onclick={() => {
                                close();
                                openSettingsTab("account");
                            }}
                        >
                            Open Settings → Account
                            <svg
                                width="13"
                                height="13"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                aria-hidden="true"
                            >
                                <path d="M5 12h14" /><path d="M12 5l7 7-7 7" />
                            </svg>
                        </button>
                    </div>
                {:else if loading}
                    <p class="status-line muted">Loading pricing…</p>
                {:else if error}
                    <div class="error-box" role="alert">
                        <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            aria-hidden="true"
                        >
                            <circle cx="12" cy="12" r="10" />
                            <line x1="12" y1="8" x2="12" y2="12" />
                            <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                        <span>{error}</span>
                    </div>
                {:else if pricing}
                    {@const plans = orderedPlans(pricing)}
                    {@const monthly = plans.find((p) => p.id === "monthly")}
                    {@const yearly = plans.find((p) => p.id === "yearly")}
                    {@const yearlyPct = yearly
                        ? yearlySavingsPct(yearly, monthly)
                        : null}

                    <!-- Header: Pro plan pill + headline + tagline -->
                    <header class="upm-head">
                        <span class="upm-pill">
                            <svg
                                width="10"
                                height="10"
                                viewBox="0 0 24 24"
                                fill="currentColor"
                                aria-hidden="true"
                            >
                                <path
                                    d="M12 2l2.6 7.4L22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6L12 2z"
                                />
                            </svg>
                            Pro plan
                        </span>
                        <h2 class="upm-title">Upgrade to Clauge Pro</h2>
                        <p class="upm-tag">Everything you need, unlocked.</p>
                    </header>

                    <!-- 2x2 feature grid -->
                    <div class="upm-features">
                        <div class="upm-feat">
                            <svg
                                class="upm-feat-icon"
                                viewBox="0 0 24 24"
                                width="14"
                                height="14"
                                fill="currentColor"
                                aria-hidden="true"
                            >
                                <path
                                    d="M12 2l2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5z"
                                />
                            </svg>
                            <span>Clauge AI</span>
                        </div>
                        <div class="upm-feat">
                            <svg
                                class="upm-feat-icon"
                                viewBox="0 0 24 24"
                                width="14"
                                height="14"
                                fill="currentColor"
                                aria-hidden="true"
                            >
                                <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
                            </svg>
                            <span>{creditsCopy(selectedPlan)}</span>
                        </div>
                        <div class="upm-feat">
                            <svg
                                class="upm-feat-icon"
                                viewBox="0 0 24 24"
                                width="14"
                                height="14"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="1.8"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                aria-hidden="true"
                            >
                                <circle cx="9" cy="8" r="3" />
                                <path d="M3 21v-1a6 6 0 0112 0v1" />
                                <circle cx="17" cy="7" r="2.5" />
                                <path d="M14 16a4.5 4.5 0 018 2.8V20" />
                            </svg>
                            <span>Unlimited coworkers</span>
                        </div>
                        <div class="upm-feat">
                            <svg
                                class="upm-feat-icon"
                                viewBox="0 0 24 24"
                                width="14"
                                height="14"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="1.8"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                aria-hidden="true"
                            >
                                <circle cx="12" cy="12" r="9" />
                                <circle
                                    cx="7.5"
                                    cy="11"
                                    r="1"
                                    fill="currentColor"
                                />
                                <circle
                                    cx="11"
                                    cy="6.5"
                                    r="1"
                                    fill="currentColor"
                                />
                                <circle
                                    cx="16"
                                    cy="9"
                                    r="1"
                                    fill="currentColor"
                                />
                            </svg>
                            <span>Premium themes</span>
                        </div>
                        <div class="upm-feat">
                            <svg
                                class="upm-feat-icon"
                                viewBox="0 0 24 24"
                                width="14"
                                height="14"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="1.8"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                aria-hidden="true"
                            >
                                <rect x="9" y="2" width="6" height="12" rx="3" />
                                <path d="M5 11a7 7 0 0014 0" />
                                <path d="M12 18v3" />
                            </svg>
                            <span>AI meeting notes <span class="upm-feat-mute">— coming soon</span></span>
                        </div>
                        <div class="upm-feat">
                            <svg
                                class="upm-feat-icon"
                                viewBox="0 0 24 24"
                                width="14"
                                height="14"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="1.8"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                aria-hidden="true"
                            >
                                <rect x="3" y="8" width="18" height="13" rx="1.5" />
                                <path d="M3 13h18" />
                                <path d="M12 8v13" />
                                <path d="M12 8c-2-3-6-3-6 0 0 1.5 2 2 4 2h2zm0 0c2-3 6-3 6 0 0 1.5-2 2-4 2h-2z" />
                            </svg>
                            <span>All future premium features included</span>
                        </div>
                    </div>

                    <!-- Radio-selectable plan rows -->
                    <div
                        class="upm-plans"
                        role="radiogroup"
                        aria-label="Choose plan"
                    >
                        {#each plans as p (p.id)}
                            {@const isSelected = selectedPlan === p.id}
                            {@const eff = discountedPrice(p)}
                            {@const hasDiscount = !!p.discount}
                            <!-- svelte-ignore a11y_click_events_have_key_events -->
                            <!-- svelte-ignore a11y_no_static_element_interactions -->
                            <div
                                class="upm-row"
                                class:is-selected={isSelected}
                                class:is-lifetime={p.id === "lifetime"}
                                onclick={() => (selectedPlan = p.id)}
                                role="radio"
                                aria-checked={isSelected}
                            >
                                <div class="upm-row-top">
                                    <div class="upm-row-name">
                                        <span
                                            class="upm-radio"
                                            aria-hidden="true"
                                        >
                                            {#if isSelected}<span
                                                    class="upm-radio-dot"
                                                ></span>{/if}
                                        </span>
                                        <span class="upm-row-label"
                                            >{planLabel(p.id)}</span
                                        >
                                        {#if p.id === "yearly" && yearlyPct}
                                            <span class="upm-pill-save"
                                                >Save {yearlyPct}%</span
                                            >
                                        {/if}
                                        {#if p.id === "lifetime"}
                                            <span class="upm-pill-best"
                                                >Best deal</span
                                            >
                                        {/if}
                                    </div>
                                    <div class="upm-row-price">
                                        <strong
                                            >${eff.toFixed(
                                                eff % 1 === 0 ? 0 : 2,
                                            )}</strong
                                        >
                                        <span class="upm-row-suffix"
                                            >{priceSuffix(p.id)}</span
                                        >
                                        {#if hasDiscount}
                                            {@const strike =
                                                p.id === "yearly" && monthly
                                                    ? monthly.price_usd * 12
                                                    : p.price_usd}
                                            <span class="upm-row-strike"
                                                >${strike}</span
                                            >
                                        {/if}
                                    </div>
                                </div>
                                {#if hasDiscount && p.discount?.code}
                                    <div class="upm-row-discount">
                                        <span class="upm-row-discount-text">
                                            Use at checkout to save {p.discount
                                                .percent}%
                                        </span>
                                        <span class="upm-row-discount-code"
                                            >{p.discount.code}</span
                                        >
                                        <button
                                            type="button"
                                            class="upm-copy"
                                            onclick={(e) => {
                                                e.stopPropagation();
                                                copyDiscountCode(
                                                    p.discount!.code!,
                                                );
                                            }}
                                            title="Copy discount code"
                                        >
                                            {#if copiedCode === p.discount.code}
                                                <svg
                                                    width="12"
                                                    height="12"
                                                    viewBox="0 0 24 24"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    stroke-width="2.5"
                                                    stroke-linecap="round"
                                                    stroke-linejoin="round"
                                                    aria-hidden="true"
                                                >
                                                    <polyline
                                                        points="20 6 9 17 4 12"
                                                    />
                                                </svg>
                                                Copied
                                            {:else}
                                                <svg
                                                    width="12"
                                                    height="12"
                                                    viewBox="0 0 24 24"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    stroke-width="1.8"
                                                    stroke-linecap="round"
                                                    stroke-linejoin="round"
                                                    aria-hidden="true"
                                                >
                                                    <rect
                                                        x="9"
                                                        y="9"
                                                        width="13"
                                                        height="13"
                                                        rx="2"
                                                    />
                                                    <path
                                                        d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"
                                                    />
                                                </svg>
                                                Copy
                                            {/if}
                                        </button>
                                    </div>
                                {/if}
                            </div>
                        {/each}
                    </div>

                    <!-- Contextual CTA — label changes with selection -->
                    <button
                        class="cta-btn upm-cta"
                        onclick={() => startCheckout(selectedPlan)}
                        disabled={busyPlan !== null}
                    >
                        <svg
                            width="13"
                            height="13"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.8"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            aria-hidden="true"
                        >
                            <rect x="5" y="11" width="14" height="10" rx="2" />
                            <path d="M8 11V8a4 4 0 018 0v3" />
                        </svg>
                        {busyPlan
                            ? "Opening checkout…"
                            : `Continue to checkout — ${planLabel(selectedPlan).toLowerCase()}`}
                    </button>

                    <!-- Footer microcopy -->
                    <p class="upm-foot">
                        <svg
                            class="upm-foot-icon"
                            width="11"
                            height="11"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            aria-hidden="true"
                        >
                            <rect x="5" y="11" width="14" height="10" rx="2" />
                            <path d="M8 11V8a4 4 0 018 0v3" />
                        </svg>
                        Secure checkout
                        <span class="upm-foot-dot">·</span> Cancel anytime
                        <span class="upm-foot-dot">·</span> Credits non-refundable
                        once used
                    </p>
                {/if}

                {#if busyPlan}
                    <div class="pending-overlay" aria-live="polite">
                        <div class="pending-inner">
                            <div class="spinner" aria-hidden="true"></div>
                            <p class="pending-title">
                                Opening secure checkout in your browser…
                            </p>
                            <p class="pending-hint">
                                This can take a few seconds on first launch.
                            </p>
                            <button
                                type="button"
                                class="pending-cancel"
                                onclick={() => (busyPlan = null)}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                {/if}
            </div>
        </div>
    </div>
{/if}

<style>
    .overlay {
        position: fixed;
        inset: 0;
        background: var(--scrim-strong, rgba(0, 0, 0, 0.6));
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: var(--z-drawer, 1000);
        backdrop-filter: blur(2px);
    }
    .modal-wrap {
        width: 560px;
        max-width: 92vw;
        max-height: 92vh;
        display: flex;
        flex-direction: column;
        color: var(--t1, #ddd);
        font-family: var(--ui);
        border-radius: var(--radius-lg, 14px);
        overflow: hidden;
        border: 1px solid var(--b1, #2a2a2a);
    }
    .modal {
        background: var(--n2, #0e0e0e);
        padding: 28px 28px 22px;
        position: relative;
        overflow-y: auto;
    }
    .close-btn {
        position: absolute;
        top: 14px;
        right: 14px;
        width: 28px;
        height: 28px;
        background: var(--surface-hover, #1a1a1a);
        border: 1px solid var(--b1, #2a2a2a);
        border-radius: 6px;
        color: var(--t3, #888);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        z-index: 2;
    }
    .close-btn:hover {
        color: var(--t1, #ddd);
        border-color: var(--b2, #3a3a3a);
    }

    /* ── Header ─────────────────────────────────────────────────── */
    .upm-head {
        margin-bottom: 18px;
    }
    .upm-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        font-size: 11px;
        font-weight: 600;
        color: var(--acc, #c2185b);
        background: color-mix(in srgb, var(--acc, #c2185b) 14%, transparent);
        border: 1px solid
            color-mix(in srgb, var(--acc, #c2185b) 30%, transparent);
        border-radius: 999px;
        margin-bottom: 14px;
    }
    .upm-title {
        margin: 0 0 6px;
        font-size: 22px;
        font-weight: 700;
        letter-spacing: -0.02em;
        color: var(--t1, #fff);
    }
    .upm-tag {
        margin: 0;
        font-size: 13px;
        color: var(--t3, #888);
    }

    /* ── Feature grid 2×2 ────────────────────────────────────────── */
    .upm-features {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px 24px;
        margin: 0 0 20px;
        padding: 0;
    }
    .upm-feat {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        color: var(--t2, #aaa);
    }
    .upm-feat-icon {
        color: var(--acc, #c2185b);
        flex-shrink: 0;
    }
    .upm-feat-mute {
        color: var(--t3, #888);
    }

    /* ── Plan rows ──────────────────────────────────────────────── */
    .upm-plans {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 18px;
    }
    .upm-row {
        padding: 14px 16px;
        border: 1px solid var(--b1, #2a2a2a);
        border-radius: var(--radius-md, 10px);
        background: var(--surface-hover, #1a1a1a);
        cursor: pointer;
        transition:
            border-color 0.12s,
            background 0.12s;
    }
    .upm-row:hover {
        border-color: var(--b2, #3a3a3a);
    }
    .upm-row.is-selected {
        border-color: color-mix(in srgb, var(--acc, #c2185b) 60%, transparent);
        background: color-mix(
            in srgb,
            var(--acc, #c2185b) 7%,
            var(--surface-hover, #1a1a1a)
        );
    }
    .upm-row.is-lifetime.is-selected {
        border-color: #d4a017;
        background: color-mix(
            in srgb,
            #d4a017 8%,
            var(--surface-hover, #1a1a1a)
        );
    }
    .upm-row-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
    }
    .upm-row-name {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
    }
    .upm-radio {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        border: 1.5px solid var(--b2, #3a3a3a);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        background: var(--n2, #0e0e0e);
    }
    .upm-row.is-selected .upm-radio {
        border-color: var(--acc, #c2185b);
    }
    .upm-row.is-lifetime.is-selected .upm-radio {
        border-color: #d4a017;
    }
    .upm-radio-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--acc, #c2185b);
    }
    .upm-row.is-lifetime.is-selected .upm-radio-dot {
        background: #d4a017;
    }
    .upm-row-label {
        font-size: 14px;
        font-weight: 600;
        color: var(--t1, #ddd);
    }
    .upm-pill-save {
        font-size: 10px;
        font-weight: 700;
        padding: 2px 8px;
        border-radius: 999px;
        background: color-mix(in srgb, #22c55e 14%, transparent);
        color: #4ade80;
        border: 1px solid color-mix(in srgb, #22c55e 30%, transparent);
    }
    .upm-pill-best {
        font-size: 10px;
        font-weight: 700;
        padding: 2px 8px;
        border-radius: 999px;
        background: color-mix(in srgb, #d4a017 16%, transparent);
        color: #f0b429;
        border: 1px solid color-mix(in srgb, #d4a017 35%, transparent);
    }
    .upm-row-price {
        display: flex;
        align-items: baseline;
        gap: 5px;
        flex-shrink: 0;
    }
    .upm-row-price strong {
        font-size: 18px;
        font-weight: 700;
        color: var(--t1, #fff);
        letter-spacing: -0.02em;
        font-variant-numeric: tabular-nums;
    }
    .upm-row-suffix {
        font-size: 12px;
        color: var(--t3, #888);
    }
    .upm-row-strike {
        font-size: 12px;
        color: var(--t4, var(--t3, #888));
        text-decoration: line-through;
        margin-left: 4px;
        opacity: 0.7;
    }
    .upm-row-discount {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid
            color-mix(in srgb, var(--b1, #2a2a2a) 70%, transparent);
        font-size: 11.5px;
    }
    .upm-row-discount-text {
        color: var(--t3, #888);
        flex: 1;
    }
    .upm-row-discount-code {
        font-family: var(--mono, ui-monospace);
        font-weight: 700;
        color: var(--acc, #c2185b);
        letter-spacing: 0.05em;
    }
    .upm-row.is-lifetime .upm-row-discount-code {
        color: #f0b429;
    }
    .upm-copy {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 4px 9px;
        border-radius: 5px;
        border: 1px solid var(--b1, #2a2a2a);
        background: var(--n2, #0e0e0e);
        color: var(--t2, #aaa);
        font-family: var(--ui);
        font-size: 11px;
        font-weight: 500;
        cursor: pointer;
        transition:
            background 0.12s,
            border-color 0.12s,
            color 0.12s;
    }
    .upm-copy:hover {
        color: var(--t1, #ddd);
        border-color: var(--b2, #3a3a3a);
        background: var(--surface-hover, #1a1a1a);
    }

    /* ── CTA + footer ───────────────────────────────────────────── */
    .upm-cta {
        width: 100%;
        margin-bottom: 12px;
    }
    .upm-foot {
        margin: 0;
        text-align: center;
        font-size: 11px;
        color: var(--t3, #888);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        width: 100%;
    }
    .upm-foot-icon {
        opacity: 0.7;
        margin-right: 2px;
    }
    .upm-foot-dot {
        opacity: 0.4;
        margin: 0 2px;
    }

    /* ── Shared CTA button ──────────────────────────────────────── */
    .cta-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 12px 18px;
        border-radius: var(--radius-md, 8px);
        border: 1px solid var(--b1, #2a2a2a);
        background: var(--surface-hover, #1a1a1a);
        color: var(--t1, #fff);
        font-family: var(--ui);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition:
            background 0.12s,
            border-color 0.12s,
            opacity 0.12s;
    }
    .cta-btn:hover:not(:disabled) {
        background: color-mix(
            in srgb,
            var(--surface-hover, #1a1a1a) 60%,
            var(--b1)
        );
        border-color: var(--b2, #3a3a3a);
    }
    .cta-btn:disabled {
        opacity: 0.7;
        cursor: not-allowed;
    }

    /* ── Sign-in state (signed-out) ─────────────────────────────── */
    .signin-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 1rem 0.5rem 0.5rem;
        text-align: center;
    }
    .signin-icon {
        width: 56px;
        height: 56px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 14px;
        background: color-mix(in srgb, var(--acc, #c2185b) 14%, transparent);
        color: var(--acc, #c2185b);
        border: 1px solid
            color-mix(in srgb, var(--acc, #c2185b) 30%, transparent);
        margin-bottom: 18px;
    }
    .signin-title {
        margin: 0 0 8px;
        font-size: 1.3rem;
        font-weight: 600;
        color: var(--t1, #fff);
        letter-spacing: -0.01em;
    }
    .signin-sub {
        margin: 0 0 22px;
        max-width: 360px;
        font-size: 0.85rem;
        line-height: 1.6;
        color: var(--t2, #aaa);
    }

    /* ── Status + error ─────────────────────────────────────────── */
    .status-line {
        text-align: center;
        margin: 1rem 0;
    }
    .muted {
        color: var(--t3, #888);
    }
    .error-box {
        display: flex;
        align-items: flex-start;
        gap: 0.6rem;
        padding: 0.75rem 1rem;
        margin: 0.75rem 0;
        background: color-mix(
            in srgb,
            var(--err, #ff6b6b) 10%,
            var(--n2, #0e0e0e)
        );
        border: 1px solid
            color-mix(in srgb, var(--err, #ff6b6b) 35%, transparent);
        border-radius: var(--radius-md, 8px);
        color: var(--t2, #aaa);
        font-size: 0.85rem;
        line-height: 1.4;
    }
    .error-box svg {
        color: var(--err, #ff6b6b);
        flex: 0 0 auto;
        margin-top: 1px;
    }

    /* ── Pending overlay during checkout ────────────────────────── */
    .pending-overlay {
        position: absolute;
        inset: 0;
        background: color-mix(in srgb, var(--n2, #0e0e0e) 92%, transparent);
        backdrop-filter: blur(6px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1.5rem;
        z-index: 1;
        animation: pending-fade 140ms ease-out;
    }
    .pending-inner {
        text-align: center;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.6rem;
    }
    .spinner {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        border: 2.5px solid
            color-mix(in srgb, var(--acc, #c2185b) 25%, transparent);
        border-top-color: var(--acc, #c2185b);
        animation: spin 0.7s linear infinite;
        margin-bottom: 0.5rem;
    }
    .pending-title {
        margin: 0;
        font-size: 0.95rem;
        font-weight: 600;
        color: var(--t1, #ddd);
    }
    .pending-hint {
        margin: 0 0 0.5rem;
        font-size: 0.78rem;
        color: var(--t3, #888);
    }
    .pending-cancel {
        appearance: none;
        background: transparent;
        border: 0;
        color: var(--t3, #888);
        font-family: inherit;
        font-size: 0.8rem;
        cursor: pointer;
        padding: 0.3rem 0.6rem;
        border-radius: 6px;
        transition:
            color 0.12s,
            background 0.12s;
    }
    .pending-cancel:hover {
        color: var(--t1, #ddd);
        background: rgba(255, 255, 255, 0.05);
    }
    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }
    @keyframes pending-fade {
        from {
            opacity: 0;
        }
        to {
            opacity: 1;
        }
    }
</style>

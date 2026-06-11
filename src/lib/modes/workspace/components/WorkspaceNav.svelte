<script lang="ts">
  import { onMount } from 'svelte';
  import { workspaces, loadWorkspaces, refreshInboxUnread, loadCoworkers, loadMeetings, initMeetingListeners } from '../stores';
  import WorkspaceItem from './WorkspaceItem.svelte';
  import MeetingListSection from './MeetingListSection.svelte';
  import { WORKSPACE_EVENT } from '$lib/shared/constants/events';

  interface Props {
    searchQuery?: string;
  }

  let { searchQuery = '' }: Props = $props();

  onMount(() => {
    loadWorkspaces();
    refreshInboxUnread();
    loadCoworkers();
    loadMeetings();
    initMeetingListeners();
  });

  const filtered = $derived(
    searchQuery.trim()
      ? $workspaces.filter(w => w.name.toLowerCase().includes(searchQuery.toLowerCase()))
      : $workspaces,
  );

  function openModal() {
    window.dispatchEvent(new CustomEvent(WORKSPACE_EVENT.NEW_WORKSPACE));
  }
</script>

<div class="ws-nav">
  <MeetingListSection {searchQuery} />
  {#if filtered.length === 0}
    <div class="nav-empty">
      {#if searchQuery}
        <span>No results for "{searchQuery}"</span>
      {:else}
        <span>No workspaces yet</span>
        <button class="nav-empty-btn" onclick={openModal}>+ New Workspace</button>
      {/if}
    </div>
  {:else}
    {#each filtered as w (w.id)}
      <WorkspaceItem workspace={w} {searchQuery} />
    {/each}
  {/if}
</div>

<style>
  .ws-nav {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .nav-empty {
    padding: 24px 12px;
    color: var(--t3);
    font-size: 12px;
    font-family: var(--mono);
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }
  .nav-empty-btn {
    padding: 5px 12px;
    border-radius: 5px;
    border: 1px solid var(--b1);
    background: transparent;
    color: var(--t2);
    font-size: 11px;
    font-family: var(--mono);
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
  }
  .nav-empty-btn:hover {
    background: var(--c);
    border-color: var(--b2);
    color: var(--t1);
  }

</style>

<script lang="ts">
  import {
    connections, activeConnectionId, connectedIds, expandedConnectionId,
    connectionDatabases, databaseTables,
    loadConnections, deleteConnection, saveConnection, connectToDb, disconnectFromDb,
    showSqlConnectionDialog, editingSqlConnection, getLiveId, loadTablesForDb,
    insertQueryText, connectToDatabase, getDbLiveId, dbLiveConnections,
    showSqlDisconnectConfirm, sqlDisconnectTarget,
    sqlConnectionStates, sqlConnectionErrors, resetSqlConnState,
    setBinding, getSqlTabData, sqlConnectionConfigVersion,
  } from '../stores';
  import { addTab } from '$lib/shared/stores/tabs';
  import { mode } from '$lib/stores/app';
  import { sqlListSchemas, sqlDescribeTable, sqlExecuteQuery, sqlCreateDatabase } from '../commands';

  // Postgres is the only supported engine with a real "schema" layer below
  // the database. MySQL/SQLite/ClickHouse/D1 treat schema and database as
  // synonyms (or have no concept of either), so the tree skips the extra
  // level for them and shows tables directly under the database.
  function hasSchemaLayer(driver: string): boolean {
    const d = driver.toLowerCase();
    return d === 'postgres' || d === 'postgresql';
  }

  // Pool keys are `${connId}:${db}` strings everywhere on the new model.
  // Helper to split them back into the (connId, db) shape the new IPC
  // commands expect. Returns null on malformed inputs.
  function splitLid(lid: string): { connId: string; db: string } | null {
    const i = lid.indexOf(':');
    if (i <= 0) return null;
    return { connId: lid.slice(0, i), db: lid.slice(i + 1) };
  }
  function makeQueryId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  import { showToast } from '$lib/shared/primitives/toast';
  import { friendlyError } from '$lib/utils/errors';
  import { writeText } from '@tauri-apps/plugin-clipboard-manager';
  import ConfirmDialog from '$lib/shared/primitives/ConfirmDialog.svelte';
  import { showContextMenu } from '$lib/shared/primitives/contextmenu';
  import BrandBadge from '$lib/shared/components/BrandBadge.svelte';
  import type { SqlConnectionConfig, SqlConnection, TableInfo, ColumnInfo } from '../types';
  import { descriptorFor } from '../dialects';
  import { tabs, activeTabId } from '$lib/shared/stores/tabs';
  import { get } from 'svelte/store';

  const icons = {
    refresh: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>',
    disconnect: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18.36 6.64a9 9 0 11-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>',
    connect: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>',
    edit: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    duplicate: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>',
    copy: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>',
    trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>',
    newQuery: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M12 11v6M9 14h6"/></svg>',
    select: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/></svg>',
    count: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>',
    describe: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    selectAll: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
    insert: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    truncate: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/></svg>',
    drop: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
    ellipsisV: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>',
    ellipsisH: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>',
  };

  interface Props {
    searchQuery?: string;
  }

  let { searchQuery = '' }: Props = $props();

  // Confirm dialog
  let confirmShow = $state(false);
  let confirmTitle = $state('');
  let confirmMessage = $state('');
  let confirmDanger = $state(false);
  /** Per-call button verb. Most destructive flows want "Delete" (the
   *  default), but DDL ops like Truncate need their own word so the
   *  button matches the title verb. */
  let confirmText = $state('Delete');
  let confirmAction: (() => Promise<void>) | null = $state(null);

  // Create database dialog
  let createDbShow = $state(false);
  let createDbName = $state('');
  let createDbConnId = $state('');
  let createDbLoading = $state(false);

  // Teleport the prompt to <body> so it always renders against the
  // viewport. Without this, NavPanel's transform-animated container
  // creates a containing block and the `position: fixed` overlay gets
  // clipped to the nav column — modal renders only over the left side,
  // background on the right is uncovered, clicks pass through, focus
  // jumps away. Same fix Modal.svelte's `teleportToBody` does.
  function teleportToBody(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        if (node.parentElement === document.body) node.remove();
      },
    };
  }

  function openCreateDbDialog(connId: string) {
    createDbConnId = connId;
    createDbName = '';
    createDbLoading = false;
    createDbShow = true;
  }

  async function handleCreateDb() {
    if (!createDbName.trim() || createDbLoading) return;
    createDbLoading = true;
    try {
      const lid = getLiveId(createDbConnId);
      if (!lid) throw new Error('Not connected');
      const parts = splitLid(lid);
      if (!parts) throw new Error('Invalid connection key');
      await sqlCreateDatabase(parts.connId, parts.db, createDbName.trim());
      showToast(`Database "${createDbName.trim()}" created`, 'success');
      createDbShow = false;
      // Refresh connection's database list from server
      clearConnectionCaches(createDbConnId);
      const dbs = await (await import('../commands')).sqlListDatabases(parts.connId, parts.db);
      connectionDatabases.update(m => {
        const next = new Map(m);
        next.set(createDbConnId, dbs);
        return next;
      });
      expandedConnectionId.set(null);
      setTimeout(() => expandedConnectionId.set(createDbConnId), 50);
    } catch (e: any) {
      showToast(friendlyError(e), 'error');
    } finally {
      createDbLoading = false;
    }
  }

  // Track expanded state at each level
  let expandedDbs = $state<Set<string>>(new Set());
  let expandedSchemas = $state<Set<string>>(new Set());
  let expandedTables = $state<Set<string>>(new Set());

  // Loading states
  let loadingDbs = $state<Set<string>>(new Set());
  let loadingSchemas = $state<Set<string>>(new Set());
  let loadingTables = $state<Set<string>>(new Set());
  let loadingColumns = $state<Set<string>>(new Set());

  // Caches
  let schemaCache = $state<Map<string, string[]>>(new Map());
  let tableCache = $state<Map<string, TableInfo[]>>(new Map());
  let columnCache = $state<Map<string, ColumnInfo[]>>(new Map());

  // Search — Mongo Compass-style recursive match. A connection is shown
  // if its name/driver matches OR any of its (already-loaded) databases,
  // schemas, or tables match. The match drives auto-expand in the
  // template too — see the `searchForce*` derivations on the render
  // path. Visibility is computed against the existing cache, not an
  // eager backend fetch, so a user-typed query can only see matches in
  // levels the user has previously expanded (or that loaded at connect
  // time). Expanding a database loads its tables; the search picks them
  // up on the next keystroke.
  const searchLower = $derived(searchQuery.toLowerCase());
  let collapsedDuringSearch = $state<Set<string>>(new Set());
  let prevSearch = $state('');
  $effect(() => {
    if (searchQuery !== prevSearch) {
      // Switching query (including clearing it) drops manual collapse
      // overrides so the next search starts from a clean "show everything
      // matching" state.
      collapsedDuringSearch = new Set();
      prevSearch = searchQuery;
    }
  });

  function tableMatchesSearch(name: string): boolean {
    if (!searchQuery) return true;
    return name.toLowerCase().includes(searchLower);
  }
  function schemaMatchesSearch(name: string): boolean {
    if (!searchQuery) return true;
    return name.toLowerCase().includes(searchLower);
  }
  function dbMatchesSearch(db: string): boolean {
    if (!searchQuery) return true;
    return db.toLowerCase().includes(searchLower);
  }
  function schemaHasMatchingTables(connId: string, db: string, schema: string): boolean {
    if (!searchQuery) return false;
    const tables = tableCache.get(`${connId}:${db}:${schema}`) ?? [];
    return tables.some(t => t.name.toLowerCase().includes(searchLower));
  }
  function dbHasMatchingChildren(connId: string, db: string, driver: string): boolean {
    if (!searchQuery) return false;
    const dbKey = `${connId}:${db}`;
    if (hasSchemaLayer(driver)) {
      const schemas = schemaCache.get(dbKey) ?? [];
      for (const s of schemas) {
        if (s.toLowerCase().includes(searchLower)) return true;
        if (schemaHasMatchingTables(connId, db, s)) return true;
      }
      return false;
    }
    const tables = tableCache.get(dbKey) ?? [];
    return tables.some(t => t.name.toLowerCase().includes(searchLower));
  }
  function connMatchesSearch(conn: SqlConnection): boolean {
    if (!searchQuery) return true;
    if (conn.name.toLowerCase().includes(searchLower)) return true;
    if (conn.driver.toLowerCase().includes(searchLower)) return true;
    const dbs = $connectionDatabases.get(conn.id) ?? [];
    for (const db of dbs) {
      if (db.toLowerCase().includes(searchLower)) return true;
      if (dbHasMatchingChildren(conn.id, db, conn.driver)) return true;
    }
    return false;
  }

  const filteredConnections = $derived(
    searchQuery ? $connections.filter(connMatchesSearch) : $connections
  );

  export function showAddConnection() {
    editingSqlConnection.set(null);
    showSqlConnectionDialog.set(true);
  }

  function showConfirm(title: string, message: string, danger: boolean, action: () => Promise<void>, verb?: string) {
    confirmTitle = title;
    confirmMessage = message;
    confirmDanger = danger;
    confirmText = verb ?? (danger ? 'Delete' : 'Confirm');
    confirmAction = action;
    confirmShow = true;
  }

  async function handleConfirmOk() {
    confirmShow = false;
    if (confirmAction) await confirmAction();
    confirmAction = null;
  }

  // ── Connection handlers ──

  async function handleClickConnection(conn: SqlConnection) {
    activeConnectionId.set(conn.id);
    const alreadyConnected = $connectedIds.has(conn.id);
    const state = $sqlConnectionStates.get(conn.id) ?? 'idle';

    // Already attempting — clicking again must NOT fire a duplicate connect.
    // The store also enforces this, but bailing here keeps behavior obvious.
    if (state === 'connecting') return;

    if (!alreadyConnected) {
      // If the previous attempt errored, treat the click as a retry: clear the
      // error first so the indicator transitions back to `connecting` cleanly.
      if (state === 'error') resetSqlConnState(conn.id);
      try {
        await connectToDb(conn.id);
        showToast(`Connected to ${conn.name}`, 'success');
      } catch (e: any) {
        showToast(friendlyError(e), 'error');
      }
    } else if (searchQuery && connMatchesSearch(conn)) {
      // Search is forcing this branch open via searchForceConn. Toggle the
      // collapse override so the user can hide a matched subtree without
      // clearing the query.
      const key = `conn:${conn.id}`;
      const next = new Set(collapsedDuringSearch);
      if (next.has(key)) next.delete(key); else next.add(key);
      collapsedDuringSearch = next;
    } else {
      if ($expandedConnectionId === conn.id) {
        expandedConnectionId.set(null);
      } else {
        expandedConnectionId.set(conn.id);
      }
    }
  }

  function clearConnectionCaches(connId: string) {
    const prefix = `${connId}:`;
    expandedDbs = new Set([...expandedDbs].filter(k => !k.startsWith(prefix)));
    expandedSchemas = new Set([...expandedSchemas].filter(k => !k.startsWith(prefix)));
    expandedTables = new Set([...expandedTables].filter(k => !k.startsWith(prefix)));
    schemaCache = new Map([...schemaCache].filter(([k]) => !k.startsWith(prefix)));
    tableCache = new Map([...tableCache].filter(([k]) => !k.startsWith(prefix)));
    columnCache = new Map([...columnCache].filter(([k]) => !k.startsWith(prefix)));
  }

  // Drop local caches whenever a saved connection's config is edited. The
  // store bumps the version on every successful update — track the last
  // version we observed per id so we only react to actual changes.
  let seenConfigVersions = $state<Map<string, number>>(new Map());
  $effect(() => {
    const versions = $sqlConnectionConfigVersion;
    let changed = false;
    const next = new Map(seenConfigVersions);
    for (const [id, v] of versions) {
      if (next.get(id) !== v) {
        clearConnectionCaches(id);
        next.set(id, v);
        changed = true;
      }
    }
    if (changed) seenConfigVersions = next;
  });

  // ── Database handlers ──

  async function handleClickDatabase(connId: string, db: string) {
    activeConnectionId.set(connId);
    const key = `${connId}:${db}`;
    const conn = get(connections).find(c => c.id === connId);

    // Search is forcing this DB's subtree open via searchForceDb. Toggle the
    // collapse override (instead of the underlying expandedDbs state) so the
    // user can hide a matched subtree without clearing the query.
    if (searchQuery && conn && (dbMatchesSearch(db) || dbHasMatchingChildren(connId, db, conn.driver))) {
      const ck = `db:${key}`;
      const next = new Set(collapsedDuringSearch);
      if (next.has(ck)) next.delete(ck); else next.add(ck);
      collapsedDuringSearch = next;
      return;
    }

    if (expandedDbs.has(key)) {
      expandedDbs = new Set([...expandedDbs].filter(k => k !== key));
      return;
    }

    expandedDbs = new Set([...expandedDbs, key]);

    if (!hasSchemaLayer(conn?.driver ?? '')) {
      // Engines without a schema layer: load tables directly into tableCache
      // under the db key, skipping the (synthetic) schema level entirely.
      if (!tableCache.has(key)) {
        loadingTables = new Set([...loadingTables, key]);
        try {
          await connectToDatabase(connId, db);
          const tables = await (await import('../commands')).sqlListTables(connId, db, '');
          tableCache = new Map([...tableCache, [key, tables]]);
        } catch {
          tableCache = new Map([...tableCache, [key, []]]);
        }
        loadingTables = new Set([...loadingTables].filter(k => k !== key));
      }
      return;
    }

    if (!schemaCache.has(key)) {
      loadingSchemas = new Set([...loadingSchemas, key]);
      try {
        await connectToDatabase(connId, db);
        const schemas = await sqlListSchemas(connId, db);
        schemaCache = new Map([...schemaCache, [key, schemas]]);
      } catch {
        schemaCache = new Map([...schemaCache, [key, ['public']]]);
      }
      loadingSchemas = new Set([...loadingSchemas].filter(k => k !== key));
    }
  }

  async function refreshDatabase(connId: string, db: string) {
    const dbKey = `${connId}:${db}`;
    schemaCache = new Map([...schemaCache].filter(([k]) => k !== dbKey));
    tableCache = new Map([...tableCache].filter(([k]) => !k.startsWith(dbKey)));
    columnCache = new Map([...columnCache].filter(([k]) => !k.startsWith(dbKey)));
    expandedSchemas = new Set([...expandedSchemas].filter(k => !k.startsWith(dbKey)));
    expandedTables = new Set([...expandedTables].filter(k => !k.startsWith(dbKey)));

    const conn = get(connections).find(c => c.id === connId);
    const schemaless = !hasSchemaLayer(conn?.driver ?? '');

    if (schemaless) {
      loadingTables = new Set([...loadingTables, dbKey]);
      try {
        await connectToDatabase(connId, db);
        const tables = await (await import('../commands')).sqlListTables(connId, db, '');
        tableCache = new Map([...tableCache, [dbKey, tables]]);
      } catch {
        tableCache = new Map([...tableCache, [dbKey, []]]);
      }
      loadingTables = new Set([...loadingTables].filter(k => k !== dbKey));
      showToast('Refreshed', 'success');
      return;
    }

    loadingSchemas = new Set([...loadingSchemas, dbKey]);
    try {
      await connectToDatabase(connId, db);
      const schemas = await sqlListSchemas(connId, db);
      schemaCache = new Map([...schemaCache, [dbKey, schemas]]);
      // Reload tables for expanded schemas
      for (const schema of schemas) {
        const sKey = `${dbKey}:${schema}`;
        if (expandedSchemas.has(sKey)) {
          const tables = await (await import('../commands')).sqlListTables(connId, db, schema);
          tableCache = new Map([...tableCache, [sKey, tables]]);
        }
      }
    } catch {
      schemaCache = new Map([...schemaCache, [dbKey, ['public']]]);
    }
    loadingSchemas = new Set([...loadingSchemas].filter(k => k !== dbKey));
    showToast('Refreshed', 'success');
  }

  // ── Schema handlers ──

  async function handleClickSchema(connId: string, db: string, schema: string) {
    const key = `${connId}:${db}:${schema}`;

    // Search-mode collapse override (same pattern as connection / database).
    if (searchQuery && (schemaMatchesSearch(schema) || schemaHasMatchingTables(connId, db, schema))) {
      const ck = `schema:${key}`;
      const next = new Set(collapsedDuringSearch);
      if (next.has(ck)) next.delete(ck); else next.add(ck);
      collapsedDuringSearch = next;
      return;
    }

    if (expandedSchemas.has(key)) {
      expandedSchemas = new Set([...expandedSchemas].filter(k => k !== key));
      return;
    }

    expandedSchemas = new Set([...expandedSchemas, key]);

    if (!tableCache.has(key)) {
      loadingTables = new Set([...loadingTables, key]);
      try {
        await connectToDatabase(connId, db);
        const tables = await (await import('../commands')).sqlListTables(connId, db, schema);
        tableCache = new Map([...tableCache, [key, tables]]);
      } catch {
        tableCache = new Map([...tableCache, [key, []]]);
      }
      loadingTables = new Set([...loadingTables].filter(k => k !== key));
    }
  }

  // ── Table handlers ──

  async function handleClickTable(connId: string, db: string, schema: string, table: string) {
    const key = `${connId}:${db}:${schema}:${table}`;

    if (expandedTables.has(key)) {
      expandedTables = new Set([...expandedTables].filter(k => k !== key));
      return;
    }

    expandedTables = new Set([...expandedTables, key]);

    if (!columnCache.has(key)) {
      loadingColumns = new Set([...loadingColumns, key]);
      try {
        await connectToDatabase(connId, db);
        const columns = await sqlDescribeTable(connId, db, table, schema);
        columnCache = new Map([...columnCache, [key, columns]]);
      } catch {
        columnCache = new Map([...columnCache, [key, []]]);
      }
      loadingColumns = new Set([...loadingColumns].filter(k => k !== key));
    }
  }

  function qualifiedName(schema: string, name: string): string {
    if (!schema || schema === 'public' || schema === 'default' || schema === 'main') return name;
    return `${schema}.${name}`;
  }

  // Ensure there's a SQL tab bound to (connId, db) before injecting a query
  // or as the result of a database/table double-click. The contract:
  //  - Active tab is SQL with the same binding   → no-op (just inject)
  //  - Active tab is SQL with a different binding → rebind in place
  //  - Active tab is something else (or no tabs) → spawn a fresh SQL tab
  // Always flips the global `mode` to 'sql' so the panel is visible.
  // Tab `query` and `results` are preserved across rebinds (setBinding only
  // touches binding/inFlight/error), so the user's in-progress editor
  // content survives a connection swap.
  function ensureSqlTabBoundTo(connId: string, db: string) {
    const allTabs = get(tabs);
    const activeId = get(activeTabId);
    const activeTab = allTabs.find(t => t.id === activeId && t.mode === 'sql');
    const targetTab = activeTab ?? addTab('SQL', 'sql', null, 'var(--sql)');

    const data = getSqlTabData(targetTab.id);
    const alreadyBound =
      data.binding?.connectionId === connId && data.binding?.database === db;
    if (!alreadyBound) {
      setBinding(targetTab.id, connId, db);
    }
    activeConnectionId.set(connId);
    if (get(mode) !== 'sql') mode.set('sql');
  }

  // Trigger the "+" button flow from a database double-click in the sidebar.
  // No SQL tab open → creates one. SQL tab already open with a different
  // (conn, db) → rebinds. Same binding → no-op (still focuses the tab).
  function handleDatabaseDblClick(connId: string, db: string) {
    ensureSqlTabBoundTo(connId, db);
  }

  function insertQuery(connId: string, db: string, query: string) {
    ensureSqlTabBoundTo(connId, db);
    insertQueryText.set(query);
  }

  function handleTableDblClick(connId: string, db: string, schema: string, tableName: string) {
    insertQuery(connId, db, `SELECT * FROM ${qualifiedName(schema, tableName)} LIMIT 100;`);
  }

  // ── Query generators ──

  function genSelectTop100(connId: string, db: string, schema: string, table: string) {
    insertQuery(connId, db, `SELECT * FROM ${qualifiedName(schema, table)} LIMIT 100;`);
  }

  function genSelectCount(connId: string, db: string, schema: string, table: string) {
    insertQuery(connId, db, `SELECT COUNT(*) FROM ${qualifiedName(schema, table)};`);
  }

  function genDescribeTable(connId: string, db: string, schema: string, table: string) {
    insertQuery(connId, db, `SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = '${table}' AND table_schema = '${schema}'
ORDER BY ordinal_position;`);
  }

  function genCopySelect(connId: string, db: string, schema: string, table: string) {
    const key = `${connId}:${db}:${schema}:${table}`;
    const columns = columnCache.get(key);
    const cols = columns && columns.length > 0
      ? columns.map(c => c.name).join(', ')
      : '*';
    const q = `SELECT ${cols} FROM ${qualifiedName(schema, table)};`;
    writeText(q).then(() => showToast('SELECT copied', 'success')).catch(() => showToast('Failed to copy', 'error'));
  }

  function genCopyInsert(connId: string, db: string, schema: string, table: string) {
    const key = `${connId}:${db}:${schema}:${table}`;
    const columns = columnCache.get(key);
    const cols = columns && columns.length > 0
      ? columns.filter(c => !c.isPrimaryKey).map(c => c.name)
      : ['column1', 'column2'];
    const placeholders = cols.map(() => '?').join(', ');
    const q = `INSERT INTO ${qualifiedName(schema, table)} (${cols.join(', ')}) VALUES (${placeholders});`;
    writeText(q).then(() => showToast('INSERT template copied', 'success')).catch(() => showToast('Failed to copy', 'error'));
  }

  // ── Context menus ──

  function showConnMenu(e: MouseEvent, conn: SqlConnection) {
    e.preventDefault();
    e.stopPropagation();
    const isConnected = $connectedIds.has(conn.id);
    const connString = `${conn.driver}://${conn.username ? conn.username + '@' : ''}${conn.host}:${conn.port}/${conn.databaseName}`;

    showContextMenu(e.clientX, e.clientY, [
      ...(isConnected ? [{
        label: 'Refresh',
        icon: icons.refresh,
        action: async () => {
          clearConnectionCaches(conn.id);
          // Re-fetch database list from server
          try {
            const lid = getLiveId(conn.id);
            const parts = lid ? splitLid(lid) : null;
            if (parts) {
              const dbs = await (await import('../commands')).sqlListDatabases(parts.connId, parts.db);
              connectionDatabases.update(m => {
                const next = new Map(m);
                next.set(conn.id, dbs);
                return next;
              });
            }
          } catch (e: any) {
            showToast(friendlyError(e), 'error');
          }
          expandedConnectionId.set(null);
          setTimeout(() => expandedConnectionId.set(conn.id), 50);
        },
      }] : []),
      ...(isConnected ? [
        { label: '', action: () => {}, separator: true },
        {
          label: 'Disconnect',
          icon: icons.disconnect,
          action: () => {
            sqlDisconnectTarget.set(conn);
            showSqlDisconnectConfirm.set(true);
          },
        },
      ] : [{
        label: 'Connect',
        icon: icons.connect,
        action: () => handleClickConnection(conn),
      }]),
      { label: '', action: () => {}, separator: true },
      {
        label: 'Edit',
        icon: icons.edit,
        action: () => {
          editingSqlConnection.set(conn);
          showSqlConnectionDialog.set(true);
        },
      },
      {
        label: 'Duplicate',
        icon: icons.duplicate,
        action: async () => {
          try {
            await saveConnection({
              name: conn.name + ' (copy)',
              driver: conn.driver,
              host: conn.host,
              port: conn.port,
              database: conn.databaseName,
              username: conn.username,
              password: conn.password,
              ssl: !!conn.ssl,
            });
            showToast('Connection duplicated', 'success');
          } catch (err: any) { showToast(friendlyError(err), 'error'); }
        },
      },
      {
        label: 'Copy Connection String',
        icon: icons.copy,
        action: async () => {
          await writeText(connString);
          showToast('Copied to clipboard', 'success');
        },
      },
      { label: '', action: () => {}, separator: true },
      {
        label: 'Delete',
        icon: icons.trash,
        danger: true,
        action: () => showConfirm('Delete Connection', `Delete "${conn.name}"? This cannot be undone.`, true, async () => {
          try {
            await deleteConnection(conn.id);
            clearConnectionCaches(conn.id);
            showToast('Connection removed', 'success');
          } catch (err: any) { showToast(friendlyError(err), 'error'); }
        }),
      },
    ]);
  }

  function showDbMenu(e: MouseEvent, connId: string, db: string) {
    e.preventDefault();
    e.stopPropagation();

    showContextMenu(e.clientX, e.clientY, [
      {
        label: 'New Query',
        icon: icons.newQuery,
        action: () => {
          insertQuery(connId, db, `-- Query on ${db}\n`);
        },
      },
      {
        label: 'Refresh',
        icon: icons.refresh,
        action: () => refreshDatabase(connId, db),
      },
      { label: '', action: () => {}, separator: true },
      {
        label: 'Copy Name',
        icon: icons.copy,
        action: async () => {
          await writeText(db);
          showToast('Copied', 'success');
        },
      },
      { label: '', action: () => {}, separator: true },
      {
        label: 'Drop Database',
        icon: icons.drop,
        danger: true,
        action: () => showConfirm('Drop Database', `Drop "${db}"? This will permanently delete the database and all its data.`, true, async () => {
          try {
            const lid = getLiveId(connId);
            if (!lid) throw new Error('Not connected');
            const parts = splitLid(lid);
            if (!parts) throw new Error('Invalid connection key');
            const conn = $connections.find(c => c.id === connId);
            const q = descriptorFor(conn?.driver ?? '')?.identifierQuote ?? '"';
            const dropStmt = `DROP DATABASE ${q}${db}${q}`;
            await sqlExecuteQuery(parts.connId, parts.db, dropStmt, makeQueryId());
            showToast(`Dropped database "${db}"`, 'success');
            // Refresh connection's database list from server
            clearConnectionCaches(connId);
            const dbs = await (await import('../commands')).sqlListDatabases(parts.connId, parts.db);
            connectionDatabases.update(m => {
              const next = new Map(m);
              next.set(connId, dbs);
              return next;
            });
            expandedConnectionId.set(null);
            setTimeout(() => expandedConnectionId.set(connId), 50);
          } catch (e: any) { showToast(friendlyError(e), 'error'); }
        }, 'Drop'),
      },
    ]);
  }

  function showTableMenu(e: MouseEvent, connId: string, db: string, schema: string, table: string) {
    e.preventDefault();
    e.stopPropagation();

    showContextMenu(e.clientX, e.clientY, [
      {
        label: 'SELECT TOP 100',
        icon: icons.select,
        action: () => genSelectTop100(connId, db, schema, table),
      },
      {
        label: 'SELECT COUNT(*)',
        icon: icons.count,
        action: () => genSelectCount(connId, db, schema, table),
      },
      {
        label: 'Describe Table',
        icon: icons.describe,
        action: () => genDescribeTable(connId, db, schema, table),
      },
      { label: '', action: () => {}, separator: true },
      {
        label: 'Copy SELECT Statement',
        icon: icons.selectAll,
        action: () => genCopySelect(connId, db, schema, table),
      },
      {
        label: 'Copy INSERT Template',
        icon: icons.insert,
        action: () => genCopyInsert(connId, db, schema, table),
      },
      {
        label: 'Copy Name',
        icon: icons.copy,
        action: async () => {
          await writeText(table);
          showToast('Copied', 'success');
        },
      },
      { label: '', action: () => {}, separator: true },
      {
        label: 'Truncate Table',
        icon: icons.truncate,
        danger: true,
        action: () => showConfirm('Truncate Table', `Truncate "${table}"? All rows will be permanently deleted. The table structure will remain.`, true, async () => {
          try {
            await connectToDatabase(connId, db);
            await sqlExecuteQuery(connId, db, `TRUNCATE TABLE ${qualifiedName(schema, table)}`, makeQueryId());
            showToast(`Truncated ${table}`, 'success');
          } catch (e: any) { showToast(friendlyError(e), 'error'); }
        }, 'Truncate'),
      },
      {
        label: 'Drop Table',
        icon: icons.drop,
        danger: true,
        action: () => showConfirm('Drop Table', `Drop "${table}"? The table and all its data will be permanently deleted.`, true, async () => {
          try {
            await connectToDatabase(connId, db);
            await sqlExecuteQuery(connId, db, `DROP TABLE ${qualifiedName(schema, table)}`, makeQueryId());
            // Refresh the schema to remove the table from nav
            const sKey = `${connId}:${db}:${schema}`;
            tableCache = new Map([...tableCache].filter(([k]) => k !== sKey));
            const tables = await (await import('../commands')).sqlListTables(connId, db, schema);
            tableCache = new Map([...tableCache, [sKey, tables]]);
            showToast(`Dropped ${table}`, 'success');
          } catch (e: any) { showToast(friendlyError(e), 'error'); }
        }, 'Drop'),
      },
    ]);
  }

  function showColumnMenu(e: MouseEvent, col: ColumnInfo) {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY, [
      {
        label: 'Copy Name',
        icon: icons.copy,
        action: async () => {
          await writeText(col.name);
          showToast('Copied', 'success');
        },
      },
    ]);
  }

  // ── Helpers ──

  function columnLabel(col: ColumnInfo): string {
    let label = col.dataType;
    const tags: string[] = [];
    if (col.isPrimaryKey) tags.push('PK');
    if (col.isNullable) tags.push('null');
    if (tags.length > 0) label += ', ' + tags.join(', ');
    return label;
  }
</script>

{#snippet renderTables(tables: TableInfo[], schema: string, db: string, connId: string, isLoadingTbl: boolean)}
  {#if isLoadingTbl}
    <div class="tree-loading" style="padding-left:38px">Loading tables...</div>
  {:else if tables.length === 0}
    <div class="tree-loading" style="padding-left:38px">No tables</div>
  {:else}
    {#each tables as table (table.name)}
      {@const tableVisible = !searchQuery || tableMatchesSearch(table.name)}
      {#if tableVisible}
      {@const tableKey = `${connId}:${db}:${schema}:${table.name}`}
      {@const isTableExpanded = expandedTables.has(tableKey)}
      {@const columns = columnCache.get(tableKey) ?? []}
      {@const isLoadingCol = loadingColumns.has(tableKey)}

      <button
        class="tree-item tree-table"
        class:expanded={isTableExpanded}
        onclick={() => handleClickTable(connId, db, schema, table.name)}
        ondblclick={() => handleTableDblClick(connId, db, schema, table.name)}
        oncontextmenu={(e) => showTableMenu(e, connId, db, schema, table.name)}
      >
        <svg class="tree-chevron-sm" class:open={isTableExpanded} viewBox="0 0 24 24">
          <path d="M9 18l6-6-6-6"/>
        </svg>
        <svg class="tree-icon tree-icon-table" viewBox="0 0 24 24">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <path d="M3 9h18M3 15h18M9 3v18"/>
        </svg>
        <span class="tree-label">{table.name}</span>
        <span class="table-ellipsis" role="button" tabindex="-1"
          onclick={(e) => { e.stopPropagation(); showTableMenu(e, connId, db, schema, table.name); }}>
          {@html icons.ellipsisH}
        </span>
      </button>

      {#if isTableExpanded}
        {#if isLoadingCol}
          <div class="tree-loading" style="padding-left:48px">Loading columns...</div>
        {:else if columns.length === 0}
          <div class="tree-loading" style="padding-left:48px">No columns</div>
        {:else}
          {#each columns as col (col.name)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="tree-item tree-column" oncontextmenu={(e) => showColumnMenu(e, col)}>
              {#if col.isPrimaryKey}
                <svg class="tree-icon tree-icon-pk" viewBox="0 0 24 24">
                  <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
                </svg>
              {:else}
                <svg class="tree-icon tree-icon-col" viewBox="0 0 24 24">
                  <rect x="8" y="4" width="8" height="16" rx="1.5" />
                </svg>
              {/if}
              <span class="tree-label col-name">{col.name}</span>
              <span class="col-type">{columnLabel(col)}</span>
            </div>
          {/each}
        {/if}
      {/if}
      {/if}
    {/each}
  {/if}
{/snippet}

<div class="sql-nav">
  {#if filteredConnections.length === 0}
    <div class="nav-empty">
      {#if searchQuery}
        <span>No results for "{searchQuery}"</span>
      {:else}
        <span>No connections yet</span>
        <button class="nav-empty-btn" onclick={() => showAddConnection()}>
          + New Connection
        </button>
      {/if}
    </div>
  {:else}
    {#each filteredConnections as conn (conn.id)}
      {@const isConnected = $connectedIds.has(conn.id)}
      {@const isExpanded = $expandedConnectionId === conn.id && isConnected}
      {@const searchForceConn = !!searchQuery && isConnected && connMatchesSearch(conn) && !collapsedDuringSearch.has(`conn:${conn.id}`)}
      {@const showConnChildren = isExpanded || searchForceConn}
      {@const databases = $connectionDatabases.get(conn.id) ?? []}
      {@const connState = $sqlConnectionStates.get(conn.id) ?? 'idle'}
      {@const isConnecting = connState === 'connecting'}
      {@const hasError = connState === 'error'}
      {@const errorMsg = $sqlConnectionErrors.get(conn.id) ?? ''}

      <div class="ncoll">
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="ncoll-hdr"
          class:active={$activeConnectionId === conn.id}
          class:connected={isConnected}
          class:connecting={isConnecting}
          class:errored={hasError}
          title={hasError ? errorMsg : ''}
          onclick={() => handleClickConnection(conn)}
          oncontextmenu={(e) => showConnMenu(e, conn)}
        >
          <div class="coll-icon">
            <BrandBadge brand={conn.driver} />
            {#if isConnected}<span class="conn-dot" aria-label="Connected" title="Connected"></span>{/if}
          </div>
          <div class="ncoll-text">
            <div class="ncoll-row-top">
              <span class="ncoll-name">{conn.name}</span>
            </div>
            <div class="ncoll-row-bot">
              {#if isConnecting}
                <span class="ncoll-sub">Connecting<span class="conn-dots"></span></span>
              {:else if conn.driver === 'sqlite'}
                <span class="ncoll-sub">Local file</span>
              {:else}
                <span class="ncoll-sub">{conn.username}{conn.username ? '@' : ''}{conn.host}{conn.port ? `:${conn.port}` : ''}</span>
              {/if}
            </div>
          </div>
          {#if isConnected}
            <button
              class="coll-menu"
              title="Create Database"
              onclick={(e) => { e.stopPropagation(); openCreateDbDialog(conn.id); }}
            >
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
            </button>
          {/if}
          <button
            class="coll-menu"
            title="More"
            onclick={(e) => { e.stopPropagation(); showConnMenu(e, conn); }}
          >
            {@html icons.ellipsisV}
          </button>
          <svg class="ncoll-arr" class:open={showConnChildren} viewBox="0 0 24 24">
            <path d="M9 18l6-6-6-6" stroke="currentColor" fill="none" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
        </div>

      <!-- Database Tree -->
      {#if showConnChildren && databases.length > 0}
        {#each databases as db}
          {@const dbKey = `${conn.id}:${db}`}
          {@const dbVisible = !searchQuery || dbMatchesSearch(db) || dbHasMatchingChildren(conn.id, db, conn.driver)}
          {#if dbVisible}
          {@const isDbExpanded = expandedDbs.has(dbKey)}
          {@const searchForceDb = !!searchQuery && (dbMatchesSearch(db) || dbHasMatchingChildren(conn.id, db, conn.driver)) && !collapsedDuringSearch.has(`db:${dbKey}`)}
          {@const showDbChildren = isDbExpanded || searchForceDb}
          {@const schemas = schemaCache.get(dbKey) ?? []}
          {@const isLoadingSchema = loadingSchemas.has(dbKey)}

          <button
            class="tree-item tree-db"
            class:expanded={showDbChildren}
            onclick={() => handleClickDatabase(conn.id, db)}
            ondblclick={() => handleDatabaseDblClick(conn.id, db)}
            oncontextmenu={(e) => showDbMenu(e, conn.id, db)}
          >
            <svg class="tree-chevron-sm" class:open={showDbChildren} viewBox="0 0 24 24">
              <path d="M9 18l6-6-6-6"/>
            </svg>
            <svg class="tree-icon tree-icon-db" viewBox="0 0 24 24">
              <ellipse cx="12" cy="5" rx="9" ry="3"/>
              <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
            </svg>
            <span class="tree-label">{db}</span>
            <span class="db-ellipsis" role="button" tabindex="-1" title="More"
              onclick={(e) => { e.stopPropagation(); showDbMenu(e, conn.id, db); }}>
              {@html icons.ellipsisH}
            </span>
          </button>

          {#if showDbChildren}
            {#if hasSchemaLayer(conn.driver)}
              {#if isLoadingSchema}
                <div class="tree-loading" style="padding-left:28px">Loading schemas...</div>
              {:else}
                {#each schemas as schema}
                  {@const schemaKey = `${conn.id}:${db}:${schema}`}
                  {@const schemaVisible = !searchQuery || schemaMatchesSearch(schema) || schemaHasMatchingTables(conn.id, db, schema)}
                  {#if schemaVisible}
                  {@const isSchemaExpanded = expandedSchemas.has(schemaKey)}
                  {@const searchForceSchema = !!searchQuery && (schemaMatchesSearch(schema) || schemaHasMatchingTables(conn.id, db, schema)) && !collapsedDuringSearch.has(`schema:${schemaKey}`)}
                  {@const showSchemaChildren = isSchemaExpanded || searchForceSchema}
                  {@const sTables = tableCache.get(schemaKey) ?? []}
                  {@const sLoadingTbl = loadingTables.has(schemaKey)}

                  <button
                    class="tree-item tree-schema"
                    class:expanded={showSchemaChildren}
                    onclick={() => handleClickSchema(conn.id, db, schema)}
                  >
                    <svg class="tree-chevron-sm" class:open={showSchemaChildren} viewBox="0 0 24 24">
                      <path d="M9 18l6-6-6-6"/>
                    </svg>
                    <svg class="tree-icon tree-icon-schema" viewBox="0 0 24 24">
                      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                    </svg>
                    <span class="tree-label">{schema}</span>
                  </button>

                  {#if showSchemaChildren}
                    {@render renderTables(sTables, schema, db, conn.id, sLoadingTbl)}
                  {/if}
                  {/if}
                {/each}
              {/if}
            {:else}
              {@const dbTables = tableCache.get(dbKey) ?? []}
              {@const dbLoadingTbl = loadingTables.has(dbKey)}
              {@render renderTables(dbTables, '', db, conn.id, dbLoadingTbl)}
            {/if}
          {/if}
          {/if}
        {/each}
      {/if}
      </div>
    {/each}
  {/if}
</div>

<!-- Confirm Dialog — shared primitive so SSH/Explorer/SQL/NoSQL all
     read identically (header bar, body, footer, teleported to body). -->
<ConfirmDialog
  bind:show={confirmShow}
  title={confirmTitle}
  message={confirmMessage}
  confirmText={confirmText}
  confirmColor={confirmDanger ? 'var(--err)' : 'var(--acc)'}
  onconfirm={handleConfirmOk}
/>

<!-- Create Database — input prompt; can't use ConfirmDialog (no input
     slot) so keeps its own markup, but re-uses the same dialog look. -->
{#if createDbShow}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="sql-prompt-overlay" use:teleportToBody onclick={() => createDbShow = false}>
    <div class="sql-prompt" onclick={(e) => e.stopPropagation()}>
      <div class="sql-prompt-title">Create Database</div>
      <div class="sql-prompt-msg">Enter a name for the new database.</div>
      <input
        class="create-db-input"
        type="text"
        placeholder="database_name"
        bind:value={createDbName}
        onkeydown={(e) => { if (e.key === 'Enter') handleCreateDb(); if (e.key === 'Escape') createDbShow = false; }}
        autofocus
      />
      <div class="sql-prompt-actions">
        <button class="sql-prompt-btn" onclick={() => createDbShow = false}>Cancel</button>
        <button
          class="sql-prompt-btn primary"
          disabled={!createDbName.trim() || createDbLoading}
          onclick={handleCreateDb}
        >
          {createDbLoading ? 'Creating...' : 'Create'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .sql-nav {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
  }
  .sql-nav::-webkit-scrollbar { width: 3px; }
  .sql-nav::-webkit-scrollbar-thumb { background: var(--b1); border-radius: 2px; }

  .nav-empty {
    padding: 24px 12px;
    color: var(--t3);
    font-size: 12px;
    font-family: var(--ui);
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
    font-family: var(--ui);
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
  }
  .nav-empty-btn:hover { background: var(--c); border-color: var(--b2); color: var(--t1); }

  .tree-item {
    width: 100%;
    border: none;
    background: transparent;
    display: flex;
    align-items: center;
    gap: 5px;
    cursor: pointer;
    transition: background 0.08s;
    text-align: left;
    position: relative;
  }
  .tree-item:hover { background: var(--c); }

  .tree-label {
    font-family: var(--ui);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .ncoll {
    border-bottom: 1px solid var(--b1);
  }
  .ncoll-hdr {
    min-height: 44px;
    padding: 6px 8px;
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    transition: background 0.1s;
    user-select: none;
  }
  .ncoll-hdr:hover { background: var(--n2); }
  .ncoll-hdr.active { background: var(--n2); }
  .ncoll-hdr.connecting { pointer-events: none; }
  .ncoll-hdr.errored { background: color-mix(in srgb, var(--err) 8%, transparent); }
  .ncoll-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .ncoll-row-top, .ncoll-row-bot {
    display: flex;
    align-items: center;
    min-width: 0;
    gap: 5px;
  }
  .ncoll-name {
    font-size: 12.5px;
    font-weight: 500;
    color: var(--t2);
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ncoll-hdr.active .ncoll-name { color: var(--t1); }
  .ncoll-sub {
    font-size: 10.5px;
    font-family: var(--mono);
    color: var(--t4);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    flex: 1;
  }
  .ncoll-arr {
    width: 12px;
    height: 12px;
    stroke: var(--t3);
    fill: none;
    stroke-width: 1.8;
    stroke-linecap: round;
    flex-shrink: 0;
    transition: transform 0.18s;
  }
  .ncoll-arr.open { transform: rotate(90deg); }

  .coll-icon {
    position: relative;
    display: flex;
    flex-shrink: 0;
  }
  .conn-dot {
    position: absolute;
    top: -2px;
    right: -2px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--ok, #1dc880);
    box-shadow: 0 0 0 1.5px var(--n);
    animation: connDotPulse 3s ease-in-out infinite;
  }
  @keyframes connDotPulse {
    0%, 100% { box-shadow: 0 0 0 1.5px var(--n), 0 0 0 2px color-mix(in srgb, var(--ok, #1dc880) 30%, transparent); }
    50%      { box-shadow: 0 0 0 1.5px var(--n), 0 0 0 5px color-mix(in srgb, var(--ok, #1dc880) 0%, transparent); }
  }

  .coll-menu {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    border: none;
    background: transparent;
    display: none;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    color: var(--t3);
    transition: background 0.1s, color 0.1s;
    padding: 0;
  }
  .ncoll-hdr:hover .coll-menu { display: flex; }
  .coll-menu:hover { background: var(--b1); color: var(--t1); }
  .coll-menu :global(svg) { width: 13px; height: 13px; }

  .tree-chevron-sm {
    width: 8px; height: 8px;
    stroke: var(--t4); fill: none; stroke-width: 2.5; stroke-linecap: round;
    flex-shrink: 0; transition: transform 0.15s;
  }
  .tree-chevron-sm.open { transform: rotate(90deg); }

  .conn-dots::after { content: ''; animation: sql-conn-dots 1.4s steps(4, end) infinite; }
  @keyframes sql-conn-dots {
    0% { content: ''; } 25% { content: '.'; } 50% { content: '..'; } 75% { content: '...'; }
  }

  /* DB ellipsis icon */
  .db-ellipsis {
    width: 18px; height: 18px;
    display: none; align-items: center; justify-content: center;
    border-radius: 3px; flex-shrink: 0; cursor: default;
    color: var(--t3); transition: background 0.1s, color 0.1s;
  }
  .tree-db:hover .db-ellipsis { display: flex; }
  .db-ellipsis:hover { background: var(--surface-hover); color: var(--t1); }

  /* Table ellipsis */
  .table-ellipsis {
    width: 18px; height: 18px;
    display: none; align-items: center; justify-content: center;
    border-radius: 3px; flex-shrink: 0; cursor: default;
    color: var(--t3); transition: background 0.1s, color 0.1s;
  }
  .tree-table:hover .table-ellipsis { display: flex; }
  .table-ellipsis:hover { background: var(--surface-hover); color: var(--t1); }

  .tree-icon {
    width: 11px; height: 11px; stroke-width: 1.5; stroke-linecap: round; flex-shrink: 0;
  }
  .tree-icon-db { stroke: var(--acc); fill: none; opacity: 0.7; }
  .tree-icon-schema { stroke: var(--t3); fill: none; opacity: 0.7; }
  .tree-icon-table { stroke: var(--t3); fill: none; }
  .tree-icon-pk { stroke: var(--acc); fill: none; width: 10px; height: 10px; }
  .tree-icon-col { stroke: var(--t4); fill: none; width: 10px; height: 10px; stroke-width: 1.5; }

  .tree-db {
    height: 28px; padding: 0 14px 0 16px;
    border-left: 1px solid var(--b1); margin-left: 11px;
  }
  .tree-db .tree-label { font-size: 11.5px; color: var(--t2); }

  .tree-schema {
    height: 26px; padding: 0 14px 0 28px;
    border-left: 1px solid var(--b1); margin-left: 11px;
  }
  .tree-schema .tree-label { font-size: 11px; color: var(--t3); }

  .tree-table {
    height: 26px; padding: 0 14px 0 38px;
    border-left: 1px solid var(--b1); margin-left: 11px;
  }
  .tree-table .tree-label { font-size: 11px; color: var(--t2); }

  .tree-column {
    height: 24px; padding: 0 14px 0 48px;
    border-left: 1px solid var(--b1); margin-left: 11px;
    cursor: default;
  }
  .tree-column .col-name { font-size: 10.5px; color: var(--t2); }
  .col-type {
    font-size: 9px; color: var(--t4); font-family: var(--ui);
    flex-shrink: 0; margin-left: auto; padding-left: 6px;
  }

  .tree-loading {
    padding: 6px 0; font-size: 10px; color: var(--t4); font-family: var(--ui);
  }


  /* Create-database prompt — has an input field so it can't ride the
     shared ConfirmDialog primitive. Visually matches the rest of the
     app's small dialogs. */
  .sql-prompt-overlay {
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    background: var(--scrim-strong); z-index: var(--z-drawer);
    display: flex; align-items: center; justify-content: center;
  }
  .sql-prompt {
    width: 360px;
    background: var(--modal-bg, var(--n));
    border: 1px solid var(--b1);
    border-radius: 10px;
    padding: 20px 22px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
  }
  .sql-prompt-title { font-size: 16px; font-weight: 600; color: var(--t1); font-family: var(--ui); margin-bottom: 6px; }
  .sql-prompt-msg { font-size: 13px; color: var(--t2); font-family: var(--ui); line-height: 1.5; margin-bottom: 14px; }
  .sql-prompt-actions { display: flex; justify-content: flex-end; gap: 8px; }
  .sql-prompt-btn {
    height: 30px; padding: 0 16px;
    border-radius: 8px; border: 1px solid var(--b1);
    background: transparent; color: var(--t2);
    font-size: 12px; font-family: var(--ui); cursor: pointer;
    transition: border-color 0.1s, color 0.1s;
  }
  .sql-prompt-btn:hover { border-color: var(--b2); color: var(--t1); }
  .sql-prompt-btn.primary { background: var(--acc); color: #fff; border-color: transparent; }
  .sql-prompt-btn.primary:hover { opacity: 0.9; }
  .sql-prompt-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .create-db-input {
    width: 100%;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid var(--b1);
    background: var(--c, rgba(255,255,255,0.05));
    color: var(--t1);
    font-size: 13px;
    font-family: var(--ui);
    outline: none;
    margin-bottom: 16px;
    transition: border-color 0.15s;
    box-sizing: border-box;
  }
  .create-db-input:focus { border-color: var(--acc); }
  .create-db-input::placeholder { color: var(--t4); }
</style>

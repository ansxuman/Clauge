<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { EditorView, keymap, placeholder as cmPlaceholder, lineNumbers } from '@codemirror/view';
  import { EditorState, Compartment } from '@codemirror/state';
  import { sql, PostgreSQL, MySQL, SQLite, keywordCompletionSource, schemaCompletionSource } from '@codemirror/lang-sql';
  import { autocompletion, type Completion, type CompletionContext, type CompletionResult, type CompletionSource } from '@codemirror/autocomplete';
  import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark';
  import { syntaxHighlighting } from '@codemirror/language';
  import { defaultKeymap, historyKeymap, indentWithTab } from '@codemirror/commands';
  import { history } from '@codemirror/commands';
  import { search, searchKeymap } from '@codemirror/search';
  import { format as formatSql } from 'sql-formatter';
  import { activeConnection } from '../stores';
  import type { TableInfo } from '../types';
  import { parserProfileFor } from '../dialects';
  import { splitSqlStatements, splitSqlStatementsWithPositions } from '../utils/splitter';
  import { showToast } from '$lib/shared/primitives/toast';
  import { mod } from '$lib/utils/platform';

  interface Props {
    query: string;
    tables?: TableInfo[];
    columnMap?: Record<string, string[]>;
    /** True while column metadata is being fetched in the background.
     *  Surfaces a small "Loading schema…" hint so users know that empty
     *  autocomplete suggestions are temporary, not broken. */
    schemaLoading?: boolean;
    /** Resolved default schema for unqualified table completion. Comes
     *  from `current_schema()` on Postgres connections; undefined for
     *  engines that have no schema concept. */
    defaultSchema?: string;
    /** True while a query is in flight OR while the pool is connecting.
     *  Cmd/Ctrl+Enter no-ops; the Run button is already disabled in the
     *  parent. Prevents queue-piling on the same tab. */
    disabled?: boolean;
    onquerychange?: (query: string) => void;
    onexecute?: (query: string) => void;
    onexecutemulti?: (queries: string[]) => void;
  }

  let { query, tables = [], columnMap = {}, schemaLoading = false, defaultSchema, disabled = false, onquerychange, onexecute, onexecutemulti }: Props = $props();

  let editorContainer: HTMLDivElement | undefined = $state();
  let editorView: EditorView | undefined;
  let sqlCompartment = new Compartment();
  let suppressExternalSync = false;

  // CodeMirror dialect objects are imported per-driver; the registry only
  // carries the profile name, so we map name -> object here. Unknown drivers
  // fall through to PostgreSQL (matches the legacy default).
  const CM_DIALECTS: Record<string, typeof PostgreSQL> = {
    PostgreSQL,
    MySQL,
    SQLite,
  };

  // sql-formatter dialect identifiers. Keep narrower than the CodeMirror
  // dialect list — sql-formatter has stricter parsing so anything
  // unknown falls back to the generic 'sql' so we don't blow up on
  // ClickHouse / D1 queries.
  const SQL_FORMATTER_DIALECTS: Record<string, 'postgresql' | 'mysql' | 'sqlite' | 'sql'> = {
    PostgreSQL: 'postgresql',
    MySQL: 'mysql',
    SQLite: 'sqlite',
  };

  const dialect = $derived(
    CM_DIALECTS[parserProfileFor($activeConnection?.driver ?? '')] ?? PostgreSQL
  );

  // CodeMirror's SQLNamespace is a *nested* shape — keys are single
  // name segments and CodeMirror does NOT split them on `.`. Writing
  // `{ "public.users": [...] }` would register a literal table named
  // "public.users", not schema "public" containing table "users".
  //
  // For Postgres (rows carry `schema`), produce a nested map:
  //   { public: { users: ['id', 'name'] }, analytics: { events: [...] } }
  // and rely on `defaultSchema: 'public'` (passed in the sql() config)
  // so unqualified `users` completes from the default schema for free.
  //
  // For engines without schemas (MySQL/SQLite/ClickHouse/D1) the output
  // is flat: `{ tableName: columns }` — the previous behaviour.
  function buildSchema(): Record<string, any> {
    if (!tables.length) return {};

    const hasSchemas = tables.some((t) => !!t.schema);
    if (!hasSchemas) {
      const out: Record<string, string[]> = {};
      for (const t of tables) {
        if (!t.name) continue;
        out[t.name] = columnMap[t.name] ?? [];
      }
      return out;
    }

    // Schema-aware (Postgres). Build nested namespaces. If a table has
    // no schema field (shouldn't happen on PG but be defensive), park
    // it under a `_unschemed` bucket rather than dropping it.
    const out: Record<string, Record<string, string[]> | string[]> = {};
    for (const t of tables) {
      if (!t.name) continue;
      const schemaName = t.schema || '_unschemed';
      const colKey = t.schema ? `${t.schema}.${t.name}` : t.name;
      const cols = columnMap[colKey] ?? columnMap[t.name] ?? [];

      let bucket = out[schemaName];
      if (!bucket || Array.isArray(bucket)) {
        bucket = {};
        out[schemaName] = bucket;
      }
      (bucket as Record<string, string[]>)[t.name] = cols;
    }

    return out;
  }

  // Resolved default schema. Prefer what the parent passed (computed
  // from Postgres `current_schema()` on connect — handles connections
  // whose first writable schema isn't `public`). Fall back to `public`
  // for Postgres if the parent hasn't resolved one yet, and undefined
  // for engines that have no schema concept.
  const defaultSchemaForDialect = $derived(
    defaultSchema ??
    (parserProfileFor($activeConnection?.driver ?? '') === 'PostgreSQL' ? 'public' : undefined)
  );

  /** Tables and aliases in scope for column completion. `refs` are the
   *  table identifiers referenced by FROM/JOIN/UPDATE/INTO clauses (may
   *  be schema-qualified). `aliases` maps an alias to the table it
   *  refers to — `FROM users u` produces `u → users`. */
  interface FromScope {
    refs: string[];
    aliases: Map<string, string>;
  }

  /** Walk the statement that contains the cursor and extract the FROM /
   *  JOIN / UPDATE / INTO table refs. Char-by-char walking so we don't
   *  match FROM-like text inside string literals, comments, or
   *  dollar-quoted blocks. */
  function analyzeFromScope(buffer: string, cursorPos: number): FromScope {
    const stmts = splitSqlStatementsWithPositions(buffer);
    let target = stmts.find((s) => cursorPos >= s.from && cursorPos <= s.to + 1);
    if (!target) {
      for (let i = stmts.length - 1; i >= 0; i--) {
        if (stmts[i].to < cursorPos) { target = stmts[i]; break; }
      }
    }
    if (!target) return { refs: [], aliases: new Map() };

    const text = target.text;
    const refs = new Set<string>();
    const aliases = new Map<string, string>();
    const KW_RE = /^(?:FROM|JOIN|UPDATE|INTO)\b/i;
    // Words that follow a table ref but are never aliases. Without this,
    // `FROM users WHERE x=1` would map `WHERE` as an alias of `users`.
    const NOT_AN_ALIAS = /^(?:WHERE|GROUP|ORDER|HAVING|LIMIT|JOIN|LEFT|RIGHT|INNER|OUTER|CROSS|FULL|ON|USING|UNION|INTERSECT|EXCEPT|FOR|FETCH|LATERAL|NATURAL|SET|VALUES|RETURNING|WINDOW|OFFSET)$/i;

    let i = 0;
    const len = text.length;
    while (i < len) {
      const ch = text[i];
      const next = i + 1 < len ? text[i + 1] : '';

      // Skip the same noise the splitter does: -- comments, /* */ comments,
      // single/double/back-quoted strings, dollar-quoted blocks.
      if (ch === '-' && next === '-') {
        const eol = text.indexOf('\n', i);
        i = eol === -1 ? len : eol + 1;
        continue;
      }
      if (ch === '/' && next === '*') {
        const end = text.indexOf('*/', i + 2);
        i = end === -1 ? len : end + 2;
        continue;
      }
      if (ch === "'") {
        i++;
        while (i < len) {
          if (text[i] === "'" && i + 1 < len && text[i + 1] === "'") { i += 2; }
          else if (text[i] === "'") { i++; break; }
          else { i++; }
        }
        continue;
      }
      if (ch === '$') {
        const tagEnd = text.indexOf('$', i + 1);
        if (tagEnd !== -1) {
          const tag = text.slice(i, tagEnd + 1);
          const tagContent = tag.slice(1, -1);
          if (tagContent === '' || /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tagContent)) {
            const closeIdx = text.indexOf(tag, tagEnd + 1);
            if (closeIdx !== -1) { i = closeIdx + tag.length; continue; }
          }
        }
        i++;
        continue;
      }

      // Keyword detection at word boundary.
      const isWordChar = /[A-Za-z_]/.test(ch);
      const prevCh = i > 0 ? text[i - 1] : ' ';
      const atWordStart = !/[A-Za-z_0-9]/.test(prevCh) && isWordChar;
      if (atWordStart) {
        const kw = text.slice(i).match(KW_RE);
        if (kw) {
          let j = i + kw[0].length;
          while (j < len && /\s/.test(text[j])) j++;
          // Identifier — supports `name`, `schema.name`, "quoted", `backticked`.
          const tableRef = readIdentifier(text, j);
          if (tableRef) {
            refs.add(tableRef.name);
            j = tableRef.endPos;
            while (j < len && /\s/.test(text[j])) j++;
            // Optional alias: `AS x` or just `x`.
            const asMatch = text.slice(j).match(/^AS\b/i);
            if (asMatch) {
              j += asMatch[0].length;
              while (j < len && /\s/.test(text[j])) j++;
            }
            const aliasMatch = text.slice(j).match(/^[A-Za-z_]\w*/);
            if (aliasMatch && !NOT_AN_ALIAS.test(aliasMatch[0])) {
              aliases.set(aliasMatch[0], tableRef.name);
              j += aliasMatch[0].length;
            }
            i = j;
            continue;
          }
        }
      }
      i++;
    }

    return { refs: Array.from(refs), aliases };
  }

  /** Read a (possibly schema-qualified, possibly quoted) identifier
   *  starting at `start` in `text`. Returns the bare identifier name
   *  (quotes stripped) and the position immediately after it. */
  function readIdentifier(text: string, start: number): { name: string; endPos: number } | null {
    function readPart(pos: number): { name: string; endPos: number } | null {
      if (pos >= text.length) return null;
      const c = text[pos];
      if (c === '"' || c === '`') {
        const close = text.indexOf(c, pos + 1);
        if (close === -1) return null;
        return { name: text.slice(pos + 1, close), endPos: close + 1 };
      }
      const m = text.slice(pos).match(/^[A-Za-z_]\w*/);
      if (!m) return null;
      return { name: m[0], endPos: pos + m[0].length };
    }
    const first = readPart(start);
    if (!first) return null;
    if (text[first.endPos] !== '.') return first;
    const second = readPart(first.endPos + 1);
    if (!second) return first;
    return { name: `${first.name}.${second.name}`, endPos: second.endPos };
  }

  /** Column completion source. Surfaces columns of tables in scope at
   *  the cursor's statement. Two modes:
   *  - Unqualified prefix → columns from every FROM/JOIN'd table.
   *  - After `<alias>.` → columns of the table the alias refers to. */
  function buildColumnSource(currentColumnMap: Record<string, string[]>): CompletionSource {
    return (context: CompletionContext): CompletionResult | null => {
      const word = context.matchBefore(/[A-Za-z_][A-Za-z0-9_]*/);
      if (!word || (word.from === word.to && !context.explicit)) return null;
      const charBefore = word.from > 0
        ? context.state.doc.sliceString(word.from - 1, word.from)
        : '';

      const buffer = context.state.doc.toString();
      const scope = analyzeFromScope(buffer, context.pos);

      // Qualified: `<prefix>.<word>`. If `<prefix>` is an alias we know,
      // surface that table's columns. Direct table-name lookups fall
      // through to the schema source so we don't double-emit.
      if (charBefore === '.') {
        const prefixMatch = context.state.doc
          .sliceString(0, word.from - 1)
          .match(/([A-Za-z_]\w*)$/);
        if (!prefixMatch) return null;
        const aliased = scope.aliases.get(prefixMatch[1]);
        if (!aliased) return null;
        const bare = aliased.split('.').pop() ?? aliased;
        const cols = currentColumnMap[aliased] ?? currentColumnMap[bare];
        if (!cols) return null;
        return {
          from: word.from,
          options: cols.map((c) => ({
            label: c,
            type: 'property',
            detail: aliased,
            boost: 10,
          })),
          validFor: /^[A-Za-z_][A-Za-z0-9_]*$/,
        };
      }

      if (scope.refs.length === 0) return null;
      const options: Completion[] = [];
      const seen = new Set<string>();
      for (const ref of scope.refs) {
        const bare = ref.split('.').pop() ?? ref;
        const cols = currentColumnMap[ref] ?? currentColumnMap[bare];
        if (!cols) continue;
        for (const col of cols) {
          const key = `${col}|${ref}`;
          if (seen.has(key)) continue;
          seen.add(key);
          options.push({
            label: col,
            type: 'property',
            detail: ref,
            boost: 5,
          });
        }
      }
      if (options.length === 0) return null;
      return {
        from: word.from,
        options,
        validFor: /^[A-Za-z_][A-Za-z0-9_]*$/,
      };
    };
  }

  // Reconfigure SQL extension when tables, columns, or dialect changes.
  //
  // CRITICAL: read every reactive dep BEFORE the editorView guard.
  // Svelte 5 tracks only reads that happen during the synchronous effect
  // run. On first mount the effect fires *before* onMount sets
  // editorView, so if we read the deps inside `if (editorView)` they are
  // never tracked and the effect never re-fires when tables/columnMap
  // arrive — which is why "tables don't appear in autocomplete" was
  // happening for everyone, on every engine.
  $effect(() => {
    const tablesDep = tables;
    const columnsDep = columnMap;
    const dialectDep = dialect;
    const defaultSchemaDep = defaultSchemaForDialect;
    void tablesDep;
    if (!editorView) return;
    const schema = buildSchema();
    const sqlConfig = { dialect: dialectDep, schema, defaultSchema: defaultSchemaDep, upperCaseKeywords: true };
    editorView.dispatch({
      effects: sqlCompartment.reconfigure([
        sql(sqlConfig),
        // Sources are listed in priority order. Column source first so
        // contextual column hits surface above generic keyword matches
        // when both match a prefix.
        autocompletion({
          activateOnTyping: true,
          maxRenderedOptions: 25,
          override: [
            buildColumnSource(columnsDep),
            schemaCompletionSource(sqlConfig),
            keywordCompletionSource(dialectDep, true),
          ],
        }),
      ]),
    });
  });

  const editorTheme = EditorView.theme({
    '&': { backgroundColor: 'transparent', fontSize: '12.5px', height: '100%' },
    '.cm-content': { fontFamily: 'var(--mono)', caretColor: 'var(--acc)', padding: '12px 4px' },
    '.cm-cursor': { borderLeftColor: 'var(--acc)' },
    '.cm-gutters': {
      backgroundColor: 'transparent', borderRight: '1px solid var(--b1)',
      color: 'var(--t4)', fontSize: '11px', fontFamily: 'var(--mono)', minWidth: '36px',
    },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--t2)' },
    '.cm-activeLine': { backgroundColor: 'var(--surface-hover)' },
    '.cm-selectionBackground': { backgroundColor: 'rgba(124,92,248,0.2) !important' },
    '&.cm-focused .cm-selectionBackground': { backgroundColor: 'rgba(124,92,248,0.3) !important' },
    '.cm-tooltip-autocomplete': {
      backgroundColor: 'var(--n2)', border: '1px solid var(--b1)',
      borderRadius: '6px', overflow: 'hidden',
    },
    '.cm-tooltip-autocomplete ul li': { fontFamily: 'var(--mono)', fontSize: '12px', padding: '4px 8px' },
    '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--acc)', color: '#fff' },
    '.cm-scroller': { overflow: 'auto' },
    '.cm-scroller::-webkit-scrollbar': { width: '4px' },
    '.cm-scroller::-webkit-scrollbar-thumb': { background: 'var(--b1)', borderRadius: '2px' },
    '.cm-placeholder': { color: 'var(--t4)' },
    // --- Find/Replace panel (@codemirror/search) ---
    // The default panel ships with light-mode gray styling that
    // clashes against the dark editor. Theme it with the app's tokens
    // so it feels like part of Clauge, not a foreign widget.
    '.cm-panels': {
      backgroundColor: 'var(--n2)',
      color: 'var(--t1)',
      borderTop: '1px solid var(--b1)',
      borderBottom: '1px solid var(--b1)',
      fontFamily: 'var(--ui)',
    },
    '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--b1)', borderTop: 'none' },
    '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--b1)', borderBottom: 'none' },
    '.cm-search': {
      padding: '6px 8px',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      flexWrap: 'wrap',
      fontSize: '12px',
    },
    '.cm-search label': {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      color: 'var(--t3)',
      fontSize: '11.5px',
      whiteSpace: 'nowrap',
    },
    '.cm-search input[type="checkbox"]': {
      accentColor: 'var(--acc)',
      margin: '0',
    },
    '.cm-textfield': {
      backgroundColor: 'var(--surface, #111)',
      color: 'var(--t1)',
      border: '1px solid var(--b1)',
      borderRadius: '4px',
      padding: '4px 8px',
      fontSize: '12px',
      fontFamily: 'var(--mono)',
      minWidth: '180px',
      outline: 'none',
    },
    '.cm-textfield:focus': {
      borderColor: 'var(--acc)',
      boxShadow: '0 0 0 1px var(--acc)',
    },
    '.cm-button': {
      backgroundColor: 'var(--surface, #111)',
      color: 'var(--t2)',
      border: '1px solid var(--b1)',
      borderRadius: '4px',
      padding: '3px 10px',
      fontSize: '11.5px',
      fontFamily: 'var(--ui)',
      cursor: 'pointer',
      backgroundImage: 'none',
      textShadow: 'none',
    },
    '.cm-button:hover': {
      backgroundColor: 'var(--surface-hover, #1a1a1a)',
      color: 'var(--t1)',
      borderColor: 'var(--b2, #333)',
    },
    '.cm-button:active': {
      backgroundColor: 'var(--n3, #0c0c0c)',
    },
    '.cm-button[name="close"], button[name="close"].cm-panel-close': {
      backgroundColor: 'transparent',
      border: 'none',
      color: 'var(--t3)',
      fontSize: '14px',
      padding: '2px 6px',
      marginLeft: 'auto',
    },
    '.cm-button[name="close"]:hover': { color: 'var(--t1)' },
    // Match highlight inside the editor body
    '.cm-searchMatch': {
      backgroundColor: 'rgba(245,166,35,0.25)',
      outline: '1px solid rgba(245,166,35,0.5)',
    },
    '.cm-searchMatch-selected': {
      backgroundColor: 'rgba(245,166,35,0.5)',
      outline: '1px solid rgba(245,166,35,0.8)',
    },
  });

  function createEditor(container: HTMLDivElement, initialDoc: string) {
    const state = EditorState.create({
      doc: initialDoc,
      extensions: [
        lineNumbers(),
        history(),
        keymap.of([
          { key: 'Mod-Enter', run: (view) => {
              if (disabled) {
                showToast('Query already running — cancel to start a new one', 'info');
                return true;
              }
              executeFromCursor(view);
              return true;
            }, preventDefault: true },
          { key: 'Mod-Shift-f', run: formatBuffer, preventDefault: true },
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          indentWithTab,
        ]),
        // Initial config uses the real dialect + schema available at
        // mount. The effect above reconfigures the whole compartment
        // (sql() + autocompletion with our custom sources) once the
        // async table/column fetches complete; this just avoids
        // starting with the wrong dialect's keywords before that
        // catches up.
        sqlCompartment.of([
          sql({
            dialect,
            schema: buildSchema(),
            defaultSchema: defaultSchemaForDialect,
            upperCaseKeywords: true,
          }),
          autocompletion({
            activateOnTyping: true,
            maxRenderedOptions: 25,
            override: [
              buildColumnSource(columnMap),
              schemaCompletionSource({
                dialect,
                schema: buildSchema(),
                defaultSchema: defaultSchemaForDialect,
                upperCaseKeywords: true,
              }),
              keywordCompletionSource(dialect, true),
            ],
          }),
        ]),
        // Find/Replace panel: Cmd/Ctrl+F to open, Cmd/Ctrl+G next,
        // Shift+Cmd/Ctrl+G prev, Cmd/Ctrl+H or Alt+Cmd/Ctrl+F for replace.
        search({ top: true }),
        syntaxHighlighting(oneDarkHighlightStyle),
        editorTheme,
        cmPlaceholder(`Write your SQL query here -- ${mod()}+Enter to execute`),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            suppressExternalSync = true;
            const value = update.state.doc.toString();
            onquerychange?.(value);
            queueMicrotask(() => { suppressExternalSync = false; });
          }
        }),
      ],
    });

    return new EditorView({ state, parent: container });
  }

  onMount(() => {
    if (editorContainer) {
      editorView = createEditor(editorContainer, query ?? '');
    }
  });

  onDestroy(() => {
    editorView?.destroy();
  });

  // Sync external query changes into editor (e.g. tab switch, insert from nav)
  $effect(() => {
    const q = query;
    if (editorView && !suppressExternalSync && q !== editorView.state.doc.toString()) {
      editorView.dispatch({
        changes: { from: 0, to: editorView.state.doc.length, insert: q ?? '' },
      });
    }
  });

  // Executable-iff-non-empty: trust the database engine to validate syntax
  // and surface its own error message. node-sql-parser's grammar coverage
  // is incomplete (it falls back to PostgreSQL for ClickHouse, doesn't
  // recognize `SETTINGS` / `PREWHERE` / `FINAL` / `ARRAY JOIN` / extension
  // SQL on any dialect, and silently drops single-keyword statements like
  // `BEGIN` / `COMMIT` / `VACUUM`). Using it as a gate produced a class of
  // bug where pressing Run did nothing, with no toast or feedback. The
  // server is the source of truth; let it answer.
  function isExecutableStatement(text: string): boolean {
    return text.trim().length > 0;
  }

  /** Reformat the entire buffer (or the current selection if one
   *  exists) using sql-formatter, with dialect picked from the active
   *  connection. Bound to Cmd/Ctrl+Shift+F. */
  function formatBuffer(view: EditorView): boolean {
    const profile = parserProfileFor($activeConnection?.driver ?? '');
    const language = SQL_FORMATTER_DIALECTS[profile] ?? 'sql';
    const sel = view.state.selection.main;
    const source = sel.empty
      ? view.state.doc.toString()
      : view.state.sliceDoc(sel.from, sel.to);
    if (!source.trim()) return true;
    try {
      const formatted = formatSql(source, { language, keywordCase: 'upper' });
      if (formatted === source) return true;
      if (sel.empty) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: formatted },
        });
      } else {
        view.dispatch({
          changes: { from: sel.from, to: sel.to, insert: formatted },
        });
      }
    } catch (e: any) {
      showToast(`Format failed: ${e?.message ?? String(e)}`, 'error');
    }
    return true;
  }

  function executeFromCursor(view: EditorView) {
    const sel = view.state.selection.main;

    // If there's a selection, execute the selected text
    if (!sel.empty) {
      const selected = view.state.sliceDoc(sel.from, sel.to).trim();
      if (!selected) return;

      const stmts = splitSqlStatements(selected);
      if (stmts.length > 1 && onexecutemulti) {
        onexecutemulti(stmts);
        return;
      }

      if (stmts.length === 1 && isExecutableStatement(stmts[0])) {
        onexecute?.(stmts[0]);
      }
      return;
    }

    // No selection — find the single statement at the cursor.
    // Uses the proper splitter that respects strings, comments, and
    // dollar-quoting; the old naive `split(';')` was broken whenever a
    // statement contained a `;` inside a literal or comment.
    const fullText = view.state.doc.toString();
    const cursorPos = sel.head;
    const statements = splitSqlStatementsWithPositions(fullText);
    if (statements.length === 0) return;

    // Primary match: cursor inside [from, to+1] (the +1 lets the cursor
    // sit right after the trailing `;`).
    let stmt = statements.find(s => cursorPos >= s.from && cursorPos <= s.to + 1);

    // Fallback for cursor at end-of-buffer or in trailing whitespace
    // after the final `;` — execute the last non-empty statement.
    if (!stmt) {
      for (let i = statements.length - 1; i >= 0; i--) {
        if (statements[i].to < cursorPos) { stmt = statements[i]; break; }
      }
    }

    if (stmt && isExecutableStatement(stmt.text)) {
      onexecute?.(stmt.text);
    }
  }

  /** Called by the Execute button — requires selection */
  export function handleExecute() {
    if (!editorView) return;
    if (disabled) {
      showToast('Query already running — cancel to start a new one', 'info');
      return;
    }
    const sel = editorView.state.selection.main;

    if (!sel.empty) {
      executeFromCursor(editorView);
      return;
    }

    showToast('Select the query you want to execute', 'info');
  }
</script>

<div class="query-editor">
  <div class="qe-editor" bind:this={editorContainer}></div>
  {#if schemaLoading}
    <div class="qe-schema-loading" title="Fetching column metadata for autocomplete. Suggestions improve as this completes.">
      <span class="qe-spinner"></span>
      <span>Loading schema for autocomplete…</span>
    </div>
  {/if}
</div>

<style>
  .query-editor {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
    position: relative;
  }
  .qe-editor {
    flex: 1;
    overflow: hidden;
    min-height: 0;
  }
  .qe-editor :global(.cm-editor) {
    height: 100%;
  }
  .qe-schema-loading {
    position: absolute;
    bottom: 6px;
    right: 10px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--surface, #1a1a1a) 85%, transparent);
    border: 1px solid var(--b1, #2a2a2a);
    color: var(--t3, #8a8a8a);
    font-family: var(--ui);
    font-size: 10.5px;
    pointer-events: none;
    user-select: none;
  }
  .qe-spinner {
    width: 9px;
    height: 9px;
    border: 1.5px solid var(--b1, #2a2a2a);
    border-top-color: var(--acc, #7c5cf8);
    border-radius: 50%;
    animation: qe-spin 0.8s linear infinite;
  }
  @keyframes qe-spin {
    to { transform: rotate(360deg); }
  }
</style>

// Auto-move-on-PR-merge: a quiet background loop that polls the host
// for each pr_url'd card's current state and, when one comes back as
// merged, moves the card to the board's first "Done"-like column.
//
// Design notes:
//   - Pure read for everything except the eventual move. Won't surprise
//     the user with mutations until the host says the PR is actually
//     merged.
//   - Heuristic destination column (regex on column name). No per-board
//     config UI yet; if real users hit boards whose "Done" column has an
//     unusual name we can add one. The regex is broad enough to cover
//     the common cases: Done / Merged / Shipped / Complete / Closed.
//   - Skips cards already in the destination column so re-runs are
//     no-ops, and skips boards that don't have a destination column at
//     all (leaving the card where it is is better than dumping it into
//     a random column).
//   - Silently swallows individual card failures — gh/glab might be
//     missing, the network might be down, the user might have lost
//     repo access. None of those should pop a toast.

import { get } from 'svelte/store';
import {
  workspaceCardCheckPrState,
  workspaceCardMove,
  workspaceCardAddComment,
} from './commands';
import { cardsByBoard, columnsByBoard, loadBoardContents } from './stores';
import { currentUserActor } from './attribution';
import { showToast } from '$lib/shared/primitives/toast';
import { settings } from '$lib/stores/settings';

const DONE_COLUMN_RX = /\b(merged|done|shipped|complete|completed|closed)\b/i;

let inflight = false;

/** Walk every loaded board, check each card-with-pr_url's host state,
 *  auto-move the merged ones. Idempotent + reentrancy-guarded so
 *  multiple rapid focus events collapse to one run.
 *
 *  Gated on the `workspace_automove_merged_prs` setting (default on).
 *  Users who want manual control can flip it off in
 *  Settings → Workspace → Board automation. */
export async function autoMoveMergedPrs(): Promise<void> {
  if (inflight) return;
  const enabled = (get(settings)['workspace_automove_merged_prs'] ?? 'true') === 'true';
  if (!enabled) return;
  inflight = true;
  try {
    const actor = currentUserActor();
    const cardsMap = get(cardsByBoard);
    const colsMap = get(columnsByBoard);
    const boardsToRefresh = new Set<string>();

    for (const [boardId, cards] of cardsMap) {
      const cols = colsMap.get(boardId) ?? [];
      if (cols.length === 0) continue;
      const doneCol = cols.find((c) => DONE_COLUMN_RX.test(c.name));
      if (!doneCol) continue;

      for (const card of cards) {
        if (!card.prUrl) continue;
        if (card.columnId === doneCol.id) continue;

        let state: string;
        try {
          state = await workspaceCardCheckPrState(card.id);
        } catch {
          continue; // gh missing / network / no access — skip silently
        }
        if (state !== 'merged') continue;

        try {
          // Append to the end of the destination column. We compute
          // position from the current snapshot rather than asking the
          // backend so the move feels instant; the backend re-sorts on
          // the next load and the snapshot updates via the event below.
          const inDone = cards.filter((c) => c.columnId === doneCol.id);
          await workspaceCardMove({
            id: card.id,
            columnId: doneCol.id,
            position: inDone.length,
            actor,
          });
          await workspaceCardAddComment(
            card.id,
            `**PR merged on host** — moved to **${doneCol.name}** by Clauge.`,
            actor,
          );
          showToast(
            `Moved "${card.title}" to ${doneCol.name} — PR merged`,
            'success',
          );
          boardsToRefresh.add(boardId);
        } catch {
          // Move failed — leave the card where it is.
        }
      }
    }

    // Refresh only the boards we actually touched so the UI shows the
    // new column position without waiting for the next user action.
    await Promise.all(
      Array.from(boardsToRefresh).map((id) =>
        loadBoardContents(id).catch(() => {}),
      ),
    );
  } finally {
    inflight = false;
  }
}

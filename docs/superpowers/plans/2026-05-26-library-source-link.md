# Library Source Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the original YouTube/Bilibili URL into history and show it as a clickable link in the library detail dialog without exposing local file paths.

**Architecture:** Extend the history entry schema with an optional `sourceUrl`, populate it from the queued task URL only for remote sources, and expose a dedicated `openExternal` IPC bridge for browser URLs. The renderer keeps reading history as before, adds one detail-grid field for the original link, and falls back to `--` for local files and older records without the new field.

**Tech Stack:** TypeScript, Electron IPC, React, Zustand store flow, Node.js built-in test runner, npm typecheck/build

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `electron/services/history.ts` | Modify | Add optional `sourceUrl` to persisted history entries |
| `src/preload.d.ts` | Modify | Keep renderer-side `HistoryEntry` and `ElectronAPI` typings aligned |
| `electron/preload.ts` | Modify | Expose a dedicated `openExternal(url)` bridge |
| `electron/main.ts` | Modify | Persist `sourceUrl` from queue tasks and add the external-link IPC handler |
| `src/components/ResultView.tsx` | Modify | Render the original-link row and open remote links from the detail dialog |
| `src/i18n/locales/en.ts` | Modify | Add English detail labels for the original link |
| `src/i18n/locales/zh.ts` | Modify | Add Chinese detail labels for the original link |

> **Testing note:** This repo already uses `npm run typecheck` and `npm run build`. For the Electron-side logic, add a focused Node test file so source URL persistence rules can be exercised without spinning up the full app.

---

### Task 1: Add a testable source-link persistence helper

**Files:**
- Create: `electron/services/history-source-link.ts`
- Create: `electron/services/history-source-link.test.ts`
- Modify: `electron/main.ts`

- [ ] **Step 1: Write the failing test**

Create `electron/services/history-source-link.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { buildHistorySourceUrl } from './history-source-link.ts'

test('keeps the original youtube url for history entries', () => {
  assert.equal(
    buildHistorySourceUrl({
      sourceType: 'youtube',
      taskUrl: 'https://www.youtube.com/watch?v=abc123def45',
    }),
    'https://www.youtube.com/watch?v=abc123def45',
  )
})

test('keeps the original bilibili url for history entries', () => {
  assert.equal(
    buildHistorySourceUrl({
      sourceType: 'bilibili',
      taskUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
    }),
    'https://www.bilibili.com/video/BV1xx411c7mD',
  )
})

test('does not expose local file paths as source links', () => {
  assert.equal(
    buildHistorySourceUrl({
      sourceType: 'local-file',
      taskUrl: '/Users/demo/Videos/sample.mp4',
    }),
    undefined,
  )
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --test --experimental-strip-types electron/services/history-source-link.test.ts
```

Expected: FAIL with module-not-found for `./history-source-link.ts`.

- [ ] **Step 3: Write the minimal helper**

Create `electron/services/history-source-link.ts`:

```ts
import type { VideoSourceType } from './types.js'

interface BuildHistorySourceUrlInput {
  sourceType: VideoSourceType
  taskUrl: string
}

export function buildHistorySourceUrl(input: BuildHistorySourceUrlInput): string | undefined {
  if (input.sourceType === 'local-file') {
    return undefined
  }

  return input.taskUrl
}
```

- [ ] **Step 4: Run the helper tests again**

Run:

```bash
node --test --experimental-strip-types electron/services/history-source-link.test.ts
```

Expected: PASS (`3` tests, `0` failures).

- [ ] **Step 5: Wire `main.ts` to use the helper**

In `electron/main.ts`, add:

```ts
import { buildHistorySourceUrl } from './services/history-source-link.js'
```

Then update the `addHistoryEntry({ ... })` payload:

```ts
sourceType: task.sourceType,
sourceUrl: buildHistorySourceUrl({
  sourceType: task.sourceType,
  taskUrl: task.url,
}),
fileSize,
```

- [ ] **Step 6: Commit the helper and initial wiring**

```bash
git add electron/services/history-source-link.ts electron/services/history-source-link.test.ts electron/main.ts
git commit -m "feat: persist history source links"
```

---

### Task 2: Extend the history and preload types plus external-link IPC

**Files:**
- Modify: `electron/services/history.ts`
- Modify: `src/preload.d.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/main.ts`
- Test: `electron/services/history-source-link.test.ts`

- [ ] **Step 1: Add `sourceUrl` to the history types**

Update `electron/services/history.ts` and `src/preload.d.ts` so `HistoryEntry` contains:

```ts
sourceUrl?: string
```

Also extend the renderer API typing in `src/preload.d.ts` with:

```ts
openExternal: (url: string) => Promise<void>
```

- [ ] **Step 2: Expose the new preload bridge**

In `electron/preload.ts`, extend `electronAPI` with:

```ts
openExternal: (url: string): Promise<void> =>
  ipcRenderer.invoke('shell:openExternal', url),
```

- [ ] **Step 3: Add the Electron IPC handler**

In `electron/main.ts`, register:

```ts
ipcMain.handle('shell:openExternal', async (_event, targetUrl: string): Promise<void> => {
  const opened = await shell.openExternal(targetUrl)
  if (!opened) {
    throw new Error(`Failed to open external URL: ${targetUrl}`)
  }
})
```

- [ ] **Step 4: Re-run the focused helper test**

Run:

```bash
node --test --experimental-strip-types electron/services/history-source-link.test.ts
```

Expected: PASS (`3` tests, `0` failures).

- [ ] **Step 5: Run project typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the type and IPC changes**

```bash
git add electron/services/history.ts src/preload.d.ts electron/preload.ts electron/main.ts
git commit -m "feat: add external source link bridge"
```

---

### Task 3: Render the original link in the detail dialog

**Files:**
- Modify: `src/components/ResultView.tsx`
- Modify: `src/i18n/locales/en.ts`
- Modify: `src/i18n/locales/zh.ts`

- [ ] **Step 1: Add helper logic in `ResultView.tsx`**

Add small helpers near the other formatting functions:

```ts
function isRemoteSource(sourceType: string | undefined): boolean {
  return sourceType === 'youtube' || sourceType === 'bilibili'
}

function getSourceUrlDisplay(entry: HistoryEntry): string {
  if (!isRemoteSource(entry.sourceType)) {
    return '--'
  }

  return entry.sourceUrl || '--'
}
```

Add the click handler in the component:

```ts
const handleOpenSourceUrl = (url: string) => {
  window.electronAPI.openExternal(url)
}
```

- [ ] **Step 2: Render the new detail-grid cell**

In the detail dialog grid, add a new item:

```tsx
<div>
  <span className="text-outline block mb-1">{t('result.detail.originalLink')}</span>
  {selectedEntry.sourceUrl && isRemoteSource(selectedEntry.sourceType) ? (
    <button
      type="button"
      onClick={() => handleOpenSourceUrl(selectedEntry.sourceUrl!)}
      className="text-primary hover:underline break-all text-left"
    >
      {selectedEntry.sourceUrl}
    </button>
  ) : (
    <span className="text-on-surface">--</span>
  )}
</div>
```

- [ ] **Step 3: Add i18n strings**

In `src/i18n/locales/en.ts` add:

```ts
'result.detail.originalLink': 'Original Link',
```

In `src/i18n/locales/zh.ts` add:

```ts
'result.detail.originalLink': '原始链接',
```

- [ ] **Step 4: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Run production build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit the renderer changes**

```bash
git add src/components/ResultView.tsx src/i18n/locales/en.ts src/i18n/locales/zh.ts
git commit -m "feat: show original source links in history"
```

---

### Task 4: Final verification

**Files:**
- Modify: none
- Test: `electron/services/history-source-link.test.ts`

- [ ] **Step 1: Re-run the focused regression test**

Run:

```bash
node --test --experimental-strip-types electron/services/history-source-link.test.ts
```

Expected: PASS (`3` tests, `0` failures).

- [ ] **Step 2: Re-run project typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Re-run project build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Smoke-check the user-visible behavior**

Manually verify:

1. A new YouTube history entry shows a clickable original link in the detail dialog
2. A new Bilibili history entry shows a clickable original link in the detail dialog
3. A local-file history entry shows `--` for the original-link field
4. An older history entry without `sourceUrl` still renders `--`

- [ ] **Step 5: Update tracking**

Mark the plan execution todo done:

```sql
UPDATE todos
SET status = 'done'
WHERE id IN ('source-link-transition-to-plan', 'source-link-implement-feature');
```

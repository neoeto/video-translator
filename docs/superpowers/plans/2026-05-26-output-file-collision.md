# Output File Collision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent final translated/subtitled videos from overwriting each other when multiple exports resolve to the same title-based filename.

**Architecture:** Extract final output-path generation into a small pure helper in `electron/services/` so collision handling can be tested without the full pipeline. The pipeline will ask that helper for the final `.mp4` path, keeping the existing readable filename when no collision exists and appending `_YYMMDD-HHmmss` only when the base path is already taken. If the timestamped filename also collides within the same second, the helper continues with an incrementing numeric suffix.

**Tech Stack:** TypeScript, Node.js built-in test runner (`node:test`), Electron, Node `fs/promises`, `path`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `electron/services/output-path.ts` | Create | Encapsulate sanitized filename generation, timestamp formatting, collision detection, and retry naming |
| `electron/services/output-path.test.ts` | Create | Automated regression coverage for no-collision, collision-with-timestamp, and same-second repeated collision cases |
| `electron/services/pipeline.ts` | Modify | Replace inline final output-path construction with the new helper |

> **Testing note:** This repo has no dedicated test script, but Node 22 is available. Use `node --test --experimental-strip-types` for the new pure helper tests, then run `npm run typecheck` and `npm run build`.

---

### Task 1: Create collision-safe output-path helper with failing tests first

**Files:**
- Create: `electron/services/output-path.test.ts`
- Create: `electron/services/output-path.ts`

- [ ] **Step 1: Write the failing test file**

Create `electron/services/output-path.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { buildUniqueOutputPath } from './output-path.ts'

test('returns the base translated output path when no collision exists', async () => {
  const outputPath = await buildUniqueOutputPath({
    outputDir: '/tmp/out',
    title: 'Same Title',
    isSubtitleOnly: false,
    pathExists: async () => false,
    now: () => new Date('2026-05-26T09:15:30Z'),
  })

  assert.equal(outputPath, '/tmp/out/Same Title_translated.mp4')
})

test('appends YYMMDD-HHmmss when the base translated output path already exists', async () => {
  const taken = new Set(['/tmp/out/Same Title_translated.mp4'])
  const outputPath = await buildUniqueOutputPath({
    outputDir: '/tmp/out',
    title: 'Same Title',
    isSubtitleOnly: false,
    pathExists: async (candidate) => taken.has(candidate),
    now: () => new Date('2026-05-26T09:15:30Z'),
  })

  assert.equal(outputPath, '/tmp/out/Same Title_translated_260526-091530.mp4')
})

test('adds an incrementing suffix when the timestamped subtitle-only output path also exists', async () => {
  const taken = new Set([
    '/tmp/out/Same Title_subtitled.mp4',
    '/tmp/out/Same Title_subtitled_260526-091530.mp4',
  ])

  const outputPath = await buildUniqueOutputPath({
    outputDir: '/tmp/out',
    title: 'Same Title',
    isSubtitleOnly: true,
    pathExists: async (candidate) => taken.has(candidate),
    now: () => new Date('2026-05-26T09:15:30Z'),
  })

  assert.equal(outputPath, '/tmp/out/Same Title_subtitled_260526-091530_2.mp4')
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
node --test --experimental-strip-types electron/services/output-path.test.ts
```

Expected: FAIL with module-not-found for `./output-path.ts`.

- [ ] **Step 3: Write the minimal helper implementation**

Create `electron/services/output-path.ts`:

```ts
import { access } from 'node:fs/promises'
import path from 'node:path'

export interface BuildUniqueOutputPathInput {
  outputDir: string
  title: string
  isSubtitleOnly: boolean
  pathExists?: (candidate: string) => Promise<boolean>
  now?: () => Date
}

function sanitizeFileName(fileName: string): string {
  const sanitized = fileName
    .replace(/[<>:\"/\\\\|?*\\u0000-\\u001F]/g, '_')
    .replace(/\\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')

  return sanitized || 'translated_video'
}

function formatCollisionTimestamp(date: Date): string {
  const yy = String(date.getFullYear()).slice(-2)
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  return `${yy}${mm}${dd}-${hh}${min}${ss}`
}

async function defaultPathExists(candidate: string): Promise<boolean> {
  try {
    await access(candidate)
    return true
  } catch {
    return false
  }
}

export async function buildUniqueOutputPath(input: BuildUniqueOutputPathInput): Promise<string> {
  const suffix = input.isSubtitleOnly ? '_subtitled' : '_translated'
  const baseName = `${sanitizeFileName(input.title)}${suffix}`
  const pathExists = input.pathExists ?? defaultPathExists
  const basePath = path.join(input.outputDir, `${baseName}.mp4`)

  if (!(await pathExists(basePath))) {
    return basePath
  }

  const timestamp = formatCollisionTimestamp((input.now ?? (() => new Date()))())
  let attempt = 0

  while (true) {
    const retrySuffix = attempt === 0 ? `_${timestamp}` : `_${timestamp}_${attempt + 1}`
    const retryPath = path.join(input.outputDir, `${baseName}${retrySuffix}.mp4`)
    if (!(await pathExists(retryPath))) {
      return retryPath
    }
    attempt += 1
  }
}
```

- [ ] **Step 4: Run the helper tests again**

Run:

```bash
node --test --experimental-strip-types electron/services/output-path.test.ts
```

Expected: PASS (`3` tests, `0` failures).

- [ ] **Step 5: Commit the helper and its tests**

```bash
git add electron/services/output-path.ts electron/services/output-path.test.ts
git commit -m "feat: add collision-safe output path helper"
```

---

### Task 2: Wire the pipeline to use the helper

**Files:**
- Modify: `electron/services/pipeline.ts`
- Test: `electron/services/output-path.test.ts`

- [ ] **Step 1: Replace inline final-output naming with the helper**

In `electron/services/pipeline.ts`, add the import:

```ts
import { buildUniqueOutputPath } from './output-path.js'
```

Then replace the current inline naming block:

```ts
const suffix = isSubtitleOnly ? '_subtitled' : '_translated'
const finalOutputPath = path.join(outputDir, `${sanitizeFileName(download.title)}${suffix}.mp4`)
```

with:

```ts
const finalOutputPath = await buildUniqueOutputPath({
  outputDir,
  title: download.title,
  isSubtitleOnly,
})
```

If `sanitizeFileName()` is no longer used anywhere else in `pipeline.ts`, delete the local helper from that file.

- [ ] **Step 2: Run the helper tests after pipeline wiring**

Run:

```bash
node --test --experimental-strip-types electron/services/output-path.test.ts
```

Expected: PASS (`3` tests, `0` failures).

- [ ] **Step 3: Run project typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit the pipeline wiring**

```bash
git add electron/services/pipeline.ts
git commit -m "feat: use unique output paths for final videos"
```

---

### Task 3: Final verification

**Files:**
- Modify: none
- Test: `electron/services/output-path.test.ts`

- [ ] **Step 1: Re-run the collision regression tests**

Run:

```bash
node --test --experimental-strip-types electron/services/output-path.test.ts
```

Expected: PASS (`3` tests, `0` failures).

- [ ] **Step 2: Run the full project typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run the production build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Run one manual smoke check against a temp directory**

Run:

```bash
tmpdir=$(mktemp -d) && \
touch "$tmpdir/Same Title_translated.mp4" && \
TMPDIR_OVERRIDE="$tmpdir" node --experimental-strip-types --input-type=module <<'EOF'
import assert from 'node:assert/strict'
import { buildUniqueOutputPath } from './electron/services/output-path.ts'

const result = await buildUniqueOutputPath({
  outputDir: process.env.TMPDIR_OVERRIDE!,
  title: 'Same Title',
  isSubtitleOnly: false,
  pathExists: async (candidate) => candidate === `${process.env.TMPDIR_OVERRIDE}/Same Title_translated.mp4`,
  now: () => new Date('2026-05-26T09:15:30Z'),
})

assert.equal(result, `${process.env.TMPDIR_OVERRIDE}/Same Title_translated_260526-091530.mp4`)
console.log(result)
EOF
rm -rf "$tmpdir"
```

Expected: prints a `_260526-091530.mp4` path and exits `0`.

- [ ] **Step 5: Commit the final verification pass if it required any touch-up**

If verification required no extra edits, skip this commit. If a small follow-up change was needed, commit only that change:

```bash
git add electron/services/output-path.ts electron/services/output-path.test.ts electron/services/pipeline.ts
git commit -m "chore: finalize output collision handling"
```

---

## Self-Review

### Spec coverage

- Keep base filename unchanged when no collision: covered by Task 1 test 1
- Append `_YYMMDD-HHmmss` only on collision: covered by Task 1 test 2 + Task 2 wiring
- Prevent same-second repeated overwrite: covered by Task 1 test 3
- Apply to both `full` and `subtitleOnly`: covered by Task 1 tests 1/2 vs 3
- Preserve downstream `outputPath` usage: covered by Task 2

### Placeholder scan

- No unresolved placeholder markers
- No vague “handle later” steps
- All commands are concrete and executable in this repo

### Type consistency

- Uses one helper name everywhere: `buildUniqueOutputPath`
- Uses one timestamp format everywhere: `YYMMDD-HHmmss`
- Uses one suffix order everywhere: `<title>_<mode>_<timestamp>.mp4`

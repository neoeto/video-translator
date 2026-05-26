# Subtitle Min Split Width Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the hard-coded subtitle punctuation split threshold configurable, persist it in app settings, and expose it in the Subtitles settings tab with default `20` and allowed value `0`.

**Architecture:** Add a new top-level `subtitleMinSplitWidth` field to backend and frontend `AppConfig`, persist it through `electron-store`, expose it in the renderer settings form, and thread the value into `generateAss()` so subtitle splitting logic reads configuration instead of a constant. Keep the current split algorithm unchanged; only replace the threshold source and clamp saved values to non-negative integers.

**Tech Stack:** TypeScript, Electron, React, Zustand, electron-store

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `electron/services/types.ts` | Modify | Add backend `AppConfig.subtitleMinSplitWidth` |
| `src/types.ts` | Modify | Add renderer `AppConfig.subtitleMinSplitWidth` |
| `electron/services/config.ts` | Modify | Add default, schema, and persistence for the new config field |
| `src/store/usePipelineStore.ts` | Modify | Seed renderer default config with the new field |
| `src/components/SettingsView.tsx` | Modify | Add numeric settings input in the Subtitles tab |
| `src/i18n/locales/en.ts` | Modify | Add English label/help text for the new setting |
| `src/i18n/locales/zh.ts` | Modify | Add Chinese label/help text for the new setting |
| `electron/services/subtitle.ts` | Modify | Replace constant threshold usage with a function parameter/configured value |
| `electron/services/pipeline.ts` | Modify | Pass configured threshold into subtitle generation |

> **Testing note:** This repository currently has no automated test runner or test files. Do not introduce a new testing framework in this change. Verification for each task is `npm run typecheck` plus targeted manual smoke checks in the running app.

---

### Task 1: Add config plumbing for `subtitleMinSplitWidth`

**Files:**
- Modify: `electron/services/types.ts`
- Modify: `src/types.ts`
- Modify: `electron/services/config.ts`
- Modify: `src/store/usePipelineStore.ts`

- [ ] **Step 1: Add the new field to backend and frontend `AppConfig`**

In `electron/services/types.ts` and `src/types.ts`, add the same field directly after `subtitleStyle` so the config shape stays aligned across the process boundary:

```ts
export interface AppConfig {
  locale: Locale
  sourceLanguage: TranslationLanguage
  targetLanguage: TranslationLanguage
  openaiApiKey: string
  outputDir: string
  subtitleStyle: SubtitleStyle
  subtitleMinSplitWidth: number
  proxyEnabled: boolean
  // ...
}
```

- [ ] **Step 2: Add the default value, schema entry, and writable key in `electron-store`**

In `electron/services/config.ts`, update `defaultConfig`, `schema`, and `simpleKeys`:

```ts
const defaultConfig: AppConfig = {
  locale: 'en',
  sourceLanguage: 'auto',
  targetLanguage: 'zh',
  openaiApiKey: '',
  outputDir: path.join(os.homedir(), 'Movies', 'video-translator'),
  proxyEnabled: false,
  proxyUrl: '',
  proxyBypass: 'localhost, 127.0.0.1',
  // ...
  subtitleStyle: {
    enFontSize: 36,
    cnFontSize: 50,
    enColor: '#FFFFFF',
    cnColor: '#FFFF00',
    enPosition: 'bottom',
    cnPosition: 'bottom',
    bgColor: '#000000',
    bgOpacity: 0,
    fontFamily: 'Arial',
  },
  subtitleMinSplitWidth: 20,
}
```

```ts
    subtitleMinSplitWidth: {
      type: 'number',
      default: defaultConfig.subtitleMinSplitWidth,
    },
```

```ts
  const simpleKeys = [
    'locale',
    'sourceLanguage',
    'targetLanguage',
    'openaiApiKey',
    'outputDir',
    'subtitleMinSplitWidth',
    'proxyEnabled',
    // ...
  ] as const
```

- [ ] **Step 3: Seed the renderer store with the same default**

In `src/store/usePipelineStore.ts`, add the field near `subtitleStyle` so the renderer never sees an incomplete `config` object before `loadConfig()` finishes:

```ts
  config: {
    locale: 'en',
    sourceLanguage: 'auto' as const,
    targetLanguage: 'zh' as const,
    openaiApiKey: '',
    outputDir: '',
    proxyEnabled: false,
    proxyUrl: '',
    proxyBypass: 'localhost, 127.0.0.1',
    // ...
    subtitleStyle: {
      enFontSize: 36,
      cnFontSize: 50,
      enColor: '#FFFFFF',
      cnColor: '#FFFF00',
      enPosition: 'bottom',
      cnPosition: 'bottom',
      bgColor: '#000000',
      bgOpacity: 0,
      fontFamily: 'Arial',
    },
    subtitleMinSplitWidth: 20,
  },
```

- [ ] **Step 4: Run typecheck after config plumbing**

Run: `npm run typecheck`

Expected: PASS. No type errors for `AppConfig` drift between main/preload/renderer.

- [ ] **Step 5: Commit config plumbing**

```bash
git add electron/services/types.ts src/types.ts electron/services/config.ts src/store/usePipelineStore.ts
git commit -m "feat: add subtitle split width config"
```

---

### Task 2: Expose the setting in the Subtitles tab

**Files:**
- Modify: `src/components/SettingsView.tsx`
- Modify: `src/i18n/locales/en.ts`
- Modify: `src/i18n/locales/zh.ts`

- [ ] **Step 1: Add i18n keys for the new label and help text**

Append these keys near the existing `settings.subtitles.*` entries.

In `src/i18n/locales/en.ts`:

```ts
  'settings.subtitles.minSplitWidth': 'Minimum Split Display Width',
  'settings.subtitles.minSplitWidthHelp': '0 makes punctuation splits easier; larger values merge short fragments more aggressively.',
```

In `src/i18n/locales/zh.ts`:

```ts
  'settings.subtitles.minSplitWidth': '最小拆分显示宽度',
  'settings.subtitles.minSplitWidthHelp': '0 表示尽量按标点拆分；值越大，越倾向于合并短片段。',
```

- [ ] **Step 2: Add a numeric input in the Subtitles settings section**

In `src/components/SettingsView.tsx`, add a third form block after the existing font-size controls. Clamp on save so persisted values are always non-negative integers:

```tsx
                <div>
                  <label className="block text-[11px] font-semibold text-on-surface-variant mb-2 uppercase tracking-wider">
                    {t('settings.subtitles.minSplitWidth')}
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={config.subtitleMinSplitWidth}
                    onChange={(e) => {
                      const nextValue = Number(e.target.value)
                      saveConfig({
                        subtitleMinSplitWidth: Number.isFinite(nextValue)
                          ? Math.max(0, Math.trunc(nextValue))
                          : 20,
                      })
                    }}
                    className="w-32 bg-surface-container-lowest border border-outline-variant rounded-md px-3 py-2 text-on-surface font-mono text-xs focus:border-primary focus:outline-none transition-colors"
                  />
                  <p className="text-[12px] text-on-surface-variant mt-1">
                    {t('settings.subtitles.minSplitWidthHelp')}
                  </p>
                </div>
```

- [ ] **Step 3: Run typecheck after the UI/i18n change**

Run: `npm run typecheck`

Expected: PASS. `TranslationKey` should still infer correctly from `en.ts`, and `SettingsView.tsx` should compile with the new config field.

- [ ] **Step 4: Manually verify the setting saves and reloads**

Run: `npm run dev`

Manual check:
1. Open **Settings → Subtitles**
2. Confirm the new field appears under the existing font size inputs
3. Enter `0`, navigate away, then return
4. Restart the app and confirm the value is still `0`

Expected: The input persists through `saveConfig()` / `getConfig()` and never stores a negative number.

- [ ] **Step 5: Commit the UI work**

```bash
git add src/components/SettingsView.tsx src/i18n/locales/en.ts src/i18n/locales/zh.ts
git commit -m "feat: add subtitle split width setting"
```

---

### Task 3: Thread the config into subtitle generation

**Files:**
- Modify: `electron/services/subtitle.ts`
- Modify: `electron/services/pipeline.ts`

- [ ] **Step 1: Replace the hard-coded constant with a parameterized threshold**

In `electron/services/subtitle.ts`, remove the module-level `MIN_SPLIT_WIDTH` constant and pass the threshold through helper signatures instead:

```ts
function splitAtPunctuation(text: string, minSplitWidth: number): string[] {
  const parts: string[] = []
  let current = ''

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    current += char
    if (SPLIT_PUNCTUATION.has(char)) {
      if (char === '.' && i + 1 < text.length && !/\s/.test(text[i + 1])) {
        continue
      }
      if (current.trim() && displayWidth(current.trim()) >= minSplitWidth) {
        parts.push(current)
        current = ''
      }
    }
  }

  if (current.trim()) parts.push(current)
  return parts.length > 0 ? parts : [text]
}
```

```ts
function splitSubtitleSegment(segment: TranslatedSegment, minSplitWidth: number): SubtitleChunk[] {
  let srcParts = splitAtPunctuation(segment.sourceText, minSplitWidth)
  let tgtParts = splitAtPunctuation(segment.targetText, minSplitWidth)
  // rest of function stays the same
}
```

```ts
export function generateAss(
  translatedSegments: TranslatedSegment[],
  style: SubtitleStyle,
  videoWidth: number,
  videoHeight: number,
  minSplitWidth = 20,
): string {
  // ...
  ...translatedSegments.flatMap((segment) =>
    splitSubtitleSegment(segment, minSplitWidth).flatMap((chunk) => [
      buildDialogueLine(chunk.start, chunk.end, 'Source', chunk.sourceText, centerX, sourceY, bgAlpha),
      buildDialogueLine(chunk.start, chunk.end, 'Target', chunk.targetText, centerX, targetY, bgAlpha),
    ])
  ),
}
```

Update `writeAssFile()` to accept the same optional argument so the helper API stays internally consistent:

```ts
export function writeAssFile(
  translatedSegments: TranslatedSegment[],
  style: SubtitleStyle,
  outputPath: string,
  videoWidth?: number,
  videoHeight?: number,
  minSplitWidth = 20,
): void {
  const ass = generateAss(
    translatedSegments,
    style,
    videoWidth ?? DEFAULT_VIDEO_WIDTH,
    videoHeight ?? DEFAULT_VIDEO_HEIGHT,
    minSplitWidth,
  )
  fs.writeFileSync(outputPath, ass, 'utf8')
}
```

- [ ] **Step 2: Pass the saved setting from the pipeline**

In `electron/services/pipeline.ts`, update the ASS generation call so subtitle splitting uses the persisted config:

```ts
        const assContent = generateAss(
          subtitleSegments,
          config.subtitleStyle,
          width,
          height,
          config.subtitleMinSplitWidth,
        )
```

- [ ] **Step 3: Run typecheck after wiring the config**

Run: `npm run typecheck`

Expected: PASS. `generateAss()` callers compile with the new signature, and no stale constant references remain in `subtitle.ts`.

- [ ] **Step 4: Manually verify subtitle behavior changes with the setting**

Run: `npm run dev`

Manual check:
1. Set **Minimum Split Display Width** to `20`
2. Process a video segment with long punctuation-heavy subtitles and note the split density
3. Set the value to `0`
4. Re-run the same input (or a cached pipeline from the same source) and compare subtitle chunking

Expected:
- `20` matches current behavior
- `0` produces more punctuation-based splits
- Larger values merge more short fragments
- Burned subtitle styling and timestamps remain unchanged aside from chunk boundaries

- [ ] **Step 5: Commit the subtitle generation change**

```bash
git add electron/services/subtitle.ts electron/services/pipeline.ts
git commit -m "feat: make subtitle split width configurable"
```

---

### Task 4: Final verification and cleanup

**Files:**
- Modify: none

- [ ] **Step 1: Run full project typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 2: Run production build**

Run: `npm run build`

Expected: PASS. Electron main, preload, and renderer bundles all compile successfully with the new config field and settings UI.

- [ ] **Step 3: Review git diff for scope**

Run: `git --no-pager diff --stat HEAD~3..HEAD`

Expected: Only the planned config, settings, i18n, and subtitle-generation files are included.

- [ ] **Step 4: Create the final verification commit if needed**

If the implementation work from Tasks 1-3 already produced clean commits and no extra fixes were needed, skip this step. If build/typecheck/manual verification required a small follow-up edit, commit it explicitly:

```bash
git add electron/services/types.ts src/types.ts electron/services/config.ts src/store/usePipelineStore.ts src/components/SettingsView.tsx src/i18n/locales/en.ts src/i18n/locales/zh.ts electron/services/subtitle.ts electron/services/pipeline.ts
git commit -m "chore: finalize subtitle split width implementation"
```

---

## Self-Review

### Spec coverage

- Config becomes user-configurable: covered by Task 1 + Task 2
- Default remains `20`: covered by Task 1 + Task 3
- `0` is allowed: covered by Task 2 + Task 3
- Existing split algorithm stays unchanged: covered by Task 3
- No ffmpeg/ASS behavior changes: preserved by Task 3 manual verification target

### Placeholder scan

- No unresolved placeholder markers
- No references to missing test files or missing functions
- All commands are concrete and executable in this repo

### Type consistency

- Uses one property name everywhere: `subtitleMinSplitWidth`
- Uses one function parameter name everywhere: `minSplitWidth`
- Keeps `AppConfig` aligned between backend and renderer

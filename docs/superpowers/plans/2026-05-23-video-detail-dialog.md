# Video Detail Dialog & Duration Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display video duration on library cards and show a detail dialog (title, source, file size, language, time, summary, subtitles) when clicking the title area.

**Architecture:** Extend `HistoryEntry` with `duration`, `sourceType`, `fileSize`, `pipelineMode`, and `translatedSegments`. Extract video duration via ffprobe in the pipeline. Get file size from the output file at completion. Build a modal dialog component in `ResultView.tsx` that displays all details.

**Tech Stack:** Electron (main process), React + Tailwind CSS (renderer), ffprobe (video metadata), electron-store (persistence)

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `electron/services/types.ts` | Modify | Add `duration`, `sourceType` to `PipelineState` |
| `electron/services/pipeline.ts` | Modify | Add `getVideoDuration()`, set duration/sourceType in state |
| `electron/services/history.ts` | Modify | Add new fields to `HistoryEntry` interface |
| `electron/main.ts` | Modify | Pass new fields to `addHistoryEntry`, compute fileSize |
| `src/preload.d.ts` | Modify | Update frontend `HistoryEntry` type |
| `src/types.ts` | Modify | Update frontend `PipelineState` type |
| `src/components/ResultView.tsx` | Modify | Add duration badge on cards, build detail dialog |
| `src/i18n/locales/en.ts` | Modify | Add new i18n keys for detail dialog |
| `src/i18n/locales/zh.ts` | Modify | Add new i18n keys for detail dialog |

---

### Task 1: Extend Backend Types and Data Collection

**Files:**
- Modify: `electron/services/types.ts:171-183` (PipelineState)
- Modify: `electron/services/history.ts:1-16` (HistoryEntry)
- Modify: `electron/services/pipeline.ts:219-242` (add getVideoDuration)
- Modify: `electron/services/pipeline.ts:283-318` (set duration/sourceType after download)
- Modify: `electron/services/pipeline.ts:510-518` (include sourceType in completed state)
- Modify: `electron/main.ts:75-87` (pass new fields to addHistoryEntry)

- [ ] **Step 1: Add `duration` and `sourceType` to `PipelineState` in `electron/services/types.ts`**

```typescript
export interface PipelineState {
  stage: PipelineStage
  progress: number
  overallProgress: number
  videoTitle?: string
  translatedTitle?: string
  error?: string
  outputPath?: string
  thumbnailDataUrl?: string
  completedAt?: number
  translatedSegments?: TranslatedSegment[]
  speakerProfiles?: SpeakerProfile[]
  duration?: number
  sourceType?: VideoSourceType
}
```

- [ ] **Step 2: Add new fields to `HistoryEntry` in `electron/services/history.ts`**

```typescript
export interface HistoryEntry {
  id: string
  videoTitle: string
  translatedTitle?: string
  outputPath: string
  thumbnailDataUrl?: string
  completedAt: number
  sourceLanguage?: string
  targetLanguage?: string
  duration?: number
  sourceType?: string
  fileSize?: number
  pipelineMode?: string
  translatedSegments?: { start: number; end: number; sourceText: string; targetText: string; speaker: string }[]
}
```

- [ ] **Step 3: Add `getVideoDuration` function in `electron/services/pipeline.ts`**

Add after the existing `getVideoDimensions` function (around line 242):

```typescript
function getVideoDuration(videoPath: string): Promise<number> {
  if (!ffprobePath) {
    return Promise.resolve(0)
  }

  return new Promise((resolve) => {
    ffmpeg.ffprobe(videoPath, (error, data) => {
      if (error || !data?.format?.duration) {
        resolve(0)
        return
      }
      resolve(data.format.duration)
    })
  })
}
```

- [ ] **Step 4: Set duration and sourceType in pipeline after download**

In `PipelineOrchestrator.start()`, after `this.updateState({ videoTitle: download.title })` (around line 301), add:

```typescript
this.updateState({ videoTitle: download.title, sourceType })

const duration = await getVideoDuration(download.videoPath)
if (duration > 0) {
  this.updateState({ duration })
}
```

Note: Replace the existing `this.updateState({ videoTitle: download.title })` line.

- [ ] **Step 5: Include `sourceType` in completed state**

In the `completed` state update (around line 510-518), add `sourceType`:

```typescript
this.updateState({
  stage: 'completed',
  progress: 100,
  overallProgress: 100,
  videoTitle: download.title,
  outputPath,
  completedAt: Date.now(),
  translatedSegments: translationResult,
  sourceType,
})
```

- [ ] **Step 6: Pass new fields to `addHistoryEntry` in `electron/main.ts`**

Update the `addHistoryEntry` call to include new fields. Also compute file size from the output file:

```typescript
if (state.stage === 'completed' && state.outputPath) {
  const currentConfig = getConfig()
  let fileSize: number | undefined
  try {
    const stats = await import('node:fs').then(m => m.promises.stat(state.outputPath!))
    fileSize = stats.size
  } catch { /* non-critical */ }
  addHistoryEntry({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    videoTitle: state.videoTitle || 'Untitled',
    translatedTitle: state.translatedTitle,
    outputPath: state.outputPath,
    thumbnailDataUrl: state.thumbnailDataUrl,
    completedAt: state.completedAt || Date.now(),
    sourceLanguage: currentConfig.sourceLanguage,
    targetLanguage: currentConfig.targetLanguage,
    duration: state.duration,
    sourceType,
    fileSize,
    pipelineMode: currentConfig.pipelineMode,
    translatedSegments: state.translatedSegments,
  })
}
```

Note: The `onProgress` callback is not `async`, so we need to handle the async stat differently. Since the callback isn't async, we should refactor to use a fire-and-forget pattern or make the callback async-safe.

Actually, the simplest approach: import `fs` at top of `electron/main.ts` and use the sync version `fs.statSync` inside the callback, or restructure to compute fileSize in a `.then()`.

Better approach — use `statSync`:

```typescript
import { statSync } from 'node:fs'
// ...
if (state.stage === 'completed' && state.outputPath) {
  const currentConfig = getConfig()
  let fileSize: number | undefined
  try {
    fileSize = statSync(state.outputPath).size
  } catch { /* non-critical */ }
  addHistoryEntry({
    // ... all fields including new ones
  })
}
```

- [ ] **Step 7: Commit**

```bash
git add electron/services/types.ts electron/services/history.ts electron/services/pipeline.ts electron/main.ts
git commit -m "feat: collect video duration, source type, file size, and segments in history"
```

---

### Task 2: Update Frontend Types

**Files:**
- Modify: `src/types.ts:40-52` (PipelineState)
- Modify: `src/preload.d.ts:3-12` (HistoryEntry)

- [ ] **Step 1: Add `duration` and `sourceType` to frontend `PipelineState` in `src/types.ts`**

```typescript
export interface PipelineState {
  stage: PipelineStage
  progress: number
  overallProgress: number
  videoTitle?: string
  translatedTitle?: string
  error?: string
  outputPath?: string
  thumbnailDataUrl?: string
  completedAt?: number
  translatedSegments?: TranslatedSegment[]
  speakerProfiles?: SpeakerProfile[]
  duration?: number
  sourceType?: VideoSourceType
}
```

- [ ] **Step 2: Update frontend `HistoryEntry` in `src/preload.d.ts`**

```typescript
export interface HistoryEntry {
  id: string
  videoTitle: string
  translatedTitle?: string
  outputPath: string
  thumbnailDataUrl?: string
  completedAt: number
  sourceLanguage?: string
  targetLanguage?: string
  duration?: number
  sourceType?: string
  fileSize?: number
  pipelineMode?: string
  translatedSegments?: { start: number; end: number; sourceText: string; targetText: string; speaker: string }[]
}
```

- [ ] **Step 3: Commit**

```bash
git add src/types.ts src/preload.d.ts
git commit -m "feat: update frontend types for video detail fields"
```

---

### Task 3: Add i18n Keys

**Files:**
- Modify: `src/i18n/locales/en.ts:81-94`
- Modify: `src/i18n/locales/zh.ts:83-96`

- [ ] **Step 1: Add English i18n keys in `src/i18n/locales/en.ts`**

Add after the existing `result.*` keys:

```typescript
'result.detail.title': 'Video Details',
'result.detail.source': 'Source',
'result.detail.sourceYoutube': 'YouTube',
'result.detail.sourceBilibili': 'Bilibili',
'result.detail.sourceLocalFile': 'Local File',
'result.detail.duration': 'Duration',
'result.detail.fileSize': 'File Size',
'result.detail.language': 'Language',
'result.detail.generatedAt': 'Generated At',
'result.detail.pipelineMode': 'Mode',
'result.detail.modeFull': 'Voice Translation',
'result.detail.modeSubtitleOnly': 'Subtitle Only',
'result.detail.summary': 'Summary',
'result.detail.subtitles': 'Subtitles',
'result.detail.noSubtitles': 'No subtitles available',
'result.detail.close': 'Close',
```

- [ ] **Step 2: Add Chinese i18n keys in `src/i18n/locales/zh.ts`**

Add after the existing `result.*` keys:

```typescript
'result.detail.title': '视频详情',
'result.detail.source': '视频来源',
'result.detail.sourceYoutube': 'YouTube',
'result.detail.sourceBilibili': 'Bilibili',
'result.detail.sourceLocalFile': '本地文件',
'result.detail.duration': '视频时长',
'result.detail.fileSize': '文件大小',
'result.detail.language': '语言转换',
'result.detail.generatedAt': '生成时间',
'result.detail.pipelineMode': '翻译模式',
'result.detail.modeFull': '语音翻译',
'result.detail.modeSubtitleOnly': '仅字幕',
'result.detail.summary': '内容简介',
'result.detail.subtitles': '字幕',
'result.detail.noSubtitles': '暂无字幕',
'result.detail.close': '关闭',
```

- [ ] **Step 3: Commit**

```bash
git add src/i18n/locales/en.ts src/i18n/locales/zh.ts
git commit -m "feat: add i18n keys for video detail dialog"
```

---

### Task 4: Add Duration Badge and Detail Dialog to ResultView

**Files:**
- Modify: `src/components/ResultView.tsx`

- [ ] **Step 1: Add helper functions for formatting duration and file size**

Add at top of file, after the existing `formatTime` and `formatCompletedAt`:

```typescript
function formatDuration(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) return '--:--'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

function formatFileSize(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return '--'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function getSourceLabel(sourceType: string | undefined, t: (key: string) => string): string {
  switch (sourceType) {
    case 'youtube': return t('result.detail.sourceYoutube')
    case 'bilibili': return t('result.detail.sourceBilibili')
    case 'local-file': return t('result.detail.sourceLocalFile')
    default: return '--'
  }
}

function generateSummary(segments: { sourceText: string }[] | undefined): string {
  if (!segments || segments.length === 0) return ''
  const text = segments.map(s => s.sourceText).join(' ')
  return text.length > 200 ? text.slice(0, 200) + '...' : text
}
```

- [ ] **Step 2: Add state and detail dialog to the component**

Inside the `ResultView` component, add state for selected entry:

```typescript
const [selectedEntry, setSelectedEntry] = useState<HistoryEntry | null>(null)
```

- [ ] **Step 3: Add duration badge on each video card thumbnail**

In the thumbnail area (the `aspect-video` div), add a duration badge at bottom-left. The existing completedAt badge is at bottom-right. Add duration at bottom-left:

```tsx
{entry.duration && entry.duration > 0 && (
  <div className="absolute bottom-2 left-2 px-2 py-1 bg-black/80 rounded text-[11px] font-mono text-on-surface">
    {formatDuration(entry.duration)}
  </div>
)}
```

- [ ] **Step 4: Make title area clickable**

Wrap the title `<h3>` element with an `onClick` handler:

```tsx
<h3
  className="font-bold text-on-surface line-clamp-2 leading-tight cursor-pointer hover:text-primary transition-colors"
  title={entry.videoTitle}
  onClick={() => setSelectedEntry(entry)}
>
  {entry.videoTitle}
</h3>
```

- [ ] **Step 5: Build the detail dialog**

Add the modal dialog at the end of the component, before the closing `</div>`:

```tsx
{selectedEntry && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setSelectedEntry(null)}>
    <div
      className="bg-surface-container rounded-xl border border-surface-variant w-full max-w-2xl max-h-[80vh] overflow-y-auto sharp-shadow mx-4"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-6 border-b border-surface-variant">
        <h2 className="text-lg font-bold text-on-surface flex items-center gap-2">
          <span className="material-symbols-outlined">info</span>
          {t('result.detail.title')}
        </h2>
        <button onClick={() => setSelectedEntry(null)} className="text-outline hover:text-on-surface transition-colors">
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>

      {/* Title section */}
      <div className="p-6 border-b border-surface-variant">
        <h3 className="text-xl font-bold text-on-surface mb-1">{selectedEntry.videoTitle}</h3>
        {selectedEntry.translatedTitle && (
          <p className="text-sm text-on-surface-variant">{selectedEntry.translatedTitle}</p>
        )}
      </div>

      {/* Metadata grid */}
      <div className="grid grid-cols-2 gap-4 p-6 border-b border-surface-variant text-sm">
        <div>
          <span className="text-outline block mb-1">{t('result.detail.source')}</span>
          <span className="text-on-surface">{getSourceLabel(selectedEntry.sourceType, t)}</span>
        </div>
        <div>
          <span className="text-outline block mb-1">{t('result.detail.duration')}</span>
          <span className="text-on-surface font-mono">{formatDuration(selectedEntry.duration)}</span>
        </div>
        <div>
          <span className="text-outline block mb-1">{t('result.detail.fileSize')}</span>
          <span className="text-on-surface font-mono">{formatFileSize(selectedEntry.fileSize)}</span>
        </div>
        <div>
          <span className="text-outline block mb-1">{t('result.detail.language')}</span>
          <span className="text-on-surface">
            {getLanguageDisplayName((selectedEntry.sourceLanguage || config.sourceLanguage) as TranslationLanguage, config.locale)} → {getLanguageDisplayName((selectedEntry.targetLanguage || config.targetLanguage) as TranslationLanguage, config.locale)}
          </span>
        </div>
        <div>
          <span className="text-outline block mb-1">{t('result.detail.generatedAt')}</span>
          <span className="text-on-surface font-mono">{formatCompletedAt(selectedEntry.completedAt)}</span>
        </div>
        <div>
          <span className="text-outline block mb-1">{t('result.detail.pipelineMode')}</span>
          <span className="text-on-surface">
            {selectedEntry.pipelineMode === 'subtitleOnly' ? t('result.detail.modeSubtitleOnly') : t('result.detail.modeFull')}
          </span>
        </div>
      </div>

      {/* Summary */}
      {selectedEntry.translatedSegments && selectedEntry.translatedSegments.length > 0 && (
        <div className="p-6 border-b border-surface-variant">
          <h4 className="text-sm text-outline mb-2">{t('result.detail.summary')}</h4>
          <p className="text-sm text-on-surface-variant leading-relaxed">
            {generateSummary(selectedEntry.translatedSegments)}
          </p>
        </div>
      )}

      {/* Subtitles */}
      <div className="p-6">
        <h4 className="text-sm text-outline mb-3">{t('result.detail.subtitles')}</h4>
        {selectedEntry.translatedSegments && selectedEntry.translatedSegments.length > 0 ? (
          <div className="bg-surface-container-lowest rounded-lg p-4 max-h-[300px] overflow-y-auto font-mono text-sm border border-outline-variant">
            <div className="flex flex-col gap-2">
              {selectedEntry.translatedSegments.map((segment, index) => (
                <div
                  key={index}
                  className={`py-2 px-3 rounded flex flex-col gap-1 ${index % 2 === 0 ? 'bg-surface-variant/50' : 'bg-transparent'}`}
                >
                  <div className="flex gap-4 text-on-surface-variant">
                    <span className="text-outline shrink-0">{formatTime(segment.start)}</span>
                    <span>{segment.sourceText}</span>
                  </div>
                  <div className="flex gap-4 text-on-surface">
                    <span className="text-outline shrink-0 opacity-0">{formatTime(segment.start)}</span>
                    <span className="text-primary-fixed-dim">{segment.targetText}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-outline italic">{t('result.detail.noSubtitles')}</p>
        )}
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/ResultView.tsx
git commit -m "feat: add video duration badge and detail dialog in library view"
```

---

### Task 5: Build Verification

- [ ] **Step 1: Run TypeScript build to verify no type errors**

```bash
npx electron-vite build 2>&1 | tail -20
```

Expected: Build succeeds with no errors.

- [ ] **Step 2: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: resolve build issues for video detail feature"
```

# 仅字幕模式（Subtitle-Only Mode）

## 概述

新增「仅字幕」模式：保留原始视频音轨，仅添加双语字幕（烧录到视频中）。与现有「语音翻译」模式并列，用户在主界面一键切换。

## Pipeline 流程对比

### 语音翻译模式（现有，6 步）

```
Download → Extract Audio → Transcribe → Translate → TTS Synthesize → Combine（替换音轨 + 烧字幕）
```

### 仅字幕模式（新增，5 步）

```
Download → Extract Audio → Transcribe → Translate → Combine（保留原音轨 + 仅烧字幕）
```

跳过 TTS 合成步骤。Extract Audio 仍需保留，因为 STT 引擎（WhisperX/local-cli）需要 wav 输入。

## 类型变更

### 新增类型

```typescript
export type PipelineMode = 'full' | 'subtitleOnly'
```

### AppConfig 扩展

```typescript
export interface AppConfig {
  // ... existing fields
  pipelineMode: PipelineMode  // 默认 'full'
}
```

需要在 `electron/services/types.ts` 和 `src/types.ts` 中同步更新。

### CombinerStrategy 接口

`audioPath` 改为可选，仅字幕模式下不传入：

```typescript
export interface CombinerStrategy {
  readonly name: string
  combine(input: {
    videoPath: string
    audioPath?: string        // 仅字幕模式下为 undefined
    subtitlePath: string
    outputPath: string
    onProgress: (pct: number) => void
    signal?: AbortSignal
  }): Promise<CombineResult>
}
```

## 新增 Combiner 策略

### FfmpegSubtitleOnlyCombiner

位于 `electron/services/strategies/combiners/ffmpeg-subtitle-only.ts`

ffmpeg 命令核心区别：
- **现有 FfmpegCombiner**：两个输入（视频 + TTS 音频），映射 `[1:a]` 作为音轨
- **SubtitleOnlyCombiner**：一个输入（视频），映射 `[0:a]` 保留原始音轨

```
ffmpeg -i video.mp4
  -filter_complex "[0:v]subtitles=subtitles.ass[v]"
  -map "[v]" -map "0:a"
  -c:v libx264 -c:a copy
  output.mp4
```

音频使用 `-c:a copy`（直接拷贝，不重新编码），速度更快。

## Pipeline 变更

### 动态步骤数

```typescript
const TOTAL_STEPS_FULL = 6        // 语音翻译
const TOTAL_STEPS_SUBTITLE = 5    // 仅字幕
```

Pipeline 根据 `pipelineMode` 选择步骤数，影响 `overallProgress` 计算。

### 条件跳过 TTS

`pipeline.ts` 的 `start()` 方法中，根据 `config.pipelineMode` 决定是否执行 TTS 合成：

```typescript
if (config.pipelineMode === 'full') {
  // 执行 TTS 合成（现有逻辑）
  // 使用合成音频 + 调整后的字幕
} else {
  // 跳过 TTS
  // 使用原始翻译结果作为字幕时间轴（不做 segmentTimings 调整）
}
```

### 步骤编号调整

仅字幕模式的步骤编号：
- 0: downloading
- 1: extracting
- 2: transcribing
- 3: translating
- 4: recombining（跳过 synthesizing）

## Factory 变更

`factories.ts` 根据 `pipelineMode` 选择 Combiner 策略：

```typescript
function createCombiner(config: AppConfig): CombinerStrategy {
  if (config.pipelineMode === 'subtitleOnly') {
    return new FfmpegSubtitleOnlyCombiner(config)
  }
  return new FfmpegCombiner(config)
}
```

## UI 变更

### 主界面模式切换

在「开始翻译」按钮旁添加模式切换组件：
- 两个按钮：「语音翻译」/「仅字幕」
- 当前选中状态高亮
- 切换时更新 `pipelineMode` 配置

### 进度条适配

- 仅字幕模式：不显示「语音合成」步骤
- 步骤标签根据模式动态调整

### 设置页

仅字幕模式下，「文字转语音」设置 tab 可以显示但标注"仅在语音翻译模式下生效"，或者直接不做变化（设置页是全局配置，不受当前模式影响）。

## i18n

新增键：
- `pipeline.mode`: 翻译模式 / Translation Mode
- `pipeline.modeFull`: 语音翻译 / Voice Translation
- `pipeline.modeSubtitleOnly`: 仅字幕 / Subtitle Only
- `pipeline.modeFullHelp`: 翻译语音并替换音轨 / Translate voice and replace audio track
- `pipeline.modeSubtitleOnlyHelp`: 保留原始音频，仅添加双语字幕 / Keep original audio, add bilingual subtitles only

## 缓存策略

- 仅字幕模式的缓存与语音翻译模式共享 transcription 和 translation 缓存
- TTS 缓存不受影响（仅字幕模式不产生也不读取 TTS 缓存）
- Combine 输出不缓存（现有行为就是每次重新生成）

## 输出文件命名

- 语音翻译模式：`{title}_translated.mp4`（现有）
- 仅字幕模式：`{title}_subtitled.mp4`

## 不做的事情

- 不导出独立字幕文件（仅烧录到视频）
- 不修改设置页 TTS tab 的可见性
- 不修改翻译历史的存储格式

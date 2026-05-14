# Pipeline 节点数据传递规范与插件化架构设计

## 问题陈述

当前 pipeline 的 6 个节点之间缺少正式的数据传递契约：

- 各服务函数签名随意，没有统一的接口抽象
- `Segment` 的 `speaker` 字段可选，导致下游节点需要防御式处理
- `TranslatedSegment` 中 `text`/`en`/`cn` 字段冗余且硬编码语言
- `AppConfig` 作为整体传入每个服务，职责耦合
- 新增实现（如换一个 ASR 引擎）需要修改 pipeline 编排器和工厂逻辑

## 方案

采用**接口分层策略模式**：

1. 定义标准化的节点间数据类型（契约）
2. 每个节点类型定义策略接口，各实现作为具体策略
3. 工厂函数根据配置实例化策略，编排器只依赖接口
4. 配置按职责拆分，策略实例在创建时注入所需配置

---

## 1. 核心数据类型

### 1.1 ASR 转录

```typescript
/** 单个转录片段 */
interface TranscriptSegment {
  /** 开始时间（秒） */
  start: number
  /** 结束时间（秒） */
  end: number
  /** 识别出的源语言文本 */
  text: string
  /** 说话人标识，如 "SPEAKER_0"。不支持 diarize 的引擎统一返回 "SPEAKER_0" */
  speaker: string
  /** 可选的识别置信度 (0-1) */
  confidence?: number
}

/** ASR 节点完整输出 */
interface TranscriptionResult {
  /** 检测到/指定的源语言代码，如 'en' */
  language: string
  /** 转录片段列表，按时间顺序排列 */
  segments: TranscriptSegment[]
}
```

### 1.2 翻译

```typescript
/** 单个翻译片段 */
interface TranslatedSegment {
  /** 开始时间（秒），透传自 TranscriptSegment */
  start: number
  /** 结束时间（秒），透传自 TranscriptSegment */
  end: number
  /** 原文 */
  sourceText: string
  /** 译文 */
  targetText: string
  /** 说话人标识，透传自 TranscriptSegment */
  speaker: string
}

/** 翻译节点完整输出 */
interface TranslationResult {
  /** 源语言代码，如 'en' */
  sourceLanguage: string
  /** 目标语言代码，如 'zh' */
  targetLanguage: string
  /** 翻译片段列表，保持与输入相同的顺序 */
  segments: TranslatedSegment[]
}
```

### 1.3 其他节点

```typescript
/** 下载节点输出 */
interface DownloadResult {
  /** 下载的视频文件路径 */
  videoPath: string
  /** 视频标题 */
  title: string
}

/** 音频提取节点输出 */
interface AudioResult {
  /** 提取的音频文件路径 */
  audioPath: string
}

/** TTS 合成节点输出 */
interface SynthesisResult {
  /** 合成的音频文件路径 */
  audioPath: string
}

/** 视频合成节点输出 */
interface CombineResult {
  /** 最终输出的视频文件路径 */
  outputPath: string
}
```

---

## 2. 策略接口

每个节点类型定义一个策略接口。策略实例在创建时通过构造函数/闭包注入所需配置，运行时方法签名只包含数据参数。

### 2.1 下载策略

```typescript
interface DownloaderStrategy {
  readonly name: string
  download(input: {
    url: string
    outputDir: string
    onProgress: (pct: number) => void
  }): Promise<DownloadResult>
}
```

**现有实现：** `yt-dlp`

### 2.2 音频提取策略

```typescript
interface AudioExtractorStrategy {
  readonly name: string
  extract(input: {
    videoPath: string
    outputDir: string
    onProgress: (pct: number) => void
  }): Promise<AudioResult>
}
```

**现有实现：** `ffmpeg`

### 2.3 转录策略

```typescript
interface TranscriberStrategy {
  readonly name: string
  transcribe(input: {
    audioPath: string
  }): Promise<TranscriptionResult>
}
```

**现有实现：** `openai-whisper`, `local-api`, `local-cli`, `whisperx`

### 2.4 翻译策略

```typescript
interface TranslatorStrategy {
  readonly name: string
  translate(input: {
    segments: TranscriptSegment[]
    sourceLanguage: string
    targetLanguage: string
  }): Promise<TranslationResult>
}
```

**现有实现：** `openai`, `deepseek`, `glm`

### 2.5 TTS 合成策略

```typescript
interface SynthesizerStrategy {
  readonly name: string
  synthesize(input: {
    segments: TranslatedSegment[]
    workDir: string
    speakers: string[]
    onProgress: (pct: number) => void
  }): Promise<SynthesisResult>
}
```

**现有实现：** `edge-tts`, `openai-tts`, `indextts`

`speakers` 参数为去重后的说话人列表（从 segments 中提取），TTS 实现内部按首次出现顺序从音色池分配声音。

### 2.6 视频合成策略

```typescript
interface CombinerStrategy {
  readonly name: string
  combine(input: {
    videoPath: string
    audioPath: string
    subtitlePath: string
    outputPath: string
    onProgress: (pct: number) => void
  }): Promise<CombineResult>
}
```

**现有实现：** `ffmpeg`

---

## 3. 配置模型与工厂函数

### 3.1 配置注入原则

- `AppConfig` 仍作为全局配置结构保留
- 工厂函数从 `AppConfig` 中提取各策略需要的子集，在创建策略实例时注入
- 策略的运行时方法不接收任何配置参数
- 网络代理配置（`ProxyConfig`）作为共享配置传入多个策略

```typescript
interface ProxyConfig {
  enabled: boolean
  url: string
}
```

### 3.2 工厂函数

```typescript
function createDownloader(config: AppConfig): DownloaderStrategy
function createAudioExtractor(config: AppConfig): AudioExtractorStrategy
function createTranscriber(config: AppConfig): TranscriberStrategy
function createTranslator(config: AppConfig): TranslatorStrategy
function createSynthesizer(config: AppConfig): SynthesizerStrategy
function createCombiner(config: AppConfig): CombinerStrategy
```

每个工厂函数根据对应的 `mode` 字段（如 `config.transcribeMode`）选择具体实现类，并注入该实现需要的配置子集。

### 3.3 策略集合

```typescript
interface PipelineStrategies {
  downloader: DownloaderStrategy
  extractor: AudioExtractorStrategy
  transcriber: TranscriberStrategy
  translator: TranslatorStrategy
  synthesizer: SynthesizerStrategy
  combiner: CombinerStrategy
}

function createPipelineStrategies(config: AppConfig): PipelineStrategies {
  return {
    downloader: createDownloader(config),
    extractor: createAudioExtractor(config),
    transcriber: createTranscriber(config),
    translator: createTranslator(config),
    synthesizer: createSynthesizer(config),
    combiner: createCombiner(config),
  }
}
```

---

## 4. Pipeline 编排器

编排器只依赖 `PipelineStrategies` 接口，不导入任何具体实现模块。

```typescript
class PipelineOrchestrator {
  private strategies: PipelineStrategies
  private targetLanguage: string  // 目标语言，来自 AppConfig

  constructor(strategies: PipelineStrategies, targetLanguage: string) {
    this.strategies = strategies
    this.targetLanguage = targetLanguage
  }

  async start(url: string, outputDir: string): Promise<void> {
    const workDir = path.join(outputDir, '.tmp', getVideoStorageKey(url))

    // Step 1: Download
    const download = await this.runStep('downloading', 0, (onProgress) =>
      this.strategies.downloader.download({ url, outputDir, onProgress })
    )

    // Step 2: Extract audio
    const audio = await this.runStep('extracting', 1, (onProgress) =>
      this.strategies.extractor.extract({
        videoPath: download.videoPath, outputDir: workDir, onProgress
      })
    )

    // Step 3: Transcribe
    const transcription = await this.runStep('transcribing', 2, async () =>
      this.strategies.transcriber.transcribe({ audioPath: audio.audioPath })
    )

    // Step 4: Translate
    const translation = await this.runStep('translating', 3, async () =>
      this.strategies.translator.translate({
        segments: transcription.segments,
        sourceLanguage: transcription.language,
        targetLanguage: this.targetLanguage,
      })
    )

    // Step 5: Synthesize TTS
    const speakers = [...new Set(translation.segments.map(s => s.speaker))]
    const synthesis = await this.runStep('synthesizing', 4, (onProgress) =>
      this.strategies.synthesizer.synthesize({
        segments: translation.segments, workDir, speakers, onProgress
      })
    )

    // Step 6: Generate subtitles & Recombine
    const subtitlePath = path.join(workDir, 'subtitles.ass')
    const finalOutputPath = path.join(outputDir, `${sanitize(download.title)}_translated.mp4`)
    const result = await this.runStep('recombining', 5, (onProgress) =>
      this.strategies.combiner.combine({
        videoPath: download.videoPath,
        audioPath: synthesis.audioPath,
        subtitlePath,
        outputPath: finalOutputPath,
        onProgress,
      })
    )
  }
}
```

缓存逻辑保留在编排器中，因为缓存是编排关注点，不属于各策略的职责。`runStep`、进度计算、取消机制等辅助逻辑沿用现有编排器的模式。

---

## 5. 说话人→音色映射

### 5.1 映射规则

- 每个 TTS 策略实现内部维护一个 `Map<string, string>`（speaker → voice）
- 按说话人在 segments 中首次出现的顺序，依次从音色池分配
- 单说话人场景（仅 `SPEAKER_0`）始终使用默认音色
- 音色池溢出时回绕（取模）

### 5.2 各引擎音色池

| 引擎 | 音色池 |
|------|--------|
| Edge TTS | `zh-CN-YunxiNeural`, `zh-CN-XiaoxiaoNeural`, `zh-CN-YunjianNeural`, `zh-CN-XiaoyiNeural`, `zh-CN-YunyangNeural`, `zh-CN-XiaozhenNeural` |
| OpenAI TTS | `alloy`, `nova`, `echo`, `shimmer`, `fable`, `onyx` |
| IndexTTS | 通过 reference_audio 配置（单一音色） |

---

## 6. 字幕生成适配

`generateAss` 函数签名调整为接收 `TranslationResult`：

```typescript
function generateAss(
  translation: TranslationResult,
  style: SubtitleStyle,
  videoWidth: number,
  videoHeight: number,
): string
```

字幕样式名从硬编码的 `'English'`/`'Chinese'` 改为基于 `sourceLanguage`/`targetLanguage` 动态生成。

---

## 7. 文件结构

```
electron/services/
├── types.ts                    # 核心数据类型 + 策略接口
├── pipeline.ts                 # 编排器（只依赖策略接口）
├── factories.ts                # 工厂函数集合
├── strategies/
│   ├── downloaders/
│   │   └── yt-dlp.ts
│   ├── extractors/
│   │   └── ffmpeg.ts
│   ├── transcribers/
│   │   ├── openai-whisper.ts
│   │   ├── local-api.ts
│   │   ├── local-cli.ts
│   │   └── whisperx.ts
│   ├── translators/
│   │   ├── openai.ts
│   │   ├── deepseek.ts
│   │   └── glm.ts
│   ├── synthesizers/
│   │   ├── edge-tts.ts
│   │   ├── openai-tts.ts
│   │   └── indextts.ts
│   └── combiners/
│       └── ffmpeg.ts
├── subtitle.ts                 # 字幕生成（纯函数）
├── config.ts                   # 配置管理
└── video-key.ts                # 视频 URL 哈希
```

---

## 8. 前端类型同步

前端 `src/types.ts` 中的 `PipelineState` 需要同步更新：

- `translatedSegments` 字段类型从旧 `TranslatedSegment[]` 改为新的 `TranslatedSegment[]`
- 前端展示字幕预览时使用 `sourceText`/`targetText` 而非 `en`/`cn`

---

## 9. 向后兼容

- 磁盘上已有的 JSON 缓存文件使用旧的 `en`/`cn` 字段名，需要在缓存读取时做迁移兼容（检测旧字段名并映射到新字段）
- `AppConfig` 结构保持不变，工厂函数内部消费

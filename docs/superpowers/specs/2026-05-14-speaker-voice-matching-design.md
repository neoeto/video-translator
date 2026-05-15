# 说话人性别标注 & 语音匹配设计

## 概述

在 STT 转写完成后，暂停 pipeline 展示标注界面，让用户为每个识别到的说话人标注性别/年龄类型，并自动提取每个说话人的语音样本。后续 TTS 根据标注结果选择对应性别/年龄的音色，IndexTTS 则使用提取的语音样本作为参考音频进行声音克隆。

## 数据类型

```typescript
type SpeakerGender = 'adult-male' | 'adult-female' | 'child-male' | 'child-female'

interface SpeakerProfile {
  id: string              // 说话人标识，如 "SPEAKER_0"
  gender: SpeakerGender   // 用户标注的性别/年龄
  samplePath: string      // 从源音频截取的语音样本文件路径
  sampleDataUrl?: string  // base64 data URL，供前端 <audio> 播放
}
```

新增 `PipelineStage`: `'awaiting-speaker-labels'` — 位于 `transcribing` 和 `translating` 之间。

## Pipeline 流程变更

### 完整流程（语音翻译模式）

```
Download → Extract → Transcribe → [提取语音样本] → awaiting-speaker-labels（暂停）
→ 用户标注 → Translate → TTS（使用 SpeakerProfile） → Combine
```

### 仅字幕模式

仅字幕模式不需要 TTS，因此跳过说话人标注环节：

```
Download → Extract → Transcribe → Translate → Combine
```

### 暂停/恢复机制

1. STT 完成后，pipeline 提取每个 speaker 的语音样本
2. Pipeline 将状态设为 `awaiting-speaker-labels`，并将 `SpeakerProfile[]`（含 sampleDataUrl，gender 字段为空）附加到 `PipelineState`
3. 前端 ProgressView 检测到此状态后，渲染标注 UI
4. 用户为每个 speaker 选择性别/年龄后点击"继续"
5. 前端通过 IPC 调用 `pipeline:submit-speaker-labels` 传回 `SpeakerProfile[]`
6. Pipeline 恢复执行后续步骤

## 语音样本提取

### 策略

对每个 speaker：
1. 从 STT 结果中找到该 speaker 所有 segments
2. 选取**最长的一段**（但不超过 10 秒）
3. 用 ffmpeg 从源音频文件中精确截取该时间段
4. 保存为 `.wav` 文件到工作目录

### 实现

```typescript
async function extractSpeakerSamples(
  audioPath: string,
  segments: TranscriptSegment[],
  workDir: string
): Promise<SpeakerProfile[]>
```

- 使用 `ffmpeg -ss <start> -t <duration> -i audio.wav -c copy speaker_X_sample.wav`
- 如果最长段超过 10 秒，只截取前 10 秒
- 生成 base64 data URL 用于前端播放

## TTS 音色匹配

### Edge TTS 音色映射

| SpeakerGender | Voice |
|---|---|
| adult-male | zh-CN-YunxiNeural |
| adult-female | zh-CN-XiaoxiaoNeural |
| child-male | zh-CN-YunyangNeural |
| child-female | zh-CN-XiaoyiNeural |

各 speaker 从对应性别的声音池中按序选择（如果同性别多人，轮换不同音色）。

扩展音色池：
- adult-male: YunxiNeural, YunjianNeural, YunyangNeural
- adult-female: XiaoxiaoNeural, XiaoyiNeural, XiaozhenNeural
- child-male: YunyangNeural (少年感)
- child-female: XiaoyiNeural (年轻感)

### OpenAI TTS 音色映射

| SpeakerGender | Voice Pool |
|---|---|
| adult-male | echo, onyx |
| adult-female | nova, shimmer |
| child-male | fable |
| child-female | alloy |

### IndexTTS 音色映射

IndexTTS 使用声音克隆，直接使用该 speaker 的 `samplePath` 作为 `reference_audio` 参数。每个 speaker 使用自己的语音样本，天然实现多说话人不同音色。

## PipelineState 扩展

```typescript
interface PipelineState {
  // ... existing fields
  speakerProfiles?: SpeakerProfile[]  // STT 后附带，供前端标注
}
```

## IPC 新增

- `pipeline:submit-speaker-labels` — 前端提交标注结果，pipeline 恢复

## 前端 UI

### ProgressView 标注区域

当 `state.stage === 'awaiting-speaker-labels'` 时，在进度条下方显示：

```
┌─────────────────────────────────────────┐
│  🎤 请标注说话人信息                      │
│                                         │
│  SPEAKER_0  [▶ 播放]  ○成年男 ○成年女 ○未成年男 ○未成年女  │
│  SPEAKER_1  [▶ 播放]  ○成年男 ○成年女 ○未成年男 ○未成年女  │
│  SPEAKER_2  [▶ 播放]  ○成年男 ○成年女 ○未成年男 ○未成年女  │
│                                         │
│                    [继续翻译]             │
└─────────────────────────────────────────┘
```

- 每行一个 speaker，显示 speaker ID
- `<audio>` 元素 + 播放按钮，播放该 speaker 的语音样本
- 4 个 radio button 选择性别/年龄
- "继续翻译" 按钮：所有 speaker 都已标注后才可点击

## i18n

新增键：
- `progress.speakerLabeling.title`: 请标注说话人信息 / Label Speaker Information
- `progress.speakerLabeling.play`: 播放 / Play
- `progress.speakerLabeling.adultMale`: 成年男 / Adult Male
- `progress.speakerLabeling.adultFemale`: 成年女 / Adult Female
- `progress.speakerLabeling.childMale`: 未成年男 / Young Male
- `progress.speakerLabeling.childFemale`: 未成年女 / Young Female
- `progress.speakerLabeling.continue`: 继续翻译 / Continue Translation

## SynthesizerStrategy 接口变更

`synthesize` 输入新增 `speakerProfiles`:

```typescript
interface SynthesizerStrategy {
  synthesize(input: {
    segments: TranslatedSegment[]
    workDir: string
    speakers: string[]
    speakerProfiles: SpeakerProfile[]  // 新增
    onProgress: (pct: number) => void
    signal?: AbortSignal
    syncMode?: SyncMode
  }): Promise<SynthesisResult>
}
```

各 TTS 策略根据 `speakerProfiles` 为每个 speaker 选择对应音色：
- Edge TTS: 根据 gender 从对应音色池选取
- OpenAI TTS: 根据 gender 从对应音色池选取
- IndexTTS: 使用 `profile.samplePath` 作为 `reference_audio`

## 缓存策略

- 语音样本文件缓存在工作目录，STT 缓存命中时不重新提取（样本依赖转写结果）
- TTS 缓存指纹需包含 speakerProfiles（性别标注变更需重新合成）
- 标注结果持久化到工作目录 `speaker-profiles.json`，下次同视频可复用

## 不做的事情

- 不做自动性别识别
- 不支持用户上传自定义参考音频替换自动截取的样本
- 仅字幕模式不做说话人标注（无 TTS 需求）

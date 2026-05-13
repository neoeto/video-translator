# TTS 提供商调研报告

> 调研时间: 2026-05-13
> 项目: VidiTranslate (video-translator)
> 当前支持: Edge TTS (免费) + OpenAI TTS

---

## 一、当前架构

### 已支持 TTS

| TTS 模式 | 实现方式 | 语音 | 语速调整 |
|---|---|---|---|
| **Edge TTS** (默认) | CLI 命令行调用 `edge-tts` | `zh-CN-YunxiNeural` | 支持 rate±50% |
| **OpenAI TTS** | OpenAI SDK (`tts-1`, `alloy`) | 固定 alloy | 不支持 |

### 架构特点

- `TtsMode` 类型 = `'edge' | 'openai'`（`electron/services/types.ts` + `src/types.ts`）
- TTS 调用在 `electron/services/tts.ts` 中，通过 `config.ttsMode` 分支
- Edge TTS 有语速自适应（先合成，探测时长，再按比例调速重合成）
- OpenAI TTS 仅合成，无调速
- 两者都输出 MP3，后续用 ffmpeg 拼接

---

## 二、云 API TTS 提供商

### 第一梯队 — 强烈推荐

| # | 提供商 | 类型 | 中文 | 英文 | 价格 | Node.js SDK | 流式 | 特色 |
|---|---|---|---|---|---|---|---|---|
| 1 | **Fish Audio** | 云 API | 30+ 语言 | ✅ | $15/M UTF-8 bytes | `fish-audio` npm | WebSocket | 声音克隆、语速控制、prosody |
| 2 | **Google Cloud TTS** | 云 API | 380+ 声音/50+ 语言 | ✅ | $4(标准)/$16(WaveNet) 每1M字符 | `@google-cloud/text-to-speech` | ✅ | WaveNet 高质量、最广泛语言覆盖 |
| 3 | **Kokoro TTS** | 本地/开源 | 有限(8语言) | ✅ | **免费** (本地推理) | `kokoro-js` npm | ✅ | 82M 参数轻量模型，可浏览器/Node 本地运行 |

### 第二梯队 — 按需推荐

| # | 提供商 | 类型 | 中文 | 英文 | 价格 | Node.js SDK | 流式 | 特色 |
|---|---|---|---|---|---|---|---|---|
| 4 | **ElevenLabs** | 云 API | 32语言 | ✅ | $120-165/M字符(贵) | `elevenlabs` npm | WebSocket | 最高音质(MOS 4.3)、声音克隆 |
| 5 | **Azure TTS** | 云 API | 140+语言/400+声音 | ✅ | 免费500K/月，$16/M神经 | `microsoft-cognitiveservices-speech-sdk` | ✅ | 最多语言覆盖、企业级 |
| 6 | **Amazon Polly** | 云 API | 40+语言 | ✅ | $4(标准)/$16(神经) | `@aws-sdk/client-polly` | ✅ | AWS 生态、可靠 |
| 7 | **Volcengine/火山引擎** | 云 API | 优秀 | ✅ | 按量计费 | REST API | ✅ | 字节跳动、中文优化 |

### 第三梯队 — 特殊场景

| # | 提供商 | 类型 | 中文 | 英文 | 价格 | Node.js 集成 | 特色 |
|---|---|---|---|---|---|---|---|
| 8 | **ChatTTS** | 本地/开源 | 10万小时中文训练 | ✅ | 免费 | Python only，需 HTTP 包装 | 对话场景优化、笑声/停顿控制 |
| 9 | **阿里云 CosyVoice** | 云 API | 优秀 | ✅ | 按量 | REST API | 阿里达摩院、声音克隆 |
| 10 | **腾讯云 TTS** | 云 API | 优秀 | ✅ | 按量 | `tencentcloud-sdk-node` | 声音克隆 |

### 云 API 详细分析

#### Fish Audio

```
npm install fish-audio
```

- 官方 Node.js SDK，声音克隆和语速控制原生支持
- `prosody: { speed: 1.2 }` 语速控制 0.5-2.0
- 大量预设声音 + 用户自定义声音克隆
- 价格: $15/M UTF-8 bytes (~$0.08/千字)

#### Google Cloud TTS

- 语言覆盖最广: 380+ 声音，50+ 语言
- WaveNet 音质接近人声
- 免费额度: 标准 1M 字符/月，WaveNet 1M 字符/月
- 无声音克隆

#### Kokoro TTS (本地/免费)

```
npm install kokoro-js
```

- 完全免费，本地运行，npm 包直接可用
- 82M 参数，CPU 可实时推理
- 中文支持有限（8 种语言），声音质量不如云 API
- 唯一零 Python 依赖的本地方案

---

## 三、可本地部署的 TTS 实现

### 综合对比总览

| 模型 | Stars | 参数量 | 中文 | 英文 | 声音克隆 | GPU 必须 | 语速控制 | 协议 | Node.js 集成方式 |
|---|---|---|---|---|---|---|---|---|---|
| **IndexTTS-2** | 20K | ~1.5B | 优秀 | 优秀 | 3-10s 零样本 | 推荐 | 时长可控 | Apache 2.0 | HTTP API (需自建) |
| **CosyVoice 3** | 20.7K | 0.5B | 9语言+18方言 | ✅ | 3s 克隆 | 推荐 | ✅ | Apache 2.0 | FastAPI/gRPC 服务 |
| **GPT-SoVITS** | ~40K | ~300M | 优秀 | 日/韩/粤 | 5-10min 微调 | 推荐 | speed_factor | MIT | FastAPI (端口9880) |
| **F5-TTS** | ~15K | 335M | 中英 | 多语言 | 零样本 | 推荐 | 有限 | MIT | CLI / Docker |
| **Spark-TTS** | ~8K | 0.5B | 中英 | ✅ | 零样本+跨语言 | 推荐 | 可控 | Apache 2.0 | CLI / Triton Serving |
| **Kokoro** | ~10K | 82M | 有限 | 优秀 | 无 | 否(CPU可跑) | ✅ | Apache 2.0 | `kokoro-js` npm 包 |
| **MeloTTS** | 7.4K | ~100M | 中英混合 | 6语言 | 无 | 否(CPU可跑) | 有限 | MIT | CLI / sherpa-onnx |
| **ChatTTS** | ~35K | 未公开 | 10万小时训练 | ✅ | 无 | 推荐 | 有限 | AGPL-3.0 | Python only |
| **Piper** | 4K | ~20M/voice | 普通话 | 30+语言 | 无 | 否(CPU可跑) | length_scale | GPL-3.0 | CLI 二进制 |
| **Fish Speech** | ~20K | 500M-4B | ✅ | 8语言 | 10-30s | 推荐 | prosody | Apache 2.0 | 自建 API / 云 |

### 本地 TTS 详细分析

#### 1. IndexTTS-2 (已集成)

**来源**: B站 (bilibili) IndexTeam
**Star**: 20K+
**最新版本**: IndexTTS-2 (2025/09)

**核心亮点**:
- 工业级零样本 TTS: 提供一段 3-10 秒参考音频即可克隆声音
- 情感可控: 支持 8 维情感向量 (高兴/悲伤/愤怒/中性等)
- 时长可控: 首个支持精确合成时长控制的 AR TTS 模型
- 拼音修正: 中文多音字可通过拼音覆盖纠正
- BigVGAN2 声码器: 音质 SOTA

**性能**:
- GPU (RTX 3060): 10s 文本 ≈ 0.5s 合成，RTF ≈ 0.02
- CPU 可用但慢 5x 左右
- 模型大小: ~300MB (checkpoints)

**部署方式**:
```bash
git clone https://github.com/index-tts/index-tts.git && cd index-tts
uv sync --all-extras
hf download IndexTeam/IndexTTS-2 --local-dir=checkpoints

# 自建 FastAPI 服务后，Electron 通过 HTTP 调用
```

#### 2. CosyVoice 3

**来源**: 阿里达摩院 FunAudioLLM
**Star**: 20.7K

**核心亮点**:
- 9 种语言 + 18+ 中文方言（粤语、闽南、川话、东北话等）
- 双流式: 文本输入流 + 音频输出流，延迟 150ms
- 零样本克隆: 3 秒参考音频，跨语言克隆
- Docker 部署 + FastAPI/gRPC 服务
- TensorRT-LLM 加速 (4x)

#### 3. GPT-SoVITS

**来源**: RVC-Boss 开源社区
**Star**: ~40K (TTS 领域最高)

**核心亮点**:
- 极低资源声音克隆: 5-10 分钟参考音频微调
- 多语言: 中文、英文、日文、韩文、粤语
- 内置 FastAPI 服务 (端口 9880)，speed_factor 语速控制
- 社区活跃，预设模型最多

**API 调用示例**:
```bash
python api_v2.py -a 127.0.0.1 -p 9880
# GET /tts?text=你好&text_lang=zh&ref_audio_path=ref.wav&speed_factor=1.0
```

#### 4. F5-TTS

**来源**: 上海人工智能实验室
**Star**: ~15K

- Flow Matching 架构，非自回归，推理速度快
- 零样本克隆，10万+小时多语言数据训练
- 官方 Docker image，Triton + TensorRT-LLM 加速
- 偶尔会"幻觉"（多字/漏字），长文本不如 StyleTTS 稳定

#### 5. Spark-TTS

**来源**: SparkAudio
**Star**: ~8K

- 基于 Qwen2.5，纯 LLM 架构
- 可控语音生成: 性别、音高、语速参数化控制
- 零样本 + 跨语言克隆
- Triton 推理服务

#### 6. Kokoro (轻量首选)

**来源**: Hexgrad
**参数**: 82M (最小)

- 超轻量，CPU 实时，Apache 2.0
- `kokoro-js` npm 包 — 唯一纯 Node.js 方案
- MOS 4.5，英文质量极好
- 中文支持有限，无声音克隆

#### 7. MeloTTS

**来源**: MyShell.ai + MIT
**参数**: ~100M

- CPU 实时推理，6 种语言 (EN/ES/FR/ZH/JP/KR)
- 中英混合支持
- 推荐: 通过 sherpa-onnx 使用 (ONNX 推理)

#### 8. Piper

**来源**: Open Home Foundation

- C++ 实现，极致轻量 (~20M/voice)
- CLI 二进制，与 edge-tts 调用模式一致
- 30+ 语言含中文，CPU 实时
- 中文声音质量一般

---

## 四、推荐集成优先级

| 优先级 | TTS 方案 | 集成方式 | 理由 |
|---|---|---|---|
| P0 | **IndexTTS-2** | HTTP API (FastAPI) | 中文音质顶级，时长精确控制，声音克隆 |
| P0 | **Kokoro** | `npm install kokoro-js` | 唯一纯 Node.js 方案，零 Python 依赖 |
| P0 | **GPT-SoVITS** | HTTP API (端口9880) | API 最完善，社区预设丰富 |
| P1 | **Fish Audio** | `fish-audio` npm | 最佳性价比云 API |
| P1 | **CosyVoice 3** | Docker + FastAPI/gRPC | 方言支持独特 |
| P2 | **Piper** | CLI spawn | 集成方式与现有代码最接近 |
| P2 | **MeloTTS** | CLI / sherpa-onnx | CPU 友好，轻量 |

---

## 五、MOS 音质排名 (2026 参考)

| 排名 | 模型 | 类型 | MOS | 备注 |
|---|---|---|---|---|
| 1 | ElevenLabs Turbo v2.5 | 云 API | 4.8 | 最高音质 |
| 2 | Sesame CSM | 开源 | 4.7 | |
| 3 | OpenAI TTS HD | 云 API | 4.7 | |
| 4 | Kokoro v1.0 | 开源 | 4.5 | 82M 参数最高性价比 |
| 5 | Fish Speech 1.5 | 开源 | 4.4 | |
| 6 | F5-TTS | 开源 | 4.4 | |
| 7 | Spark-TTS | 开源 | 4.3 | |
| 8 | Piper | 开源 | 3.6 | 轻量但有差距 |

---

## 六、云 API 定价对比

| 提供商 | 价格/1M字符 | 免费额度 | 备注 |
|---|---|---|---|
| Google Standard | $4 | 1M 字符/月 | 最便宜标准音质 |
| Amazon Standard | $4 | 5M/月(12个月) | |
| Google WaveNet | $16 | 1M 字符/月 | 高质量神经音 |
| Amazon Neural | $16 | 5M/月(12个月) | |
| Azure Neural | $16 | 500K/月 | 最多语言 |
| OpenAI TTS | $15 | $5 credit | 简单好用 |
| Fish Audio | $15/M bytes | 按量 | 声音克隆 |
| ElevenLabs | $120-165 | 10K/月 | 最贵最高质 |
| Kokoro | **免费** | N/A | 本地运行 |
| IndexTTS-2 | **免费** | N/A | 本地运行 |

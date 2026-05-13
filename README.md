# VidiTranslate

YouTube 视频翻译桌面应用。粘贴链接，自动完成下载、语音转录、翻译、语音合成和视频合成，生成带中英双语字幕的翻译视频。

## 功能

- **视频下载** — 输入 YouTube 链接，自动下载视频和音频
- **语音转录** — 支持 OpenAI Whisper API、本地 Whisper API 服务、本地 Whisper CLI 三种模式
- **文本翻译** — 支持 OpenAI (GPT-4o)、DeepSeek、GLM 智谱 多个 LLM 服务商
- **语音合成** — 支持 Edge TTS（免费）和 OpenAI TTS
- **视频合成** — 自动生成 ASS 字幕并合成最终视频，带中英双语字幕
- **断点缓存** — 每个处理阶段的结果都会缓存，中断后重新运行可跳过已完成步骤
- **多语言界面** — 支持中文 / English 切换，语言偏好自动保存
- **网络代理** — 内置代理设置，支持需要代理的网络环境

## 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Electron + React 19 |
| 构建 | electron-vite + Vite 7 |
| 样式 | Tailwind CSS v4 |
| 状态管理 | Zustand |
| 语言 | TypeScript |
| 音视频处理 | FFmpeg (fluent-ffmpeg + ffmpeg-static) |
| 配置存储 | electron-store |

## 项目结构

```
├── electron/                  # Electron 主进程
│   ├── main.ts                # 应用入口，窗口创建，IPC 注册
│   ├── preload.ts             # 预加载脚本，暴露安全 API
│   └── services/              # 后端服务
│       ├── pipeline.ts        # 流水线编排器（6 步骤）
│       ├── config.ts          # 配置管理（electron-store）
│       ├── downloader.ts      # YouTube 视频下载
│       ├── audio.ts           # 音频提取
│       ├── transcriber.ts     # 语音转录
│       ├── translator.ts      # 文本翻译
│       ├── tts.ts             # 语音合成
│       ├── subtitle.ts        # ASS 字幕生成
│       ├── combiner.ts        # 视频合成（替换音轨 + 烧录字幕）
│       ├── types.ts           # 共享类型定义
│       └── video-key.ts       # 视频 URL 哈希键
├── src/                       # React 渲染进程
│   ├── main.tsx               # React 入口
│   ├── App.tsx                # 应用根组件
│   ├── types.ts               # 前端类型定义
│   ├── preload.d.ts           # electronAPI 类型声明
│   ├── index.css              # Tailwind + 设计系统 Token
│   ├── store/
│   │   └── usePipelineStore.ts # Zustand 全局状态
│   ├── i18n/                  # 国际化
│   │   ├── index.ts           # useI18n store (t / setLocale)
│   │   └── locales/
│   │       ├── en.ts          # 英文翻译
│   │       └── zh.ts          # 中文翻译
│   └── components/
│       ├── InputView.tsx       # 首页：输入 YouTube 链接
│       ├── ProgressView.tsx    # 处理进度面板
│       ├── ResultView.tsx      # 视频库 / 结果展示
│       ├── SettingsView.tsx    # 设置页（AI 服务 / 翻译 / TTS / 系统）
│       ├── SideNavBar.tsx      # 侧边导航栏
│       └── TopAppBar.tsx       # 顶部栏（含语言切换）
├── resources/
│   └── icon.png               # 应用图标
├── index.html                 # HTML 入口
├── electron.vite.config.ts    # electron-vite 构建配置
└── package.json
```

## 处理流水线

```
YouTube URL
    │
    ▼
[1] Download ──── 下载视频到本地工作目录
    │
    ▼
[2] Extract ───── 提取音频为 WAV 格式
    │
    ▼
[3] Transcribe ── 语音转文字，生成时间戳片段
    │
    ▼
[4] Translate ─── 调用 LLM 翻译为中文
    │
    ▼
[5] Synthesize ── 中文文本转语音
    │
    ▼
[6] Recombine ─── 替换音轨 + 烧录双语字幕 → 最终 MP4
```

每个步骤的结果会以 JSON 缓存到工作目录（`.tmp/<video-hash>/`），基于文件指纹做缓存校验。如果中途失败或取消，重新运行时会自动跳过已缓存的有效结果。

## 快速开始

### 环境要求

- Node.js >= 18
- Python 3.8+（仅在使用本地 Whisper CLI 模式时需要）

### 安装

```bash
# 克隆仓库
git clone <repo-url>
cd video-translator

# 安装依赖
npm install
```

### 开发

```bash
npm run dev
```

### 构建

```bash
npm run build
```

构建产物输出到 `out/` 目录。

### 预览构建产物

```bash
npm run preview
```

## 配置说明

首次启动后，进入 **Settings** 页面配置以下内容：

| 配置项 | 说明 |
|--------|------|
| Transcription Engine | 转录引擎：OpenAI Whisper API / 本地 API Server / 本地 CLI |
| API Key | 对应服务的 API 密钥 |
| Translation Model | 翻译 LLM：OpenAI / DeepSeek / GLM 智谱 |
| TTS Engine | 语音合成：Edge TTS（免费）/ OpenAI TTS |
| Working Directory | 工作目录，存放临时文件和导出视频 |
| Network Proxy | 网络代理开关和地址 |

所有配置通过 `electron-store` 加密存储在本地。

## License

Private

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

### Phase 1 Video Tool

侧边栏新增独立的 **Video Tool**。可选择 YouTube、Bilibili 或本地视频作为输入：网络来源仅负责下载，本地文件会复制到 `outputDir/projects/<projectId>` 下的自包含项目目录。Video Tool 的项目编辑器与翻译流程中的人工复核编辑器相互独立。

项目编辑器提供预览和时间线，以及分割、删除、裁剪、重排、撤销/重做和自动保存。音频工具面板还提供普通音频提取，以及独立的 **按 speaker 导出音频** 操作：使用本地 WhisperX 做说话人分离标注，按每位 speaker 的识别片段时间顺序拼接，分别生成 WAV/MP3/M4A 项目音频资产。还支持截取 PNG/JPEG 帧，并按原始分辨率或 1080p、720p、480p 渲染 MP4。

项目媒体通过主进程 IPC 和 FFmpeg 处理；项目清单保存相对路径和时间线状态，避免依赖机器上的绝对路径。

使用流程：

1. 从侧边栏打开 **Video Tool**，选择 YouTube、Bilibili 或本地视频。
2. 等待网络视频下载或本地文件复制到项目目录。
3. 在独立项目编辑器中预览并编辑时间线，项目会自动保存。
4. 按需截取帧、提取音频，或在音频工具面板使用 **按 speaker 导出音频**；使用该操作前须配置 WhisperX 路径、token 和模型。选择输出分辨率后渲染 MP4。

Phase 1 暂不包含字幕、多音轨、代理、裁剪/旋转/变速等能力。**按 speaker 导出音频** 是基于本地 WhisperX 识别和说话人标注的独立导出功能；它不会保留原始时间线间隔，也不是声源分离或人声分离。

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

### Video Tool 结构

- **侧边栏入口**：`Video Tool` 作为独立的一等功能入口。
- **项目目录**：每个项目位于配置的 `outputDir/projects/<projectId>`，媒体文件与项目清单一起保存。
- **处理边界**：项目媒体操作经主进程 IPC 调用 FFmpeg；项目清单记录媒体相对路径和时间线状态。

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
- Python 3.8+（仅在使用本地 Whisper CLI 模式时需要；**按 speaker 导出音频** 还需要已配置的本地 WhisperX 路径、token 和模型）

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

### 发布桌面安装包

仓库提供 `.github/workflows/release.yml`，用于在 GitHub Actions 中构建并发布 macOS、Windows 和 Linux 安装包。

1. 打开仓库的 **Actions → Release desktop packages**。
2. 点击 **Run workflow**，在 `version` 中填写 SemVer 版本号，例如 `1.0.0`，不要加 `v` 前缀。
3. 等待三个平台的构建完成。Workflow 会创建 `v<version>` 标签和 GitHub Release，并将 DMG、NSIS EXE 和 AppImage 作为发行资产上传。

版本号只写入本次构建工作区，不会自动提交回仓库。Windows 构建会准备应用配置中声明的嵌入式 Python；macOS 和 Linux 构建会准备对应的可选资源目录。

## 配置说明

首次启动后，进入 **Settings** 页面配置以下内容：

| 配置项 | 说明 |
|--------|------|
| Transcription Engine | 转录引擎：OpenAI Whisper API / 本地 API Server / 本地 CLI |
| API Key | 对应服务的 API 密钥 |
| Translation Model | 翻译 LLM：OpenAI / DeepSeek / GLM 智谱 |
| TTS Engine | 语音合成：Edge TTS（免费）/ OpenAI TTS |
| Working Directory | 工作目录，存放临时文件和导出视频；Video Tool 使用其中配置的 `outputDir` 创建项目目录 |
| Network Proxy | 网络代理开关和地址 |

所有配置通过 `electron-store` 加密存储在本地。

## License

Private

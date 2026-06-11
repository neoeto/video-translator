## Context

当前 `dependency-manager.ts`（279 行）是整个依赖安装的唯一入口。它通过 `findPython()` 搜索系统 PATH 中的 Python，创建共享 venv，再用 pip 安装 yt-dlp、openai-whisper、whisperx、audio-separator[cpu]。整个流程存在 13 个已记录问题，核心痛点是：用户必须预装 Python、大包安装在国内几乎必然失败、安装失败后无恢复机制。

应用基于 Electron + React + TypeScript，使用 electron-vite 构建，electron-builder 打包。当前 `extraResources` 仅打包 icon.png。应用已有代理配置（`proxyEnabled`/`proxyUrl`/`proxyBypass`）和 HF 镜像配置（`hfMirrorEnabled`/`hfMirrorUrl`），但均未与依赖安装流程打通。

## Goals / Non-Goals

**Goals:**
- 消除用户预装 Python 的要求（内嵌 Python 3.11 embeddable）
- 保证依赖版本可复现（requirements.lock）
- 确保国内用户能正常安装（镜像多级降级 + PyTorch 镜像）
- 安装失败后能自动恢复（venv 清理 + 重试）
- 将用户配置的代理透传给 pip
- 展示真实的安装下载进度

**Non-Goals:**
- 大包断点续传（需自建 HTTP 下载层，成本过高，后续迭代）
- 模型文件预打包（whisper/whisperx 模型由库内部下载，改造需深入第三方库源码）
- Linux / macOS embeddable 支持（当前仅 Windows 有 embeddable 包；Linux/macOS 仍走系统 Python fallback）
- 用 uv/conda 替代 pip（变更过大，后续评估）
- 每个 dep 独立 venv（当前依赖量可控，共享 venv + 版本锁定足够）

## Decisions

### D1: 内嵌 Python embeddable package

**选择**: 在 electron-builder 打包阶段下载 Python 3.11 embeddable（~10MB），修改 `python311._pth` 启用 site-packages，安装 pip，将完整目录作为 `extraResources` 打包。

**替代方案**:
- PyInstaller/Nuitka 将每个 Python 工具编译为独立 exe → 体积巨大（每个 100MB+），维护困难
- 首次运行时下载 embeddable → 增加首次启动延迟和网络依赖
- uv 包管理器 → 需要额外分发 uv 二进制，且 whisperx 等复杂依赖兼容性未验证

**理由**: embeddable package 是 Python 官方提供的 Windows 分发方案，体积小（~10MB），与 pip/venv 完全兼容，打包时预初始化消除运行时开销。

### D2: requirements.lock 而非 DEP_REGISTRY 内硬编码版本

**选择**: 新增 `requirements.lock` 文件，包含所有直接和传递依赖的精确版本（`==`）。`DEP_REGISTRY` 保持语义化描述，`installMissingDeps` 改为 `pip install -r requirements.lock`。

**替代方案**:
- DEP_REGISTRY 的 `pipPackage` 字段直接写 `whisperx==3.1.1` → 混合描述和版本，不够清晰
- pip freeze 在用户机器上 → 版本不可控，不同用户可能得到不同版本

**理由**: 独立 lock 文件是 Python 生态的标准做法（pip-tools、Poetry 等均采用），可在 CI 中验证，更新时有明确的 diff。

### D3: 镜像三级降级链

**选择**: pip 安装按以下顺序尝试：
1. 清华 PyPI 镜像 (`pypi.tuna.tsinghua.edu.cn/simple`)
2. 阿里 PyPI 镜像 (`mirrors.aliyun.com/pypi/simple`)
3. 官方 PyPI (`pypi.org/simple`)

PyTorch 额外索引按以下顺序：
1. 上交 PyTorch 镜像 (`mirror.sjtu.edu.cn/pytorch-wheels/cpu`)
2. 官方 PyTorch (`download.pytorch.org/whl/cpu`)

**理由**: 清华和阿里是国内最稳定的两个 PyPI 镜像，互为备份；上交 PyTorch 镜像是国内唯一可靠的 PyTorch wheel 源。

### D4: pip --progress-bar json 进度解析

**选择**: 使用 pip 24.1+ 的 `--progress-bar json` 选项，解析 stderr 中的 JSON 进度行，转换为 `DepInstallProgress` 发送到前端。

**理由**: pip 内置的 JSON 进度输出是官方支持的接口，无需猜测 ANSI escape code 或文本格式。

### D5: 安装失败清理策略

**选择**: 单个依赖安装失败时，删除整个 venv 目录，从下一级镜像重试。所有镜像均失败后，删除 venv 并报错。

**理由**: 简单可靠。venv 是可重建的临时资源，脏状态下的增量修复比重建更不可靠。

### D6: 代理透传方式

**选择**: 从 `AppConfig` 读取 `proxyEnabled`/`proxyUrl`，若启用则在 `spawn` 时通过 `env` 选项注入 `HTTP_PROXY`/`HTTPS_PROXY` 环境变量。

**理由**: pip 原生支持 `HTTP_PROXY`/`HTTPS_PROXY` 环境变量，无需额外参数。应用已有代理配置 UI，只需在 `runCommand` 中透传。

## Risks / Trade-offs

**[embeddable Python + venv 兼容性]** → 在 embeddable Python 上需验证 `python -m venv` 是否正常工作。若不兼容，备选方案是直接用 embeddable Python 的 `site-packages` 目录（跳过 venv）。

**[requirements.lock 维护成本]** → 每次依赖升级需手动更新 lock 文件并全量测试。可通过 CI 脚本自动化验证。

**[pip --progress-bar json 格式稳定性]** → pip 的 JSON 输出格式未在文档中明确定义，不同 pip 版本可能有差异。需要锁定 pip 版本并做充分的解析测试。

**[安装包体积增加 ~10MB]** → Python embeddable 增加约 10MB 安装包体积。对于功能丰富的桌面应用来说可以接受。

**[仅 Windows 有 embeddable 包]** → Linux 和 macOS 用户仍需预装 Python。应用目前主要面向国内 Windows 用户，后续可扩展。

**[镜像降级增加安装耗时]** → 每次降级重试需要重新下载。可通过快速检测镜像可用性（HEAD 请求）来缩短失败时的等待时间。

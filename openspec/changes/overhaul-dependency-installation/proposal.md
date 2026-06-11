## Why

当前依赖安装系统存在 13 个已记录的问题，涵盖环境依赖（无 Python、Windows 别名误判、源码编译失败）、可靠性（无版本锁定、脏状态无清理、依赖冲突）、用户体验（无真实进度、无代理支持）和国内网络（PyTorch 下载超时、镜像无降级）。这些问题导致大量非技术用户无法正常使用应用，尤其是国内用户安装 whisperx（~3GB+）时几乎必然失败。

## What Changes

- **内嵌 Python embeddable package**：随应用分发 Python 3.11 embeddable，消除用户预装 Python 的要求，解决 Windows Store 别名误判和源码编译问题
- **版本锁定**：引入 `requirements.lock` 文件，精确锁定所有直接和传递依赖的版本号
- **镜像多级降级**：PyPI 安装支持 清华 → 阿里 → 官方 三级自动降级；PyTorch 安装支持 上交镜像 → 官方 双级降级
- **代理透传**：将用户配置的代理设置（`config.proxyUrl`）通过 `HTTPS_PROXY` 环境变量传递给 pip 进程
- **真实安装进度**：解析 pip `--progress-bar json` 输出，将真实下载进度反馈到前端 UI
- **安装失败清理**：安装失败时删除 venv 目录后重试，避免脏状态
- **打包时 Python 预初始化**：build 阶段下载并准备好 embeddable Python（修改 `_pth`、安装 pip），运行时直接使用

## Capabilities

### New Capabilities
- `embedded-python`: 内嵌 Python embeddable 的下载、初始化、路径管理和打包集成
- `mirror-fallback`: PyPI 和 PyTorch 镜像源的多级自动降级机制
- `install-progress`: pip 安装过程的真实进度解析和 UI 反馈
- `version-locking`: 基于 requirements.lock 的依赖版本精确锁定

### Modified Capabilities

（无已有 spec 需要修改）

## Impact

- **核心文件改造**：`electron/services/dependency-manager.ts` 需要大幅重构（`findPython` → `getEmbeddedPython`、`installMissingDeps` 流程重写、`runCommand` 增加流式输出和环境变量支持）
- **新增文件**：`requirements.lock`、`scripts/setup-python.ts`（打包脚本）、`electron/services/embedded-python.ts`（运行时路径管理）
- **构建配置**：`package.json` 的 `extraResources` 和 `scripts` 需要增加 embeddable Python 相关条目
- **IPC 层**：`main.ts` 的 `deps:install` handler 需要传递 `config` 给 `installMissingDeps`（当前丢弃了 config）
- **类型定义**：`DepInstallProgress` 的 `stage` 枚举可能需要扩展以反映新的安装阶段
- **前端**：`DependencyDialog.tsx` 可能需要适配更细粒度的进度信息
- **测试**：`dependency-manager.test.ts` 需要扩展覆盖新增逻辑

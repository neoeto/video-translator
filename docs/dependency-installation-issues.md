# 依赖自动安装机制问题清单

当前应用通过 `pip install` 将 yt-dlp、whisper、whisperx、audio-separator 等 Python 依赖安装到用户目录下的 `.venv` 虚拟环境中。以下列出该方案存在的问题及对应触发场景。

---

## 一、环境依赖问题

### 1. 强依赖用户预装 Python

- **现象：** 应用启动安装时直接报错 `Python 3 is required to install dependencies.`
- **场景：** 大多数桌面应用用户（尤其非技术用户）电脑上没有安装 Python，应用无法自行安装
- **涉及代码：** `dependency-manager.ts` → `findPython()`

### 2. Windows Store Python 别名误判

- **现象：** 报错 `python3 exited with code 9009`
- **场景：** Windows 10/11 默认开启了 "Python" 应用别名（指向 Microsoft Store），`where python3` 能找到但实际不是可用的 Python
- **涉及代码：** `dependency-manager.ts` → `findPython()` → `isExecutableAvailable()`

### 3. 源码编译失败

- **现象：** 报错 `ValueError: 'bitpack.pyx' doesn't match any files` 或 `error: subprocess-exited-with-error`
- **场景：** 某些依赖（如 ctranslate2）在当前平台/Python 版本下没有预编译 wheel，pip 尝试源码编译，但用户机器缺少 Visual Studio Build Tools 或 Cython 源文件不完整
- **涉及代码：** `dependency-manager.ts` → `installMissingDeps()` 中的 `pip install` 调用

---

## 二、可靠性问题

### 4. 无版本锁定

- **现象：** 更新后应用突然无法使用某依赖
- **场景：** `pip install whisperx` 始终拉取最新版本，上游发布破坏性更新（如 API 变更、子依赖冲突）时，应用会不可预期地失败
- **涉及代码：** `DEP_REGISTRY` 中的 `pipPackage` 字段均为无版本约束的包名

### 5. 安装失败无清理

- **现象：** 重新安装依然失败，报各种奇怪错误
- **场景：** 安装中途失败（网络中断、磁盘满等）后 venv 处于脏状态，残留的不完整包导致后续安装冲突
- **涉及代码：** `installMissingDeps()` 无 try-catch 清理逻辑

### 6. 依赖冲突风险

- **现象：** 安装某个包后另一个包无法使用
- **场景：** 所有依赖装在同一个 venv 中，不同包的子依赖可能互相冲突（如 A 要求 numpy>=1.26，B 要求 numpy<1.26）
- **涉及代码：** `installMissingDeps()` 顺序安装到同一 venv

### 7. `--only-binary :all:` 可能无包可装

- **现象：** 报错 `No matching distribution found for xxx`
- **场景：** 某些小众平台或特定 Python 版本下，PyPI 上没有预编译 wheel，强制 binary-only 会直接失败
- **涉及代码：** `dependency-manager.ts` → `installMissingDeps()` 中的 `--only-binary :all:` 参数

---

## 三、用户体验问题

### 8. 无真实下载进度

- **现象：** UI 长时间停留在 "正在安装 xxx..." 无进度变化
- **场景：** whisperx 等大包（~3GB+）下载时，pip 的 stdout/stderr 进度信息未被捕获解析，UI 仅显示静态估算百分比
- **涉及代码：** `runCommand()` 使用 `stdio: ['ignore', 'pipe', 'pipe']` 但未解析 pip 的进度输出

### 9. 大包无断点续传

- **现象：** 下载到 90% 网络波动后从头开始
- **场景：** PyTorch 约 2GB、whisperx 约 3GB+，pip 下载中断后无缓存复用，重新下载浪费大量时间和带宽
- **涉及代码：** pip 本身无断点续传能力，`installMissingDeps()` 也无相关缓存逻辑

### 10. 无代理支持

- **现象：** 安装卡住不动或超时
- **场景：** 用户有代理但 pip 安装和模型下载链路都没有读取系统代理或提供配置项
- **涉及代码：** `runCommand()` 中的 `spawn` 调用未传入任何代理相关环境变量

---

## 四、国内网络问题

### 11. PyTorch 下载源未配置国内镜像

- **现象：** 安装 whisperx 时长时间卡住，最终超时
- **场景：** whisperx 依赖 PyTorch（~2GB），PyTorch CPU wheel 不在标准 PyPI 上，需要额外配置 `--extra-index-url https://download.pytorch.org/whl/cpu`，而该域名在国内访问很慢甚至不通
- **涉及代码：** `PYPI_MIRROR_ARGS` 只配置了清华 PyPI 镜像，未配置 PyTorch 镜像

### 12. 模型运行时下载走海外

- **现象：** 首次使用 whisper/whisperx 时卡在下载模型
- **场景：** pip 只安装了代码，模型文件（几十 MB 到 1GB+）在首次运行时从 GitHub Releases / OpenAI CDN 下载，这些地址在国内经常被墙或极慢
- **涉及代码：** 不在 `dependency-manager.ts` 管控范围内，是 whisper/whisperx 库内部行为

### 13. 镜像失败无降级机制

- **现象：** 清华镜像同步延迟时安装失败，手动重试也不行
- **场景：** 镜像未同步最新版本、镜像临时不可用时，硬编码的镜像地址直接失败，没有 fallback 到官方 PyPI 的逻辑
- **涉及代码：** `PYPI_MIRROR_ARGS` 固定传入，`installMissingDeps()` 无 try-catch + fallback

---

## 改善方向建议

| 问题 | 建议方案 |
|------|----------|
| 预装 Python | 使用 Python embeddable package 内嵌，或用 PyInstaller/Nuitka 打包为独立可执行文件 |
| 版本锁定 | 在 `pipPackage` 中指定确切版本号（如 `whisperx==3.1.1`），或使用 requirements.txt |
| 安装清理 | 安装失败时删除 venv 目录后重试 |
| 依赖冲突 | 为每个大依赖使用独立 venv，或用 pip 的 dependency resolver 预检查 |
| 下载进度 | 解析 pip 的 `--progress-bar json` 输出，将真实进度发送到前端 |
| 断点续传 | 先用 HTTP 下载 wheel 文件（支持断点），再 `pip install --no-index --find-links` 本地安装 |
| 代理支持 | 读取系统代理设置或提供代理配置项，通过环境变量 `HTTP_PROXY`/`HTTPS_PROXY` 传给 pip |
| PyTorch 镜像 | 额外配置 `--extra-index-url https://mirror.sjtu.edu.cn/pytorch-wheels/cpu` |
| 模型预打包 | 将常用模型文件随发行版一起打包，或提供国内模型下载镜像 |
| 镜像降级 | 镜像安装失败时自动 fallback 到官方 PyPI 源重试 |

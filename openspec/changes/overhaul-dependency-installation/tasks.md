## 1. 构建脚本：内嵌 Python embeddable

- [x] 1.1 创建 `scripts/setup-python.ts`：下载 Python 3.11 embeddable（Windows x64），解压到 `resources/python/`
- [x] 1.2 修改 `python311._pth`：启用 `Lib/site-packages`、`..` 路径、import site
- [x] 1.3 下载并执行 `get-pip.py` 初始化 pip
- [x] 1.4 在 `package.json` 中添加 `"setup-python"` script 条目
- [x] 1.5 在 `package.json` 的 `extraResources` 中添加 `resources/python/` 目录
- [ ] 1.6 手动验证：运行 setup-python 后 `resources/python/python.exe -m pip --version` 正常

## 2. 运行时：Embedded Python 路径管理

- [x] 2.1 创建 `electron/services/embedded-python.ts`：实现 `getEmbeddedPython()` 函数，返回 `process.resourcesPath/python/python.exe` 或 `null`
- [x] 2.2 修改 `dependency-manager.ts` 的 `findPython()`：优先调用 `getEmbeddedPython()`，fallback 到原有系统 Python 搜索逻辑
- [x] 2.3 修改 `deps:install` IPC handler（`main.ts`）：不再丢弃 config，将 config 传递给 `installMissingDeps`

## 3. 版本锁定：requirements.lock

- [x] 3.1 在项目根目录创建 `requirements.lock`，包含 yt-dlp、openai-whisper、whisperx、audio-separator[cpu] 及其传递依赖的精确版本
- [x] 3.2 修改 `installMissingDeps`：将逐个 `pip install <pkg>` 改为 `pip install -r requirements.lock`
- [x] 3.3 实现 `requirements.lock` 路径解析逻辑（开发环境 vs 打包环境）
- [x] 3.4 在 `requirements.lock` 中确保 `pip` 本身也被锁定版本（用于 `--progress-bar json` 兼容性）

## 4. 镜像降级机制

- [x] 4.1 定义 `MIRROR_CHAIN` 常量数组：清华 → 阿里 → 官方 PyPI，每项包含 URL 和 trusted-host
- [x] 4.2 定义 `PYTORCH_INDEX_CHAIN` 常量数组：上交镜像 → 官方 PyTorch，每项包含 extra-index-url
- [x] 4.3 在 `DEP_REGISTRY` 的 `DepInfo` 中增加可选字段 `requiresPyTorch: boolean`
- [x] 4.4 实现 `installWithMirrorFallback` 函数：遍历镜像链，每次失败时删除 venv 并用下一级镜像重试
- [x] 4.5 在 `installMissingDeps` 中替换原有的单次 pip install 为 `installWithMirrorFallback`
- [ ] 4.6 验证：手动测试镜像降级逻辑（可 mock 清华镜像不可用）

## 5. 代理透传

- [x] 5.1 修改 `runCommand` 函数签名：增加可选参数 `env?: Record<string, string>`
- [x] 5.2 在 `spawn` 调用中将 `env` 合并到 `process.env`
- [x] 5.3 修改 `installMissingDeps`：读取 `config.proxyEnabled`/`config.proxyUrl`，构造 `HTTP_PROXY`/`HTTPS_PROXY` 环境变量传给 `runCommand`

## 6. 真实安装进度

- [x] 6.1 修改 `runCommand` 函数签名：增加可选参数 `onStderr?: (line: string) => void`
- [x] 6.2 实现基于换行符和 `\r` 的行级 stderr 分割（处理 pip 的进度覆盖行为）
- [x] 6.3 创建 `electron/services/pip-progress.ts`：实现 `parsePipJsonProgress(line)` 函数，解析 pip `--progress-bar json` 输出
- [x] 6.4 修改 `installMissingDeps`：pip install 命令添加 `--progress-bar json` 参数，通过 `onStderr` 回调解析进度并调用 `onProgress`
- [x] 6.5 扩展 `DepInstallProgress` 的 `stage` 枚举：增加 `'downloading'` 阶段用于真实下载进度

## 7. 安装失败清理

- [x] 7.1 在 `installWithMirrorFallback` 中实现：pip install 失败时递归删除 `{userData}/.venv` 目录
- [x] 7.2 清理后重新创建 venv 并从下一步骤（pip upgrade）继续
- [x] 7.3 在重试时通过 `onProgress` 发送包含重试信息的消息

## 8. 测试与验证

- [x] 8.1 为 `embedded-python.ts` 编写单元测试：验证路径解析逻辑（Windows/非 Windows）
- [x] 8.2 为 `pip-progress.ts` 编写单元测试：覆盖 JSON 解析、非 JSON 行过滤、边界情况
- [x] 8.3 为镜像降级逻辑编写单元测试：验证 fallback 链执行顺序
- [x] 8.4 扩展 `dependency-manager.test.ts`：覆盖 `getRequiredDeps` 在新 `requiresPyTorch` 字段下的行为
- [ ] 8.5 端到端验证：在干净的 Windows 环境（无系统 Python）中测试完整安装流程
- [ ] 8.6 网络验证：测试镜像降级在清华镜像不可用时的行为

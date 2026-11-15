# TRACE · 只读代码审查 Agent

面向网站、小程序和 App 的上线前源码审查：静态风险规则、DeepSeek 上下文分析、Strix 知识技能、文件与行号定位、只读建议和可导出报告。原有交付验证演示完整保留。

## 使用

打开网站后会出现首次使用指南，右上角可随时重新打开。

1. 在「代码审查」选择文件、文件夹或 ZIP，也可粘贴代码。
2. 选择项目类型，点击「开始只读审查」。可先加载内置缺陷样例。
3. 查看安全、隐私、逻辑和发布配置问题；逐项核对代码依据、影响、前提、建议与验证方法。
4. 检查文件覆盖、模型异常和未审范围，再导出 Markdown、JSON 或独立 HTML。

审查不会执行代码、安装被审项目的依赖或修改源码。源码在请求内存中处理，不保存到服务端；报告保存在当前浏览器，可以清除本机记录。疑似敏感值在提交 DeepSeek 前脱敏。上传代码片段会由 DeepSeek 处理。

## 本地运行

双击桌面的「TRACE 代码审查」或项目中的 `启动TRACE.cmd`：自动启动本地服务，并以 1480 × 1000 的独立桌面窗口打开 `index.html`。窗口大小可自由调整。后端仅监听本机；重复启动复用服务，端口冲突时自动选择空闲端口。关闭窗口后可再次从桌面进入；完全停止服务请运行 `停止TRACE.cmd`。

`index.html` 是约 525 KB 的单文件页面，已内嵌样式、脚本、ZIP 库、演示契约和审查知识。直接双击它即可离线运行全部浏览器验证演示、静态源码审查及报告导出；调用 DeepSeek 和 Python 验证引擎请使用桌面入口。模型密钥始终在后端，HTML 中不包含密钥。

重新生成单文件和安装当前 Windows 用户的桌面入口：

```powershell
node scripts/build-single-html.mjs
powershell -ExecutionPolicy Bypass -File scripts/install-desktop.ps1
```

桌面入口使用本机 Python 和 Edge / Chrome 应用窗口，无需 Electron。项目文件夹请保留在原位置；移动后重新运行安装脚本即可更新快捷方式。下面的命令可手动启动普通浏览器服务：

```powershell
py -3 server.py
```

需要 Python 3.9+ 和 Node.js 20+。审查核心与在线 Worker 共享；Python 还提供 SQLite 持久化和真实子进程验证演示。只运行演示不需要模型密钥。

端口被占用时：

```powershell
py -3 server.py --port 8790
```

## 模型配置

官方接口为 `https://api.deepseek.com/chat/completions`，默认模型标识 `deepseek-flash`。旧的 `deepseek-v4-flash` 当前作为兼容名；实际响应的模型标识与 Token 用量写入报告。

本地使用 `DEEPSEEK_API_KEY` 环境变量。当前 Windows 工作区也支持用户绑定的 DPAPI 加密凭据，文件位于忽略提交的 `.data` 目录；加密凭据不能复制给其他系统用户使用。密钥不进入前端、源码、报告或 Git。在线版使用 Sites 服务端 secret。

```powershell
$traceSecret = Read-Host 'DeepSeek API Key' -AsSecureString
$traceCredential = [System.Net.NetworkCredential]::new('', $traceSecret)
$env:DEEPSEEK_API_KEY = $traceCredential.Password
py -3 server.py
```

可选 `DEEPSEEK_MODEL` 更改官方服务的模型标识。没有配置模型时只执行规则检查，并明确显示未完成模型审查。服务异常不伪装成完整成功。

## 审查范围

- 输入：最多 160 个源码文本文件，总量 1.5 MB，单文件 200 KB。
- ZIP：最大 20 MB；检查路径、展开大小和压缩比。自动排除依赖、构建目录和二进制文件。
- 类型：JS/TS/React/Vue、小程序 WXML/WXSS/配置、Python/PHP、Java/Kotlin、Swift/Dart、Go/C# 等源码。
- 静态规则：疑似凭据、SQL 拼接、动态执行、HTML 注入、敏感日志、令牌存储、明文通信、TLS 绕过、移动端配置和文件路径等。
- 模型分析：基于已提交的上下文检查数据流、权限、业务逻辑、隐私处理和缓解措施。
- 证据：模型引用必须定位到实际文件的已审行范围；无法定位的候选单列为未核实。
- 覆盖：静态检查全部接受的源码；模型按预算选取文件或片段。覆盖表显示全文、片段、未覆盖和调用失败。

模型源码上下文每次最多约 160,000 字符、4 个批次；长文件保留头尾与静态命中附近的片段。知识技能与文件索引也会占用额外模型上下文。大项目应按服务或模块分批，不能把未审部分当作已经安全。

静态规则存在误报和漏报，模型推断需要人工复核。这里没有动态利用、生产环境测试、实时依赖漏洞库查询或安全/合规认证；无发现不代表没有漏洞。二进制 APK、IPA 或编译后小程序包不在源码审查范围内。

## Strix 知识技能

从用户提供的归档安装 29 个知识技能，服务端按项目特征最多选择 9 个，加入模型参考上下文。包括认证、越权、信息泄露、注入、业务逻辑、反证、风险校准和常见框架。报告记录实际启用的技能。

它是只读知识适配，不是 Strix 的动态渗透或自动修复引擎。上游原文、归档和文件哈希、Apache-2.0 许可证保存在 `third_party/strix`。详情见 [Strix 技能集成](docs/Strix技能集成.md)。

## 原有验证演示

「验证演示」保留校园预约、课程权限与游戏排行榜三个场景：缺陷基线、局部修复、完整复测、故障注入、事件链与人工验收。

| 场景 | 缺陷基线 | 局部修复 | 完整修复 | 已知变异检出 |
| --- | --- | --- | --- | --- |
| 校园预约 | 4/12 | 10/12 | 12/12 | 3/3 |
| 课程权限 | 6/12 | 9/12 | 12/12 | 3/3 |
| 游戏排行榜 | 4/12 | 9/12 | 12/12 | 3/3 |

反事实实验室展示故障指纹矩阵，并用动态规划求解已知变异的最小诊断见证。它不替代全部验收断言。SHA-256 事件链仅提供链内一致性检查，没有外部签名，不能独立防止整链重算或尾部截断。

## 构建在线 Worker

```powershell
node scripts/build-worker.mjs
```

构建将前端静态文件与共享审查引擎合并为无依赖 ESM Worker。在线版可以真实调用模型，同时浏览器端继续运行完整的内置验证演示。在线版不会运行 Python 子进程。

## 验证

```powershell
node --test tests/review.test.mjs
py -3 -m unittest discover -s tests -v
node tests/parity.mjs
node --check public/app.js
node --check public/review-ui.js
```

检查覆盖：路径与输入限制、敏感值脱敏、参数化 SQL 反例、模型引用定位、上下文覆盖、失败状态、只读报告、技能路由、接口来源、原有状态机和双引擎一致性。真实模型连接和 UI 报告还需使用配置好的服务执行。

## 结构

- `public/`：工作台、审查界面、验证演示、首次使用指南。
- `review/`：静态规则、模型审查、证据定位、知识路由、流式接口。
- `worker/`：托管服务入口。
- `server.py` / `review_gateway.py`：本地 Python 服务与共享审查桥接。
- `engine.py` / `policies.py`：原有验证闭环。
- `third_party/strix/`：上游知识原文、许可证和可核查来源。
- `secret_store.py`：Windows 用户绑定的加密本地凭据。
- `.data/`：本地数据库与加密凭据，忽略提交和分发。

参考：[DeepSeek 官方文档](https://api-docs.deepseek.com/)、[Strix](https://github.com/usestrix/strix)。

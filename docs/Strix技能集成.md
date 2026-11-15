# Strix 只读知识技能

本项目按用户提供的 `strix-main.zip` 导入了 29 个知识文件，原文件位于 `third_party/strix/skills`。归档 SHA-256、每个文件的 SHA-256、来源路径与 Apache-2.0 许可证一并保存于该目录。

## 安装到哪里

这些技能安装在 TRACE 的服务端审查流程，不是当前编码助手的全局技能。`review/skills.mjs` 根据文件内容、技术栈与静态风险线索选择最多 9 个知识技能，加入 DeepSeek 的本轮参考上下文。每份报告记录实际选择的技能及其来源哈希。

原始 Markdown 保持原样。运行时引用经过单独适配：移除可执行代码块、限制片段长度，并明确仅供源码分析参考，不授予执行命令、外部扫描或写入源码的能力。用户上传代码始终按数据处理，不作为 Agent 指令。

## 能力范围

- 基础分析：源码入口、数据流、反证检查、风险校准、信息泄露。
- 访问控制：JWT、对象权限、功能级权限、OAuth。
- 注入与边界：SQL、NoSQL、XSS、SSRF、文件路径、上传、反序列化、原型污染。
- 业务逻辑：状态转换、并发竞态、批量赋值。
- 框架：Django、FastAPI、NestJS、Next.js、GraphQL、Firebase、Supabase。
- 模型应用：提示注入与工具权限。

当前没有安装或运行 Strix 完整动态渗透、漏洞利用、Shell、浏览器攻击或自动修复引擎。上游源码审查 skill 描述包含可写挂载与动态验证，和本工具的只读契约不同，所以没有直接执行其 CLI。发现项标记为待人工复核，不冒充已经动态利用成功的漏洞。

## 增益如何验证

测试确认技能库存为 29 个、FastAPI 等技术特征能触发对应路由、反证策略进入模型上下文。真实 DeepSeek 请求完成后，报告会列出实际技能和可定位问题。没有做独立 A/B 研究，因此不声称技能能带来某个确定的准确率或召回率提升。

## 更新

```powershell
py -3 scripts/import-strix.py '你的 strix-main.zip'
node scripts/build-worker.mjs
```

来源：[usestrix/strix](https://github.com/usestrix/strix)。适配说明与上游原始文件分开保存，保留许可证和版权声明。

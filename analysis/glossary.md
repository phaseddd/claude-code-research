# analysis 术语表（公开知识库）

> 受控词 + 解释。目的：避免同一个东西出现两种叫法（同义词漂移）。新词先加这里，再在页面里用。

## 标签（受控前缀）

### `topic:`（主题）

- `topic:ast` —— 抽象语法树（AST）及其解析工具这一主题域。
- `topic:acorn` —— acorn 这个 JavaScript 解析器及其生态。
- `topic:claude-code` —— Claude Code（Anthropic 官方 CLI）本体及其分发 / 逆向 / 补丁这一主题域。
- `topic:slash-command` —— Claude Code 斜杠命令（`/…`）子系统：命令对象、分发与 builtin/prompt/local 等形态。
- `topic:insights` —— Claude Code `/insights` 使用报告能力（会话扫描、usage-data、内嵌提示词与 HTML 报告）。
- `topic:bun-sea` —— Bun SEA（Single Executable Application）单文件可执行分发形态与其内嵌模块提取这一主题域。
- `topic:npm` —— npm 包的分发 / 分包 / 安装机制这一主题域。

### `form:`（形态）

- `form:concept` —— 解释「是什么」的概念页。
- `form:mechanism` —— 讲清一个流程 / 系统怎么运作的机制页。
- `form:case` —— 分析一个具体项目 / 对象的案例页。
- `form:decision` —— 记录本项目为什么这么选的决策页。
- `form:investigation` —— 调查 / 验证过程记录页。

## 核心术语（避免漂移）

- **AST（抽象语法树 / Abstract Syntax Tree）** —— 源码逻辑结构的树形表示，剥掉标点/括号等语法噪声。别和 CST 混用。
- **CST（具体语法树 / parse tree / Concrete Syntax Tree）** —— 保留全部语法细节的树；AST 是它「去噪」后的抽象版。
- **ESTree** —— JS AST 的社区事实标准格式，acorn / espree / esprima 等解析器「遵循」它输出。统一叫 ESTree，不叫「SpiderMonkey 格式」（那只是它的前身）。
- **Pratt 解析 / 运算符优先级解析** —— 把语义动作绑定到 token、用「绑定力」处理优先级的解析法；是递归下降的增强而非替代。acorn 表达式层用它。
- **Bun SEA（Single Executable Application）** —— Bun 把打包后的 JS 连同 native 模块编译进单个原生可执行文件的分发形态；内嵌数据存放在二进制的专用 section（PE/ELF 的 `.bun`、MachO 的 `__BUN/__bun`），尾部有固定 trailer `\n---- Bun! ----\n`。Claude Code 自 v2.1.113 起用它分发。
- **SEA（Single Executable Application / 单文件可执行）** —— 「把运行时 + 代码打进一个可执行文件」的统称。本库语境默认指 **Bun SEA**；注意与 Node.js 官方的 SEA 特性区分，别混。
- **cli.js** —— Claude Code 打包后的主程序 JavaScript（十几 MB 的单文件 bundle），是 Bun SEA 提取和 acorn 补丁的核心目标文件。
- **slash command（斜杠命令）** —— 用户以 `/` 开头触发的 CLI 内建或扩展命令；本库写「斜杠命令」，标签用 `topic:slash-command`。
- **/insights** —— Claude Code builtin 斜杠命令：本机扫历史会话与缓存，经内部模型调用生成 usage 报告 HTML；细节见 mechanisms / concepts 下 insights 相关页。
- **usage-data** —— Claude 配置根下存放 `/insights` 产物与缓存的目录名（含 `session-meta/`、`facets/`、`report*.html`）。
- **transcript（会话日志）** —— `projects/` 下单次会话的原始消息流水（常为 JSONL）；`/insights` 统计与语义分析的源数据。
- **mtime（modification time）** —— 文件最后修改时间。`/insights` 语境下多指 transcript 的 mtime：枚举会话排序，并判断 session-meta 是否过期。
- **session-meta（meta）** —— `/insights` 从 transcript **算出**的可复算统计缓存（时长、工具次数等），不调模型，目录 `usage-data/session-meta/`；transcript mtime 变了则刷新。
- **facet（会话 facet）** —— `/insights` 对单会话 LLM 抽取的结构化语义标签（目标、满意度、摩擦等），缓存于 `usage-data/facets/`。

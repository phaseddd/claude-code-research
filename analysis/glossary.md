# analysis 术语表（公开知识库）

> 受控词 + 解释。目的：避免同一个东西出现两种叫法（同义词漂移）。新词先加这里，再在页面里用。

## 标签（受控前缀）

### `topic:`（主题）

- `topic:ast` —— 抽象语法树（AST）及其解析工具这一主题域。
- `topic:acorn` —— acorn 这个 JavaScript 解析器及其生态。
- `topic:claude-code` —— Claude Code（Anthropic 官方 CLI）本体及其分发 / 逆向 / 补丁这一主题域。
- `topic:bun-sea` —— Bun SEA（Single Executable Application）单文件可执行分发形态与其内嵌模块提取这一主题域。
- `topic:npm` —— npm 包的分发 / 分包 / 安装机制这一主题域。

### `form:`（形态）

- `form:concept` —— 解释「是什么」的概念页。
- `form:case` —— 分析一个具体项目 / 对象的案例页。

## 核心术语（避免漂移）

- **AST（抽象语法树 / Abstract Syntax Tree）** —— 源码逻辑结构的树形表示，剥掉标点/括号等语法噪声。别和 CST 混用。
- **CST（具体语法树 / parse tree / Concrete Syntax Tree）** —— 保留全部语法细节的树；AST 是它「去噪」后的抽象版。
- **ESTree** —— JS AST 的社区事实标准格式，acorn / espree / esprima 等解析器「遵循」它输出。统一叫 ESTree，不叫「SpiderMonkey 格式」（那只是它的前身）。
- **Pratt 解析 / 运算符优先级解析** —— 把语义动作绑定到 token、用「绑定力」处理优先级的解析法；是递归下降的增强而非替代。acorn 表达式层用它。
- **Bun SEA（Single Executable Application）** —— Bun 把打包后的 JS 连同 native 模块编译进单个原生可执行文件的分发形态；内嵌数据存放在二进制的专用 section（PE/ELF 的 `.bun`、MachO 的 `__BUN/__bun`），尾部有固定 trailer `\n---- Bun! ----\n`。Claude Code 自 v2.1.113 起用它分发。
- **SEA（Single Executable Application / 单文件可执行）** —— 「把运行时 + 代码打进一个可执行文件」的统称。本库语境默认指 **Bun SEA**；注意与 Node.js 官方的 SEA 特性区分，别混。
- **cli.js** —— Claude Code 打包后的主程序 JavaScript（十几 MB 的单文件 bundle），是 Bun SEA 提取和 acorn 补丁的核心目标文件。

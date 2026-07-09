# analysis 术语表（公开知识库）

> 受控词 + 解释。目的：避免同一个东西出现两种叫法（同义词漂移）。新词先加这里，再在页面里用。

## 标签（受控前缀）

### `topic:`（主题）

- `topic:ast` —— 抽象语法树（AST）及其解析工具这一主题域。
- `topic:acorn` —— acorn 这个 JavaScript 解析器及其生态。

### `form:`（形态）

- `form:concept` —— 解释「是什么」的概念页。

## 核心术语（避免漂移）

- **AST（抽象语法树 / Abstract Syntax Tree）** —— 源码逻辑结构的树形表示，剥掉标点/括号等语法噪声。别和 CST 混用。
- **CST（具体语法树 / parse tree / Concrete Syntax Tree）** —— 保留全部语法细节的树；AST 是它「去噪」后的抽象版。
- **ESTree** —— JS AST 的社区事实标准格式，acorn / espree / esprima 等解析器「遵循」它输出。统一叫 ESTree，不叫「SpiderMonkey 格式」（那只是它的前身）。
- **Pratt 解析 / 运算符优先级解析** —— 把语义动作绑定到 token、用「绑定力」处理优先级的解析法；是递归下降的增强而非替代。acorn 表达式层用它。

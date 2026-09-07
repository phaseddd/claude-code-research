---
title: acorn 与 JavaScript AST 解析工具
kind: concept
status: active
updated: 2026-09-07
applies_to: general；acorn 事实截至 2026-09（latest v8.18.0）
tags:
  - topic:ast
  - topic:acorn
  - topic:claude-code
  - form:concept
---

# acorn 与 JavaScript AST 解析工具

## 一句话解释

acorn 是一个**小而快、零运行时依赖、纯 JavaScript 写的 JavaScript 解析器**：把源码解析成符合 ESTree 规范的 AST（抽象语法树 / Abstract Syntax Tree）。它是前端工具链里的「事实默认解析器」—— webpack、Rollup（进而 Vite）、ESLint（经 espree 包装）都靠它把代码变成可分析、可改写的树。

## 背景：AST 与解析基础

要理解 acorn，先理解它的产物和它做的事。

**AST vs CST vs token：**

- **token（词法单元）**：源码切成的最小意义单位（一个关键字、一个标识符、一个符号），是树的叶子。
- **CST（具体语法树 / Concrete Syntax Tree，又叫 parse tree）**：文法到树的一对一映射，**保留全部语法细节**（关键字、标点、优先级带来的多层嵌套）。适合需要精确复现原文的场景（格式化、结构化 diff）。
- **AST（抽象语法树）**：CST **去噪后**的抽象版，剥掉标点/括号等语法噪声，内部节点代表编程构造（运算符、语句），叶子代表操作数（变量、字面量）。它表达的是「程序的含义」而非「程序的字面」。

数据流是：`源码 → tokens → parser →（概念上的 CST）→ AST`。实践中 CST 常不显式构建，parser 直接产出 AST。

**为什么用 AST，而不是正则/字符串替换？** 正则处理代码容易漏边界情况（多行、模板字符串、复杂调用嵌套），而 AST 提供有语义的结构化变换 —— 你操作的是「这个函数调用节点」，而不是「这段碰巧长这样的文本」。

**解析的两个阶段：**

1. **词法分析（tokenize）**：源码 → token 流。
2. **语法分析（parse）**：token 流 → AST。

在语法分析怎么处理运算符优先级，有两条主要路线：

- **递归下降（recursive descent）**：给每个文法非终结符写一个互相递归的函数。在语句/声明层很自然（多以关键字开头），但表达式层要为**每个优先级**写一个函数（JS 约 17 级），冗长且低效。
- **Pratt 解析 / 运算符优先级解析（operator-precedence parsing）**：Vaughan Pratt 1973 年论文《Top Down Operator Precedence》提出。把语义动作绑定到 **token** 而非文法规则，用「绑定力（binding power）」处理优先级与结合性，循环+递归结合，每个 token 只需几次调用，快。它是递归下降的**增强**而非替代。Douglas Crockford 在 JSLint 里用的就是 Pratt。

> acorn 整体是**递归下降**解析器，但在**表达式层改用运算符优先级解析**（而非给约 17 级优先级各写一个函数）——这既是它诞生时能在性能上压过 Esprima 的原因之一，也是上面「Pratt 是递归下降的增强而非替代」的具体落地。

## acorn 本体

- **作者**：Marijn Haverbeke —— 同时是 CodeMirror、ProseMirror 的作者，著有《Eloquent JavaScript》。
- **诞生**：**2012-09-24**（npm 上首个版本 `0.0.1` 的发布时间戳，registry 一手数据）。作者自述初衷是「没有非做不可的理由」，主要图「小而定义清晰的系统好玩」，外加想在性能上胜过当时的 Esprima；关键差异就是上面说的运算符优先级解析。
- **版本节奏**：8.x 长期稳定，节奏是「跟着 ECMAScript 定稿特性与 Unicode 版本走的小步迭代」，无破坏性大版本。**别在本页记最新版本号**——它每几个月就动一次，精确值以 [CHANGELOG](https://github.com/acornjs/acorn/blob/master/acorn/CHANGELOG.md) 为准，本页写作时的基准见 frontmatter `applies_to`。
- **体积/依赖**：极轻量，**运行时零依赖**；被 9,600+ npm 包依赖，跨超百万仓库。
- **许可证**：MIT。
- **特性策略**：只实现 **stage 4（已定稿）** 的 ECMAScript 特性；未定稿的提案特性一律走**插件**，acorn 本体不收。

**技术特点：**

- **遵循 ESTree 规范**：`parse()` 的返回值就是 ESTree 定义的 AST（见下节）。
- **插件/扩展机制**：插件可以新增 token 类型、tokenizer 上下文、扩展 parser 方法，**无需 fork 整个 acorn** 就能支持 JS 方言（典型如 `acorn-jsx`）。
- **配套包**：
  - `acorn-walk` —— AST 遍历器，提供 `simple()` / `full()` 等访问器。
  - `acorn-loose` —— 容错解析，遇到语法错误仍产出近似 ESTree 的树（占位节点文本为 `✖`），适合编辑器里对半成品代码做分析。
- **`ecmaVersion` 选项**：可填年份（`2022`）、版本号（`6`）或 `"latest"`；支持 modules、top-level await、私有字段校验、hashbang 等。

## ESTree：为什么大家的 AST 长得像

**ESTree** 是 JavaScript AST 的**社区事实标准**。前身是 Mozilla SpiderMonkey 的 Parser API（Firefox 把 SpiderMonkey 解析器暴露成 JS API 时形成的格式）。它按 ES 版本演进（ES5 打底，ES6 起每版增补，如 ES2016 增 `**`）。

关键关系是「**谁定义、谁遵循**」：ESTree **定义规范**，而 acorn / espree / esprima / meriyah 等解析器**遵循**它来输出。这就是为什么换一个解析器，下游的遍历/分析代码往往不用大改 —— 大家吐出来的树结构是同一套。

> 治理层面：ESTree 指导委员会成员来自 ESLint、Acorn、Babel 三方（此条来自二手综述，未逐字核对成员名单，见「证据边界」）。

## 生态位：谁在用 acorn

acorn 的价值很大程度上来自「它已经在你的依赖树里」：

- **webpack**：AST 解析用 acorn。
- **Rollup**：直接依赖 acorn 做解析；**Vite** 构建于 Rollup，故 acorn 也在其依赖树中。
- **ESLint / espree**：ESLint 的默认解析器 espree **最初是 Esprima v1.2.2 的 fork**，自 2.0.0 起改为**构建在 acorn 之上的「翻译层」**（acorn 输出 → Esprima 风格），因为看中 acorn 的插件支持。**注意：espree 不是 acorn 的 fork，而是包装 acorn。**
- **Babel（@babel/parser，旧名 Babylon）**：最初 fork 自 acorn + acorn-jsx，后走自有路线；提供 `estree` 插件以输出 ESTree 兼容 AST。
- **terser**：有自己的 AST 格式，但可导入 SpiderMonkey/ESTree AST，`-p acorn` 选项能直接用 acorn 解析。

**已知坑**：webpack 与 ESLint 同装时，acorn 实例可能因依赖去重产生**多份**，导致 `acorn.tokTypes` 是不同实例、插件失效（acorn PR #870）。排查「插件明明装了却不生效」时值得想到这一条。

## 同类工具与取舍：什么时候不该用 acorn

| 工具 | 语言 | 定位 |
|---|---|---|
| esprima | JS | 老牌基础解析器，输出 ESTree；ES6 时期更新滞后，促成 espree/acorn 崛起 |
| espree | JS | ESLint 默认，**包装 acorn**，输出 ESTree |
| @babel/parser | JS | 插件系统强，默认开最新 ES + JSX/TS/Flow；配 `@babel/traverse` + `@babel/generator` 成完整「解析-变换-生成」链 |
| @typescript-eslint/parser | JS | 把 TS 自有 AST 桥接成 ESTree 兼容的 TSESTree，让 ESLint 能 lint TS |
| swc / oxc | Rust | 追求极致速度；oxc 自测 parser 比 swc 快约 3×、比 Biome 快约 5×，transformer 比 Babel 快 20×–50× |
| meriyah | JS | 现代快速解析器，输出 ESTree |
| tree-sitter | C | 语言无关的**增量解析**框架，产出保真 **CST**（含精确源位置），多语言，适合编辑器/检索/AI 场景 |

**acorn 的取舍**：胜在**轻量、通用、ESTree 输出、已是生态默认**；弱在**原始速度不敌 Rust 系**、**原生不支持 TS/JSX**（需插件或换 Babel / typescript-eslint）。

> 别被「Rust 一定更快」误导：swc/oxc 的基准是**厂商自测**，且从 Node.js 调用时有 **FFI + AST 序列化开销**，小文件未必更快，纯 JS 场景 TypeScript 自带 parser 也常更优。选型看**是否已在依赖树 + 语言支持需求**，而非只看跑分。

## 典型应用场景

- **打包（bundler）**：源码 → AST → 分析 import/export 依赖、tree-shaking → 生成 chunk（Rollup/webpack）。
- **linting**：ESLint 在 AST 层跑规则（经 espree/acorn）。
- **代码转换 / codemod**：`jscodeshift` 包装 `recast` + `ast-types`，走「源码 → AST → 查询修改节点 → `toSource()` 回写」，recast 尽量保留原格式与注释。
- **压缩（minify）**：terser 解析 → AST → 改名/删死代码 → 生成。
- **静态分析 / 插桩 / 依赖分析**：遍历 AST 提取符号、调用关系、import 图，或注入探针节点后回生成。

## 在本项目中的含义

先划清一个容易搞混的边界：**AI 编程工具语境下的主流证据指向 tree-sitter，而非 acorn**。`ast-grep`（结构化搜索/重构）、`difftastic`（按节点做结构化 diff）、`probe`（ripgrep 速度 + 语义搜索），以及各种经 MCP 把符号/调用图喂给 Claude Code / Cursor 的项目，底层多是 tree-sitter —— 因为它保精确源位置、跨语言。acorn 在这类工具内的直接用途**缺乏公开证据**（见「证据边界」）。

但**本仓库自己**的用法是明确的：做 Claude Code 逆向时要解析并改写**打包后的 `cli.js`**（十几 MB、压缩混淆的单 bundle），这条链**一律用 acorn**，从不用 Babel，也不是纯正则。定位策略是「结构而非字面」——不依赖任何被混淆的变量名，因而能跨版本存活。以 `/copy` UTF-8 补丁为例：

1. `acorn.parse` 把 `cli.js` 解析成 AST；
2. 找 discriminant 为 `process.platform` 的 `SwitchStatement`；
3. 用 `case "darwin"` 里含 `"pbcopy"` 调用来确认这就是 `copyNative` 的那个 switch；
4. 在 `case "win32"` 里定位目标 `CallExpression`，按 AST 位置精确替换参数；
5. 改完再 `acorn.parse` 复解析一次，验证产物仍是合法 JS。

这正是「用 AST 而非字符串」原则的直接落地：面对压缩混淆的大文件，结构化改写比文本替换稳得多。acorn / ESTree 因此是这条改写链的概念基础。

> 版本细节：项目补丁**锁定**的是 acorn `8.14.0`（`.mjs` 脚本）/ `8.16.0`（`.ps1` 与 `.sh` 脚本），脚本运行时从 unpkg 拉固定版本并本地缓存。这是「项目锁定版本」，与生态 latest 是两回事，别混淆。

## 常见误解

- ❌「espree 是 acorn 的 fork」 → 实为**包装** acorn 的翻译层。
- ❌「acorn 能直接解析 TS/JSX」 → **不能**，需插件（acorn-jsx）或换 Babel / typescript-eslint。
- ❌「CST = AST」 → 不同：CST 保留全部语法细节，AST 是去噪抽象版。
- ❌「Rust 解析器从 Node 调用一定更快」 → 小文件未必，有 FFI + 序列化开销。
- ❌「解析报语法错 = 源码真有语法错」 → 常见真因是**选项没配对**：`ecmaVersion` 低于源码用到的语法，或 `sourceType` 用了默认的 `"script"` 去解析含 `import`/`export` 的 ESM。改写 `cli.js` 这类打包产物时尤其要先把这两项设对。

## 依据（证据与复核）

**本项目用法（可自查）**：`private/patches/` 下 23 个补丁脚本（11 `.ps1` + 12 `.sh` + 3 `.mjs`）**全部**走 acorn，无一使用 Babel；版本锁定见各脚本里的 unpkg 下载行（`acorn@8.16.0` / `acorn@8.14.0`）。`private/` 是本地非公开材料区且被 gitignore，公开读者无法打开——所以上一节把定位策略内联进了正文，页面不依赖这些路径也能读懂。

**主要来源：**

- acorn 本体 / CHANGELOG：<https://github.com/acornjs/acorn> ；<https://github.com/acornjs/acorn/blob/master/acorn/CHANGELOG.md>
- 作者自述：<https://marijnhaverbeke.nl/blog/acorn.html>
- npm：<https://www.npmjs.com/package/acorn> ；registry 元数据（`https://registry.npmjs.org/acorn` 的 `time` 字段）—— 首发日期与各版本发布时间的一手来源，`0.0.1` 时间戳为 2012-09-24。
- ESTree 规范：<https://github.com/estree/estree>
- espree 由来：<https://eslint.org/blog/2014/12/espree-esprima/>
- Babel parser：<https://babeljs.io/docs/babel-parser>
- typescript-eslint：<https://typescript-eslint.io/packages/parser/>
- oxc 基准：<https://oxc.rs/docs/guide/benchmarks>
- AST 概念：<https://en.wikipedia.org/wiki/Abstract_syntax_tree> ；<https://eli.thegreenplace.net/2009/02/16/abstract-vs-concrete-syntax-trees>
- Pratt 解析：<https://matklad.github.io/2020/04/13/simple-but-powerful-pratt-parsing.html> ；<https://journal.stuffwithstuff.com/2011/03/19/pratt-parsers-expression-parsing-made-easy/>
- 各家解析器综述：<https://www.pkgpulse.com/guides/acorn-vs-babel-parser-vs-espree-javascript-ast-parsers-2026>

**证据边界（未确认 / 待核）：**

- 首轮入库时一手页面抓取（WebFetch）不可用（网关 503/403），除版本与 CHANGELOG 外的多数生态事实来自 **WebSearch 对权威源的摘要**，引用 URL 指向其所据的权威页。
- acorn 下载量的精确数字（不同聚合器给「月 9.39 亿」「周 2.17 亿」），量级可信、精确值存疑。
- ESTree 指导委员会「ESLint/Acorn/Babel 三方」来自二手综述，未逐字核对成员名单。
- acorn 在 AI 编程工具内的**直接**用途缺公开证据；主流证据指向 tree-sitter。Claude Code 是否内部用 acorn，未查到公开证据。
- 各解析器的性能对比数字均为**厂商自测**，本页未独立复现。

## 相关页面

- [node-compat-patches.md](node-compat-patches.md) —— 同库机制页：CometixSpace 那条恢复流水线同样用 acorn 给抽出的 `cli.js` 打补丁（P1/P2/P3/P5/P7/P8/P10 按节点特征改写，P9 才走字符串替换），是本页「acorn 是 cli.js 改写链的概念基础」在**第三方项目**上的独立印证。
- [cometix-restore-pipeline.md](cometix-restore-pipeline.md) —— 那条流水线的整体顺序：补丁只是其中一环。

**本地材料（`private/`，被 gitignore，公开读者不可见）：**

- `private/patches/` —— 23 个 acorn AST 补丁脚本。其中 `fix-claude-copy.mjs`、`fix-claude-line-streaming-windows.mjs`、`claude-code-AskUserQuestion-preview-patch.mjs` 三个 `.mjs` 锁 `acorn@8.14.0`；`apply-claude-code-*.ps1` / `.sh` 系列锁 `acorn@8.16.0`。上一节的定位策略示例即出自 `fix-claude-copy.mjs`。

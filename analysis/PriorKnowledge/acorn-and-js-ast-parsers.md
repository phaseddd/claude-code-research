---
title: acorn 与 JavaScript AST 解析工具
kind: concept
status: draft
updated: 2026-07-09
applies_to: general；acorn 事实截至 2026-07（v8.17.0）
tags:
  - topic:ast
  - topic:acorn
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
- **诞生**：2012 年下半年（一手博客与二手资料在 9 月 / 10 月间有一月之差，待一手核）。作者自述初衷是「没有非做不可的理由」，主要图「小而定义清晰的系统好玩」，外加想在性能上胜过当时的 Esprima；关键差异就是上面说的运算符优先级解析。
- **当前版本**：**8.17.0**（2026-06 发布，已随 Node.js v26.4.0 于 2026-06-24 纳入）。8.17.0 新增 ES2025 import attributes、ES2025 RegExp modifiers、ES2025 重复捕获组名，并升级到 Unicode 16.0。
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

## 在 AI 编程工具 / Claude Code 语境

核心思路是**把代码当结构化数据而非纯文本**：AST 捕获「程序含义」利于索引/embedding；tree-sitter 的 CST 保精确源位置，利于检索与精确编辑。

要点澄清：**这个语境下的主流证据大多指向 tree-sitter，而非 acorn**。相关工具如 `ast-grep`（结构化搜索/重构）、`difftastic`（按 AST 节点做结构化 diff）、`probe`（ripgrep 速度 + tree-sitter 的语义搜索）、以及各种经 MCP 把符号/调用图喂给 Claude Code/Cursor 的项目，底层多是 tree-sitter。**acorn 在 AI 工具内的直接用途缺乏公开证据**（见「证据边界」）。

## 在本项目中的含义

本仓库做 Claude Code 逆向研究时，`private/analysis/` 下的 patches 需要解析并改写**打包后的 `cli.js`**。经冲突复检核对，本项目补丁**一律用 acorn**：`acorn.parse` 解析 → 定位并改写 AST 节点 → 改完再 `acorn.parse` 复解析验证；**从不用 Babel，也非纯正则**。这正是「用 AST 而非字符串」原则的直接应用 —— 面对压缩混淆过的大文件，结构化改写比文本替换稳得多。因此 acorn / ESTree 是这条改写链的概念基础。

> 版本细节：项目补丁**锁定**的是 acorn `8.14.0`（`.mjs` 脚本）/ `8.16.0`（`.ps1` 脚本），和本页说的「生态最新 8.17.0」是「项目锁定版本 vs 生态最新版本」的区别，别混淆。

## 常见误解

- ❌「espree 是 acorn 的 fork」 → 实为**包装** acorn 的翻译层。
- ❌「acorn 能直接解析 TS/JSX」 → **不能**，需插件（acorn-jsx）或换 Babel / typescript-eslint。
- ❌「CST = AST」 → 不同：CST 保留全部语法细节，AST 是去噪抽象版。
- ❌「Rust 解析器从 Node 调用一定更快」 → 小文件未必，有 FFI + 序列化开销。
- ❌「acorn 最新是 8.15」 → 已到 **8.17.0**（版本会动，以 CHANGELOG 为准）。

## 依据（证据与复核）

**版本号已核对**：acorn **8.17.0** 经 WebSearch 核对（npm 官方页 + Node.js v26.4.0 发布说明，2026-06-24 纳入），**修正了上一轮素材里 8.15.0 vs 8.17.0 的冲突**。

**主要来源：**

- acorn 本体 / CHANGELOG：<https://github.com/acornjs/acorn> ；<https://github.com/acornjs/acorn/blob/master/acorn/CHANGELOG.md>
- 作者自述：<https://marijnhaverbeke.nl/blog/acorn.html>
- npm：<https://www.npmjs.com/package/acorn>
- ESTree 规范：<https://github.com/estree/estree>
- espree 由来：<https://eslint.org/blog/2014/12/espree-esprima/>
- Babel parser：<https://babeljs.io/docs/babel-parser>
- typescript-eslint：<https://typescript-eslint.io/packages/parser/>
- oxc 基准：<https://oxc.rs/docs/guide/benchmarks>
- AST 概念：<https://en.wikipedia.org/wiki/Abstract_syntax_tree> ；<https://eli.thegreenplace.net/2009/02/16/abstract-vs-concrete-syntax-trees>
- Pratt 解析：<https://matklad.github.io/2020/04/13/simple-but-powerful-pratt-parsing.html> ；<https://journal.stuffwithstuff.com/2011/03/19/pratt-parsers-expression-parsing-made-easy/>
- 各家解析器综述：<https://www.pkgpulse.com/guides/acorn-vs-babel-parser-vs-espree-javascript-ast-parsers-2026>

**证据边界（未确认 / 待核）：**

- 本次入库时一手页面抓取（WebFetch）不可用（网关 503/403），除版本号外的多数事实来自 **WebSearch 对权威源的摘要**，引用 URL 指向其所据的权威页。
- acorn 下载量的精确数字（不同聚合器给「月 9.39 亿」「周 2.17 亿」），量级可信、精确值存疑。
- ESTree 指导委员会「ESLint/Acorn/Babel 三方」来自二手综述，未逐字核对成员名单。
- acorn 在 AI 编程工具内的**直接**用途缺公开证据；主流证据指向 tree-sitter。Claude Code 是否内部用 acorn，未查到公开证据。
- ES2025/ES2026 逐项语法覆盖未逐条核实（`using`/`await using`、import attributes、RegExp modifiers 已确证）。

## 待维护者拍板（第 3 步冲突复检 = WARNING）

冲突复检（全新上下文子代理）总裁决 **WARNING**，无 BLOCKER（全库当前无 `status: active` 的 workflow 页可被推翻）。以下三点需人工拍板，故本页暂留 `status: draft`：

1. **旧文是否标 stale**：`private/analysis/old/docs/JavaScript-AST-解析工具深度指南.md` 记的 acorn 版本（8.16.0）、把 acorn 单述为「递归下降」、首发「10 月」，已被本页更新或精化。是否给旧文标 stale 或加「版本 / 概念以本页为准」注记？（旧文无本 workflow 的 frontmatter、非 active，故不构成 BLOCKER，本轮不擅改。）
2. **acorn 首发月份**：本页「2012 下半年（9 月存疑）」vs 旧文「10 月」，待一手来源（作者博客 / CHANGELOG）定稿。
3. **证据边界**：本次一手页面抓取（WebFetch）网关不可用，除已核的版本号外，多数事实来自 WebSearch 对权威源的摘要（见「依据」）。

## 相关页面

**概念 ↔ 实战 配套**（冲突复检确认：同主题但互补，不重复、不合并）：

- `private/analysis/old/docs/JavaScript-AST-解析工具深度指南.md` —— 同主题的**实战深度手册**（完整 API 选项、ES5 节点类型速查、真实 patch 的 AST 树例、代码生成 / 遍历生态、四步补丁走查）。本页是「概念 + 当前事实」入口，旧文是「实战深度」配套。

**本项目 acorn 用法的硬证据：**

- `private/analysis/04-patch-system.md` —— acorn 解析 → astPatch → patch 后 acorn 复解析验证的完整链路。
- `private/analysis/01-file-by-file.md` —— 明列「acorn：解析 JavaScript AST，用于补丁和验证」。
- `private/analysis/00-overview.md` —— 「补丁尽量基于结构而非纯字符串……用 acorn 解析 AST」。
- `private/analysis/old/patches/fix-claude-copy.mjs`、`fix-claude-line-streaming-windows.mjs`、`claude-code-AskUserQuestion-preview-patch.mjs` —— 三个 acorn AST 补丁实例。
- `private/patches/apply-claude-code-cleanup-period-fix.ps1`（及同目录 `.sh`）—— 当前活跃的 acorn AST 补丁集。

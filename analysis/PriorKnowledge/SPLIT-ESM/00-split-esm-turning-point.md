---
title: 2.1.242 分水岭：从单文件 CJS 到分块 ESM
kind: concept
status: active
updated: 2026-09-13
applies_to: "CometixSpace/claude-code master@a14c5e5（452353d..a14c5e5 共 19 个提交，2026-09-08 至 09-10）；官方 split-ESM 自 v2.1.242 起；本页实测对象为已发布的 @cometix/claude-code 2.1.242 / 246 / 250 / 251 / 259 / 261 / 263 win32-x64 安装树"
tags:
  - topic:claude-code
  - topic:bun-sea
  - topic:split-esm
  - form:concept
---

# 2.1.242 分水岭：从单文件 CJS 到分块 ESM

## 一句话解释

官方 Claude Code 在 v2.1.242 换掉了 Bun SEA 里的内嵌形态：以前是一份约 28 MB 的 CommonJS 大包，现在是一份约 20 KB 的 ESM 入口加上一千多个互相 import 的 `chunk-*.js`。[BUN2JS](../BUN2JS/00-cometix-restore-pipeline.md) 那条「抽出一份 cli.js → 过闸门 → 打补丁 → 组包」的链子在这一版整段失效，连补丁都还没轮到就退出了。提交 `452353d` 起，Cometix 仓库并存两条管线，按版本号二选一；其后十八个提交全是把新管线从「darwin 上能跑」收敛到「八个平台都能发布」。

## 旧管线为什么停在打补丁之前

`scripts/verify-node-compat.mjs` 的 `CHECKS` 里三项 severity 为 fatal。2.1.242 的抽出入口直接踩掉两项：

| fatal 检查 | 单文件 CJS 时代 | 2.1.242 的 ESM 入口 |
|---|---|---|
| 以 `// @bun` 开头，且正文含 `(function(exports, require, module, __filename, __dirname)` | 成立 | 只剩 `// @bun @bytecode`，没有 CJS 外壳 |
| 全文 `require(` 至少 100 次 | 成立（几千次） | 入口只有十几 KB，模块之间靠 `import` 连接 |
| 能用 `VERSION:"x.y.z"` 抽出版本 | 成立 | 仍成立 |

`fetchAndProcess` 第 3 步拿到 `compatible` 为假就 `process.exit(1)`，所以 2.1.242 之后的版本在 Cometix 侧表现为「构建在抽出之后立刻整进程退出」，不是「补丁打歪了」。这一点决定了修复的形状：不是补一个补丁，而是加一条平行管线。

## 分界写死在常量里，不靠嗅探

`scripts/fetch-and-process.mjs`：

```js
const FIRST_SPLIT_ESM_VERSION = '2.1.242';
// ...
const splitEsm = semver.gte(version, FIRST_SPLIT_ESM_VERSION);
```

`452353d` 的提交信息写明这个 2.1.242 是拿官方二进制二分出来的：2.1.240 与 2.1.241 内嵌 15 个模块，2.1.242 内嵌 1391 个。`verify-node-compat.mjs` 的注释也点明「用哪套检查由上游版本号决定，不在这里嗅探」。

两条管线在第 3 步分叉，此前（读清单、下八份二进制）与此后（下 wrapper、组包、清理）共用同一段编排：

| 环节 | `splitEsm === false`（≤ 2.1.241） | `splitEsm === true`（≥ 2.1.242） |
|---|---|---|
| 抽出 | `extract-worker.mjs` 独立进程（新，见 [03](03-extraction-worker-and-encoding.md)） | 同上 |
| 闸门 | `CHECKS`（3 fatal，结构底线） | `ESM_CHECKS`（3 fatal，另一组底线） |
| 补丁 | `patchFile(cliSrc, patchedPath)`，单文件进单文件出 | `patchSplitEsm({ extractDir, entryRel })`，整棵目录原地改写 |
| 落点定位 | 补丁计数掉到 0 就看得出来 | `patch-sites.mjs` 先扫一遍并断言（见 [02](02-patch-site-registry.md)） |
| 平台包 | 一份补过的 `cli.js` 加 `vendor/` | 整棵模块树，`type: module` |

`ESM_CHECKS` 的三项 fatal 换成了分块布局自己的结构底线：入口以 `// @bun` 开头、入口里存在经 BunFS 根的 import、仍有 `VERSION:"x.y.z"`。它验的不再是「这是不是一份 CJS 程序」，而是「这是不是一棵还能靠改路径救活的 ESM 图」。

## 新管线由哪些脚本组成

`452353d` 之后 `scripts/` 多了五个文件，`test/` 从零开始：

| 文件 | 职责 | 专页 |
|---|---|---|
| `esm-chunk-patch.mjs` | E1–E5 五类改写，整棵目录逐文件过一遍 | [01](01-esm-chunk-rewrites.md) |
| `patch-sites.mjs` | 声明每个补丁落在哪种 AST 形状上，扫描并断言其存在 | [02](02-patch-site-registry.md) |
| `patch-site-worker.mjs` | 上面那次扫描的工作线程一侧 | [02](02-patch-site-registry.md) |
| `extract-worker.mjs` | 抽出改到独立进程里做，并按 Bun 的 `encoding` 标签解码文本 | [03](03-extraction-worker-and-encoding.md) |
| `bun-api-coverage.mjs` | 把 polyfill 和「bundle 实际调了哪些 `Bun.*`」两边都从 AST 读出来对账 | [04](04-bun-api-coverage-and-polyfill.md) |
| `test/esm-text-assets.test.mjs` | 文本资产路径解析的回归测试，配 `.github/workflows/test.yml` | [05](05-split-package-layout-and-release.md) |

同期改动最大的仍是老脚本 `node-compat-patch.mjs`：P1–P10 的判定条件被抽成一张 `MATCHERS` 表，`astPatch` 多了 `sourceType` 参数，从而同一套补丁能同时作用于 CJS 单文件和 ESM 分块。

## 十八个后续提交在收敛什么

`452353d` 只在 darwin 上验证过。其后的提交按「暴露问题的平台 / 版本」排开来是这样：

| 触发条件 | 症状 | 提交 |
|---|---|---|
| win32 二进制 | BunFS 前缀是 `B:/~BUN/root/`，P3 / P10 判定只认 `/$bunfs/root/`，落点扫描报 0 并中止 | `96bb4d4` |
| 八个平台连跑 | 第一个平台做完就段错误；lief 的原生对象图不受 JS 堆管辖 | `b32d601` → `4f337d8` |
| win32 二进制 | P5 在 Windows 上本就无事可做，却被标成 required 而卡住构建 | `230c438` |
| win32 二进制 | 构建机路径在 Windows 上写成 `D:\a\claude-cli-internal\...`，P1 只认正斜杠 | `aa16c29` |
| 官方 2.1.246 | 内嵌技能资产改成 164 个松散 `.md`/`.txt`，Node 会把 markdown 当 JS 编译 | `bfd7b4e` |
| 官方 2.1.250 | 分块之间开始用 `require` 互相加载，8 处成环，Node 抛 `ERR_REQUIRE_CYCLE_MODULE` | `a6b2c5f` |
| 官方 2.1.259 | 上一条的处理方式（环内返回 `undefined`）在读整个工具对象的落点上把启动打死 | `935036b` |
| polyfill 手工维护 | `Bun.TOML`、`Bun.connect` 自 2.1.242 起一直缺，只因在冷路径上没人撞到 | `6bbbd95` |
| 自己造的 `vendor/` 布局 | 原生模块和静态资产被搬进 `vendor/`，而改写后的字面量指向包根 | `07d65a4` |
| 假设「每个 chunk 都在根上」 | `import.meta.dirname` 是引用方所在目录，不是包根 | `0f672d5` |
| 从项目目录启动 | 文本资产走 `readFileSync` 时按 `process.cwd()` 解析 | `3bf95d4` |
| 发布作业 | 平台包发布失败被 `|| echo` 吞掉，主包照发，optional 依赖指向不存在的版本 | `2908539` |

余下三个是文档与测试收尾：`eaccd61`、`57c01ca` 重写 README，`a14c5e5` 修一条只在 macOS 上失败的断言。两条 `changelog: sync` 只是把上游 `CHANGELOG.md` 覆盖过来，不含逻辑。

时间线与「哪个已发布版本第一次带上哪个修复」的实测对照在 [06](06-version-timeline-evidence.md)。

## 术语（本组页面统一用法）

| 词 | 指什么 |
|---|---|
| 分块 / chunk | 官方 split-ESM 产物里的 `chunk-<八位随机串>.js`。它们是代码分割产物，不是 npm 包，也不是 Bun 特有格式 |
| split-ESM | 本组页面对「≥ 2.1.242 的内嵌形态」的统称：一份 ESM 入口加一批互相 import 的分块 |
| single-CJS | 对应「≤ 2.1.241 的内嵌形态」：一份带 Bun CJS 外壳的 CommonJS 大包 |
| 补丁落点 / patch site | 某个补丁要改的那处 AST 形状。一个落点可能出现在多个文件里，也可能一个都不剩 |
| 标记串 / marker | 判断「这个文件值不值得解析 AST」的廉价子串，例如 `_cc_bin`。它不是判定条件，只是过滤器 |
| 提升 / hoist | 把顶层的 `require("./chunk-x.js")` 之前补一条 `import "./chunk-x.js"`，逼 ESM 先求值目标 |
| 惰性替身 / lazy stand-in | 环内取不到真值时先交出去的 Proxy，首次被碰时才去解析真正的导出 |
| zstd 帧 | 以 `28 B5 2F FD` 四字节开头的压缩数据。官方自 2.1.251 起把内嵌文本压成这种形式 |
| BunFS 双根 | POSIX 构建是 `/$bunfs/root/`，PE 构建是 `B:/~BUN/root/`。两者都得认，见 `BUNFS_ROOTS` |

## 常见误解

- 「2.1.242 是 Cometix 的补丁失效了。」不成立。失败发生在 `verifyNodeCompat`，比 `patchFile` 更早；两项 fatal 描述的是单文件 CJS 的结构底线，而新入口根本不是那种文件。
- 「新旧管线靠读文件内容判断。」不成立。`splitEsm` 由 `semver.gte(version, '2.1.242')` 算出，`verify-node-compat.mjs` 的注释明确说边界由上游版本号给出、不在此嗅探。
- 「split-ESM 下 P3 / P10 还在改写路径。」不成立。E2 在 `astPatch` 之前就把所有残留的 BunFS 字面量改成相对路径了，两条补丁的改写分支在分块管线上永远匹配不到；它们的判定条件只作为落点扫描的断言活着。实测 2.1.263 成品里 `__ccVendorNode` / `__ccAsset` / `"vendor","assets"` 全部为 0 次，原生模块写成 `"./audio-capture.node"`。
- 「一千多个分块意味着一千多次 AST 解析。」不成立。整棵树里带标记串的文件约在百位数，`patch-sites.mjs` 的第一遍子串过滤把绝大多数挡在解析之外。

## 依据

- `scripts/fetch-and-process.mjs`：`FIRST_SPLIT_ESM_VERSION`、`semver.gte`、第 3 步的 `if (splitEsm)` 分叉、`verifyNodeCompat(cliSrc, splitEsm)`。
- `scripts/verify-node-compat.mjs`：`CHECKS` 与 `ESM_CHECKS` 两组，以及第 123–124 行「由上游版本号决定、不在此嗅探」的注释。
- `git show 452353d`：提交正文给出 2.1.240/241 内嵌 15 个模块、2.1.242 内嵌 1391 个的二分结论，以及六项改动的分工。
- `git log 452353d..a14c5e5`：十八个后续提交的正文，逐条给出触发版本 / 平台与验证方式。
- 实测 `artifacts/2.1.263/global-prefix/node_modules/@cometix/claude-code`（win32-x64）：顶层 1824 个条目，其中 1627 个 `chunk-*.js`；`cli.js` 18332 字节；`/$bunfs/root/` 与 `B:/~BUN/root/` 各 0 次。

**未确认：** 本轮没有实跑一次 `fetchAndProcess`，管线行为取自源码与已发布成品的对照，不是一次构建日志。「2.1.242 内嵌 1391 个模块」沿用提交正文，没有自己对两版官方二进制重抽一次。表格里各提交与官方版本的对应关系取自提交正文自述，除 [06](06-version-timeline-evidence.md) 已实测的那几项外没有逐条复核。

## 相关页面

- [E1–E5：分块 ESM 的五类改写](01-esm-chunk-rewrites.md)
- [补丁落点登记表与扫描](02-patch-site-registry.md)
- [抽出进独立进程，与文本编码的坑](03-extraction-worker-and-encoding.md)
- [Bun API 对账与 polyfill 补齐](04-bun-api-coverage-and-polyfill.md)
- [split 下的包布局与发布作业](05-split-package-layout-and-release.md)
- [版本时间线与实测证据](06-version-timeline-evidence.md)
- [BUN2JS：单文件 CJS 时代的还原链](../BUN2JS/00-cometix-restore-pipeline.md)

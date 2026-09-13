---
title: 补丁落点登记表与扫描
kind: mechanism
status: active
updated: 2026-09-13
applies_to: "CometixSpace/claude-code master@a14c5e5 的 scripts/patch-sites.mjs 与 patch-site-worker.mjs；官方 split-ESM 自 v2.1.242 起；实测对象为已发布的 @cometix/claude-code 2.1.263 win32-x64 安装树"
tags:
  - topic:claude-code
  - topic:bun-sea
  - topic:split-esm
  - form:mechanism
---

# 补丁落点登记表与扫描

## 一句话结论

单文件时代，一条补丁失配会让日志里的计数掉到 0，一眼看得见。分块之后同一条补丁散落在上千个压缩文件里，「落点悄悄换了地方」和「这个文件从来就没有过」在计数上完全一样。`scripts/patch-sites.mjs` 因此把每条补丁要找什么显式登记下来，用 `astPatch` 自己那套 AST 判定条件去定位，并对标成 required 的落点做断言：消失就让构建失败，而不是让补丁作为空操作发出去。

## 为什么不能用正则找

`452353d` 的提交正文给了一个具体反例：P5 真正落在 `chunk-kw9r9dw8` 里，而仅仅提到那个环境变量名的分块是另一个。压缩之后空白、标识符名、成员访问形式在每次构建之间都会变，拿正则去猜压缩文本会猜错文件。

所以定位必须和改写一样可靠——问 AST，不问文本。做法是把每条补丁的判定条件抽成一张共享表，登记表里的每个落点指向表里的一个键：

```js
// node-compat-patch.mjs
export const MATCHERS = { p1Paths, p1Requires, p1Dirnames, p2, p3, p10, p5, p7, p8 };
export function findSites(code, sourceType = 'script') { /* 走一遍，报哪些命中 */ }
```

`astPatch` 改写时用它们，扫描时也用它们。注释点明这样做的收益：扫描不可能声称一个落点存在、而改写又漏掉它——两边对同一棵 AST 问同一个问题。`findSites` 与 `astPatch` 的区别只在于前者不需要偏移量，走一遍报布尔值就够。

## 登记表的四个字段

```js
{
  id: 'P5-search-tools',
  matcher: 'p5',                    // MATCHERS 里的键，真正的判定条件
  description: '…',
  marker: 'CLAUDE_CODE_ENTRYPOINT', // 廉价子串，只决定「这个文件值不值得解析」
  expect: 'optional',               // 'required' 则消失即构建失败
  markerSurvivesUnpatched: true,    // 标记串合法地活过补丁，不参与走形告警
}
```

`marker` 不是判定条件，只是过滤器。注释给的量级是：约 1375 个分块全量解析要花几分钟，这层过滤把需要解析的压到约 85 个。

当前十条落点：

| id | matcher | 标记串 | expect | 备注 |
|---|---|---|---|---|
| `P1-fileurl` | `p1Paths` | `claude-cli-internal` | optional | split-ESM 下打包器不再包 `fileURLToPath()`，本就没有 |
| `P1-createrequire` | `p1Requires` | `claude-cli-internal` | optional | 同上 |
| `P1-dirname` | `p1Dirnames` | `claude-cli-internal` | optional | 2.1.242 起构建机路径改成裸 `__dirname` 赋值 |
| `P2-bun-guard` | `p2` | `Bun required` | optional | polyfill 已覆盖；留着是为了它回来时能被注意到 |
| `P3-napi` | `p3` | `.node"` | **required** | 原生模块加载 |
| `P5-search-tools` | `p5` | `CLAUDE_CODE_ENTRYPOINT` | optional | 只有 macOS/Linux 构建会内联，见下 |
| `P7-proxy-agent` | `p7` | `HttpsProxyAgent` | **required** | |
| `P8-shadow-fn` | `p8` | `_cc_bin` | **required** | |
| `P10-assets` | `p10` | `.min.js"` | **required** | 内嵌 artifact 运行时 |
| `P10-template` | `p10` | `.asset"` | optional | 自 2.1.229 起才有的 design-canvas 模板 |

两个细节值得单独记：

- **P10 的标记串取扩展名，不取 BunFS 根。** 注释写明理由：每个分块的 import 指示符里都带着那个前缀，用它当过滤器等于不过滤。
- **同一个 matcher 可以挂两个落点。** `P10-assets` 与 `P10-template` 共用 `p10`，只是标记串和 `expect` 不同——这让「artifact 运行时没了」和「design-canvas 模板还没出现」变成两条可分别读的报告行。
- **三条 P1 共用一个标记串。** 这正是走形告警要处理的情况，见下节。

## 两遍扫描

```
Pass 1  逐个读文件 → mayContainPatchSite() 子串过滤 → 顺带统计每个标记串出现在几个文件里
Pass 2  对幸存者做真正的 AST 遍历，跨工作线程
```

第一遍一次只读一个文件就丢掉。注释给的理由是内存：整棵树约 40 MB，而一次 release 要为八个平台各走一遍自己的副本。

第二遍按文件大小从大到小排队（「长杆先起跑，别吊在快跑完的批次后面」），然后起 `min(concurrency, 队列长度)` 个 worker，`concurrency` 默认是 `max(1, min(4, availableParallelism() - 1))`。队列少于 4 个文件、或 `concurrency` 为 1 时退回进程内串行——注释说明此时起 worker 和每线程再建一份模块图的开销超过省下的解析。

`patch-site-worker.mjs` 只有二十行，设计要点是**常驻**：每条消息处理一个文件，这样约 7 MB 的大分块不用各自付一次 worker 启动成本，模块图每线程解析一次而不是每文件一次。

内存约束在两侧都写进了注释。`siteIdsIn` 的做法是「解析、收集、丢掉」：

```js
function siteIdsIn(code, sourceType) {
  try { return siteIdsFor(findSites(code, sourceType)); }
  catch { return []; }   // 解析不了的文件不可能含落点
}
```

一个 7 MB 压缩分块的 AST 有数百万个节点，不能让它活过这次遍历；同时持有好几棵、再乘以八个平台，就是 `b32d601` 里那次把堆耗尽的原因（见 [03](03-extraction-worker-and-encoding.md)）。

worker 完成顺序不确定，所以 `found` 里每个列表最后都 `sort()` 一遍，报告才稳定。

`scanSources(fileMap, sourceType)` 是同一套逻辑的单线程版，导出给「已经持有源码」的调用方；当前仓库里没有使用者。

## 两种失败：消失的落点、走形的构造

`finish()` 算两件事。

**missing**：`expect === 'required'` 且命中文件数为 0。`patchSplitEsm` 把它带回给 `fetch-and-process.mjs`：

```js
if (st.sites.missing.length > 0) {
  console.error(`  ✗ ${platform} — required patch sites missing: …`);
  process.exit(1);
}
```

报告里的措辞是 `The upstream bundle changed shape — those patches would ship as no-ops.`——这道闸挡的是「补丁作为空操作发出去」，不是「补丁打错了」。

**stale**：标记串还在，但共用它的所有落点一个都没命中。报告行写成

```
[??] "…" still in N file(s), but P…/P… matched none
     The construct is there in a shape the predicate no longer knows.
```

注释把它的价值说得很准：标记串是「这个构造在这里」的廉价代理；它活着而判定条件全部失配，说明构造换了形状。两个设计取舍：

- 只有共用某标记串的落点**全部**失配才告警。构造在兄弟落点之间搬家是正常的——`aa16c29` 的正文举了 2.1.241→2.1.242 的例子：`fileURLToPath("file:///…")` 变成裸 `__dirname` 赋值，`P1-fileurl` 合法地掉到 0，只因为 `P1-dirname` 接住了。
- 对 optional 落点也报。注释写明：optional 落点安静下来，恰恰是那种否则就会漏过去的情况。

`markerSurvivesUnpatched` 是给「标记串合法地活过补丁」的落点开的口子，目前只有 P5 用，理由见下节。

**这条走形告警不是事后总结出来的经验，它自己抓到过一次事故。** `aa16c29` 的正文写明：P1 原先只测 `/claude-cli-internal/`，所以只看得见正斜杠路径；win32 二进制烘进去的是同一份 checkout 的反斜杠形式

```js
var __dirname = "D:\\a\\claude-cli-internal\\claude-cli-internal\\..."
```

其中两处——grpc-js 与 `@ant/computer-use`——在 2.1.242 里就这么没打补丁地发了出去，仍然对着构建机目录解析 proto 目录。提交正文明确说这是**新加的检查发现的，不是读代码读出来的**。修法是把判定条件的正则改成 `/[\\/]claude-cli-internal[\\/]/`，两种分隔符都认。

## 计数在各平台天然不同，所以只断言存在

`57c01ca` 把这件事写进了 README：上游多数原生模块只为一个平台构建。

| 模块 | darwin | linux | win32 |
|---|:-:|:-:|:-:|
| `audio-capture` | ✓ | ✓ | ✓ |
| `image-processor` | ✓ | ✓ | ✓ |
| `computer-use-swift` | ✓ | | |
| `computer-use-input` | ✓ | | |
| `url-handler` | ✓ | | |
| `clipboard-napi` | | ✓ | |

所以 darwin 包带五个、linux 三个、win32 两个，P3 的命中数各平台不同。登记表因此断言「required 落点存在」，而不是「命中固定条数」。实测 2.1.263 win32-x64 主包根上恰好是 `audio-capture.node` 与 `image-processor.node` 两份，对得上。

`clipboard-napi` 在 README 里被单独点出：它只在 linux 上，而且走自己的查找——先试内嵌副本，再退回 `vendor/clipboard-napi/<arch>-<os>/`。保留抽出自带的布局（见 [01](01-esm-chunk-rewrites.md) 的 E2 第二版）意味着第一条路径就能解析成功，回退永远不必走。

## P5 在 Windows 上无事可做

P5 存在的目的是撤销一次内联。macOS 与 Linux 构建会把守卫编译成 `isEnvTruthy("true")`，于是 shadow 模式恒开、Grep/Glob 工具被藏起来。Windows 构建保留原样——`230c438` 的正文给的形态是：

```js
function ou(){if(!So(process.env.EMBEDDED_SEARCH_TOOLS))return!1;…}
```

这正是 P5a 想恢复的样子，所以那里没什么要改。把它标成 required 曾经让 2.1.242 的构建停在 win32-arm64，为的是一条本就无事可做的补丁；改成 optional 加 `markerSurvivesUnpatched` 之后，标记串 `CLAUDE_CODE_ENTRYPOINT` 继续出现也不再触发走形告警。

实测 2.1.263 win32-x64 成品里这个函数是：

```js
function R_(){if(!Pe(process.env.EMBEDDED_SEARCH_TOOLS))return!1;if(QMn())return!1;return a.CLAUDE_CODE_ENTRYPOINT…
```

环境变量读取完好、`__dpBinOk` 一次都不出现，与提交正文描述一致。

同一条提交还顺带说明了 P3 的平台差异「本来就是对的」，不需要改。

## 让 win32 落点从 0 变回可见的那一步

`96bb4d4` 是这条扫描机制上线后抓到的第一个问题。P3 与 P10 的判定条件当时字面匹配 `/$bunfs/root/`，而 win32 构建里 Bun 嵌的是 `B:/~BUN/root/`，于是每个原生模块和资产常量都检测不到。2.1.242 的构建走到 win32-arm64 才被扫描拦下：

```
[! ] P3-napi          0 file(s)
[! ] P5-search-tools  0 file(s)
[! ] P10-assets       0 file(s)
```

修法是把两条判定条件和它们的改写都改走 `bunfsTarget()`，这个 helper 遍历 `BUNFS_ROOTS`——那份常量本来就为指示符改写同时带着两个前缀，只是补丁侧没用上。

值得注意的是这三行报告的性质：它们不是运行时崩溃，是构建期断言。同一个问题在没有落点扫描的年代会表现为「win32 包装上之后加载原生模块失败」，而且只在用户机器上出现。

## 报告长什么样

`formatScanReport` 每个落点一行，标记为 `OK` / `! `（required 且为 0）/ `--`（optional 且为 0）：

```
  [OK] P3-napi               2 file(s)  chunk-hzta6v2x.js, chunk-…
  [--] P5-search-tools       0 file(s)  —
  [??] "claude-cli-internal" still in 3 file(s), but P1-fileurl/P1-createrequire/P1-dirname matched none
       The construct is there in a shape the predicate no longer knows.

  Missing required sites: P7-proxy-agent
  The upstream bundle changed shape — those patches would ship as no-ops.
```

命中文件多于两个时只印第一个加 `(+N more)`。

## 常见误解

- 「标记串就是判定条件。」不是。标记串只决定要不要解析这个文件；命中与否由 `MATCHERS` 里的 AST 判定条件决定。两者不一致正是走形告警要报的事。
- 「optional 落点掉到 0 无所谓。」不对。optional 只是不让构建失败；它安静下来照样进走形告警，注释明确说这是最容易漏过去的情况。
- 「required 落点保证了补丁一定生效。」它只保证落点在改写之前**存在**。P3 / P10 在分块管线上的改写分支其实永远匹配不到（E2 先把 BunFS 字面量清掉了），required 断言在这里的意义是「上游还在用这种形状引用原生模块和资产」。
- 「扫描跑在改写之后。」反了。`scanPatchSites` 是 `patchSplitEsm` 的第一步，因为改写会擦掉它要找的标记串。

## 依据

- `scripts/patch-sites.mjs` 全文：`PATCH_SITES` 十条、`AST_MARKERS`、`mayContainPatchSite`、`countMarkers`、`scanSources`、`siteIdsIn`、`finish`、`scanPatchSites`、`formatScanReport`，以及文件头与各函数上方注释给出的量级（1375 → 约 85、约 94%）。
- `scripts/patch-site-worker.mjs`：常驻、每消息一文件。
- `scripts/node-compat-patch.mjs`：`MATCHERS`、`findSites`、`bunfsTarget`、`BUILD_DIR_RE`。
- `scripts/esm-chunk-patch.mjs`：`scanPatchSites` 的调用位置与「必须最先」的注释。
- `scripts/fetch-and-process.mjs`：`st.sites.missing.length > 0` → `process.exit(1)`。
- `git show 96bb4d4` / `230c438` / `aa16c29` / `452353d` / `57c01ca`：三行 0 file(s) 的原始报告、Windows 上 P5 与 P1 的实际形态、`markerSurvivesUnpatched` 的引入理由、各平台原生模块表。
- 实测 `artifacts/2.1.263/global-prefix/node_modules/@cometix/claude-code`（win32-x64）：`EMBEDDED_SEARCH_TOOLS` 出现在 2 个分块且保留 `process.env` 读取、`__dpBinOk` 0 次、根上两份 `.node`。

**未确认：** 只实测了 win32-x64 一条线，darwin 上 P5 会命中、P3 应命中五份原生模块，本轮没有对应安装树。`formatScanReport` 的样例输出是按源码格式化逻辑手写的示意，不是一次真实构建日志。走形告警除 `aa16c29` 正文自述的那一次外，没有其它可核的触发记录。

## 相关页面

- [2.1.242 分水岭](00-split-esm-turning-point.md)
- [E1–E5：分块 ESM 的五类改写](01-esm-chunk-rewrites.md)
- [抽出进独立进程，与文本编码的坑](03-extraction-worker-and-encoding.md)
- [split 下的包布局与发布作业](05-split-package-layout-and-release.md)
- [BUN2JS/03：打补丁前的 Node 兼容闸门](../BUN2JS/03-verify-node-compat-gate.md)

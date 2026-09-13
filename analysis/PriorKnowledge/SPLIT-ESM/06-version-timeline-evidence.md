---
title: 版本时间线与实测证据
kind: investigation
status: active
updated: 2026-09-13
applies_to: "已发布的 @cometix/claude-code 2.1.241 至 2.1.263 win32-x64 全局安装树（本仓库 artifacts/ 下 16 个版本）；对照 CometixSpace/claude-code 452353d..a14c5e5"
tags:
  - topic:claude-code
  - topic:npm
  - topic:split-esm
  - form:investigation
---

# 版本时间线与实测证据

## 这页干什么

前五页讲的是源码现状与各次提交的动机。这一页做一件互补的事：从**已发布的 npm 包**倒推「哪个版本的包是哪一版管线造出来的」。

源码只告诉你现在的管线长什么样。已发布的 tarball 是快照——它固定在构建那一刻，此后不会随仓库更新。所以只要挑一批在成品里留痕的特征，就能把每个 release 钉到一段管线区间上，并且直接回答「某个修复第一次真正发出去是哪一版」。

这条对照还捡到了一件源码和提交正文都没说的事：2.1.242 到 2.1.260 的成品里，四份 fs 读取型资产的路径与它们实际所在目录对不上。

## 测量方法

材料是本仓库 `artifacts/<版本>/global-prefix/node_modules/@cometix/claude-code`——十六个版本的 win32-x64 全局安装树，每个带一份 `install-summary.json`，里面的 `cliVersion` 字段记录了安装后 `claude --version` 的实际输出。

按包内可观测的痕迹取指标：

| 指标 | 怎么取 | 反映什么 |
|---|---|---|
| `chunks` | 根上 `chunk-*.js` 个数 | 上游分割粒度 |
| `zst` | 根上名字以 `.zst` 结尾的文件数 | 上游是否压缩内嵌文本 |
| `md/txt` | 根上未压缩的 `.md` / `.txt` 数 | 同上 |
| `type` / `engines` | 主包 `package.json` | `build-main-package.mjs` 的版本 |
| `shim` | 含 `__ccMakeRequire` 的 `.js` 文件数 | 有多少上游文件用了 `import.meta.require` |
| `text` | 含 `__ccReadText` | E3 的文本加载器分支是否在（`bfd7b4e`） |
| `lazyNs` | 含 `__ccLazyNs` | 环处理第一层是否在（`a6b2c5f`） |
| `lazyVal` | 含 `__ccLazyVal` | 环处理第二层是否在（`935036b`） |
| `resolve` | 含 `__ccRawRequire.resolve` | 文本目标按模块解析是否在（`3bf95d4`） |
| `.node` | 根上原生模块数 | 布局是否已停止搬动（`07d65a4`） |
| `vendor` | `vendor/` 下的子目录名 | 同上 |

`shim` / `text` / `lazyNs` 这些的**数值**混了两件事——管线有没有生成它，以及上游有多少文件用到 `import.meta.require`。所以只把「0 还是非 0」当作管线指纹读，绝对值只用来看上游的变化。

## 实测表

| 版本 | chunks | zst | md/txt | type | engines | shim | text | lazyNs | lazyVal | resolve | .node | vendor 子目录 | `--version` |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2.1.241 | 0 | 0 | 2 | — | ≥22 | 0 | 0 | 0 | 0 | 0 | 0 | assets, audio-capture, image-processor, ripgrep | 2.1.241 |
| 2.1.242 | 1372 | 0 | 2 | module | ≥22 | 1 | 0 | 0 | 0 | 0 | 0 | 同上 | 2.1.242 |
| 2.1.243 | 1372 | 0 | 2 | module | ≥22 | 1 | 0 | 0 | 0 | 0 | 0 | 同上 | 2.1.243 |
| 2.1.245 | 1374 | 0 | 2 | module | ≥22 | 1 | 0 | 0 | 0 | 0 | 0 | 同上 | 2.1.245 |
| 2.1.246 | 562 | 0 | 166 | module | ≥22 | 1 | **1** | 0 | 0 | 0 | 0 | 同上 | 2.1.246 |
| 2.1.247 | 566 | 0 | 168 | module | **≥24** | 1 | 1 | **1** | 0 | 0 | 0 | 同上 | 2.1.247 |
| 2.1.248 | 1767 | 0 | 168 | module | ≥24 | 65 | 65 | 65 | 0 | 0 | 0 | 同上 | 2.1.248 |
| 2.1.250 | 1767 | 0 | 168 | module | ≥24 | 65 | 65 | 65 | 0 | 0 | 0 | 同上 | 2.1.250 |
| 2.1.251 | 1789 | **100** | 71 | module | ≥24 | 66 | 66 | 66 | 0 | 0 | 0 | 同上 | 2.1.251 |
| 2.1.252 | 1789 | 100 | 71 | module | ≥24 | 66 | 66 | 66 | 0 | 0 | 0 | 同上 | 2.1.252 |
| 2.1.257 | 1620 | 100 | 71 | module | ≥24 | 60 | 60 | 60 | 0 | 0 | 0 | 同上 | 2.1.257 |
| 2.1.258 | 1620 | 100 | 71 | module | ≥24 | 60 | 60 | 60 | 0 | 0 | 0 | 同上 | 2.1.258 |
| 2.1.259 | 1629 | 106 | 71 | module | ≥24 | 59 | 59 | 59 | **0** | 0 | 0 | 同上 | 2.1.259 |
| 2.1.260 | 1620 | 106 | 72 | module | ≥24 | 59 | 59 | 59 | **59** | 0 | 0 | 同上 | 2.1.260 |
| 2.1.261 | 1627 | 106 | 72 | module | ≥24 | 59 | 59 | 59 | 59 | 0 | **2** | **只有 ripgrep** | 2.1.261 |
| 2.1.263 | 1627 | 106 | 72 | module | ≥24 | 59 | 59 | 59 | 59 | **59** | 2 | 只有 ripgrep | 2.1.263 |

十六个版本的 `cliVersion` 都与版本号一致，说明每一份都至少把 `claude --version` 跑通了。

## 修复第一次发出去是哪一版

把上表的指纹和提交时间对起来（各 release 由 `workflow_dispatch` 按需构建，所以顺序反映的是**构建**先后，不是版本号大小；从表里看这两者在这一段恰好一致）：

| 提交 | 日期 | 指纹 | 最后一个不带它的 release | 第一个带它的 release |
|---|---|---|---|---|
| `452353d` split-ESM 管线 | 09-08 | `type: module` + chunks | 2.1.241 | **2.1.242** |
| `bfd7b4e` 文本加载器语义 | 09-08 | `__ccReadText` | 2.1.245 | **2.1.246** |
| `a6b2c5f` require 成环第一层 | 09-08 | `__ccLazyNs` | 2.1.246 | **2.1.247** |
| `6bbbd95` Node 下限抬到 24 | 09-09 | `engines ≥24` | 2.1.246 | **2.1.247** |
| `935036b` 提升 + 惰性替身 | 09-10 | `__ccLazyVal` | 2.1.259 | **2.1.260** |
| `07d65a4` + `0f672d5` 保留抽出布局 | 09-10 | 根上有 `.node`、`vendor/` 只剩 ripgrep | 2.1.260 | **2.1.261** |
| `3bf95d4` 文本目标按模块解析 | 09-10 | `__ccRawRequire.resolve` | 2.1.261 | **2.1.263** |

两点顺带的结论：

- **`07d65a4` 与 `0f672d5` 没有任何 release 只带前者。** 两者同日落地，而它们的产物在成品里是可分的：`07d65a4` 把资产写成裸名（`"mermaid.min.js"`），`0f672d5` 改成带前缀（`"./mermaid.min.js"`）。2.1.261 已经是后者，所以那个中间状态从未发布。
- **2.1.259 那次故障没有重新构建发布。** `935036b` 的正文说 2.1.259 发出去就是坏的，而已发布的 2.1.259 tarball 里 `__ccLazyVal` 为 0——修复只进了后续版本，2.1.259 本身没有回炉。它的 `claude --version` 仍然跑得通，说明正文描述的那条「构建工具注册表」的启动路径不在 `--version` 覆盖范围内。

## 上游侧能看出的变化

同一张表也记录了官方 bundle 自己的抖动，跟 Cometix 管线无关：

- **分块数不单调。** 2.1.245 的 1374 到 2.1.246 的 562，再到 2.1.248 的 1767，再到 2.1.257 的 1620。代码分割粒度在上游反复调整，所以任何「分块数应该是多少」的断言都不可靠——这正是 [02](02-patch-site-registry.md) 里落点扫描断言「存在」而不断言「条数」的同一个理由。
- **技能资产在 2.1.246 出现。** 根上未压缩 `.md`/`.txt` 从 2 跳到 166。前面几版那个 2 是主包自带的 `README.md` 一类，不是内嵌资产。
- **2.1.251 开始压缩。** `.zst` 从 0 到 100，同时未压缩的 `.md`/`.txt` 从 168 掉到 71。这是 `6bbbd95` 补 `Bun.zstdDecompress*` 的直接原因。
- **四个成帧资产不带 `.zst` 后缀。** 按 zstd 魔数（`28 B5 2F FD`）扫，2.1.251 有 104 个成帧文件（根上 100 + `vendor/assets/` 4）、2.1.263 有 110 个（全在根上），两版里名字不带 `.zst` 的都恰好是 `chart.umd.min.js`、`hljsBundle.generated.min.js`、`mermaid.min.js`、`payload.template.html.asset`。与 `6bbbd95` 正文「四个保留原名」一致（总数与它给的 darwin 101 有差，属平台差异）。

## 顺带查到的一处错位

2.1.242 到 2.1.260 的成品里，那四份 fs 读取型资产只存在于 `vendor/assets/`：

```
vendor/assets/chart.umd.min.js
vendor/assets/hljsBundle.generated.min.js
vendor/assets/mermaid.min.js
vendor/assets/payload.template.html.asset
```

而代码里写的是

```js
var D = globalThis.__ccAsset("mermaid.min.js");
```

`bun-polyfill.mjs` 里这个 helper 的定义是

```js
globalThis.__ccAsset = (name) => name ? __ccJoin(__dirname, name) : __dirname;
```

`__dirname` 是 `bun-polyfill.mjs` 自己所在目录，也就是包根。于是路径解析到包根，文件却在 `vendor/assets/` 下——2.1.242、2.1.259、2.1.260 三个版本上逐一核对过包根没有这四个文件中的任何一个。

`07d65a4` 从结构上消掉了这个错位（不再搬动，也就不可能错位），但它的提交正文把这次改动讲成简化，没有提到此前那些版本的路径根本对不上。所以这不是一条「已知问题的修复记录」，而是这次对照新查出来的事实。

原生模块那一侧没有同类问题：`__ccVendorNode("audio-capture.node")` 是个真去 `vendor/<模块>/<cpu>-<os>/` 找的 helper，与当时的拷贝位置一致。

## 2.1.263 成品的细项核对

拿最新一版做了一轮逐项核对，结论全部为期望值：

| 检查 | 结果 |
|---|---|
| `/$bunfs/root/` 与 `B:/~BUN/root/` 残留 | 各 0 次 |
| `claude-cli-internal` 残留 | 0 次 |
| `@anthropic-ai/claude-code` 残留（P9） | 0 次 |
| `__ccAsset` / `__ccVendorNode` / `"vendor","assets"` | 各 0 次（布局改动后不再需要） |
| 原生模块加载形态 | `"./audio-capture.node"` |
| 资产引用形态 | `"./mermaid.min.js"` |
| 入口 polyfill 注入 | `cli.js` → `import"./bun-polyfill.mjs"` |
| 嵌套 worker 的 polyfill 注入 | `hooks-worker.js` → `import"../../../../bun-polyfill.mjs"`，深度 4 对得上 |
| P7 落点 | 1 个分块含 `globalThis.__HttpsProxyAgent` |
| P8 落点 | 1 个分块含 `_cc_bin` 注入 |
| P1 裸 `__dirname` 落点 | 2 个分块、3 处 `__dirname=globalThis.__ccDirname()` |
| P5 落点 | 0——守卫仍是 `if(!Pe(process.env.EMBEDDED_SEARCH_TOOLS))return!1;`，win32 上本就无事可做 |

另有两个分块里出现 `$bunfs` / `~BUN` 字样，但那是官方自己的虚拟文件系统判定代码（一个 `includes` 检查加一条正则），不带 `root/`，不是漏改的路径字面量。

`2.1.246` 那一版另外核了文本解码：根上 165 个 `.md`/`.txt`（不含主包自带的 `README.md`）全部不含 NUL 字节，首个文件可按 UTF-8 正常读出——`bfd7b4e` 那条 `encoding` 解码修复在成品里生效。

## 常见误解

- 「版本号大的 release 一定是后构建的。」不必然。发布只有 `workflow_dispatch`，且 publish 作业带 `--tag backfill` 正是为了回填旧版本而存在。本段的构建先后是从成品指纹推的，恰好与版本号同序，不能当成通例。
- 「2.1.259 被修好后重发了。」没有。已发布的 2.1.259 tarball 里没有 `__ccLazyVal`，修复只进了 2.1.260 及之后。
- 「`shim` 那一列是管线指标。」它的数值是上游指标（多少文件用 `import.meta.require`）；只有「0 还是非 0」才是管线指纹。
- 「`engines` 写 ≥22 的那几版在 Node 22 上能跑。」`engines` 只是声明。2.1.242–2.1.246 声明 ≥22，而 `6bbbd95` 抬到 24 的理由（`using` / `await using`）针对的是 2.1.251；那几版在 Node 22 上到底能不能解析，本轮没有验。

## 依据

- `artifacts/2.1.241` … `artifacts/2.1.263` 共 16 份 win32-x64 全局安装树，以及各自的 `install-summary.json`（`cliVersion` 字段）。
- 上表各列由一次遍历脚本得到：`readdirSync` 统计文件名，`readFileSync(...).includes(标记)` 统计含标记的 `.js` 文件数，`package.json` 读 `type` / `engines`，zstd 成帧按魔数 `28 B5 2F FD` 判定。
- `git log --format=… 452353d..a14c5e5`：各提交日期与正文。
- `git show 452353d:scripts/esm-chunk-patch.mjs`、`git show 452353d:scripts/build-platform-package.mjs`：E2 第一版的 `__ccVendorNode` / `__ccAsset` 形态与当时的 `skip` 集合，用来解释 2.1.242–2.1.260 的成品形态。
- 源码现状与各项设计意图见 [00](00-split-esm-turning-point.md)–[05](05-split-package-layout-and-release.md) 各页的依据节。

**未确认：** 全部实测只覆盖 win32-x64 一条平台线，因此 darwin 的五份原生模块、linux 的 `clipboard-napi` 与 `vendor/seccomp/`、musl 与 android 两条键都没有样本。`cliVersion` 只证明 `claude --version` 跑通，不证明交互启动、工具注册表、artifact 渲染等路径可用；2.1.242–2.1.260 的资产错位因此没有对应的失败现象记录。构建先后是从成品指纹推的，没有查 GitHub Actions 的运行历史。2.1.244、2.1.249、2.1.253–2.1.256、2.1.262 在 `artifacts/` 下没有目录，本页无法判断它们是未发布还是未采集。

## 相关页面

- [2.1.242 分水岭](00-split-esm-turning-point.md)
- [E1–E5：分块 ESM 的五类改写](01-esm-chunk-rewrites.md)
- [补丁落点登记表与扫描](02-patch-site-registry.md)
- [抽出进独立进程，与文本编码的坑](03-extraction-worker-and-encoding.md)
- [Bun API 对账与 polyfill 补齐](04-bun-api-coverage-and-polyfill.md)
- [split 下的包布局与发布作业](05-split-package-layout-and-release.md)

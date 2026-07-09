---
title: CometixSpace-claude-code — 从 Bun SEA 二进制恢复 Node.js npm 包
kind: case
status: active
updated: 2026-07-09
applies_to: CometixSpace/claude-code master@74d5438（镜像官方 v2.1.196）；官方 Claude Code v2.1.113+ Bun SEA 分发
tags:
  - topic:claude-code
  - topic:bun-sea
  - topic:npm
  - form:case
---

# CometixSpace-claude-code — 从 Bun SEA 二进制恢复 Node.js npm 包

## 一句话定位

`CometixSpace-claude-code`（GitHub：`CometixSpace/claude-code`）是一个**自动化构建仓库**：追踪 `@anthropic-ai/claude-code` 官方新版本，把官方从 **v2.1.113** 起改用的 **Bun SEA 原生二进制**里内嵌的 JavaScript 抠出来，打一组兼容补丁使其能在 **Node.js** 下运行，再重新组装成 npm 包 `@cometix/claude-code`（外加多平台包），并用 GitHub Actions 全自动发 Release / npm。

它**不是**一个普通源码仓库，而是一条「上游二进制 → 可运行 Node 包」的**恢复流水线**。仓库自身在 `package.json` 里的名字是 `cc-node-restore`（`private: true`），产物才是 `@cometix/claude-code`。

## 对象

| 维度 | 事实 |
|---|---|
| 仓库 | `https://github.com/CometixSpace/claude-code.git`，分支 `master` |
| 仓库自身包名 | `cc-node-restore`（工具项目，非产物） |
| 产物包 | `@cometix/claude-code`（主包）+ 9 个 `@cometix/claude-code-<platform>`（平台包） |
| 核心依赖 | `node-lief`（读二进制 section）、`acorn`（AST 补丁）、`semver` |
| 本质 | 上游闭源二进制分发物的**逆向恢复 + 重打包**自动化 |

## 当前观察基线

- 参考仓库最新提交：`74d5438 changelog: sync v2.1.196`。
- 观察到的产物标签：`v2.1.193`、`v2.1.195`、`v2.1.196`、`v2.1.197`。
- 观察时间：2026-07。
- 官方分发**断点**：`2.1.112` 是最后一个「包内直接带 `cli.js`」的纯 JS npm 包；`2.1.113` 是**第一个** Bun SEA 版本，`check-new-versions.mjs` 即以 `>= 2.1.113` 作为「SEA 版本」筛选起点。

## 背景：官方 v2.1.113 起的分发形态变化（这个仓库为什么存在）

从 `v2.1.113` 开始，官方 `@anthropic-ai/claude-code` 从「JS 主程序包」改成「**壳包 + 平台原生二进制分包**」：

- 主包 `bin` 从 `cli.js` 改成 `bin/claude.exe`（原生可执行）。
- 新增 `postinstall: node install.cjs`。
- 主包声明 8 个平台 `optionalDependencies`（`@anthropic-ai/claude-code-<platform>`）。
- `install.cjs` 在安装期把当前平台包里的原生二进制复制/硬链到 `bin/claude.exe`；**运行时不再有常驻 Node 进程**，直接跑原生二进制。
- `cli-wrapper.cjs` 只是 postinstall 失败时的 `spawnSync` 兜底启动器。
- 已知官方 issue **#50203**：Bun 默认拦截 postinstall，导致 `native binary not installed`。

这些平台原生二进制是 **Bun SEA（Single Executable Application）** 编译产物——它把打包后的 JS（`cli.js`）连同 native 模块一起**嵌进可执行文件的一个专用 section**。CometixSpace 的价值就在于：把这个内嵌 JS 抠回来，补成 Node 可跑，重新包成 npm 包，恢复出一条不依赖官方原生二进制的 Node 运行路径。

## 它解决什么问题

一句话：**官方停止以「纯 Node.js 包」形态分发 Claude Code 之后，仍要一个能在 Node.js 下运行、可 npm 安装的 Claude Code**。围绕它，仓库解决三个子问题：

1. **抠得出来**：从 MachO / PE / ELF 三种二进制格式里定位并解析 Bun 内嵌模块表，导出 `cli.js` 和 native 模块。
2. **跑得起来**：Bun 打包/编译引入的痕迹（Bun wrapper、`typeof Bun` 硬断言、`/$bunfs/` 虚拟路径、编译期常量内联、Bun 专有 API）在 Node 下会崩，需要逐条补丁 + polyfill。
3. **发得出去**：贴着官方分发模型做主包 + 平台包，用 GitHub Actions 追新版、构建、发 Release / npm。

## 主链路（一张图）

```text
官方 npm 版本列表
      ↓  check-new-versions.mjs：筛 >=2.1.113 且未处理，再用 optionalDependencies 确认是 SEA 版本
待处理版本
      ↓  fetch-and-process.mjs（主编排器）
下载 manifest + 8 平台 Bun SEA 二进制（downloads.claude.ai CDN）
      ↓  bun-sea-extract.mjs（node-lief 读 section）
导出 src/entrypoints/cli.js + native 模块
      ↓  verify-node-compat.mjs（12 项结构检查，fatal 即中止）
      ↓  node-compat-patch.mjs（acorn AST 补丁 P1/P2/P3/P5/P7/P8/P9 + P6 polyfill 注入）
patched cli.js
      ↓  下载 vendor：wrapper 包 / ripgrep / seccomp
build-platform-package.mjs × 9  +  build-main-package.mjs
      ↓  .github/workflows/release.yml
CI 冒烟验证 → 打 tarball → GitHub Release → npm publish（先平台包后主包）
```

**平台清单**：官方 8 个 SEA 平台 = `darwin-arm64` / `darwin-x64` / `linux-arm64` / `linux-x64` / `linux-arm64-musl` / `linux-x64-musl` / `win32-arm64` / `win32-x64`。仓库**额外**生成第 9 个平台包 `android-arm64`，它**复用 `linux-arm64` 的提取结果**——所以「下载 8 平台、构建 9 平台包」两个数字都对，差的就是这个复用包。

## 关键结构（逐环节）

### 1. 版本检测 · `check-new-versions.mjs`

- `npm view @anthropic-ai/claude-code versions --json` 取全部版本。
- 筛：版本 `>= 2.1.113` 且不在 `existing`（已发布集合）里。
- 对每个候选再查 `optionalDependencies`，**只有存在 `@anthropic-ai/claude-code-linux-x64` 才认定是 SEA 版本**——不盲信版本号，用分发结构反证。
- CI 里 `existing` 由 `gh release list` 得到（用「已发过的 GitHub Release」去重）。

### 2. Bun SEA 提取 · `bun-sea-extract.mjs`（技术核心）

用 `node-lief` 读二进制 section，按魔数分格式：

```text
MachO  magic 0xFEEDFACF（另识别 0xCEFAEDFE）  segment __BUN → section __bun   base path /$bunfs/
PE     "MZ"  0x5A4D                            section .bun                    base path B:/~BUN/
ELF    0x7F454C46                              section .bun                    base path /$bunfs/
```

Bun 数据的内部布局（硬参数）：

```text
size prefix   段首 8 或 4 字节长度；校验 prefix_size + data_size == section 长度
trailer       段尾固定 "\n---- Bun! ----\n"（16 字节），不匹配即报错
offset table   trailer 前 32 字节：byteCount(BigUInt64LE) / modulesPtr{offset,length} / entryPointId
module entry   V1 = 36 字节/条目，V2 = 52 字节/条目；用「模块表长度能否整除条目大小」判定版本
```

每个模块解析出：`name` / `contents` / `sourcemap` / `encoding` / `loader`（jsx/js/ts/tsx/css/json/napi/…）/ `format`（none/esm/cjs）/ `side`。导出时去掉 Bun 虚拟路径前缀（`/$bunfs/`、`B:/~BUN/`）和 `root/`，entry point 按 loader 修正扩展名：

```text
/$bunfs/root/src/entrypoints/cli.bytecode  →  src/entrypoints/cli.js
```

- 目标核心文件是 `src/entrypoints/cli.js`，首行签名 `// @bun @bytecode @bun-cjs`。
- 提取产物是**一组模块**（观察到约 5 个：`cli.js` 约 12–13 MB、`audio-capture(.js/.node)`、`image-processor(.js/.node)` 等；具体随版本/平台变化）。
- **`ripgrep` 不在 SEA 内嵌模块里**，是构建时另行下载放进 `vendor/` 的（易混淆点）。
- 主编排调用的是 `extractBunSEA(binPath)`（拿模块元信息 + `entryPointId` / `basePath` 自己写盘），而非 CLI 的 `extractToDir()`。

### 3. 前置验证 · `verify-node-compat.mjs`

在补丁**之前**判断「提取出的 `cli.js` 是否还像一个可恢复目标」，共约 12 项检查。

- **fatal（失败即中止全流程）**：Bun CJS wrapper 存在（`// @bun` + `(function(exports, require, module, __filename, __dirname)`）；`require()` 调用 **≥ 100**；存在 `VERSION:"x.y.z"` 字符串。
- **非 fatal（风险提示）**：`ws` / `yaml` / `undici` 是否被引用；Bun API 调用数；CI build path 是否存在；无 guard 的裸 `Bun.*` 占比（阈值约 ≤ 5:1）。
- **模式分类**（按 `typeof Bun` guard 数）：`≥ 15 → dual-runtime`（上游还留较多 Node fallback）；`≥ 1 → bun-only`（更依赖 Bun API，需 polyfill）；否则 `unknown`。

意义：上游每次发版都可能改压缩结构 / wrapper / 路径；先断言结构，好过打完补丁再崩、还难定位。

### 4. Node 兼容补丁 · `node-compat-patch.mjs`（8 个补丁，实现是 AST + 字符串混合）

流程：`stripBunWrapper()` → `acorn.parse` → `astPatch()` → 补丁后再 `acorn.parse` 校验语法 → 按条件注入 `bun-polyfill.js` → `addShebangHeader()`（`#!/usr/bin/env node`）。**主体是 AST 结构改写**（P1/P2/P3/P5/P7/P8 按节点特征定位替换），**个别补丁走字符串级替换**（典型是 P9 全量换包名）——这就是下文「AST + 字符串混合」的含义，与「补丁基于 AST 而非正则」并不冲突：主干结构化，字符串替换只用在包名这种确定性场景。

> **补丁真相：编号是 P1/P2/P3/P5/P6/P7/P8/P9，共 8 个，缺 P4。** 别被连续编号误导成 9 个。

| 编号 | 名字 | 问题 → 修复 | 脆弱点 |
|---|---|---|---|
| **P1** | build-path | 硬编码 CI 构建路径 `file:///…/claude-cli-internal/…` 的 `fileURLToPath()`→`__filename`、`createRequire()`→`require` | 依赖 file URL 特征串 |
| **P2** | bun-transpiler guard | `if(typeof Bun>"u")throw Error(...)` → `return null`（graceful fallback） | 低 |
| **P3** | bunfs native require | `require("/$bunfs/root/*.node")` → 先从 `__dirname/vendor/<module>/<arch-platform>/*.node` 加载，失败再 fallback 原路径 | 低（vendor 布局来源之一） |
| **P5** | embedded-search-tools | 反固化被内联成常量的 `"true"` → `process.env.EMBEDDED_SEARCH_TOOLS`，并注入 `bfs`/`ugrep` 可用性检测 | **高**：依赖 `CLAUDE_CODE_ENTRYPOINT` 等函数体线索 |
| **P6** | bun-polyfill | `typeof Bun` 出现 < 10 时，把 `templates/bun-polyfill.js` 注入头部注释后 | 阈值是经验值 |
| **P7** | https-proxy-agent | 找到 `<exports>.HttpsProxyAgent = X` 后追加 `globalThis.__HttpsProxyAgent = X`，让 polyfill 能把 Bun 的 `ws {proxy}` 转成 Node agent | 中 |
| **P8** | shadow-search-binaries | Node 下 `process.execPath` 是 node、不能靠 ARGV0 模拟 `bfs`/`ugrep`；改用 `which`/`where` 找系统真实二进制覆盖 fallback 路径 | **高**：依赖函数体含 `ARGV0`/`_cc_bin`/`command` |
| **P9** | package-rebrand | `@anthropic-ai/claude-code` → `@cometix/claude-code`（全量字符串替换） | 字符串级，无匹配收敛 |

补丁后的 `acorn.parse` **只证明语法成立，不证明运行正确**——语义正确性靠后续 smoke test。

**配套模板**：
- `templates/bun-polyfill.js`：在 Node 下模拟 `Bun.hash / spawn / Terminal / Transpiler / YAML / semver / which / stripANSI / stringWidth / wrapAnsi / gc / generateHeapSnapshot / embeddedFiles`，并把 `ws` 的 `{proxy}` patch 成 `{agent}`。
- `templates/bun-ink-compat.cjs`：打包后的终端兼容库，导出 `stringWidth / stripANSI / wrapAnsi`，服务于 TUI 的字符宽度/换行。

### 5. 分包与 postinstall（贴近官方分发模型）

**平台包** `@cometix/claude-code-<platform>`（`build-platform-package.mjs`）：
- 内容：patched `cli.js` + `vendor/`（native 模块候选 `audio-capture` / `computer-use-swift` / `computer-use-input` / `image-processor` / `url-handler` + `ripgrep` + `seccomp`）+ `package.json`。
- `package.json` 带 `os` / `cpu` 约束，让 npm 只装当前平台。
- `ripgrep` 来自 BurntSushi GitHub Release（默认 `14.1.1`）；`seccomp` 来自 `@anthropic-ai/sandbox-runtime`，**仅 Linux**。

**主包** `@cometix/claude-code`（`build-main-package.mjs`）：
- `bin: { claude: cli.js }`、`engines.node >= 22`、`scripts.postinstall: node install.cjs`。
- `optionalDependencies`：9 个平台包 + 多个 `@img/sharp-*`。
- `dependencies`：`ws` / `yaml` / `undici` / `semver` / `node-pty`（服务 patched cli.js 与 polyfill）。
- 主包里的 `cli.js` 只是 **placeholder**；`sdk-tools.d.ts` / `LICENSE.md` / `README.md` 从官方 wrapper 包（`npm pack`）复制。

**postinstall** `install.cjs`：
- `getPlatformKey()` 按 `process.platform` / `process.arch` / musl 检测（`process.report.getReport().header?.glibcVersionRuntime === undefined`）生成平台 key。
- `require.resolve('<平台包>/package.json')` 定位平台包，复制其 `cli.js` + `vendor/` 覆盖 placeholder。
- 修 Unix 下 `node-pty` 的 `spawn-helper` 执行权限（`chmod 755`）。
- 失败不硬崩，`cli-placeholder.js` 在运行 `claude` 时给出明确错误（提示 `--ignore-scripts` / `--omit=optional` / 平台包缺失）。

### 6. 发布 · `.github/workflows/release.yml`

- 触发：`workflow_dispatch`（输入 `version` / `force`）。**当前没有 `schedule`**——原为 `cron '0 */3 * * *'`（每 3 小时），2026-04-23 的 commit `0bf75e5` 删掉；README 仍写「every 6 hours」，已过时（文档漂移，README ≠ cron ≠ 现状三者不一致）。
- `check`：`gh release list` 算 existing → `check-new-versions.mjs`。
- `build`：版本矩阵跑 `fetch-and-process.mjs`；**冒烟测试**在 Linux 临时目录模拟主包安装、拷 `linux-x64` 的 cli.js+vendor，真跑 `node cli.js --version` 和 `node cli.js --help`；打 tarball 上传 artifact。
- `release`：`curl` 同步官方 `anthropics/claude-code` 的 `CHANGELOG.md` 并 commit push；创建 GitHub Release（notes 取官方对应 tag body）。
- `publish`：npm **provenance**；版本 > npm latest 用 `latest` tag，否则 `--tag backfill`；**先发平台包、再发主包**（主包 optionalDependencies 指向同版本平台包，顺序反了用户会装不到平台包）；已存在则跳过。
- **npm 不可变规则**（同 name+version 不可覆盖）逼出策略：**镜像官方版本号**——某版本发坏了只能等下一个官方版本（如 2.1.117 坏了、等 2.1.118）。

## 标志性案例：P5「2.1.117 搜索瘫痪 → 2.1.118 复活」

这是整条恢复链里最能说明「Bun 编译期陷阱」的案例，值得单独记：

1. 官方 `2.1.117` CHANGELOG：在 macOS/Linux native build 上用嵌入式 `bfs` / `ugrep` 替换 `Glob` / `Grep` 工具。
2. Bun 编译时把环境判断 `EMBEDDED_SEARCH_TOOLS` 做**常量内联**（dead-code elimination 把 `isEnvTruthy(process.env.EMBEDDED_SEARCH_TOOLS)` 固化成 `isEnvTruthy("true")`）。
3. 恢复成 Node 版后，这个写死的 `"true"` 让程序默认进 **shadow mode**（走 `bfs`/`ugrep`），可 Node 环境既没有 ARGV0 多调用二进制、系统也未必装 `bfs`/`ugrep` → **搜索工具（Grep/Glob）瘫痪甚至被隐藏**。
4. **P5** 反固化那个常量 + 检测系统是否真有 `bfs`/`ugrep`，没有就回退 Tool mode；**P8** 配合修 shadow function 里的二进制路径解析。修复提交 `b19a743`（2026-04-23），`2.1.118` 得以「完美复活」。

**教训**：Bun 的**编译期常量内联/死代码消除**是恢复链最隐蔽的坑——源码里本是运行时判断，二进制里已被固化成常量，纯文本 diff 很难察觉，必须靠 AST 结构 + 运行验证一起兜。

## 失败模式（这些都是「上游结构变了」的信号）

提取/验证阶段任一处失败，都指向**官方分发结构变化**，应回到研究而非硬打补丁：

```text
二进制格式不支持 / MachO 找不到 __BUN·__bun / PE·ELF 找不到 .bun /
section size prefix 不认识 / trailer 不匹配 / offset table 异常 /
模块 entry size 既不是 36 也不是 52 / verify 的 fatal 项失败
```

## 本项目可借鉴点

1. **阶段边界清晰**：检测 / 下载 / 提取 / 验证 / 补丁 / 构建 / 发布拆成相对独立的脚本，便于单步调试与失败定位。
2. **核心不可控点前置验证**：`verify-node-compat.mjs` 在 patch 前断言结构，避免对已失效的上游盲目打补丁。
3. **补丁尽量基于 AST 而非纯字符串**：`acorn` 解析后按节点特征改写，降低变量名/压缩变化带来的脆弱性（详见 [[acorn-and-js-ast-parsers]]）。
4. **分包贴近官方模型**：主包 optional dependency + postinstall 复制当前平台文件，npm 只拉当前平台产物。
5. **用分发结构反证版本**：靠 `optionalDependencies` 里有没有平台包来判定「是不是 SEA 版本」，比单看版本号稳。
6. **发布闭环**：build + 同步 changelog + artifact + Release + npm publish 一条龙，且先平台包后主包。
7. **placeholder 兜底**：安装失败时给用户明确错误，而非 `file not found`。

## 本项目不应照搬点

1. **补丁不该塞进一个巨型 `node-compat-patch.mjs`**：应演进为**补丁注册表**，每个补丁声明 `id / name / purpose / match / apply / verify / risk / knownVersions`，每次构建产出结构化 **patch report**（哪个补丁命中/未命中/命中几处）。
2. **P5 / P8 依赖上游压缩后函数体特征**（`CLAUDE_CODE_ENTRYPOINT` / `ARGV0` / `_cc_bin`），上游改名或改压缩结构就会静默失效——要有「补丁未命中」告警，别当成功。
3. **P9 是全量字符串替换**，缺匹配收敛与验证项，长期看有误伤风险。
4. **CI 验证覆盖不足**：只测 `linux-x64` 的 `--version` / `--help`，没测其他平台、TUI 交互、native 模块、补丁语义。
5. **文档漂移**：README「6 小时」/ 旧 cron「3 小时」/ 现状「仅手动」三者不一致——自己的项目要让文档跟随实现。
6. **下载物 / 提取物 / 构建物不进 Git**（`.gitignore` 忽略 `node_modules/ dist/ output/ .tmp/ *.tgz`）。

## 常见误解 / 易错点

- ❌「补丁是 P1–P9 共 9 个」→ 实为 **8 个，缺 P4**（P1/P2/P3/P5/P6/P7/P8/P9）。
- ❌「构建 9 个平台包和官方 8 平台矛盾」→ 不矛盾，第 9 个是 `android-arm64`，**复用 `linux-arm64` 提取结果**。
- ❌「ripgrep 也是从 SEA 二进制抠出来的」→ 不是，`ripgrep` 是构建时**另行下载**放进 vendor。
- ❌「补丁全用 AST」→ 实为 **AST + 字符串混合**；且补丁后的 `acorn.parse` 只验语法、不验运行。
- ❌「主包里的 `cli.js` 就是真程序」→ 主包的 `cli.js` 是 **placeholder**，真身由 postinstall 从平台包复制。
- ❌「它靠源码泄露做恢复」→ 不靠；CometixSpace 是从官方 Bun SEA 二进制里抠 bundle，**不依赖任何源码泄露**（这是它区别于「有泄露源码可对照」那类研究的关键特征）。

## 技术依赖

- **`node-lief`**：读 MachO/PE/ELF section 的关键依赖（观察版本 v1.1.1，Piebald-AI 2025-11 发布的 N-API 封装；底层 LIEF 由 Quarkslab 的 Romain Thomas 所作，Apache-2.0；Node.js 自 v24.14.0+ 亦将 LIEF 纳入构建依赖）。*此段外部背景系二手，见证据边界。*
- **`acorn`**：`node-compat-patch.mjs` 用它做 AST 补丁与补丁后语法校验（AST 概念与解析器背景见 [[acorn-and-js-ast-parsers]]）。
- **`semver`**：版本筛选与发布 tag 判定。

## 证据（与复核）

**一手来源**（参考仓库脚本，即本页事实主体）：
- `scripts/`：`check-new-versions.mjs` / `fetch-and-process.mjs` / `bun-sea-extract.mjs` / `verify-node-compat.mjs` / `node-compat-patch.mjs` / `build-platform-package.mjs` / `build-main-package.mjs`。
- `templates/`：`install.cjs` / `cli-placeholder.js` / `bun-polyfill.js` / `bun-ink-compat.cjs`。
- `.github/workflows/release.yml`；`package.json`（`cc-node-restore`）；`.gitignore`。
- 关键 commit：`b19a743`（P5 反固化，2026-04-23）、`0bf75e5`（删 cron schedule，2026-04-23）。

**外部佐证**：官方 issue #50203；官方 `2.1.117` CHANGELOG（bfs/ugrep 替换 Glob/Grep）；CDN `https://downloads.claude.ai/claude-code-releases/{version}/manifest.json`。

**内部分析出处**：本页系针对 CometixSpace 的本地私有分析材料的提炼稿（私有研究材料按设计不公开、不随本仓库上传）。

**证据边界（未逐一复核）**：
- 提取产物的**模块数量与文件体积**（约 5 个、`cli.js` 12–13 MB 等）随版本/平台变化，数字取自内部教程文档的具体版本观察，非跨版本恒定。
- `verify` 的「12 项」「裸 `Bun.*` ≤ 5:1」等阈值取自内部文档转述，未逐行对脚本核验。
- `node-lief` 的作者/许可证/Node 纳入版本等**外部背景**系二手资料，未一手核对。
- 参考仓库处于活跃演进中，`master@74d5438`（镜像官方 v2.1.196）之后的行为可能变化；本页按 `case` 记录**观察基线**，上游结构变动时应复核并可能转 `stale`。

## 相关页面

- [[acorn-and-js-ast-parsers]] —— 本 case 里「补丁主要用 acorn 改写 cli.js（个别如 P9 走字符串替换）」的概念基础（AST vs 字符串、ESTree、为什么不用正则）。

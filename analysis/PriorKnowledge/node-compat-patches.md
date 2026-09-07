---
title: 把抽出的 cli.js 改成 Node 可执行
kind: mechanism
status: draft
updated: 2026-09-07
applies_to: "CometixSpace/claude-code master@c286ad1（changelog: sync v2.1.240）；已发布 @cometix/claude-code 2.1.241；官方 Bun SEA 自 v2.1.113 起"
tags:
  - topic:claude-code
  - topic:bun-sea
  - form:mechanism
---

# 把抽出的 cli.js 改成 Node 可执行

## 一句话结论

`scripts/fetch-and-process.mjs` 在闸门通过之后，把选中的入口交给 `scripts/node-compat-patch.mjs` 的 `patchFile`。`patchFile` 先剥掉 Bun 加载器才调用的 CJS 外壳，再用 acorn 按 script 解析并改 AST（P1、P2、P3、P5、P7、P8、P10），然后对整份文本做包名替换（P9），按 `typeof Bun` 是否少于 10 次决定是否插入 `templates/bun-polyfill.js`（[P6](../glossary.md)），最后补 `#!/usr/bin/env node`，写入 `outputDir/.tmp/patched/<平台>.js`。

## 剥 Bun CJS 外壳

抽出的 **cli.js** 文件头可以是 `// @bun @bytecode @bun-cjs`，外层再包一层 `(function(exports, require, module, __filename, __dirname){…})`。这是 [Bun CJS 外壳](../glossary.md)。Bun 加载器负责调用这层函数。Node 直接跑则只得到一个不被调用的函数表达式，主程序不执行。

`stripBunWrapper`：若文件以 `// @bun @bytecode @bun-cjs` 开头则删掉这一行；若接下来是 `(function(exports, require, module, __filename, __dirname) {` 则剥掉这对括号函数外壳，只留下函数体。两个前缀都没有则原样返回。闸门的 fatal 检查只要求以 `// @bun` 开头，比这里认的头更宽，见 [兼容闸门](verify-node-compat-gate.md)。

然后 `astPatch` 用 acorn 把函数体解析成 `sourceType` 为 `script` 的 AST，按节点改写。当前 `astPatch` 的 stats 字段、`patchFile` 的日志和 README 补丁表都没有 P4。

## 构建机路径与 Bun 守卫（P1 / P2）

官方构建会把本机路径写进 bundle。P1 的注释对应 Linux CI 的 `file:///home/runner/work/claude-cli-internal/…` 与 Windows CI 的 `file:///D:/a/claude-cli-internal/…`。若调用形如 `*.fileURLToPath`，且唯一参数是以 `file:///` 开头、并含 `/claude-cli-internal/` 的字符串字面量，就把整个调用换成 `__filename`；对同样参数的 `*.createRequire(...)` 则整段换成 `require`。不改的话，`fileURLToPath` 和 `createRequire` 在用户机器上会指向不存在的构建机目录。

同一份代码里还有「没有 Bun 就抛 Bun required」的守卫。Node 上 `typeof Bun` 为 `"undefined"`，压缩后写成 `typeof Bun > "u"`（字符串 `"undefined"` 大于 `"u"`，有 Bun 对象时得到 `"object"`，不大于 `"u"`）。P2：若 `IfStatement` 的条件是 `typeof Bun > "u"`、then 分支是 throw，且错误字符串含 `Bun required`，就把整句换成 `if(typeof Bun>"u")return null;`。不改就会在 `Bun.Transpiler` 那条路径直接抛错。

## BunFS 路径改写到 vendor（P3 / P10）

原生 `.node` 与 chart / hljs / mermaid / payload 在 Bun 里是 [BunFS](../glossary.md) 上的绝对路径。写盘之后这些文件会在平台包的 `vendor/` 下，见 [npm 组包](cometix-npm-reassembly.md)。补丁必须让运行中的 cli.js 去打开 `__dirname` 下的那些文件，而不是去打开一个在 Node 文件系统上不存在的 `/$bunfs/root/…`。

P3：若 `require` 的唯一参数是以 `/$bunfs/root/` 开头的字符串，就把该调用换成一段立即执行函数——先用 `require("path").join(__dirname,"vendor",去掉 .node 后的基名, process.arch+"-"+process.platform, 原文件名)` 拼出路径再 `require`，catch 后再 `require` 原来的 `/$bunfs/root/` 路径。P3 的匹配条件就是这个前缀，代码并不再检查是否以 `.node` 结尾。

P10：同一前缀下、不以 `.node` 结尾、且 `/$bunfs/root/` 后面只有一段文件名（不含斜杠或反斜杠）的字符串字面量，换成 `require("path").join(__dirname,"vendor","assets",文件名)`。注释写明 chart / hljs / mermaid 以及后来的 design-canvas payload 是用 `fs.readFile` 读的，加载器写的是 `path.isAbsolute(p) ? p : path.join(ciBuildDir, p)`，改成 `__dirname` 相对拼出来的绝对路径后 `isAbsolute` 为真，不再去拼构建机目录。P10 显式跳过以 `.node` 结尾的字面量，把 `.node` 留给 P3 的 require 改写。

P3 与 P10 的匹配条件都是字符串以 `/$bunfs/root/` 开头。`bun-sea-extract.mjs` 把 PE 模块名前缀记为 `B:/~BUN/`；Windows 抽出的 JS 字面量是否也写成 `/$bunfs/root/`，本页未核。

## 搜索工具守卫与 shadow 回退（P5 / P8）

P5 注释写明：macOS/Linux 的 Bun 原生构建会把 `isEnvTruthy(process.env.EMBEDDED_SEARCH_TOOLS)` 内联成 `isEnvTruthy("true")`，于是名为 `DP()` 的守卫恒为真，Grep/Glob 工具被藏起来。匹配条件是：无参、函数体至少两条语句、第一条是 `if (!某调用("true")) return`、且函数体其余部分含 `CLAUDE_CODE_ENTRYPOINT`。补丁把那个 `"true"` 字面量改成 `process.env.EMBEDDED_SEARCH_TOOLS`，并在该 if 结束后插入一段用 `which`（win32 上是 `where`）探测 bfs 与 ugrep 的代码，结果记在 `globalThis.__dpBinOk`。两个二进制必须都探测成功才把 `__dpBinOk` 设为真；对 bfs、ugrep 连续 `execFileSync`，缺一进入 catch，设为假并 `return !1`。环境变量未设时走自带 Grep/Glob（ripgrep）；设为 true 且本机同时找得到 bfs 与 ugrep 时，Bash 里的 find/grep 被换成这两个二进制。

P8 注释写明：Bun 在原生构建里用 `ARGV0=bfs` 再去跑同一个 `$claude_multicall_binary` 来当 bfs/ugrep；Node 的 `process.execPath` 是 node，`~/.local/bin/claude` 也不存在。匹配条件是参数个数 2 到 4、函数体源码同时含 `ARGV0`、`_cc_bin`、`command` 的函数。补丁在其内部第一个 `return[` 之前插入一次 `which`/`where`，目标名取该函数的第二个参数（注释写它是 bfs 或 ugrep），若解析到真实路径则覆盖变量 `M`。

## 代理、包名、polyfill（P7 / P9 / P6）

P7：找到把一个标识符赋给 `*.HttpsProxyAgent` 的赋值，在赋值后追加 `;globalThis.__HttpsProxyAgent=该标识符`。注释写明 Bun 自带的 ws 认 `{proxy:url}`，Node 的 ws 不认，所以要把已经打进 cli.js 的 `HttpsProxyAgent` 挂到 `globalThis`，供 polyfill 把 proxy 转成 agent。P7 与 P8 的匹配条件都带 `!stats.p7` / `!stats.p8` 守卫：一次遍历只改遇到的第一处匹配，之后同类节点不再进入判断。

AST 替换写回后，P9 不对节点下手，而是对整份文本 `replaceAll('@anthropic-ai/claude-code','@cometix/claude-code')`。注释写明构建期常量 `PACKAGE_URL` 被内联成 `@anthropic-ai/claude-code`，`claude update` 和自动更新会去装官方包；GitHub 路径用的是 `anthropics/claude-code`，故不会被这次 `replaceAll` 碰到。README 补丁表未列 P9；P9 只出现在 `astPatch` 末尾的 `replaceAll` 与 `patchFile` 日志里。

`astPatch` 返回后 `patchFile` 再用 acorn 解析一次做语法校验。这次解析包在 try/catch 里：失败只打印 Post-patch AST validation FAILED，既不抛错也不中止，产物照样写出去。所以它是一条日志，不是一道闸。随后数 `typeof Bun` 的出现次数：少于 10 就把 `templates/bun-polyfill.js` 插到版权注释块之后，这是 **P6**；不少于 10 则跳过并打印 dual-runtime fallbacks present。脚本会去掉 polyfill 文件开头的 shebang；当前这份模板没有 shebang，这一替换是空操作。闸门用 15 次划分 dual-runtime，P6 用小于 10 决定是否注入，两者没有共用返回值，见 [兼容闸门](verify-node-compat-gate.md)。

`templates/bun-polyfill.js` 第 3 行注释写它为实现 Claude Code 2.1.200+ 所用的 Bun API。同一文件第 51 行把 `Bun.file` 经 `openSync` 转 fd 写成 matching pre-2.1.200 openSync(...err) behavior。这两处版本只出现在 polyfill 模板注释里。`patchFile` 是否插入这份模板只看 `typeof Bun` 是否少于 10 次，没有按 2.1.200 做版本分支。`scripts/verify-node-compat.mjs` 文件头也不含 `2.1.200+`。

P6 只在 `globalThis.Bun` 尚未定义时挂上 file、spawn、hash、deepEquals、stripANSI、stringWidth、wrapAnsi、semver.order/satisfies、YAML.parse/stringify、which、Terminal、Transpiler、listen、serve、stdin、WebView.closeAll、gc、generateHeapSnapshot、embeddedFiles，并把 `isStandaloneExecutable` 设为 false。`JSONL.parseChunk` 故意保持 null：注释写明业务代码（pYe → r0m）在它为假时会走纯 JS 逐行 `JSON.parse`（i0m/o0m）；若做成返回 `{values,error}` 却没有 `read`/`done` 的对象，n0m 消费者会空转。`SQL` 构造函数故意抛出 `claude gateway requires the native binary`，注释写明 gateway 需要原生二进制，这里不提供假实现。

polyfill 还会改写 `require("ws")` 得到的 WebSocket：若选项带 proxy 且没有 agent，就用 P7 挂上的 `globalThis.__HttpsProxyAgent` 造 agent。stripANSI / stringWidth / wrapAnsi 优先 `require("./bun-ink-compat.cjs")`，也就是 `templates/bun-ink-compat.cjs` 这份由 `scripts/build-main-package.mjs` 拷进主包的实现；require 失败则退回正则去 ANSI、按去 ANSI 后的 length 估宽度。

`Bun.which` 在命令为 `rg` 时还会按 `USE_BUILTIN_RIPGREP` 去 `vendor/ripgrep/<arch>-<platform>/` 找捆绑的 rg。注释写明抽出到 Node 之后 `Bun.isStandaloneExecutable` 为假，SEA 里那条内置 rg 分支不会再走。

## shebang 与 CI 校验的分工

最后 `addShebangHeader` 若文件还没有 `#!` 就加上 `#!/usr/bin/env node`，写入输出路径，供 `scripts/build-platform-package.mjs` 拷成平台包里的 cli.js。没有 shebang 则文件不能当可执行文件直接启动。`.github/workflows/release.yml` 的 Verify main package 是把主包拷到临时目录，再把 linux-x64 平台包的 cli.js 与 vendor 拷进去模拟 postinstall，然后执行 `node cli.js --version`。这一步不读 shebang，但会在外壳未剥、构建机路径未改、BunFS 路径未改、缺失的 `Bun` 对象等入口障碍上失败。

## 没有 patchFile 会怎样

若跳过 `patchFile` 整段，编排脚本仍会抽出并用 `verifyNodeCompat` 做结构检查（它发生在补丁之前），随后 `buildPlatformPackage` 会把未改过的 cli.js 拷进 `@cometix/claude-code-<platform>`，主包里的 `install.cjs`（源自 `templates/install.cjs`）再把平台包的 cli.js 覆盖到 `@cometix/claude-code/cli.js`。用 Node 跑这份文件时：若还包在 Bun 的 CJS 外壳里，外壳函数不会被调用，主程序根本不进。进了主程序后，P1–P3、P5、P7–P10、P6 各自对应的路径、守卫、`Bun.*` 调用、包名更新都不会发生。

## 关键边界

- 补丁只作用于选定的那一份入口文件。剥壳、AST 改写、包名替换、polyfill 注入、shebang 全在 `patchFile` 内完成，产物写到 `outputDir/.tmp/patched/<平台>.js`，平台包里的其它文件不经过这里。
- P3 与 P10 只认 `/$bunfs/root/` 这个字面量前缀。PE 抽出物里的路径字面量是否也写成这个形式，未核。
- P5 与 P8 认的是压缩后函数体的特征串（`CLAUDE_CODE_ENTRYPOINT`、`ARGV0`、`_cc_bin`、`command`）。上游改名或改压缩结构后这两条会静默失配：`patchFile` 只打印 not found，不报错也不中止，构建继续。
- P7 与 P8 只改第一处匹配。
- 补丁后的 acorn 解析只证明产物仍是合法脚本，不证明运行语义正确；运行层面的证据只有 CI 那一次 linux-x64 的 `node cli.js --version`。
- 本页不解释抽出与组包，也不解释闸门的判定条件。

## 证据与复核

- `scripts/node-compat-patch.mjs`：`stripBunWrapper`、`astPatch`、`patchFile`、P1–P3 / P5 / P7–P10 的匹配条件与生成代码、P9 的 `replaceAll`、P6 的小于 10 次阈值、`addShebangHeader`。
- `templates/bun-polyfill.js`：第 3 行 `Claude Code 2.1.200+`、第 51 行 `pre-2.1.200`；以及 `isStandaloneExecutable`、`JSONL.parseChunk`、`SQL`、`Bun.which` 对 rg 的 vendor 查找、ws 的 proxy → agent。
- `templates/bun-ink-compat.cjs`：主包里与 polyfill 相对路径对应的实现。
- `scripts/fetch-and-process.mjs`：闸门通过后调用 `patchFile`。
- `README.md` 补丁表：列了 P1–P3、P5–P8、P10，未列 P9。
- `.github/workflows/release.yml`：`node cli.js --version`，不依赖 shebang。

**未确认：** 工作区没有抽出态 cli.js，未对真实抽出的文件执行 `patchFile`，命中次数未实测。P3/P10 只匹配 `/$bunfs/root/` 前缀。10 到 14 次 `typeof Bun` 没有样本。当前代码没有 P4；不能把 split-package 当作已证实的删除原因。`templates/bun-polyfill.js` 第 3 行与第 51 行的 2.1.200 只是注释，本轮未对着 2.1.200 前后的抽出文件核对 polyfill 覆盖面。

## 相关页面

- [工作链顺序](cometix-restore-pipeline.md)
- [打补丁前的 Node 兼容闸门](verify-node-compat-gate.md)
- [组 9 个平台包与主包并发布](cometix-npm-reassembly.md)
- [acorn 与 JavaScript AST 解析工具](acorn-and-js-ast-parsers.md)

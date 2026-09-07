---
title: 打补丁前的 Node 兼容闸门
kind: mechanism
status: draft
updated: 2026-09-07
applies_to: "CometixSpace/claude-code master@c286ad1（changelog: sync v2.1.240）；已发布 @cometix/claude-code 2.1.241；官方 Bun SEA 自 v2.1.113 起"
tags:
  - topic:claude-code
  - topic:bun-sea
  - form:mechanism
---

# 打补丁前的 Node 兼容闸门

## 一句话结论

`scripts/fetch-and-process.mjs` 在某个平台的模块已经写进 [extractDir](../glossary.md)、入口路径 `cliSrc` 已经选定之后，立刻调用 `scripts/verify-node-compat.mjs` 的 `verifyNodeCompat`。此时还没有调用 `patchFile`。三项标了 severity 为 fatal 的检查里只要有一项失败，返回的 [compatible](../glossary.md) 就是假，编排脚本对该平台打印 fatal 项数后 `process.exit(1)`。闸门不读取 [dual-runtime](../glossary.md) / [bun-only](../glossary.md) 这个 mode；要不要注入 polyfill 由后面的 `patchFile` 另数 `typeof Bun`。

## 输入：何时、对哪份文件

入口定位规则在 [抽出模块并定位 cli.js](bun-sea-extract.md)：若 `extractDir/src/entrypoints/cli.js` 已经在磁盘上就用它，否则用 `extractDir/cli.js`。`verifyNodeCompat` 把整份文件 `readFileSync` 成字符串。路径上没有文件会在这里抛错。

独立 CLI 是 `node scripts/verify-node-compat.mjs <cli.js>`，判定规则与被编排调用时相同。

## 三项 fatal 检查

`CHECKS` 数组里 severity 为 fatal 的三项：

1. 文件是否以 `// @bun` 开头，并且正文里含有 `(function(exports, require, module, __filename, __dirname)`。这是 [Bun CJS 外壳](../glossary.md) 的结构底线。注意：闸门只要求以 `// @bun` 开头；后面 `stripBunWrapper` 认的是更完整的 `// @bun @bytecode @bun-cjs` 或 CJS 开括号。
2. 全文里 `require(` 是否至少出现 100 次。
3. 是否能用正则 `VERSION:"数字.数字.数字"` 抽出版本。

某一项测试为假，就把内部计数 `fatal` 加一。函数返回的 **compatible** 就是 `fatal === 0`。`fetch-and-process.mjs` 只解构 `compatible` 和 `fatal`。

## typeof Bun 只分类不挡关

同一份文件再数 `typeof Bun` 出现几次：大于等于 15 次把 mode 设成 **dual-runtime**，大于等于 1 次且不到 15 次设成 **bun-only**，一次都没有设成 unknown。

`CHECKS` 里「typeof Bun runtime guards」这一项的 severity 是 info，测试条件只是次数是否至少 1：次数为 0 只增加 info 计数，不增加 fatal。ws、yaml、undici 和 `Bun.*` 调用清单这些检查只记 warn 或 info，不会让 compatible 变假。

`scripts/verify-node-compat.mjs` 文件头注释把抽出的入口分成三类：还留着 `typeof Bun` 判断并且带 Node 回退的叫 dual-runtime（注释把它标成 ≤2.1.127）；判断被拿掉、需要靠注入 polyfill 才能在 Node 下跑的叫 bun-only（注释把它标成 ≥2.1.128）；基本结构已经变了、不能再恢复的叫 incompatible。文件头只有这两处版本标注，没有 `2.1.200+`。`2.1.200+` 写在 `templates/bun-polyfill.js` 第 3 行，不在闸门脚本的文件头。闸门脚本里没有按版本号比较的 `if` 分支；当前分类只数 `typeof Bun`，不读版本号。

独立用该脚本跑时，compatible 为假以退出码 1 结束；若 mode 是 bun-only 打印将注入 polyfill，其余情况（dual-runtime 或 unknown）都打印 Dual-runtime build. Standard patches sufficient.。这句打印不等于后面真的会注入。

## compatible 为假时整进程退出

`fetch-and-process.mjs` 只要 `compatible` 为假，就对该平台打印 fatal 项数，再打印 `Anthropic may have removed dual-runtime fallbacks. Aborting.`，然后 `process.exit(1)`。后续平台、补丁、组包全部不做。

这条英文报错把作者担心的官方变化写成「可能已经去掉 dual-runtime 回退」。报错文案不等于闸门的判定条件。闸门只看 fatal 是否为零。

本仓库 `README.md` 写明：从 v2.1.113 起 Anthropic 把 Claude Code 改成各平台 Bun SEA 本地二进制，不再发一份能直接用 Node 跑的 JS。抽出来的入口仍然是给 Bun 打包的 CommonJS。三项 fatal 对应文件头所说 fundamental structure changed, cannot restore 的结构底线：还包着 Bun 写进去的 CJS 外壳、还大量调用 `require(`、还留着 `VERSION:"x.y.z"` 这种版本字面量。

## 与 P6 注入的分工

真正决定要不要插 polyfill 的是后面的 `patchFile`：它在剥掉 Bun CJS 外壳并做完 AST 补丁之后再数一次 `typeof Bun`，次数小于 10 就把 `templates/bun-polyfill.js` 插到版权注释之后（日志里叫 [P6](../glossary.md)），次数大于等于 10 就跳过并写 dual-runtime fallbacks present。

闸门的 15 次阈值只影响 mode 字符串和独立 CLI 的那句提示。`patchFile` 不读取 `verifyNodeCompat` 返回的 mode。守卫次数落在 10 到 14 时，`verify-node-compat.mjs` 标 bun-only，`patchFile` 却跳过 P6。15 与 10 两个阈值在源码里都没有注释说明为什么取这两个数。

P6 的匹配条件、插入位置和 `Bun.*` 实现见 [兼容补丁](node-compat-patches.md)。本页不保存 polyfill 清单。

## 没有这道闸会怎样

若从 `fetchAndProcess` 第 3 步删掉对 `verifyNodeCompat` 的调用，已经选定的 `cliSrc` 会马上交给 `patchFile`。`stripBunWrapper` 只有在文件以 `// @bun @bytecode @bun-cjs` 或 CJS 开括号开头时才剥壳，否则原样返回。随后 `astPatch` 会先让 acorn 按 script 解析；解析失败会直接抛错，那是另一条失败路径，并不检查 CJS 外壳、`require(` 次数或 VERSION 字面量。

只要官方已经不再产出带 Bun CJS 外壳、至少 100 处 `require(`、或 `VERSION:"x.y.z"` 的那类入口，但文件仍能被 acorn 解析，闸门本应 `process.exit(1)` 的地方就不会触发，脚本仍会写出 `patched/{platform}.js`，`buildPlatformPackage` 再把它打进平台包。`.github/workflows/release.yml` 是在 `fetch-and-process.mjs` 成功返回之后，才把组好的 cli.js 拷到临时目录跑 `node cli.js --version`。没有这道闸，流水线不会在「入口已经不是那类 CJS 程序」时停在打补丁之前。

去掉闸门取消的是 fatal 大于 0 时整进程退出，不是取消 polyfill。

## 关键边界

- 闸门发生在 `patchFile` 之前，读的是未剥壳、未打补丁的抽出文件。
- compatible 与 dual-runtime / bun-only 无关。
- 独立 CLI 在 mode 为 unknown 时也会打印 Dual-runtime 那句。
- 本页不解释各补丁改写的 AST 节点。

## 证据与复核

- `scripts/verify-node-compat.mjs` 全文：`CHECKS`、`verifyNodeCompat`、独立 CLI 打印。第 7–8 行注释把 dual-runtime 标成 ≤2.1.127、把 bun-only 标成 ≥2.1.128。
- `scripts/fetch-and-process.mjs` 第 221–236 行：只解构 `compatible` 与 `fatal`，失败则 `process.exit(1)`。
- `scripts/node-compat-patch.mjs` 的 `patchFile`：P6 用小于 10 次决定是否注入，不读 mode。
- `templates/bun-polyfill.js` 第 3 行：注释写 Claude Code 2.1.200+；不在闸门脚本文件头。P6 插入的就是这份模板。
- 本仓库 `README.md`：v2.1.113 起改为 Bun SEA 二进制。

**未确认：** 仓库下没有抽出态的 cli.js 快照，未对着真实抽出的 cli.js 跑过这两份脚本。`scripts/verify-node-compat.mjs` 文件头把 dual-runtime 标成 ≤2.1.127、把 bun-only 标成 ≥2.1.128，没有对应的版本号 `if` 分支。`2.1.200+` 出现在 `templates/bun-polyfill.js` 第 3 行，不在闸门脚本文件头。10 到 14 次 `typeof Bun` 没有样本。

## 相关页面

- [工作链顺序](cometix-restore-pipeline.md)
- [从官方二进制抽出模块并定位 cli.js](bun-sea-extract.md)
- [把抽出的 cli.js 改成 Node 可执行](node-compat-patches.md)

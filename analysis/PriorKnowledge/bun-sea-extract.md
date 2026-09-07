---
title: 从官方二进制抽出模块并定位 cli.js
kind: mechanism
status: draft
updated: 2026-09-07
applies_to: "CometixSpace/claude-code master@c286ad1（changelog: sync v2.1.240）；已发布 @cometix/claude-code 2.1.241；官方 Bun SEA 自 v2.1.113 起"
tags:
  - topic:claude-code
  - topic:bun-sea
  - form:mechanism
---

# 从官方二进制抽出模块并定位 cli.js

## 一句话结论

`fetchAndProcess` 第 3 步对每个已下载的平台二进制调用 `extractBunSEA`：按 Mach-O / PE / ELF 取出 Bun 专用节，解析模块表，把内嵌文件写到 [extractDir](../glossary.md)。写盘前只在前缀匹配时剥掉 [BunFS](../glossary.md) 路径（POSIX 上的 `/$bunfs/`，或 PE 上的 `B:/~BUN/`）和随后的 `root/`。然后用 `existsSync` 在 `extractDir/src/entrypoints/cli.js` 与 `extractDir/cli.js` 之间选出 `cliSrc`，交给闸门和补丁。

## 输入

- 第 2 步已经写到 `outputDir/.tmp/bins/<平台>/` 的官方二进制（下载见 [官方 Bun SEA 交付](claude-code-bun-sea-shipping.md)）。
- `scripts/bun-sea-extract.mjs` 的 `extractBunSEA(binaryPath)`：只解析，不写盘。
- 写盘与选入口在 `scripts/fetch-and-process.mjs` 第 3 步完成。独立入口 `extractToDir` 用同一套剥前缀规则落盘。

## 按文件头打开二进制并取出 Bun 节

`extractBunSEA` 先让 `findBunSection` 用 `readFileSync` 读入整个文件，再读文件头魔数。

- 若 `readUInt32LE(0)` 为 `0xFEEDFACF` 或 `0xCEFAEDFE`，当作 Mach-O：用 node-lief 的 `MachO.parse` 打开，取段 `__BUN` 里的节 `__bun`，并把 `basePath` 设成常量 `BASE_PATH_POSIX`（`/$bunfs/`）。
- 若 `readUInt16LE(0)` 为 `0x5A4D`（MZ），当作 PE：用 `lief.parse` 打开并取节 `.bun`，`basePath` 设成 `BASE_PATH_WINDOWS`（`B:/~BUN/`）。
- 若 `readUInt32BE(0)` 为 `0x7F454C46`，当作 ELF：同样取节 `.bun`，`basePath` 仍用 `/$bunfs/`。

对不上这三种头就抛 `Unsupported binary format`。缺 `__BUN` / `__bun` / `.bun` 也抛错。node-lief 在这里的角色是：按 Mach-O、PE、ELF 打开官方二进制，取出 `__bun` 或 `.bun` 节的原始字节。

## 从 trailer 解析模块表

`parseBunDataFromSection` 用 `detectSectionPrefix` 判断节内容开头是 8 字节还是 4 字节的长度前缀，按这个长度切出 `bunData`。再核对 `bunData` 末尾是否等于常量 `BUN_TRAILER`（换行包围的 `---- Bun! ----`）。确认后从 trailer 之前固定 `OFFSETS_SIZE`（32 字节）处调用 `parseOffsets`，读出模块表切片 `modulesPtr`（连续 8 字节的 offset 加 length）和入口下标 `entryPointId`。

`parseModules` 按 `modulesPtr` 切出整张表。`detectModuleStruct` 先试 `MODULE_V2`（每条 52 字节）再试 `MODULE_V1`（每条 36 字节），表长必须能被其中之一整除。`parseModuleEntry` 对每条记录读 name、contents、sourcemap 三个切片指针，并在 v2 的 offset+48 或 v1 的 offset+32 处读 encoding、loader、format、side。

返回值带 `modules`、`basePath`、`entryPointId`。`extractBunSEA` 本身到此结束，磁盘上还没有文件。

## 剥虚拟路径前缀后写到 extractDir

官方二进制里嵌的不是「磁盘路径已经排好」的一棵目录树。模块表给每个内嵌文件起的名字带 [BunFS](../glossary.md) 虚拟前缀：POSIX 上是 `/$bunfs/`，PE 上是 `B:/~BUN/`。`fetchAndProcess` 把返回的模块写到 `outputDir/.tmp/extract/<平台名>/`（变量 **extractDir**）。对每个模块的 `name`：

1. 若以这次解析得到的 `basePath` 开头，才切掉这段。不以该前缀开头则原样留下。
2. 若接着以 `root/` 开头，再切掉这 5 个字符。
3. 若当前下标等于 `entryPointId`，就把文件名扩展名改成该条的 `loader` 字段；官方入口因此写成 `cli.js`。
4. `contents` 长度大于 0 才 `writeFile`。

切完之后剩下的相对路径，拼到 extractDir 上就是磁盘路径：

- 相对路径若仍是 `src/entrypoints/cli.js`，文件落在子目录里。
- 相对路径若只剩 `cli.js`，文件落在该平台抽出目录的根上，与 `scripts/build-platform-package.mjs` 按 `join(extractDir, 模块名.node)` 去捡的 `audio-capture.node` 等原生模块同级，也与随后 `readdir(extractDir)` 扫进 `vendor/assets/` 的根上普通文件同级。

独立入口 `extractToDir` 用同一套剥前缀规则，只是把 `root/` 写成常量 `BASE_PUBLIC_PATH`。

代码并不比较版本号来决定「写到子目录还是写到 extractDir 根上」。磁盘上的相对路径完全由剥完前缀后剩下的那一段决定。

## 在嵌套路径与根上 cli.js 之间选入口

后面的 `verifyNodeCompat` 和 `patchFile` 都是按传入路径读文件：前者内部是 `readFileSync`，后者内部是 `readFile`。路径上没有文件就是 ENOENT，而不是「检查无法执行」。因此写出之后必须先选定入口路径 `cliSrc`。

当前脚本走的是存在性检查，不是版本号比较。因果链如下。

1. 官方从 v2.1.113 起交付的是各平台原生可执行文件。Bun 把 Claude Code 的 JavaScript 和 native 模块嵌进这个文件的专用节（Mach-O 的 `__BUN/__bun`，PE/ELF 的 `.bun`）。模块表里的名字带 `/$bunfs/` 或 `B:/~BUN/` 这种虚拟前缀。这套分发形态本库叫 [Bun SEA](../glossary.md)。
2. `fetchAndProcess` 写盘时：若模块名以这次解析得到的 `basePath`（`/$bunfs/` 或 `B:/~BUN/`）开头，才切掉这段；若接着以 `root/` 开头，再切掉这 5 个字符。剩下的相对路径拼到 `extractDir` 上，才是磁盘上的文件路径。
3. 剥完之后若相对路径仍是 `src/entrypoints/cli.js`，`writeFile` 的目标就是 `extractDir/src/entrypoints/cli.js`。当前脚本把这条路径赋给变量 `legacyCli`。
4. `fetch-and-process.mjs` 第 222 行注释写 `v2.1.229+: embedded layout flattened, cli.js at extract root`。按第 2 步的剥前缀规则，这表示入口模块剥完 `/$bunfs/` 或 `B:/~BUN/` 以及随后的 `root/` 之后，剩下的相对路径是 `cli.js`，`writeFile` 的目标就是 `extractDir/cli.js`。
5. `verify-node-compat.mjs` 第 85 行是 `readFileSync(cliJsPath)`。若调用方只把 `legacyCli`（`join(extractDir, 'src', 'entrypoints', 'cli.js')`）传进去，而这次写出没有把入口放到那条嵌套路径上，`readFileSync` 打开的就是不存在的 `extractDir/src/entrypoints/cli.js`，会因文件不存在抛错，流程在 `patchFile` 之前退出。`.github/workflows/release.yml` 的 Build all packages 调用的就是 `fetch-and-process.mjs`，会在这一步失败。
6. 当前实现在写出之后用 `existsSync(legacyCli)` 判断：这条嵌套路径在就把 `cliSrc` 设成它，不在就把 `cliSrc` 设成 `join(extractDir, 'cli.js')`。这个 `cliSrc` 先交给 `verifyNodeCompat`，再交给 `patchFile`。两种相对路径都能进入校验和补丁。代码没有 `if (version >= '2.1.229')` 这样的分支。

二进制下载时 curl 的重试参数不在本页。第 2 步 `downloadFile` 给 curl 加 `--retry 3 --retry-delay 2 --retry-all-errors`，是另一条约束：八路并行下载包在同一个 `Promise.all` 里，任意一路失败抽出都不会开始。见 [官方 Bun SEA 交付](claude-code-bun-sea-shipping.md) 的「下载八份二进制」。

## 输出与后续消费

- **extractDir**：该平台全部写出的模块。
- **cliSrc**：选中的入口路径。
- 闸门与补丁消费 `cliSrc`（见 [兼容闸门](verify-node-compat-gate.md)、[兼容补丁](node-compat-patches.md)）。
- `buildPlatformPackage` 按 extractDir 下的 `audio-capture.node` 等名字把 napi 模块拷进 `vendor/`，并把其余根上普通文件拷进 `vendor/assets/`。

若去掉这一步，`fetchAndProcess` 不会往 extractDir 写入任何模块。同一步里的 `existsSync` 选入口之后，`verifyNodeCompat` 的 `readFileSync` 会因两个路径都没有文件而抛错，随后的 `patchFile` 不会跑到。后面的平台包和 `node cli.js --version` 都不会得到可运行的 **cli.js** 和 `.node`。

## 关键边界

- 只处理 Mach-O / PE / ELF 三种头；节名固定为 `__BUN/__bun` 或 `.bun`。
- 剥前缀是 `startsWith` 守卫，不是假定每个 name 都带 `/$bunfs/` 或 `B:/~BUN/` 再加 `root/`。
- 入口选择不看版本号，只看 `legacyCli` 是否存在。v2.1.229 分界来自第 222 行注释，不是 `if (version >= …)` 分支。这条 `existsSync` 选择由 `c2f8284`（2026-09-04，fix: support flattened SEA layout in v2.1.229+，unblocks 2.1.229–2.1.237）引入，替换掉原来写死的 `join(extractDir, 'src', 'entrypoints', 'cli.js')`；同一个提交还给 `downloadFile` 的 curl 加上了那组重试参数。
- 二进制下载与 curl 重试不在本页（见 [官方 Bun SEA 交付](claude-code-bun-sea-shipping.md) 的 `downloadFile`）。

## 证据与复核

- `scripts/bun-sea-extract.mjs`：`findBunSection`、`parseBunDataFromSection`、`parseModules`、`parseModuleEntry`、`extractBunSEA`、`extractToDir`、`BASE_PATH_POSIX` / `BASE_PATH_WINDOWS` / `BASE_PUBLIC_PATH`。
- `scripts/fetch-and-process.mjs` 第 196–236 行：写盘循环、第 222 行注释、`legacyCli` / `cliSrc`。
- `git show c2f8284 -- scripts/fetch-and-process.mjs`：该提交把写死的嵌套入口路径换成 `existsSync(legacyCli) ? legacyCli : join(extractDir, 'cli.js')`，并在同一 diff 里给 `downloadFile` 加上 `--retry 3 --retry-delay 2 --retry-all-errors`。
- `scripts/verify-node-compat.mjs` 第 85 行：`readFileSync(cliJsPath)`。
- `scripts/build-platform-package.mjs`：从 extractDir 根捡 `.node` 与 assets。
- `README.md`、`CHANGELOG.md` 的 2.1.113 节：官方改为原生二进制分发，所以必须先抽出。

**未确认：** 本轮没有实际抽出一份官方二进制。抽出根上除 cli.js 以外的文件名单，是根据 `build-platform-package.mjs` 的 napi 列表与 `readdir` 逻辑，以及已落下的 `artifacts/2.1.229`、`artifacts/2.1.241` 安装树里的 `vendor/assets` 推断的，不是 extractDir 目录快照。v2.1.229 分界的提交出处已核到 `c286ad1` 树内的 `c2f8284`，但没有对着 2.1.228 与 2.1.229 两份官方二进制实抽，去验证扁平化确实发生在这一版。PE 模块名用 `B:/~BUN/`，但补丁页的 P3/P10 只匹配 `/$bunfs/root/` 字面量；Windows 抽出的 JS 里路径字面量长什么样，未核。

## 相关页面

- [工作链顺序](cometix-restore-pipeline.md)
- [官方 Claude Code 的 Bun SEA 交付](claude-code-bun-sea-shipping.md)
- [打补丁前的 Node 兼容闸门](verify-node-compat-gate.md)
- [把抽出的 cli.js 改成 Node 可执行](node-compat-patches.md)

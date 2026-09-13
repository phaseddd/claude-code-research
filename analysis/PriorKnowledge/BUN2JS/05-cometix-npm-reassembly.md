---
title: 组 9 个平台包与主包并发布
kind: mechanism
status: draft
updated: 2026-09-13
applies_to: "CometixSpace/claude-code master@c286ad1（changelog: sync v2.1.240）；已发布 @cometix/claude-code 2.1.241；官方 Bun SEA 自 v2.1.113 起"
tags:
  - topic:claude-code
  - topic:npm
  - topic:bun-sea
  - form:mechanism
---

# 组 9 个平台包与主包并发布

## 一句话结论

补丁完成后，`scripts/fetch-and-process.mjs` 第 5 步对 `OUTPUT_PLATFORMS` 里每一个名字调用 `scripts/build-platform-package.mjs`，第 6 步再调用 `scripts/build-main-package.mjs`。用户只安装主包 `@cometix/claude-code`；npm 按各平台包的 `os` / `cpu` 装上对得上的那一份，[postinstall（Cometix 主包）](../../glossary.md) 里的 `install.cjs` 再把平台包的 **cli.js** 和 `vendor/` 拷进主包目录。发布由 `.github/workflows/release.yml` 在手动 `workflow_dispatch` 之后完成。

## 九个平台包怎么写出

官方 CDN 清单只有 8 个 SEA 平台：`darwin-arm64`、`darwin-x64`、`linux-arm64`、`linux-x64`、`linux-arm64-musl`、`linux-x64-musl`、`win32-arm64`、`win32-x64`。脚本另外把 `android-arm64` 写成 `PLATFORM_ALIAS`：磁盘内容复用 `linux-arm64` 抽出来并打过补丁的 cli.js 和 extract 目录，包名却是 `@cometix/claude-code-android-arm64`，`package.json` 的 `os` 为 android、`cpu` 为 arm64。这是 [android-arm64 别名](../../glossary.md)。用户最终面对的是这 9 个平台包，外加 1 个主包 `@cometix/claude-code`。

每个平台包根上是那份补丁后的 cli.js（`chmod 0o755`）。平台包 `package.json` 带 `os`、`cpu` 数组，告诉 npm 这包只适用于该操作系统和 CPU；本机对不上的 optional 平台包会被跳过。`linux-*-musl` 仍然是 `os=linux` 且 `cpu=arm64` 或 `x64`，没有 `libc` 字段。

## vendor 目录如何对齐 P3 / P10

`scripts/node-compat-patch.mjs` 的 P3 把 `require("/$bunfs/root/<模块>.node")` 改成从 `path.join(__dirname, "vendor", 模块名, process.arch+"-"+process.platform, 文件名)` 加载。P10 把那些不是 `.node` 的 `"/$bunfs/root/<文件>"` 字面量改成 `path.join(__dirname, "vendor", "assets", 文件名)`。因此 `vendor` 必须和正在运行的那份 cli.js 同目录。

`vendorDir()` 能从两段式平台键算出「cpu-os」目录名时（例如 `darwin-arm64` 变成 `arm64-darwin`），就把 extract 里找得到的 `audio-capture`、`computer-use-swift`、`computer-use-input`、`image-processor`、`url-handler` 的 `.node` 拷到 `vendor/<模块名>/<cpu>-<os>/`；找不到的模块被空的 catch 跳过。平台键是三段的 [musl](../../glossary.md) 时 `vendorDir()` 返回 null，这些 `.node` 不拷；该分支注释写 `musl — no audio-capture`。`android-arm64` 在算 vendor 路径时改传入 `linux-arm64`，所以文件落在 `arm64-linux` 子目录。

`vendor/assets` 不看 `vendorDir`：extract 里除 cli.js 和上述模块的 `.js` / `.node` 以外的普通文件都会拷进去，注释点名 chart / hljs / mermaid，以及 v2.1.229 起才有的 payload.template。ripgrep 来自 GitHub 的 6 套二进制（arm64/x64 乘 darwin/linux/win32），放入 `vendor/ripgrep/<cpu>-<os>/`；musl 没有独立目录时回退到 `arm64-linux` 或 `x64-linux`。seccomp 只在 linux 平台按 arch 放入 `vendor/seccomp/arm64` 或 `x64`。

README 的 Package contents 画出的 vendor 只有 assets、ripgrep（标注 6 platforms）、audio-capture（标注 6 platforms）、seccomp。脚本还会尝试拷 computer-use-swift、computer-use-input、image-processor、url-handler。本仓库已落下的 `artifacts/2.1.241` 是 win32-x64 安装树：postinstall 之后主包 vendor 里有 assets（含 `payload.template.html.asset`）、`audio-capture/x64-win32`、`image-processor/x64-win32`、`ripgrep/x64-win32`，没有 seccomp。

### ripgrep 与 seccomp 都是尽力而为

这两样不是官方二进制里抽出来的，是第 4 步另外去拉的，失败也不会让构建停下。

`downloadRipgrep` 对六个 `<cpu>-<os>` 键逐个下载解包，每个包在自己的 try/catch 里；失败只打印一行 `⚠ <键>: …`。函数末尾是 `return downloaded > 0 ? ripgrepDir : null`——只要有一个成功就返回目录，六个全失败才返回 null。`buildPlatformPackage` 拿到目录后对本平台那份 `stat` 不到时也只打印 `[!] vendor/ripgrep/<键>/ — not found`。所以「某个平台包发出去时没带 rg」这件事只体现为构建日志里的一行，不会失败。

六个键里 Linux 两条用的不是同一种 libc 目标：`arm64-linux` 取 `aarch64-unknown-linux-gnu`，`x64-linux` 取 `x86_64-unknown-linux-musl`。musl 平台键没有独立目录时回退到 `arm64-linux` / `x64-linux`，因此 `linux-x64-musl` 包拿到的恰好是静态链接那份，而 `linux-arm64-musl` 包拿到的是 gnu 那份。源码没有注释说明为什么两条 Linux 取不同目标。

`downloadSeccomp` 先 `npm pack @anthropic-ai/sandbox-runtime`，再按两条路径各试一次解包：`*/vendor/seccomp/*` 对应 sandbox-runtime v0.0.58+，`*/dist/vendor/seccomp/*` 对应 v0.0.57（注释写明这两个版本号）。两条都取不到就 `return null`，此后 `seccompArch(platform) && seccompDir` 不成立，linux 平台包静默地不带 seccomp。

`tarExtract` 解包时先不带 `--wildcards` 调 tar，失败再带一次；注释写明 macOS 的 BSD tar 不需要这个参数、Linux 的 GNU tar 需要。

### rg 版本探测在当前代码里不可能成功

`DEFAULT_RG_VERSION` 是写死的 `'15.1.0'`。`fetchAndProcess` 本意是从官方二进制里问出真实的 rg 版本再去 GitHub 下对应版本：

```js
// 第 3 步循环内，每个平台处理完
await rm(binPath, { force: true });
// ...循环结束之后
const currentKey = `${process.platform}-${process.arch}`;
if (extractions[currentKey]?.binPath) {
  const detected = await detectRgVersion(extractions[currentKey].binPath);
  if (detected) { rgVersion = detected; ... }
}
```

`detectRgVersion` 的做法是把那个二进制 symlink 成名为 `rg` 的文件再执行 `--version`（Bun 打出来的是 multicall 二进制，按 argv[0] 分派）。但第 3 步循环末尾已经 `rm` 掉了每一份二进制，而探测在循环**之后**才跑，拿的是同一条已删除的路径。`detectRgVersion` 整个包在 try/catch 里、失败返回 null，所以既不报错也不打印，`rgVersion` 就一直是 `15.1.0`。

CI 跑在 ubuntu-latest 上，`currentKey` 算出 `linux-x64`，这一键确实在 `extractions` 里，所以条件成立、探测照样发起，只是必然落进 catch。这一段顺序在 `3186ed0`（split-package 架构那次重构）就已经是这样，`detectRgVersion` 本身来自初始提交。

### 平台包的 files 字段没有参与发布

平台包 `package.json` 写着 `files: ['cli.js', 'vendor/']`，但发布链不走 `npm pack`：CI 用 `tar czf` 把目录包成顶层目录名为 `package` 的 tarball，再 `npm publish <tgz>` 直接发这个 tarball。npm 不会对已经打好的 tarball 再按 `files` 过滤，所以这个字段从头到尾是装饰。在单文件布局下它恰好与实际内容一致，所以无害。

## 主包占位 cli.js 与 optionalDependencies

主包由 `build-main-package.mjs` 写出。`bin.claude` 指向根目录 cli.js，写出时内容是 `templates/cli-placeholder.js`（[占位 cli.js](../../glossary.md)）：它只打印平台包没装上或 postinstall 没跑（例如 `--ignore-scripts`），并 `process.exit(1)`。`scripts.postinstall` 是 `node install.cjs`，正文来自 `templates/install.cjs`。

[optionalDependencies](../../glossary.md) 列出 9 个 `@cometix/claude-code-<平台>` 的同一版本，以及一组 `@img/sharp-*`。npm 允许列在这里的依赖安装失败也不让整包失败；缺某一个平台包时主包仍能装上，再由 `install.cjs` 决定能不能把 cli.js 拷过来。

`files` 数组包含 `cli.js`、`install.cjs`、`bun-ink-compat.cjs`、`sdk-tools.d.ts`。`bun-ink-compat.cjs` 从 templates 拷入主包，因为 `templates/bun-polyfill.js` 里是 `require("./bun-ink-compat.cjs")`，运行时的 cli.js 在主包目录。`sdk-tools.d.ts`、`LICENSE.md`、`README.md` 从 npm pack 下来的官方 `@anthropic-ai/claude-code` wrapper 目录拷来，官方主包的 JS 不当入口，见 [官方 Bun SEA 交付](01-claude-code-bun-sea-shipping.md)。主包还把 ws、yaml、undici、semver、node-pty 写进普通 `dependencies`，`engines.node` 为 `>=22.0.0`。

## postinstall 拷贝与 musl / android 选择

用户 `npm install` 主包之后，npm 按各平台包的 `os`、`cpu` 决定哪些 optional 包进入 `node_modules`。随后 `install.cjs` 用 `process.platform` 和 `process.arch` 拼键：Linux 上若 `process.report.getReport()` 的 `header.glibcVersionRuntime` 为 `undefined` 则改用 `linux-<arch>-musl`；`process.platform` 为 android 则用 `android-<arch>`。`require.resolve` 到对应平台包的 `package.json` 后，把该包的 cli.js 覆盖主包根上的占位文件，并把整个 `vendor/` 递归拷进主包目录。

同一段脚本再在 node-pty 的 `prebuilds/<平台>/spawn-helper` 上 `chmod 0o755`。注释写明 npm 会去掉非 bin 文件的可执行位，否则 Unix 上 `pty.spawn()` 报 `posix_spawnp failed`。Windows 的 `.exe` 不走 chmod。

官方 CDN 的 `SEA_PLATFORMS` 没有 android。`install.cjs` 在 `process.platform` 为 android 时会去 resolve `@cometix/claude-code-android-<arch>`，而 `os` 写成 linux 的 linux-arm64 包不会被 npm 选中，所以 `PLATFORM_ALIAS` 再打一份 `os=android` 的包。`linux-*-musl` 与对应 gnu 包在 package.json 里 `os`、`cpu` 相同，`build-platform-package.mjs` 没有写 `libc` 字段，因此 musl 与 gnu 的区分不靠 npm 的 os/cpu，而靠 `install.cjs` 的 `detectMusl()`。

## 发布作业：校验、tarball、provenance、backfill

发布由 `.github/workflows/release.yml` 完成。触发器只有 `workflow_dispatch`（可填 version 与 force），YAML 里没有 schedule 或 cron。README 的 Automated releases 写 GitHub Actions 每 6 小时检查新版本；同一仓库里的 `release.yml` 当前没有 cron。

这条文档漂移在 git 历史里可以还原：`6084129` 先删掉定时触发器，`4edc21d`（2026-04-21）又把它按三小时装回来，`0bf75e5`（2026-04-23）再删一次，diff 就是去掉 `schedule:` 与 `cron: '0 */3 * * *'` 两行。此后 `release.yml` 一直只有 `workflow_dispatch`。也就是说 README 那句「每 6 小时」不只是与现状不符——仓库里存在过的定时触发是三小时，从来没有过六小时的版本。

未指定 version 时，check 作业用 `gh release list` 收集已有 tag，再跑 `scripts/check-new-versions.mjs`：从 npm 读 `@anthropic-ai/claude-code` 的 versions，留下大于等于 2.1.113、尚未出现在本仓库 Release、且 optionalDependencies 含 `@anthropic-ai/claude-code-linux-x64` 的版本。

build 作业对每个版本跑 `fetch-and-process.mjs`，然后把 linux-x64 的 cli.js 和 vendor 拷进临时主包目录来模拟 postinstall，在 `--omit=optional` 下 `npm install` 后执行 `node cli.js --version`。这一步不依赖 shebang。接着把 `dist/<version>/main` 和 `packages/<platform>` 各自放进顶层目录名为 `package` 的 tar（不是 `npm pack`），得到 `cometix-claude-code-<version>.tgz` 和 `cometix-claude-code-<platform>-<version>.tgz`。

release 作业 `curl https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md` 覆盖本仓库 `CHANGELOG.md`，有 diff 就提交推送；GitHub Release 的 notes 来自官方 `anthropics/claude-code` 同 tag 的 body。

publish 作业先按 tarball 发平台包再发主包，registry 上已有该版本则跳过；若该版本不高于 `@cometix/claude-code` 当前 latest，则带 `--tag backfill`，避免把 latest 指针拨回旧版本。`npm publish` 使用 `--access public --provenance`；注释要求用 setup-node 自带的 npm，因为 `npx npm@latest` 会缺 sigstore。

## 没有组包会怎样

若抽包和补丁之后不再跑 `buildPlatformPackage` 与 `buildMainPackage`，`fetchAndProcess` 第 7 步会递归删除 `output/.tmp`，磁盘上不会留下 `main/` 和 `packages/<平台>/`。`.github/workflows/release.yml` 的 Verify main package 步骤会在 `cp dist/<version>/main` 时失败。即便跳过校验，Package tarballs 也打不出 `cometix-claude-code-<version>.tgz`，publish 作业在主包 tarball 缺失时会 `exit 1`。

即便把补丁后的 cli.js 留在临时目录，没有带 bin 和 optionalDependencies 的 `@cometix/claude-code`，用户执行 `npm install -g @cometix/claude-code` 也得不到 `claude` 命令。若只发主包、不发 9 个平台包，`install.cjs` 的 `require.resolve('@cometix/claude-code-<平台>/package.json')` 会失败并打印 platform package not found，主包根上仍是 `cli-placeholder.js`，一运行就 `process.exit(1)`。若平台包已经在 npm 上但去掉 postinstall 拷贝，bin 仍然链到占位 cli.js，P3 与 P10 改过的 `__dirname/vendor/...` 路径在主包目录下没有对应文件。若去掉 android-arm64 这份别名包，`getPlatformKey` 在 `process.platform` 为 android 且 arch 为 arm64 时会去 resolve `@cometix/claude-code-android-arm64`，同样失败。

## 关键边界

- 主包 `bin.claude` 指向主包自己的 cli.js，不是平台包里的文件。
- musl 与 gnu 在 npm 的 os/cpu 上无法区分，靠 `detectMusl()`。
- 触发器当前只有手动 `workflow_dispatch`。
- 本页不解释抽出与补丁的内部算法。

## 证据与复核

- `scripts/fetch-and-process.mjs` 第 5–7 步、`OUTPUT_PLATFORMS`、`PLATFORM_ALIAS`。
- `scripts/build-platform-package.mjs`：`vendorDir`、napi 列表、assets 的 `readdir`、os/cpu、musl 返回 null。
- `scripts/build-main-package.mjs`：占位 cli.js、optionalDependencies、files、从 wrapper 拷三份文件。
- `templates/install.cjs`：`detectMusl`、`getPlatformKey`、拷贝、spawn-helper 的 chmod 注释。
- `templates/cli-placeholder.js`：退出码 1。
- `.github/workflows/release.yml`：`on.workflow_dispatch`、Verify main package、tarball 顶层目录名 `package`、provenance 注释、backfill。
- `README.md`：Package contents 与 Automated releases 文案。
- `artifacts/2.1.241` 的 win32-x64 安装树：主包 `package.json` 与 `vendor/` 实况。
- `artifacts/2.1.229` 的 `vendor/assets` 含 `payload.template.html.asset`。
- `git log -S cron -- .github/workflows/release.yml` 与 `git show 0bf75e5`：定时触发器的加删过程，以及被删的那两行。
- `scripts/fetch-and-process.mjs`：`DEFAULT_RG_VERSION`、`tarExtract` 的 `--wildcards` 回退、`rgPlatformMap` 六个键的归档名、`downloadRipgrep` 的 `downloaded > 0` 返回、`downloadSeccomp` 的两条解包路径与 v0.0.58+ / v0.0.57 注释、第 3 步循环末尾的 `rm(binPath)` 与循环之后的 `detectRgVersion`。
- `git show c286ad1:scripts/fetch-and-process.mjs`：上列各项在 c286ad1 树内已是现状，不是后来才引入的。
- `git log -S"rm(binPath" -- scripts/fetch-and-process.mjs`（得到 `3186ed0`）与 `git log -S detectRgVersion`（得到初始提交 `332fd47`）：两段代码的引入时间。
- `.github/workflows/release.yml` 的 Package tarballs 与 publish 步骤：用 `tar czf` 打包、`npm publish <tgz>` 直接发 tarball。

**未确认：** 未在本机对 android 或 musl 实装以核对 `detectMusl` / `os=android` 的 npm 选型。cron 的加删过程已从本地 git 历史核实，但该仓库 GitHub 上的 Actions 运行记录本轮没有查，因此「现在实际靠人手动触发」这一步仍是从 YAML 推的，不是从运行历史看到的。「rg 版本探测必然落进 catch」是从「二进制已删 + 探测在循环之后 + 整段包 try/catch」推出的，没有实跑一次构建去看日志里有没有那行 `rg version:`；也没有核对 `15.1.0` 与官方二进制内嵌的 rg 版本是否恰好相同（若相同，这段失效不会产生可观察后果）。两条 Linux 取不同 libc 目标的动机源码未写，本页不补。

## 相关页面

- [工作链顺序](00-cometix-restore-pipeline.md)
- [官方 Claude Code 的 Bun SEA 交付](01-claude-code-bun-sea-shipping.md)
- [把抽出的 cli.js 改成 Node 可执行](04-node-compat-patches.md)
- [SPLIT-ESM/05：2.1.242 起的包布局与发布作业](../SPLIT-ESM/05-split-package-layout-and-release.md)

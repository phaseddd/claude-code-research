---
title: 官方 Claude Code 的 Bun SEA 交付
kind: concept
status: draft
updated: 2026-09-07
applies_to: "CometixSpace/claude-code master@c286ad1（changelog: sync v2.1.240）；已发布 @cometix/claude-code 2.1.241；官方 Bun SEA 自 v2.1.113 起"
tags:
  - topic:claude-code
  - topic:bun-sea
  - topic:npm
  - form:concept
---

# 官方 Claude Code 的 Bun SEA 交付

## 一句话解释

从 v2.1.113 起，用户安装官方包 `@anthropic-ai/claude-code` 时拿到的不是一份可以交给 Node 直接执行的应用脚本，而是按平台去拉一份原生 [Bun SEA](../glossary.md) 二进制。Cometix 要把应用还原成 Node 下的 npm 包，就必须按 [CDN 清单（manifest.json）](../glossary.md) 下载这些二进制、从里面抽出脚本；官方主包里的 JavaScript 不当运行入口。

## 官方从 v2.1.113 起交付的是什么

Cometix 仓库的 `CHANGELOG.md` 在 2.1.113 条目写明：CLI 改为通过按平台的 [optionalDependencies](../glossary.md) 去拉起一份原生 Claude Code 二进制，而不再使用打进 npm 包里的 JavaScript。原句是 spawn a native Claude Code binary via a per-platform optional dependency instead of bundled JavaScript。

同一仓库的 `README.md` 把同一事实写成：Starting from v2.1.113, Anthropic ships Claude Code as native Bun binaries instead of Node.js-runnable JavaScript。

这些原生文件按版本放在 `https://downloads.claude.ai/claude-code-releases/{version}/`。npm 上的官方主包仍然存在，但它的职责是按平台 optional dependency 拉起那份二进制，而不是把应用本体以可在 Node 里 `node cli.js` 的形式发出去。

本页把这种分发叫做 **Bun SEA**：Bun 把 Claude Code 的 JavaScript 和 native 模块打进一个原生可执行文件。抽出、闸门、补丁见后续专页。

## CDN 清单与八个平台键

`scripts/fetch-and-process.mjs` 的 `fetchAndProcess` 第 1 步用 `fetchJson` 读取 `{CDN}/{version}/manifest.json`，并打印 `manifest.buildDate`。`fetchJson` 内部是 `curl -sL --fail`，没有 `--retry`。

第 2 步按常量 `SEA_PLATFORMS` 的八个 [平台键](../glossary.md) 去 `manifest.platforms[平台名]` 取 `binary` 字段，拼出 `{CDN}/{version}/{平台名}/{文件名}` 再下载。这八个键是：

`darwin-arm64`、`darwin-x64`、`linux-arm64`、`linux-x64`、`linux-arm64-musl`、`linux-x64-musl`、`win32-arm64`、`win32-x64`。

它们同时是 CDN 路径的一层目录名和清单里的键。某个键在该版本清单里不存在时，脚本打印 skip，并不中止整次构建，也不会改用别的名字去猜文件。[musl](../glossary.md) 的两个键（`linux-arm64-musl` 与 `linux-x64-musl`）和另外六个键走同一条分支：有条目就按下 `binary` 各下一份，缺键就 skip。

`PLATFORM_ALIAS` 把 `android-arm64` 映射成 `linux-arm64`，用来打第九个输出包。这一键不在 `SEA_PLATFORMS` 里，不会向 CDN 要第九份二进制。见 [android-arm64 别名](../glossary.md)。

## 下载八份二进制

第 2 步用 `Promise.all` 对每个仍有清单条目的平台调用 `downloadFile`，把文件写到 `outputDir/.tmp/bins/<平台>/`。`Promise.all` 的含义是：一路 `downloadFile` 抛错，整组 promise 都会拒绝，后面的抽出不会开始。

`downloadFile` 调用 curl 时另外带上 `--retry 3 --retry-delay 2 --retry-all-errors`。这组参数用来拉这八个平台二进制，以及后面的 ripgrep 资源。它们只出现在 `downloadFile` 里，不出现在第 1 步拉清单的 `fetchJson` 里。源码没有注释说明为什么要重试。`git show c2f8284` 显示这组参数是 2026-09-04 那次「支持 v2.1.229+ 扁平布局」的修复顺手加的，与入口路径改成 `existsSync` 判断在同一个 diff 里；提交信息同样没写重试的动机。能从代码直接读到的约束是：八路并行下载包在同一个 `Promise.all` 里，任意一路失败都会让第 2 步整段拒绝。

第 3 步才对刚下的二进制调用 `extractBunSEA`。第 4 步才 `npm pack @anthropic-ai/claude-code@version`。抽出发生在 wrapper 下载之前，不是 wrapper 的后续步骤。工作链顺序见 [工作链](cometix-restore-pipeline.md)。

## 自动检测如何认定 SEA 版本

版本筛选由 `scripts/check-new-versions.mjs` 完成。它先用 [FIRST_SEA_VERSION](../glossary.md)（值为 `2.1.113`）丢掉更早的 npm 版本，再 `npm view` 该版本的 **optionalDependencies**，只有出现 `@anthropic-ai/claude-code-linux-x64` 才当作 SEA 版本。注释写明不要把只有 `@img/sharp-*` 的包算进来。

`.github/workflows/release.yml` 在未手动指定 version 时调用这个检查，再对每个通过的版本跑 `fetch-and-process.mjs`。若手动填了 version，check 作业跳过 `check-new-versions.mjs`，直接把该版本交给后续构建。

## 官方 npm 主包在 Cometix 里只贡献三份文件

`downloadWrapper` 会 `npm pack` 官方主包 `@anthropic-ai/claude-code`。`scripts/build-main-package.mjs` 只从解开的 wrapper 目录拷贝 `sdk-tools.d.ts`、`LICENSE.md`、`README.md`。

主包的 **cli.js** 来自 `templates/cli-placeholder.js`（[占位 cli.js](../glossary.md)）：它只说明平台包没装上或 postinstall 被 `--ignore-scripts` 跳过，然后以退出码 1 结束。Cometix 既不用官方主包里的 JS 当入口，也不把抽出的脚本写进主包；抽出并打过补丁的入口在平台包里，安装时由 `install.cjs` 拷过来。组包细节见 [组 9 个平台包与主包并发布](cometix-npm-reassembly.md)。

## 常见误解

- ❌「官方 npm 包里的 cli.js 就是应用本体，Cometix 把它再打一遍发出去。」→ `build-main-package.mjs` 根本不拷官方 cli.js；主包入口在 postinstall 成功之前一直是占位脚本。
- ❌「抽出发生在 npm pack wrapper 之后。」→ `fetchAndProcess` 里 `extractBunSEA` 是第 3 步，`downloadWrapper` 是第 4 步。
- ❌「musl 两份是脚本猜 glibc 之后改名下的。」→ 脚本只有 `linux-arm64-musl` 与 `linux-x64-musl` 两个键，缺键就 skip，不会改用 `linux-arm64` 或 `linux-x64` 去猜。
- ❌「android-arm64 会向 CDN 要第九份二进制。」→ 这一键不在 `SEA_PLATFORMS` 里；磁盘内容复用 `linux-arm64`。

## 依据

- `CometixSpace-claude-code/CHANGELOG.md` 的 `## 2.1.113` 条。
- `CometixSpace-claude-code/README.md` 开篇与 What it does。
- `scripts/fetch-and-process.mjs`：`CDN_BASE`、`SEA_PLATFORMS`、`OUTPUT_PLATFORMS`、`PLATFORM_ALIAS`、`fetchJson`、`downloadFile`、`fetchAndProcess` 第 1–4 步、`downloadWrapper`。
- `scripts/check-new-versions.mjs`：`FIRST_SEA_VERSION`、`optionalDependencies` 里的 `@anthropic-ai/claude-code-linux-x64`。
- `scripts/build-main-package.mjs`：只拷 `sdk-tools.d.ts` / `LICENSE.md` / `README.md`；cli.js 来自 `templates/cli-placeholder.js`。
- `templates/cli-placeholder.js`：未装上平台包时 `process.exit(1)`。
- `.github/workflows/release.yml`：未填 version 才跑 `check-new-versions.mjs`。
- `git show c2f8284 -- scripts/fetch-and-process.mjs`：curl 重试参数的引入位置与时间。

**未确认：** 本页依据是仓库内脚本与 changelog 原文，没有向 CDN 实拉一份 `manifest.json`。脚本未写「官方为不用 glibc 的 Linux 另发 musl」这类动机，本页也不补。`fetchJson` 为何不带 `--retry`、`downloadFile` 为何带 `--retry-all-errors`，代码注释与提交信息都没有交代，只能定位到引入它们的那个提交。

## 相关页面

- [工作链顺序](cometix-restore-pipeline.md)
- [从官方二进制抽出模块并定位 cli.js](bun-sea-extract.md)
- [组 9 个平台包与主包并发布](cometix-npm-reassembly.md)

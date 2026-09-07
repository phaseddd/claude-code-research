---
title: Cometix 把官方 Bun SEA 还原成 Node npm 包的工作链
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

# Cometix 把官方 Bun SEA 还原成 Node npm 包的工作链

## 一句话解释

Cometix 仓库用 `scripts/fetch-and-process.mjs` 导出的 `fetchAndProcess`，把某一版官方 Claude Code 还原成可在 Node 下安装的 npm 包。编排顺序是：读 [CDN 清单（manifest.json）](../glossary.md) → 按八个 [平台键](../glossary.md) 下载 [Bun SEA](../glossary.md) 二进制 → 抽出模块并定位 **cli.js** → 过兼容闸门 → 打补丁 → 组九个平台包加一个主包。`.github/workflows/release.yml` 在 Build all packages 步骤调用这份脚本，随后再做校验、打 tarball、发布。本页只记录这段顺序，以及各环交接的目录与变量名。

## 工作链顺序

编排函数是 `fetchAndProcess`。`.github/workflows/release.yml` 的 Build all packages 步骤对每个待发布版本执行：

`node scripts/fetch-and-process.mjs --version <版本> --output ./dist/<版本>`

未手动指定 `version` 时，check 作业先跑 `scripts/check-new-versions.mjs`，把通过过滤的版本号交给上面这条命令。

| 顺序 | 发生的事 | 谁执行 | 交接物 | 专页 |
|---|---|---|---|---|
| 0 | 自动检测时认定这是 SEA 版本 | `scripts/check-new-versions.mjs` | 通过过滤的版本号 | [官方 Bun SEA 交付](claude-code-bun-sea-shipping.md) |
| 1 | 读 CDN 清单 | `fetchAndProcess` 第 1 步 `fetchJson` | `manifest.buildDate`、`manifest.platforms` | 同上 |
| 2 | 按八个平台键下载二进制 | 第 2 步 `downloadFile`（包在 `Promise.all` 里） | `outputDir/.tmp/bins/<平台>/` | 同上 |
| 3a | 解析 Bun 节、把模块写到磁盘 | 第 3 步 `extractBunSEA` 加写盘循环 | `outputDir/.tmp/extract/<平台>/`（变量 `extractDir`） | [抽出模块并定位 cli.js](bun-sea-extract.md) |
| 3b | 在嵌套路径与根上 `cli.js` 之间选入口 | 第 3 步 `existsSync(legacyCli)` | 变量 `cliSrc` | 同上 |
| 3c | 打补丁前的结构闸门 | `verifyNodeCompat(cliSrc)` | 返回字段 `compatible` 与 `fatal` | [Node 兼容闸门](verify-node-compat-gate.md) |
| 3d | 剥壳、AST 补丁、按需注入 polyfill | `patchFile(cliSrc, patchedPath)` | `outputDir/.tmp/patched/<平台>.js` | [Node 兼容补丁](node-compat-patches.md) |
| 4 | `npm pack` 官方主包，并拉 ripgrep / seccomp | 第 4 步 `downloadWrapper` 等 | 变量 `wrapperDir`（主包稍后只用其中三份文件） | [官方 Bun SEA 交付](claude-code-bun-sea-shipping.md)、[npm 组包与发布](cometix-npm-reassembly.md) |
| 5 | 组九个平台包 | 第 5 步对 `activeOut` 逐个调用 `buildPlatformPackage` | `outputDir/packages/<平台>/` | [npm 组包与发布](cometix-npm-reassembly.md) |
| 6 | 组主包 | 第 6 步 `buildMainPackage` | `outputDir/main/` | 同上 |
| 7 | 删掉临时目录 | `rm(tmpDir)` | 磁盘上只留 `main/` 与 `packages/` | 同上 |
| CI | 模拟 postinstall、打 tarball、发布 | `release.yml` 的 Verify / Package / publish | `artifacts/cometix-claude-code-*.tgz` | 同上 |

`android-arm64` 不在第 2 步的下载名单里。第 5 步用常量 `PLATFORM_ALIAS` 把名为 `android-arm64` 的包映射到 `linux-arm64` 的抽出与补丁产物，另打一份 `os` 为 android 的包。这一键不向 CDN 要第九份二进制，细节见 [android-arm64 别名](../glossary.md) 与组包专页。

## 编排入口与产物交接

- 入口脚本是 `scripts/fetch-and-process.mjs`。命令行要 `--version` 或 `--latest`。`--latest` 会执行 `npm view @anthropic-ai/claude-code version`，把读到的版本号再交给 `fetchAndProcess`。
- 运行中的临时根是 `outputDir/.tmp/`（变量 `tmpDir`）。第 7 步整棵删除，所以闸门、补丁、抽出目录都不会留到发布产物里。
- 各环用到的目录与变量：
  - `CDN_BASE`：`https://downloads.claude.ai/claude-code-releases`
  - `SEA_PLATFORMS`：八个下载用平台键
  - `OUTPUT_PLATFORMS`：上面八个再加 `android-arm64`
  - `activeSEA` / `activeOut`：第 2 步与第 5 步实际遍历的名单。不传 `--platforms` 时分别等于 `SEA_PLATFORMS` 与 `OUTPUT_PLATFORMS`；传了就按该参数过滤
  - `PLATFORM_ALIAS`：`{ 'android-arm64': 'linux-arm64' }`
  - `extractDir`：`join(tmpDir, 'extract', platform)`，即 `outputDir/.tmp/extract/<平台>/`
  - `legacyCli`：`join(extractDir, 'src', 'entrypoints', 'cli.js')`
  - `cliSrc`：闸门与补丁实际打开的那份入口
  - `patchedPath`：`join(tmpDir, 'patched', platform + '.js')`
  - `extractions[platform]`：`{ extractDir, patchedPath, binPath }`，第 5 步按 `PLATFORM_ALIAS[platform] || platform` 去取
  - `wrapperDir`：`npm pack` 解开后的官方主包目录
  - 最终产物：`outputDir/packages/<平台>/` 与 `outputDir/main/`
- 用户最终安装的是主包 `@cometix/claude-code`。主包根上的 **cli.js** 在 [postinstall（Cometix 主包）](../glossary.md) 成功拷贝之前是 [占位 cli.js](../glossary.md)；真正跑起来的入口来自对应平台包里那份打过补丁的 **cli.js**。

## 本页不讲什么

官方为什么改成原生二进制、八个平台键如何拼 URL、`downloadFile` 给 curl 加了哪些重试参数、模块表如何解析、闸门三项 fatal 怎么测、各补丁改哪类节点、`vendor/` 如何对齐 `require` 路径——各有专页。本页出现这些名字只为标明顺序和交接物，不保存细节。

## 常见误解

- 「九个平台包对应九份官方二进制」不成立。第 2 步只向 CDN 要 `SEA_PLATFORMS` 里那八份；第九个包由 `PLATFORM_ALIAS` 复用 `linux-arm64` 的抽出与补丁产物。
- 「抽出物和补丁产物会随包发出去」不成立。第 3 步的 `extractDir` 与 `patched/<平台>.js` 都在 `outputDir/.tmp/` 下，第 7 步整棵删除；平台包里的 cli.js 是第 5 步 `buildPlatformPackage` 拷进去的副本。
- 「闸门失败只跳过该平台」不成立。`verifyNodeCompat` 返回的 `compatible` 为假时，编排脚本直接 `process.exit(1)`，尚未处理的平台、补丁、组包全部不做。

## 依据

- `scripts/fetch-and-process.mjs`：`fetchAndProcess` 第 1–7 步；常量 `CDN_BASE` / `SEA_PLATFORMS` / `OUTPUT_PLATFORMS` / `PLATFORM_ALIAS`；变量 `tmpDir` / `extractDir` / `legacyCli` / `cliSrc` / `patchedPath` / `extractions` / `wrapperDir`；CLI 分支 `--version` / `--latest` / `--platforms`。
- `.github/workflows/release.yml`：check 作业调用 `check-new-versions.mjs` 的条件，Build all packages 步骤对 `fetch-and-process.mjs` 的调用形式，以及其后的 Verify / Package / publish。
- 各环内部细节的出处记在对应专页的「证据与复核」或「依据」节。

**未确认：** 本轮没有实跑 `fetchAndProcess`，顺序与交接物取自源码阅读，不是一次构建的日志。`--platforms` 过滤下 `activeSEA` / `activeOut` 的裁剪路径未实测。

## 相关页面

- [官方 Claude Code 的 Bun SEA 交付](claude-code-bun-sea-shipping.md)
- [从官方二进制抽出模块并定位 cli.js](bun-sea-extract.md)
- [打补丁前的 Node 兼容闸门](verify-node-compat-gate.md)
- [把抽出的 cli.js 改成 Node 可执行](node-compat-patches.md)
- [组 9 个平台包与主包并发布](cometix-npm-reassembly.md)

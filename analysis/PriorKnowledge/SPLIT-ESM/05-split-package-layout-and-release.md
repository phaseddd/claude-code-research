---
title: split 下的包布局与发布作业
kind: mechanism
status: active
updated: 2026-09-13
applies_to: "CometixSpace/claude-code master@a14c5e5 的 build-platform-package.mjs / build-main-package.mjs / templates/install.cjs / .github/workflows；实测对象为已发布的 @cometix/claude-code 2.1.242 至 2.1.263 win32-x64 安装树"
tags:
  - topic:claude-code
  - topic:npm
  - topic:split-esm
  - form:mechanism
---

# split 下的包布局与发布作业

## 一句话结论

分块布局下，平台包不再是「一份 cli.js 加一个 `vendor/`」，而是整棵抽出目录原样搬过去：入口、上千个分块、原生模块、资产平铺在一起，`vendor/` 只留 Cometix 自己加的 ripgrep 和 seccomp。主包因此要标 `type: module`，`install.cjs` 也从「拷两样东西」改成「除了 `package.json` 全拷」。发布作业跟着改了两处：模拟 postinstall 要带上整棵树，验证要在 `/tmp` 里跑而不是在包目录里跑。

## 平台包：整棵树原样搬

```js
if (splitEsm) {
  const copied = await copyModuleTree(extractDir, outputDir, new Set());
  await chmod(join(outputDir, entryRel), 0o755);
} else {
  await copyFile(patchedCliPath, join(outputDir, 'cli.js'));
  await chmod(join(outputDir, 'cli.js'), 0o755);
}
```

`skip` 是**空集合**——这是 `07d65a4` 的结果。在它之前 `skip` 装着五个 `.node` 名字加全部 `*.min.js`/`*.asset` 名，那些文件被排除在树外、另行拷进 `vendor/`（见 [01](01-esm-chunk-rewrites.md) 的 E2 第二版）。现在什么都不排除，因为什么都不搬。

与之对应，两段 `vendor/` 拷贝都加了 `!splitEsm` 守卫：

| `vendor/` 子目录 | single-CJS | split-ESM |
|---|---|---|
| `<模块>/<cpu>-<os>/*.node` | 拷（musl 键除外，`vendorDir()` 返回 null） | **不拷**——分块按相对路径直接 require |
| `assets/*.{min.js,asset}` | 拷 | **不拷**——留在树里原地 |
| `ripgrep/<cpu>-<os>/rg[.exe]` | 拷 | 拷 |
| `seccomp/<arch>/apply-seccomp` | 拷（仅 linux） | 拷（仅 linux） |

`07d65a4` 的正文还顺带解释了为什么连 `<cpu>-<os>` 那一层都删掉：它是更早的单包布局遗留，而现在每个平台包只带自己那份原生模块，`process.arch + "-" + process.platform` 不可能解析到别的东西。

平台包 `package.json` 仍然写着

```js
files: ['cli.js', 'vendor/'],
```

这在 split 布局下与实际内容不符——它既不包含 `chunk-*.js`，也不包含 `bun-polyfill.mjs` 和平铺的原生模块。之所以没炸，是因为发布链根本不走 `npm pack`：`release.yml` 用 `tar czf` 把目录包成顶层目录名为 `package` 的 tarball，再 `npm publish "$tgz"` 直接发这个 tarball，`files` 从头到尾没有参与。这是一处休眠的地雷——哪天有人改回 `npm pack`，平台包会只剩 `cli.js` 和 `vendor/`。这条在单文件时代就存在（那时内容恰好对得上，所以是无害的），到 split 布局才变成隐患。

## 主包：`type: module` 与 files 清单

`buildMainPackage` 在 `splitEsm` 为真时加一行：

```js
...(splitEsm ? { type: 'module' } : {}),
```

注释给的理由是 postinstall 会把 ESM 分块放到 `cli.js` 旁边，包必须被标成 module 才能让 Node 加载它们。

`files` 数组在 split 下多四项，注释写明它们是 postinstall 写进来的，列在这里只为「万一以后在发布前先把树铺好再打包」：

```js
...(splitEsm ? ['chunk-*.js', 'bun-polyfill.mjs', 'src/', 'vendor/'] : [])
```

`engines.node` 改成 `>=24.0.0`，两条理由见 [04](04-bun-api-coverage-and-polyfill.md)。`dependencies` 多了 `smol-toml`（撑 `Bun.TOML`）。主包根上那份 `cli.js` 在 postinstall 成功之前仍然是 `templates/cli-placeholder.js`，这一点没变。

## postinstall：从「拷两样」改成「除了 package.json 全拷」

`templates/install.cjs` 原先拷 `cli.js` 和 `vendor/`。现在是：

```js
for (const entry of readdirSync(pkgDir)) {
  if (entry === 'package.json') continue;   // 会覆盖主包清单
  const src = path.join(pkgDir, entry);
  const target = path.join(dest, entry);
  if (statSync(src).isDirectory()) copyDirSync(src, target);
  else copyFileSync(src, target);
}
```

排除 `package.json` 的理由写在注释里：它会覆盖主包自己的清单。注释同时说明了为什么必须全拷——分块之间靠相对指示符互相 import，所以必须落在同一个目录里。

拷完之后新增一句对 `cli.js` 补可执行位：

```js
require('fs').chmodSync(path.join(dest, 'cli.js'), 0o755);
```

注释给的理由：`copyFileSync` 会把源文件的 mode 带过来，而 npm 可能已经从平台包 tarball 里剥掉了 `+x`，所以要在 bin 入口上补回来。node-pty 的 `spawn-helper` 那段 chmod 保持原样。

平台选择逻辑（`detectMusl()` 看 `process.report` 里有没有 `glibcVersionRuntime`、`process.platform === 'android'` 走 android 键）没有变化，见 [BUN2JS/05](../BUN2JS/05-cometix-npm-reassembly.md)。

## 实测：装完之后主包长什么样

`artifacts/2.1.263/global-prefix/node_modules/@cometix/claude-code`（win32-x64，`install-summary.json` 记录 `claude --version` 输出 `2.1.263 (Claude Code)`）：

```
cli.js                     18332 字节，ESM 入口，首行 shebang，第一条语句 import"./bun-polyfill.mjs"
chunk-*.js                 1627 个
bun-polyfill.mjs           E4 产物，含 __ccNodeRequire / __ccDirname 两个全局
bun-ink-compat.cjs         主包自带（polyfill 的 stripANSI/stringWidth/wrapAnsi 走它）
install.cjs                postinstall 本体
audio-capture.node         平铺在根上
image-processor.node       平铺在根上
chart.umd.min.js           平铺；这四份都是 zstd 成帧但保留原名
hljsBundle.generated.min.js
mermaid.min.js
payload.template.html.asset
*.md / *.md.zst / *.txt / *.txt.zst   内嵌技能提示词与模板，共 106 个 .zst + 72 个未压缩
sdk-tools.d.ts / LICENSE.md / README.md   从官方 wrapper 拷来
package.json               type: module，engines.node >=24.0.0
src/plugins/functionHooks/hooks-worker/hooks-worker.js   唯一的嵌套模块，import"../../../../bun-polyfill.mjs"
vendor/ripgrep/x64-win32/rg.exe 与 vendor/ripgrep/COPYING
node_modules/              ws、yaml、undici、semver、node-pty、smol-toml
```

顶层条目共 1824 个。`vendor/` 里没有 seccomp——它只发给 linux 平台键。

这棵树同时印证了 `0f672d5` 那次修复的必要性：`hooks-worker.js` 确实躺在四层目录之下，「所有分块都在根上」从来不是一个安全假设。

## 发布作业改了两处

### 一、模拟 postinstall 要带上整棵树

```bash
find "$DIST/packages/linux-x64" -maxdepth 1 -mindepth 1 \
  ! -name package.json -exec cp -r {} "$VERIFY/" \;
```

替换掉原先那两行 `cp cli.js` + `cp -r vendor`。注释写明：在 split 布局下这也把分块树带过来，没有它 `cli.js` 连一条 import 都解析不了。这段 `find` 与 `install.cjs` 的「除了 `package.json` 全拷」是同一条规则的两份实现。

### 二、验证要在包目录之外跑

```bash
cd /tmp
node "$VERIFY/cli.js" --version
node "$VERIFY/cli.js" --help > "$VERIFY/help.txt"
node "$VERIFY/cli.js" mcp list
```

`3bf95d4` 的正文把这条讲成事故的根因：用户是从项目目录启动的，不是从包目录。原先的冒烟检查在包目录里跑，工作目录恰好是对的，所以看不见 `readFileSync` 按 `process.cwd()` 解析这个问题——从项目目录启动会在某个内嵌提示词上 ENOENT。检查项也从 `--version` + `--help` 扩到加一条 `mcp list`。

### 三、平台包发布失败不再被吞

`2908539` 之前那个循环以 `|| echo "Failed (may need package init)"` 结尾，于是被拒的发布只印一行、作业照样绿。紧接着发布的主包把每个平台都列进 `optionalDependencies`，所以一次静默失败会发出一个「optional 依赖指向从未存在的版本」的 release——安装方只会一路落到占位 `cli.js`。

改法是收集失败而不是吞掉：一个包坏不再拖累其余，但循环结束后作业以非零码退出并点名是哪些包。

`release.yml` 的触发器仍然只有 `workflow_dispatch`。

## 新增的测试与 CI

`.github/workflows/test.yml`（新增）：`pull_request` 与 `push` 触发，矩阵是 ubuntu-latest 与 windows-latest、Node 24，跑 `npm ci --ignore-scripts` 然后 `npm test`。`package.json` 的 `test` 脚本是 `node --test test/*.test.mjs`。

目前唯一的测试文件 `test/esm-text-assets.test.mjs` 专门盯 E2/E3 的路径解析，覆盖面是（`BUNFS_ROOTS` 两种前缀）×（平铺 / 嵌套）四组：

- 包目录名故意取成 `package with spaces #资源`——空格、`#`、非 ASCII 字符各一份；
- 断言 `.md`、`.txt` 读回内容，`.json` 仍按普通模块加载，绝对路径形式的文本目标也要能读；
- `load.resolve(...)` 的返回值要等于真实绝对路径（这条验的是 `Object.assign(…, __ccRawRequire)` 把 `resolve` 带过去了）；
- 从模块所在目录和从外部项目目录各跑一遍；
- 再在项目目录下和其上一级各放一份同名 `prompt.md` / `template.txt`，重跑一次——用户工作目录里的同名文件绝不能顶替内嵌提示词。

`a14c5e5` 修的是这个测试自己的毛病：绝对路径断言拿 `mkdtemp` 的输出和 `require.resolve()` 的报告比，而 macOS 上 `tmpdir()` 是指向 `/private/var` 的符号链接，两者差一个前缀。修法是先 `realpath` 临时目录。正文特意说明「把修复撤掉之后四条内容断言仍然全挂，所以这次放宽没有削弱检查」——以及 CI 只跑 Windows 和 Ubuntu，那里两条路径恰好相同，所以这个问题不是 CI 发现的。

## 常见误解

- 「split 布局下资产在 `vendor/assets/`。」2.1.242–2.1.260 是，且那几版路径与文件位置对不上；2.1.261 起不再搬动。
- 「平台包 `files` 字段决定了发布内容。」没有参与。发布走 `tar czf` + `npm publish <tgz>`，`files` 只在 `npm pack` 路径上生效。
- 「主包 `files` 里的 `chunk-*.js` 说明主包 tarball 带着分块。」不带。那几项是 postinstall 之后才存在的文件，注释说明列在这里只为将来可能的「先铺树再打包」。
- 「`install.cjs` 会拷平台包的 `package.json`。」显式跳过，否则会覆盖主包清单。
- 「CI 的冒烟检查一直在包目录外跑。」`3bf95d4` 之后才是。之前在包目录里跑，正是那条 cwd 问题漏过去的原因。

## 依据

- `scripts/build-platform-package.mjs`：`copyModuleTree`、空 `skip`、两段 `!splitEsm` 守卫、`vendorDir` / `seccompArch`、`files: ['cli.js','vendor/']`。
- `scripts/build-main-package.mjs`：`type: module`、`engines`、`files` 的 split 分支及注释、`smol-toml`。
- `templates/install.cjs`：跳过 `package.json` 的循环及注释、`cli.js` 的 chmod 及注释、`detectMusl` / `getPlatformKey`。
- `.github/workflows/release.yml`：Verify main package 的 `find … ! -name package.json`、`cd /tmp` 与三条冒烟命令、Package tarballs 的 `tar czf … package/`、publish 作业收集 `FAILED` 后 `exit 1`、`on.workflow_dispatch`。
- `.github/workflows/test.yml` 与 `package.json` 的 `test` 脚本。
- `test/esm-text-assets.test.mjs` 全文。
- `git show 07d65a4` / `0f672d5` / `3bf95d4` / `2908539` / `a14c5e5`：各次改动的正文理由。
- 实测 `artifacts/2.1.242`…`2.1.263` win32-x64 安装树：`vendor/` 内容、原生模块位置、分块数、`package.json`、`install-summary.json` 里的 `cliVersion`。

**未确认：** 只有 win32-x64 的安装树，linux 的 `vendor/seccomp/` 与 `clipboard-napi`、darwin 的五份原生模块都没有实测样本。musl 与 android 两条键同样没有实装验证（这一条在单文件时代也未确认）。`npm test` 本轮没有在本机跑过；测试内容取自源码阅读。「`files` 改回 `npm pack` 会漏掉分块树」是按 npm 语义推的，没有实做一次 `npm pack` 验证。

## 相关页面

- [2.1.242 分水岭](00-split-esm-turning-point.md)
- [E1–E5：分块 ESM 的五类改写](01-esm-chunk-rewrites.md)
- [Bun API 对账与 polyfill 补齐](04-bun-api-coverage-and-polyfill.md)
- [版本时间线与实测证据](06-version-timeline-evidence.md)
- [BUN2JS/05：组 9 个平台包与主包并发布](../BUN2JS/05-cometix-npm-reassembly.md)

---
title: 抽出进独立进程，与文本编码的坑
kind: mechanism
status: active
updated: 2026-09-13
applies_to: "CometixSpace/claude-code master@a14c5e5 的 scripts/extract-worker.mjs、bun-sea-extract.mjs、fetch-and-process.mjs 第 3 步；官方 split-ESM 自 v2.1.242 起；实测对象为已发布的 @cometix/claude-code 2.1.246 / 2.1.263 win32-x64 安装树"
tags:
  - topic:claude-code
  - topic:bun-sea
  - topic:split-esm
  - form:mechanism
---

# 抽出进独立进程，与文本编码的坑

## 一句话结论

2.1.242 把内嵌模块数从 15 个抬到一千多个、把节大小抬到两百多 MB，抽出这一步随之从「进程内一个函数调用」变成两个独立问题：内存回收和文本解码。前者的答案是 `scripts/extract-worker.mjs`——每个平台开一个子进程做抽出，靠进程退出把内存还给操作系统；后者的答案是按 Bun 的 `encoding` 标签解码，因为那个字段说的是「Bun 内部怎么存这个字符串」，不是「磁盘上的字节怎么排」。

## 内存：两次尝试，第二次才对

### 症状

`b32d601` 与 `4f337d8` 的正文都以同一句开头：2.1.242 的构建在第一个平台跑完之后立刻段错误。

### 第一次尝试：收紧 JS 侧（`b32d601`）

诊断是：每个模块的 `contents` 都是同一份节缓冲区上的视图——这一版是 228 MB；把 345 MB 的二进制本体和 lief 自己那份副本一起算，常驻内存 1.4 GB。而 `extractBunSEA` 的返回值在整个打补丁阶段都还在作用域里，于是这块缓冲区在下一个平台已经开始读自己那份的时候仍然释放不掉。

做法有三条：

1. 把抽出收进一个更小的作用域；
2. 每写一个模块就把那一片置空，让某个平台的缓冲区在下一个平台开始前可被回收；
3. 顺手把落点扫描改成流式——它原先把所有候选读进一个 map 再解析，同时持有约 20 MB 源码加一棵数百万节点的 AST（这条改动留在了 `patch-sites.mjs` 里，见 [02](02-patch-site-registry.md)）。

同时抬高了 CI 的堆上限。

量到的结果：三次连续抽出常驻 1433 MB、1440 MB、1446 MB——平的，不累积。但平在 1.4 GB 仍然超出 runner。

### 第二次尝试：换进程（`4f337d8`）

关键观察写在正文里：一次完整抽出之后，JS 堆回到 5 MB，而 RSS 停在约 1 GB。那块内存属于 lief 为一个三百多 MB 的二进制建起来的原生对象图，垃圾回收管不到它——所以八个平台挤在一个进程里必然把 runner 撑爆。

做法是把抽出搬进 `extract-worker.mjs`，用 `execFileSync` 跑：

```js
execFileSync(process.execPath, [
  join(SCRIPT_DIR, 'extract-worker.mjs'), binPath, extractDir,
], { stdio: ['ignore', 'pipe', 'inherit'], timeout: 600_000 });
```

进程退出就把原生内存交还操作系统。顺带还有一个好处，正文单独点出：解析器内部崩溃不再把整次构建带走。

量到的结果：父进程三次连续抽出 RSS 34 MB、34 MB、35 MB；此前是 1071 MB 且在涨。

同一提交还做了两件事：

- **不再为读魔数而读整个文件。** lief 自己会打开文件，所以四个字节就够，每个平台省下另外 345 MB：

  ```js
  function readMagic(binaryPath) {
    const head = Buffer.alloc(4);
    const fd = openSync(binaryPath, 'r');
    try { readSync(fd, head, 0, 4, 0); } finally { closeSync(fd); }
    return head;
  }
  ```

- **撤销上一次的堆上限抬高。** 正文的判断是它让事情更糟：V8 因此推迟回收，而原生分配在同时增长。

这两次尝试的顺序值得留着。第一次的诊断（视图共享一块缓冲区）是对的、量出的曲线也是平的，但结论错在把 1.4 GB 当成 JS 侧问题；第二次用「JS 堆 5 MB / RSS 1 GB」这一组对照把归因钉死在原生侧，才换了方案。

## 抽出循环现在长什么样

`fetch-and-process.mjs` 第 3 步是逐平台串行的 `for` 循环（下载那一步仍然是 `Promise.all` 并行），每轮：

1. `execFileSync` 跑 `extract-worker.mjs`，写满 `extractDir`；
2. 按 `existsSync(legacyCli)` 在 `extractDir/src/entrypoints/cli.js` 与 `extractDir/cli.js` 之间选 `cliSrc`（这段逻辑与单文件时代相同，见 [BUN2JS/02](../BUN2JS/02-bun-sea-extract.md)）；
3. `verifyNodeCompat(cliSrc, splitEsm)`，不通过就 `process.exit(1)`；
4. 按 `splitEsm` 走 `patchSplitEsm` 或 `patchFile`；
5. `rm(binPath)` 删掉这份二进制。

worker 一侧只做「解析 + 写盘」，最后往 stdout 打一个写出文件数。写盘规则与原先进程内那段一致：剥 `basePath`、再剥 `root/`、入口按 `loader` 改扩展名、`contents.length > 0` 才写；新增的是每写完一个就

```js
mod.contents = null;
mod.sourcemap = null;
```

注释解释得很清楚：每一片都是同一份节缓冲区上的视图，只要还有一片可达，整块就活着。

## 文本编码：`encoding` 说的不是字节布局

`bfd7b4e` 里这条是与文本加载器改写（见 [01](01-esm-chunk-rewrites.md) 的 E3）**并列的第二个问题**，正文用「Extraction was corrupting half of them independently」把两者分开。

结论一句话：Bun 模块表里的 `encoding` 字段描述的是 Bun 内部怎么持有这个字符串，不是磁盘字节怎么排。

| `encoding` 标签 | 实际字节 | 直接写盘的后果 |
|---|---|---|
| `utf8` | UTF-16LE | 每个字符后面跟一个 NUL，文件读不出来 |
| `latin1` | 已经是 UTF-8 | 正确 |

2.1.246 里 76 个文本资产标着 `utf8`，占全部的一半，全都带「每字符后一个 NUL」的特征。修法是按标签解码，且只对 `loader === 'text'` 的模块生效：

```js
function decodeText(mod) {
  return mod.encoding === 'utf8'
    ? Buffer.from(mod.contents.toString('utf16le'), 'utf8')
    : mod.contents;
}
// …
await writeFile(outPath, mod.loader === 'text' ? decodeText(mod) : mod.contents);
```

实测已发布的 2.1.246 win32-x64 主包：根上 165 个 `.md`/`.txt`（不含主包自带的 `README.md`）全部不含 NUL 字节，首个文件 `agent-design-g0jwx8sb.md` 以 `# Agent Design Patterns` 开头，可正常按 UTF-8 读出。

`bfd7b4e` 的验证记录是：2.1.246 darwin-arm64 上 164 个资产干净抽出，加载一个技能分块得到九个字符串条目（`references/*.md` 与 `scripts/*.{js,py}`）且 `SKILL_MD` 完好；2.1.242 与 2.1.241 不受影响。

## 双前缀常量导出

`bun-sea-extract.mjs` 把两个 BunFS 根提升成导出常量：

```js
export const BASE_PATH_POSIX   = '/$bunfs/';
export const BASE_PATH_WINDOWS = 'B:/~BUN/';
export const BUNFS_ROOTS = [BASE_PATH_POSIX, BASE_PATH_WINDOWS].map((b) => `${b}root/`);
```

注释写明动机：只认第一个的改写器会把每一条 win32 路径原样留下。现在 `esm-chunk-patch.mjs`（E1/E2 的正则）、`node-compat-patch.mjs`（`bunfsTarget`）、`verify-node-compat.mjs`（`ESM_CHECKS` 的 BunFS import 检查）、`test/esm-text-assets.test.mjs`（对两种前缀各跑一遍）都从这一处取。

`96bb4d4` 的正文顺带交代了历史：这份常量本来就为指示符改写同时带着两个前缀，只是 P3/P10 的判定条件当时还在字面匹配 `/$bunfs/root/`，所以 win32 全线漏检——细节见 [02](02-patch-site-registry.md)。

## 常见误解

- 「段错误是 Bun 节解析写错了。」不是。两条提交都把它归因到内存：先是 JS 侧持有视图，后确认主体在 lief 的原生对象图上。
- 「抬高 Node 堆能救。」相反。`4f337d8` 明确撤销了上一次的抬高，理由是它让 V8 推迟回收而原生分配继续涨。
- 「`encoding: 'utf8'` 意味着磁盘上是 UTF-8。」恰好相反，这是这条 bug 的全部。
- 「文本解码只影响技能提示词。」它作用于所有 `loader === 'text'` 的模块；2.1.246 起技能资产只是把这个面放大到了一半文件。
- 「抽出仍然八路并行。」下载并行，抽出串行。串行是前提：独立进程之所以能把内存还回去，是因为同一时刻只有一个在跑。

## 依据

- `scripts/extract-worker.mjs` 全文：文件头注释（JS 5 MB / RSS 1 GB、崩溃隔离）、`decodeText`、写盘循环、置空两行、末尾打印写出数。
- `scripts/bun-sea-extract.mjs`：`readMagic`、`BASE_PATH_POSIX` / `BASE_PATH_WINDOWS` / `BUNFS_ROOTS` 及其注释。
- `scripts/fetch-and-process.mjs` 第 3 步：`execFileSync` 调用与其上方注释、串行 `for`、`rm(binPath)`。
- `git show b32d601`：228 MB 节 / 345 MB 二进制 / 1.4 GB 常驻、1433–1446 MB 三次测量、流式扫描、堆上限抬高。
- `git show 4f337d8`：34/34/35 MB 对 1071 MB、四字节魔数省 345 MB、撤销堆上限。
- `git show bfd7b4e`：`encoding` 语义、76 个 `utf8` 标签资产、164 个资产的 darwin 验证。
- `git show 96bb4d4`：`BUNFS_ROOTS` 已存在而补丁侧未用上。
- 实测 `artifacts/2.1.246/global-prefix/node_modules/@cometix/claude-code`：165 个 `.md`/`.txt` 无 NUL 字节，可按 UTF-8 读出。

**未确认：** 内存数字全部沿用提交正文，本轮没有在本机重跑抽出去复现 RSS 曲线。2.1.242 那份二进制的 228 MB 节大小、345 MB 体积同样未自行核对。文本解码只在已发布的 2.1.246 win32-x64 上验证了「结果干净」，没有拿一份未修版本对照出损坏形态。

## 相关页面

- [2.1.242 分水岭](00-split-esm-turning-point.md)
- [E1–E5：分块 ESM 的五类改写](01-esm-chunk-rewrites.md)
- [补丁落点登记表与扫描](02-patch-site-registry.md)
- [BUN2JS/02：从官方二进制抽出模块并定位 cli.js](../BUN2JS/02-bun-sea-extract.md)

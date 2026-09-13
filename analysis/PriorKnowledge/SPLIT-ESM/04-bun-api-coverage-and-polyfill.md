---
title: Bun API 对账与 polyfill 补齐
kind: mechanism
status: active
updated: 2026-09-13
applies_to: "CometixSpace/claude-code master@a14c5e5 的 scripts/bun-api-coverage.mjs 与 templates/bun-polyfill.js；引入提交 6bbbd95（2026-09-09）；实测对象为已发布的 @cometix/claude-code 2.1.251 / 2.1.263 win32-x64 安装树"
tags:
  - topic:claude-code
  - topic:bun-sea
  - topic:split-esm
  - form:mechanism
---

# Bun API 对账与 polyfill 补齐

## 一句话结论

`templates/bun-polyfill.js` 一直是手工维护的，所以它覆盖的是「我们碰巧注意到崩过的那些」。缺一个 `Bun.*` 不会让构建失败——它会在运行时、在第一个走到那条功能路径的用户那里抛出来。`6bbbd95` 加的 `scripts/bun-api-coverage.mjs` 把两边都从 AST 读出来对账：bundle 实际调了哪些 `Bun.*`、polyfill 定义了哪些、缺口里哪些有守卫（功能失效）哪些没有（启动即炸）。对账当时就查出 `Bun.TOML` 与 `Bun.connect` 自 2.1.242 起一直缺着发了出去，只因为两者都在冷路径上，没人撞到。

## 为什么两边都要读 AST

`Bun` 是一个全局对象，所以 `Bun.x` 在压缩之后仍然是一个成员表达式——形状稳定，可以靠 AST 精确捞。子串扫描在两侧各有一种错法：

- bundle 侧会把字符串、注释和更长成员链里的 `Bun.` 一起捞进来；
- polyfill 侧会漏掉简写属性（`deepEquals,` 这种），因为文本里根本没有 `Bun.deepEquals`。

`collectBunApis` 的判定条件是「`MemberExpression` 且其 object 是名为 `Bun` 的 `Identifier`」，注释点明这样能把 `foo.Bun.bar` 和字符串 `"Bun.spawn"` 排除在外。计算属性也认（`Bun["x"]`，取 `Literal` 的值）。

## 三件事，每个 API 都记

### 一、polyfill 定义了没有

`collectPolyfillApis` 只看两种赋值：`globalThis.Bun = { … }` 里的属性键，以及后续的 `Bun.foo = …`。注释写明这样简写和 getter 都能算进来。

### 二、调用点有没有守卫

这是全页最有用的一条区分：**没有守卫的缺口在原地就抛，有守卫的缺口只是悄悄关掉一个功能**。

守卫状态沿 AST 向下传播，三种情况置真：

```js
if (node.type === 'TryStatement' && key === 'block') g = true;
if (node.type === 'ChainExpression') g = true;               // ?. 
if (node.type === 'UnaryExpression' && node.operator === 'typeof') g = true;
```

聚合规则是「一处无守卫就算承重」：

```js
found.set(name, { guarded: prev ? prev.guarded && safe : safe, members: … });
```

注释举的对比：`Bun.ant` 只在这类守卫后面被碰到，而 `Bun.TOML.parse` 不是。

### 三、二级成员

命名空间被 polyfill 了，并不说明上面真正被调的那个方法也在。注释举的实例就是 `Bun.hash` 有、`Bun.hash.xxHash64` 没有——只有第二级名字才看得出来。

这一层不能只读源码，因为 `Bun.hash.xxHash64` 是用 `Object.assign` 挂上去的。`loadPolyfillGlobals` 把 shim 在一个伪造的全局里跑一遍再探形状：

```js
const sandbox = { globalThis: undefined, require: createRequire(import.meta.url), Buffer, process };
sandbox.globalThis = sandbox;
const fn = new Function('globalThis', 'require', 'Buffer', 'process', source);
fn(sandbox, sandbox.require, Buffer, process);
return sandbox.Bun ?? null;
```

失败（例如缺可选依赖）返回 `null`，此时二级检查整段跳过——不因为探测失败而误报。

## 压缩资产按魔数认，不按扩展名

```js
const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
export function isZstdFramed(buf) { … }
```

注释给的理由是：bundle 自己的加载器就是嗅魔数的，所以只有看字节才知道哪些文件需要 `Bun.zstdDecompress*`。提交正文给的数据是 2.1.251 有 101 个成帧资产，其中四个保留了原本的 `.js`/`.asset` 名。

实测 win32-x64 两个版本：

| 版本 | 成帧资产 | 名字带 `.zst` | 成帧但名字不带 `.zst` |
|---|---|---|---|
| 2.1.251 | 104（根上 100 + `vendor/assets/` 4） | 100 | `chart.umd.min.js`、`hljsBundle.generated.min.js`、`mermaid.min.js`、`payload.template.html.asset` |
| 2.1.263 | 110（全在根上） | 106 | 同上四个 |

「四个保留原名」两个版本上都成立；总数与提交正文（darwin 101）有差，属平台差异。2.1.251 那四个之所以落在 `vendor/assets/` 而不是根上，是当时的布局，见 [01](01-esm-chunk-rewrites.md) 的 E2 第二版。

## 对账查出来的四个缺口

`6bbbd95` 按查出来的结果补了四项：

| 补的 API | 实现 | 为什么这么实现 |
|---|---|---|
| `Bun.zstdDecompress` / `zstdDecompressSync` | 转 `node:zlib` | 自 2.1.251 起内嵌文本成帧发布，技能提示词与 artifact 运行时都在这条路径上。Node 的 zstd 是回调式，Bun 的异步形态返回 promise，所以异步版包一层 |
| `Bun.connect` | 转 `net.connect`，与 `Bun.listen` 共用 `wrapSocket` | 沙箱放行某台主机时，代理用它拨上游并读 `socket.remoteAddress` 去拒绝被封网段——那处调用**没有守卫**，缺它就在中继途中抛 |
| `Bun.TOML.parse` | `smol-toml` | 结果会变成用户导入进来的 Codex 配置（`mcpServers`、hooks、权限模式）。近似解析器会静默损坏它，所以宁可在缺依赖时明确报错，也不返回半解析对象 |
| `Bun.hash.xxHash64` | `sha256` 取前 8 字节读成 BigInt | 调用方按固定宽度十六进制格式化（`.toString(16).padStart(16,"0")`），所以必须是 BigInt，不能是 `bunHash()` 的 32 位 Number。注释说明这里只要稳定：它是本地缓存键，没人拿它和真的 xxHash 比 |

`Bun.hash` 的挂法也随之改成 `Object.assign(function hash(…){…}, bunHash)`——注释写明 `Bun.hash` 既是可调用的、又是 `xxHash64` 的命名空间，裸包装函数会把后者丢掉。

`Bun.ant` **故意不实现**，正文给了三条理由：`getPeerUid`/`getPeerPid` 需要 `SO_PEERCRED`；它被编译进 Anthropic 自己那份 Bun 分支，不是以 NAPI 模块形式发出来的；而且每个调用点都已经能降级。这是「有守卫的缺口」这一分类的用途——它把「不修」变成一个可论证的决定，而不是遗漏。

同一提交里还有一条正文没提的修正，值得记下来，因为它是同类错误的反面：`Bun.semver.order` / `satisfies` 原先把 `require("semver")` 和调用一起裹在 `try/catch` 里。调用方会捕获 `order()` 并重抛成 `Invalid SemVer`，所以解析失败必须往外传；一把抓的 catch 把「被拒绝的版本号」变成了静默的 0（相等），并让 `satisfies()` 对它从未解析过的输入回答 true。改法是只在模块本身取不到时才回退——那是与「输入非法」不同的失败。

## Node 版本下限抬到 24

`6bbbd95` 同时把主包的 `engines.node` 改成 `>=24.0.0`，`build-main-package.mjs` 的注释给了两个理由：

- `using` / `await using`（显式资源管理）在 2.1.251 上有 67 处、分布在 20 个分块里，Node 20 在解析阶段就拒绝；
- `node:zlib` 的 zstd 落在 22.15。

24 同时覆盖两者。README 把同样两条写给用户。

实测 2.1.263 主包 `package.json`：`engines.node` 为 `>=24.0.0`，`dependencies` 里有 `smol-toml: ^1.8.0`。注意仓库自身的 `package.json` 仍写 `engines.node: >=20.0.0`，那是构建工具链的要求，与产物无关；`.github/workflows/test.yml` 用的是 Node 24。

## 这个脚本没有接进构建

`bun-api-coverage.mjs` 只导出函数：`scanBunApis`、`collectBunApis`、`collectPolyfillApis`、`collectCompressedAssets`、`isZstdFramed`、`formatCoverageReport`。它**没有 `isMain` 块**，仓库里也没有任何 `.mjs` / `.yml` 引用它——整仓库提到它的地方只有 `README.md` 一句和它自己的注释。同仓库其它五个脚本（`bun-sea-extract`、`check-new-versions`、`fetch-and-process`、`node-compat-patch`、`verify-node-compat`）都带 `isMain` 命令行入口。

所以它的定位是一次性审计工具，由作者手动调用，不是每次 release 都跑的闸门。README 那句「`scripts/bun-api-coverage.mjs` does the same for the polyfill」容易读成它已经在管线里，实际不是。这也意味着：下一次上游新增一个 `Bun.*`，仍然要有人想起来跑一次，构建本身不会提醒。

对比一下 [02](02-patch-site-registry.md) 里的落点扫描——那条是接进 `patchSplitEsm` 并且 required 落点消失就 `process.exit(1)` 的。两个工具动机相同（把「静默失配」变成可见信号），接入程度差一截。

## 常见误解

- 「对账脚本会让构建在缺 API 时失败。」不会。它没接进管线；即使接进去，它区分的是「有守卫」和「无守卫」，本身也不是硬闸。
- 「`Bun.TOML` 是 2.1.242 新增的调用。」正文说的是自 2.1.242 起它就缺着发出去了，冷路径掩盖了缺口。缺的是 polyfill 那一侧。
- 「`Bun.ant` 是漏的。」是明确不实现，三条理由写在提交正文里。
- 「压缩资产可以按 `.zst` 后缀筛。」不行。实测两个版本里都有四个成帧文件保留 `.js`/`.asset` 名，而 bundle 的加载器嗅的是魔数。
- 「Node 24 下限是为了 zstd。」zstd 只要 22.15。抬到 24 的直接原因是 `using` / `await using`。

## 依据

- `scripts/bun-api-coverage.mjs` 全文：文件头注释、`ZSTD_MAGIC` / `isZstdFramed`、`collectBunApis`（守卫传播与聚合规则）、`collectPolyfillApis`、`scanBunApis`、`loadPolyfillGlobals`、`collectCompressedAssets`、`formatCoverageReport`；无 `isMain` 块。
- `templates/bun-polyfill.js`：`zstdDecompress` / `zstdDecompressSync`、`tomlParse`、`bunHash.xxHash64`、`wrapSocket` / `attachSocketHandlers` / `bunConnect`、`hash: Object.assign(…)`、`semver.order` / `satisfies` 的新写法及其注释。
- `scripts/build-main-package.mjs`：`engines: { node: '>=24.0.0' }` 及其上方注释、`smol-toml` 依赖。
- `git show 6bbbd95`：三件事的表述、`Bun.TOML`/`Bun.connect` 自 2.1.242 起缺失、四个补齐项的动机、`Bun.ant` 不实现的三条理由、2.1.251 的 101 个成帧资产、67 处 `using`。
- `README.md` 的 P6 行与 `bun-api-coverage.mjs` 段。
- `Grep bun-api-coverage|scanBunApis|collectCompressedAssets`（排除 `node_modules`）：仅命中 `README.md` 与该脚本自身。
- 实测 `artifacts/2.1.251`、`artifacts/2.1.263` win32-x64：按 zstd 魔数统计的成帧资产数与「四个保留原名」的具体文件名；2.1.263 主包 `package.json` 的 `engines` 与 `dependencies`。

**未确认：** 本轮没有实跑 `scanBunApis`，所以「bundle 实际调了多少个 `Bun.*`、其中几个有守卫」这组数字没有自测值，只有提交正文的定性描述。`Bun.zstdDecompress`、`Bun.connect`、`Bun.TOML.parse`、`Bun.hash.xxHash64` 四项只核到源码存在，未在运行中触发对应功能路径验证。`Bun.ant` 的三条理由沿用提交正文，未独立核实 Anthropic 的 Bun 分支如何编译它。

## 相关页面

- [2.1.242 分水岭](00-split-esm-turning-point.md)
- [E1–E5：分块 ESM 的五类改写](01-esm-chunk-rewrites.md)
- [补丁落点登记表与扫描](02-patch-site-registry.md)
- [split 下的包布局与发布作业](05-split-package-layout-and-release.md)
- [BUN2JS/04：单文件时代的 P6 与 polyfill 清单](../BUN2JS/04-node-compat-patches.md)

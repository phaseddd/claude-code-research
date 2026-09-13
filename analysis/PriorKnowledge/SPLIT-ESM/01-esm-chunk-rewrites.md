---
title: E1–E5：分块 ESM 的五类改写
kind: mechanism
status: active
updated: 2026-09-13
applies_to: "CometixSpace/claude-code master@a14c5e5 的 scripts/esm-chunk-patch.mjs；官方 split-ESM 自 v2.1.242 起；实测对象为已发布的 @cometix/claude-code 2.1.242 / 246 / 250 / 251 / 259 / 261 / 263 win32-x64 安装树"
tags:
  - topic:claude-code
  - topic:bun-sea
  - topic:split-esm
  - form:mechanism
---

# E1–E5：分块 ESM 的五类改写

## 一句话结论

`scripts/esm-chunk-patch.mjs` 导出的 `patchSplitEsm` 把整棵抽出目录逐文件原地改写：E1 把 BunFS 虚拟路径的 import 指示符换成相对于引用方的相对路径，E2 对剩下的运行期路径做同样的事，E3 把 Bun 独有的 `import.meta.require` 换成一层 `createRequire` 包装（并在里面顺手处理文本加载器语义和 `require` 成环），E4 把 Bun polyfill 落成 `bun-polyfill.mjs` 并让入口第一条语句就 import 它，E5 把顶层的分块 `require` 提升成一条裸 `import`。Node 只要路径指向真实文件，这套 ESM 图本身就能跑——分块依赖的是 ESM 语义，不是 Bun 特有的模块行为。

## 执行顺序，以及为什么不能换

`patchSplitEsm` 的顺序不是风格问题，每一步都被上一步的产物挡住：

```
listJsFiles(extractDir)                  // 收集全部 .js
scanPatchSites(extractDir, files)        // ① 必须最先：后面的改写会擦掉它要找的标记串
for (const rel of files) {
  hoistTopLevelChunkRequires(before, prefix)   // ② 读的是 BunFS 指示符，且认的是 import.meta.require
  rewriteBunfsPaths(code, prefix)              // ③ E1 + E2
  patchImportMetaRequire(code)                 // ④ E3，会把 import.meta.require 改名
  astPatch(code, 'module') 或 P9 的 replaceAll // ⑤ P1–P10
}
写 bun-polyfill.mjs                      // ⑥ E4
给入口与 hooks-worker 插 import + shebang // ⑦
```

三处硬约束：

- ① 在最前。落点扫描靠 `.node"`、`_cc_bin`、`.min.js"` 这类标记串筛文件，而 E2 一改完，`/$bunfs/root/audio-capture.node` 就变成 `./audio-capture.node`——`.node"` 还在，但 P3 的判定条件（参数必须是 BunFS 路径）已经不成立。先扫再改，报告才有意义。
- ② 在 ③ 之前。`hoistTopLevelChunkRequires` 要从 `import.meta.require("/$bunfs/root/chunk-x.js")` 里读出目标名，前缀被剥掉之后就认不出来了。
- ② 在 ④ 之前。④ 会把 `import.meta.require` 整串替换成 `__ccRequire`，而 ② 的判定条件是「callee 的 object 是 `MetaProperty`」，改名后这个 AST 形状不存在了。

## E1：指示符按语法位置匹配，不按扩展名

```js
const SPECIFIER_RE = new RegExp(`(from|import)(\\s*\\(?\\s*)"(?:${ROOT_ALT})([^"]+)"`, 'g');
const LITERAL_RE   = new RegExp(`"(?:${ROOT_ALT})([^"]*)"`, 'g');
```

`ROOT_ALT` 来自 `bun-sea-extract.mjs` 导出的 `BUNFS_ROOTS`，即 `/$bunfs/root/` 与 `B:/~BUN/root/` 两个前缀转义后取或。

E1 只吃处在 `from"…"`、`import"…"`、`import("…")` 三种语法位置上的字面量——凡是模块图会去解析的，都从这里过。E2 随后把「上一遍没吃掉的」全部当成运行期路径。源码注释点明了这个设计的理由：按语法位置分类，在上游改分块命名规则时仍然正确，而按扩展名嗅探不行。分块叫 `chunk-*.js`、资产也可能叫 `*.js`（2.1.251 起有四个压缩资产保留了原本的 `.js`/`.asset` 名），扩展名区分不了「这是要 import 的模块」还是「这是要 `readFile` 的数据」；语法位置能。

前缀由 `prefixFor` 算：

```js
function prefixFor(relDir) {
  if (relDir === '.' || relDir === '') return './';
  const depth = relDir.split(sep).filter(Boolean).length;
  return '../'.repeat(depth);
}
```

这是「从引用方所在目录回到抽出根」的那段路径，而 BunFS 名字本来就是相对抽出根起的。两侧都能嵌套：引用方可能在 `src/plugins/**` 下，目标名剥掉 BunFS 根之后也保留自己的目录层级。实测 2.1.263 里 `src/plugins/functionHooks/hooks-worker/hooks-worker.js` 的指示符写成 `from"../../../../chunk-m8qyvwrt.js"`，深度 4 对得上。

## E2：运行期路径，以及它改过两次

E2 的现状很短——所有残留的 BunFS 字面量都换成 `prefix + target`：

```js
code = code.replace(LITERAL_RE, (_m, target) => {
  literals++;
  return JSON.stringify(`${prefix}${target}`);
});
```

但这条一行改写背后是两次返工，值得完整记下来，因为它解释了成品包为什么长成现在这样。

**第一版（`452353d`）：搬到自己造的 `vendor/` 下。** 那时 E2 分两路：`.node` 结尾的改成 `globalThis.__ccVendorNode(name)`，其余改成 `globalThis.__ccAsset(name)`，两个 helper 由 `bun-polyfill.mjs` 挂上；`build-platform-package.mjs` 则把原生模块拷到 `vendor/<模块>/<cpu>-<os>/`、把 `*.min.js`/`*.asset` 拷到 `vendor/assets/`，并在拷模块树时把这些名字放进 `skip`。这是从单文件时代 P3 / P10 那套布局直接搬过来的。

**第二版（`07d65a4`，2026-09-10）：不搬了。** 提交正文的理由是：上游本来就把原生模块和资产平铺在分块旁边，而代码也正是在那里找它们——

```js
ve("/$bunfs/root/audio-capture.node")
JJ("/$bunfs/root/mermaid.min.js", import.meta.dirname)
```

资产加载器自己做的是 `isAbsolute(t) ? t : join(dir, t)`，所以一个裸名字就能落在入口旁边；`require()` 只需要显式的 `./`。改写字面量本身就够了，不需要 helper、不需要额外目录、不需要拷贝。同时 `<cpu>-<os>` 这一层也被删掉了——它是更早的单包布局的遗留，而现在每个平台包只装自己那份原生模块，`process.arch + "-" + process.platform` 不可能解析到别的东西。

**第三版（`0f672d5`，同日）：裸名字改成带前缀。** 第二版把资产写成裸名字，前提是 `import.meta.dirname` 等于包根。但它其实是「持有这处引用的那个文件」所在目录，只在所有分块都躺在根上时才与包根相等，而上游从没承诺过这一点。提交正文举的例子很直白：

```
join("/pkg/chunks", "mermaid.min.js")     → /pkg/chunks/mermaid.min.js
join("/pkg/chunks", "../mermaid.min.js")  → /pkg/mermaid.min.js
```

所以前缀要挂在每个目标上，不只挂在 `require()` 会解析的那些上。在根上这什么都不改（`join(root, "./x")` 与 `join(root, "x")` 是同一条路径），嵌套时它是唯一正确答案。

第一版留下的后果可以从已发布包里直接看到：2.1.242、2.1.259、2.1.260 的 win32-x64 主包里，`chart.umd.min.js`、`hljsBundle.generated.min.js`、`mermaid.min.js`、`payload.template.html.asset` 四份文件只存在于 `vendor/assets/`，而代码里写的是 `globalThis.__ccAsset("mermaid.min.js")`，helper 的定义是 `(name) => name ? __ccJoin(__dirname, name) : __dirname`——`__dirname` 是 `bun-polyfill.mjs` 自己所在目录，也就是包根。路径指向包根，文件却在 `vendor/assets/`，两边对不上。`07d65a4` 从结构上消掉了这个错位（不再搬动，所以不可能错位），但它的提交正文只把这次改动讲成简化，没有提到这四份资产在此前的版本里根本对不上号。首个平铺的已发布版本是 2.1.261，见 [06](06-version-timeline-evidence.md)。

## E3：`import.meta.require` 的三层职责

Bun 有 `import.meta.require`，Node 没有。2.1.242 把它收进一个运行期分块再 re-export，所以一处改写就能覆盖全部消费者。`patchImportMetaRequire` 做两件事：在第一条语句之前插入 `REQUIRE_SHIM`，然后 `replaceAll('import.meta.require', '__ccRequire')`。

`REQUIRE_SHIM` 的最外层是这样：

```js
const __ccRequire = Object.assign((id) => {
  if (/\.(?:md|txt)$/.test(id)) return __ccReadText(__ccRawRequire.resolve(id), "utf8");
  try { return __ccRawRequire(id) }
  catch (e) { if (__ccCyclic(e)) return __ccLazyNs(id); throw e }
}, __ccRawRequire);
```

`Object.assign(…, __ccRawRequire)` 把 `require.resolve` / `require.cache` 带到包装函数上。三层职责分别是：

### 一、文本加载器语义（`bfd7b4e`，官方 2.1.246 起）

2.1.246 把内建技能改成 164 个松散文件（118 个提示词 `.md`、46 个脚本/模板 `.txt`），并用原生模块那套 `require` 别名在分块顶层拉进来：

```js
var a = e("/$bunfs/root/anti-patterns-c1rmzbdk.md");
```

Bun 的 `require` 对这些扩展名返回文件内容。Node 会把它们当 JS 编译并抛 `Invalid or unexpected token`；又因为调用处在模块作用域上，整个分块加载失败。所以 `.md`/`.txt` 单独走 `readFileSync`。

这里的 `__ccRawRequire.resolve(id)` 是后来补的（`3bf95d4`）。E2 改写出的是相对路径，而 `readFileSync` 按 `process.cwd()` 解析——包目录里启动碰不到，从项目目录启动就 ENOENT。先过 `require.resolve` 相当于按「引用它的那个模块」解析，顺带还挡掉一件更难发现的事：用户工作目录下有同名文件时，原先会静默读到用户的文件，而不是报错。

### 二、`require` 成环（`a6b2c5f`，官方 2.1.250 起）

2.1.250 起分块之间开始用 `require` 互相加载——2.1.246 只用动态 `import()` 的地方，这一版有 358 处。静态 import 图仍然无环，但同步 `require` 是第二种边，代码分割器并不保证它无环，其中 8 处绕回 import 图形成闭环。Bun 会重新进入求值并交回一个半初始化的命名空间；Node 拒绝这么做（那会破坏规范要求的不变量），直接抛 `ERR_REQUIRE_CYCLE_MODULE`，把整个分块带下去——提交正文点名 `chunk-j5h9ds58` 一个文件就占 7 处、导出 2506 个名字。

当时的处理是：环还活着就报 `undefined`，环闭合之后再真正解析。理由是那 8 处读的都是工具名常量，消费者一律写成 `x ? [x] : []`，本来就容忍值还没到位。

### 三、把 `undefined` 换成惰性替身（`935036b`，官方 2.1.259）

2.1.259 发出去就是坏的：启动报 `Claude Code could not start: Cannot read properties of undefined (reading 'name')`。九个版本之后，同一个机制逮到的是整个工具对象，而这里没人做守卫：

```js
K1n = import.meta.require("…/chunk-cepj3hyp.js").ArtifactTool
let kt = Zk();                            // [ArtifactTool, …]
new Set([...kt.map((ft) => ft.name), …])  // undefined.name
```

提交正文对上一次判断的复盘写得很直接：那是把一个特例当成了通例。现在是两层：

- **`__ccLazyNs(id)`**：命名空间的 Proxy。取属性时先 `__ccPeek(id, p)` 真解析一次，成功就直接给真值——所以环一闭合，后续访问全部走正常路径，原始值（字符串、数字）也照样读得通。取不到时，非字符串键和 `then` 返回 `undefined`（不让 `await` 把它误认成 thenable），其余交给下一层。
- **`__ccLazyVal(id, p)`**：单个导出的替身。Proxy 的 target 是 `function(){}`，因为导出里有可调用对象，而箭头函数没有不可配置的自有属性，不会踩 Proxy 不变量；`get` / `apply` / `construct` / `has` / `ownKeys` / `getOwnPropertyDescriptor` / `getPrototypeOf` 都转发到首次被碰时解析出的真值，`getOwnPropertyDescriptor` 还把 `configurable` 强制为真。替身按 `(模块, 属性)` 缓存在 `globalThis.__ccLazyVals` 里（键是 `id + "\0" + p`），所以反复取到的是同一个对象，`===` 成立。

为什么不直接用 Proxy 顶替：这些值有字符串，而 Proxy 当不了原始值（`String(proxy)` 会抛）。2.1.250 那条提交里已经写过同一句话，用来解释当时为什么选 `undefined`。

## E4：polyfill 落成 ESM 模块

`templates/bun-polyfill.js` 是按 CJS 写的（用 `require`、`__dirname`）。与其为分块布局再叉一份，`buildPolyfillModule` 给它套一层前言补上这些名字，两条管线继续共用同一份 shim：

```js
const ESM_PRELUDE = [
  'import{createRequire as __ccCreateRequire}from"module";',
  'import{fileURLToPath as __ccFileURLToPath}from"url";',
  'import{dirname as __ccPathDirname}from"path";',
  'const require=__ccCreateRequire(import.meta.url);',
  'const __filename=__ccFileURLToPath(import.meta.url);',
  'const __dirname=__ccPathDirname(__filename);',
].join('\n');
```

尾部再挂两个全局，供 `astPatch` 的 module 模式使用：

```js
globalThis.__ccNodeRequire = require;
globalThis.__ccDirname = () => __dirname;
```

产物写成 `bun-polyfill.mjs`，放在抽出根上。随后给入口以及每个 `*hooks-worker.js` 在第一条语句之前插入 `import"<prefix>bun-polyfill.mjs";`——worker 入口开的是自己的模块图，同样需要在任何分块正文跑起来之前拿到 `globalThis.Bun`。只有入口会补 `#!/usr/bin/env node`。

实测 2.1.263：`cli.js` 第一条语句是 `import"./bun-polyfill.mjs"`，`src/plugins/functionHooks/hooks-worker/hooks-worker.js` 是 `import"../../../../bun-polyfill.mjs"`，且后者没有 shebang。`__ccAsset` / `__ccVendorNode` 在这一版已不存在，`bun-polyfill.mjs` 里只剩 `__ccNodeRequire` 与 `__ccDirname` 两个 `__cc` 前缀全局。

## E5：把顶层 require 提升成 import

惰性替身是兜底，`hoistTopLevelChunkRequires` 是预防。一处 `require()` 之所以撞上活着的环，是因为目标还没求值完；那就在模块正文之前补一条裸 `import "./chunk-x.js"`，逼 ESM 先把目标求值掉，原来那处 `require` 就变成一次缓存命中。

判定条件：`CallExpression`，callee 是 `MemberExpression` 且其 object 为 `MetaProperty`、property 名为 `require`，单参数且为字符串字面量，剥掉 BunFS 根之后以 `.js` 结尾，并且——不在任何函数体内。函数体里的 `require` 在启动之后才跑，那时 `require(esm)` 本来就能用。命中的目标去重进 `Set`，拼成一串 `import"…";` 插在 `ast.body[0].start` 处。

`935036b` 给出的数字：2.1.259 有 149 处这样的落点、分布在 22 个分块里，其中 64 处集中在构建工具注册表的那一个；提升清掉 130 处，剩下 8 处是求值顺序破不掉的双向环，交给惰性替身。

这一步先用 acorn 按 module 解析；解析失败就原样返回、不提升（`catch { return { code, hoisted: 0 } }`），也不报错。

## P1–P10 在 module 模式下怎么复用

`astPatch(code, sourceType)` 的补丁正文两种布局完全一样，只有它注入的两个 CJS 专属名字要换——ESM 模块里这两个名字都不存在：

```js
function esmNames(sourceType) {
  return sourceType === 'module'
    ? { REQ: 'globalThis.__ccNodeRequire', DIR: 'globalThis.__ccDirname()' }
    : { REQ: 'require', DIR: '__dirname' };
}
```

`452353d` 同时改了两处判定条件，让它们能在压缩后的分块上成立：

- **P3 改成认参数，不认 callee 名。** 单文件布局里 callee 字面就是 `require`，但 2.1.242 把 Bun 的 `import.meta.require` 收进一个运行期分块，161 个分块用各自压缩后的别名（`R`、`t`、`A`…）re-import 它。稳定的信号是那个以 BunFS 根开头、以 `.node` 结尾的字面量。源码里的写法是：`sourceType !== 'module'` 时才额外要求 callee 名为 `require`。
- **P1 多出一条 `p1Dirnames`。** 2.1.242 起打包器不再把构建机路径包在 `fileURLToPath()` 里，内嵌的 CJS 依赖（grpc-js）直接声明一个裸 `__dirname` 存着构建机路径，再拿它去解析真实文件（`includeDirs: [\`${__dirname}/../../proto\`]`）。补丁把初始值换成 `DIR`。提交正文提到这条顺带补上了 2.1.241 上漏掉的 2 处。

还有一处与单文件管线不同的收紧：补丁后的 acorn 复核在分块管线里是硬失败。

```js
try { acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module' }); }
catch (e) { throw new Error(`post-patch AST validation failed for ${rel}: ${e.message}`); }
```

单文件管线里同一次复核只 `console.error` 一句、产物照样写出（见 [BUN2JS/04](../BUN2JS/04-node-compat-patches.md)）。注释给的理由是：让坏改写在构建时炸，而不是在用户会话里炸。

P9 不走 AST。带标记串的文件由 `astPatch` 内部的 `replaceAll` 顺手改掉；不带标记串但提到包名的文件走 `patchSplitEsm` 里的 `else if (code.includes(REBRAND_FROM))` 分支单独替换——否则那些分块会漏掉。

## 统计口径与 leftover

`patchSplitEsm` 返回的统计里有几个容易读错的字段：

| 字段 | 口径 |
|---|---|
| `specifiers` / `literals` | 全树累计的改写**次数**（E1 / E2 各自） |
| `metaRequire` | 插入了 E3 shim 的**文件数** |
| `hoisted` | 全树累计的提升目标数（每文件去重后再求和） |
| `ast.<补丁名>` | 该补丁命中的**文件数**，不是次数——注释说明这是为了和单文件管线的次数口径「可比」 |
| `leftover` | 改写之后整棵树里仍能匹配到 BunFS 根前缀的次数 |
| `sites` | 落点扫描结果，来自 ①，与本次改写无关，见 [02](02-patch-site-registry.md) |

`leftover` 应当为 0。实测 2.1.263 win32-x64 成品：`/$bunfs/root/` 与 `B:/~BUN/root/` 各 0 次。另有两个分块里出现 `$bunfs` 与 `~BUN` 字样，但那是官方自己的判定代码——`function Wv(t){return t.includes("$bunfs")||t.includes("~BUN")||…}` 和一条 `/^(?:\/(?:\$bunfs|~BUN)|\/?[A-Za-z]:[\\/](?:\$bunfs|~BUN))[\\/]/` 正则，都不带 `root/`，也不是要改写的路径字面量。把它们当成漏改是误判。

## 实测落点（2.1.263 win32-x64）

| 观察项 | 实测 |
|---|---|
| `chunk-*.js` 个数 | 1627 |
| 带 E3 shim（`__ccMakeRequire`）的文件数 | 59 |
| 其中带文本分支（`__ccReadText`）/ 环处理（`__ccLazyNs`）/ 替身（`__ccLazyVal`）/ `require.resolve`（`3bf95d4`） | 各 59 |
| P7（`globalThis.__HttpsProxyAgent`） | 1 个分块 |
| P8（`_cc_bin` 注入） | 1 个分块，同一文件里也有 `globalThis.__ccNodeRequire` |
| P1 的 `__dirname=globalThis.__ccDirname()` | 2 个分块、共 3 处 |
| P5（`__dpBinOk`） | 0——win32 构建本就无事可做，见 [02](02-patch-site-registry.md) |
| 残留 `claude-cli-internal` | 0 |
| 残留 `@anthropic-ai/claude-code` | 0（P9 已全改） |

## 常见误解

- 「E1 和 E2 是两条正则在抢同一批字面量。」不是。E1 先把语法位置上的吃掉，E2 才处理剩下的；顺序即分类依据，`LITERAL_RE` 本身并不区分种类。
- 「E2 把资产搬到了 `vendor/assets`。」这是 2.1.242–2.1.260 的历史状态，且那几版路径与文件位置对不上。现行做法是不搬动、只改路径。
- 「惰性替身能顶替任何导出。」不能。原始值直接读通，Proxy 当不了原始值。替身只服务于对象和函数型导出。
- 「提升会处理所有 `require`。」只处理顶层且目标以 `.js` 结尾的那些。函数体内的一律不动。
- 「补丁后的 AST 复核在两条管线里一样。」不一样。分块管线抛异常中止，单文件管线只打印一行。

## 依据

- `scripts/esm-chunk-patch.mjs` 全文：`SPECIFIER_RE` / `LITERAL_RE` / `prefixFor` / `rewriteBunfsPaths` / `REQUIRE_SHIM` / `patchImportMetaRequire` / `hoistTopLevelChunkRequires` / `buildPolyfillModule` / `patchSplitEsm`，以及各段上方的设计注释。
- `scripts/node-compat-patch.mjs`：`esmNames`、`MATCHERS.p3` 的 `sourceType` 分支、`MATCHERS.p1Dirnames`、`bunfsTarget`。
- `scripts/bun-sea-extract.mjs`：`BUNFS_ROOTS` 的导出与注释。
- `git show 452353d`：E2 第一版的 `__ccVendorNode` / `__ccAsset` 形态，以及 P3 改判据、P1 增 `p1Dirnames` 的动机。
- `git show 07d65a4` / `0f672d5` / `bfd7b4e` / `a6b2c5f` / `935036b` / `3bf95d4`：各次返工的正文与数字。
- 实测 `artifacts/2.1.242`、`2.1.259`、`2.1.260`、`2.1.261`、`2.1.263` 的 win32-x64 安装树：`__ccAsset` / `__ccVendorNode` 的调用形态与 helper 定义、`vendor/assets` 与包根的文件分布、`bun-polyfill.mjs` 的 import 前缀、上表各项计数。

**未确认：** 只实测了 win32-x64 一条平台线；darwin 上五个原生模块、P5 会真正命中，本轮没有对应安装树可比。E2 第一版的资产错位是从「文件位置 + helper 定义」推出的，没有在那几版上实跑 artifact/design-canvas 相关功能去看它以什么方式失败。`935036b` 给的 149 / 130 / 8 三个数字沿用提交正文，未自行复算。`hoistTopLevelChunkRequires` 在成品里插入的裸 import 与 E1 改写出的裸 import 形态相同，无法在成品中区分，因此没有实测提升次数。

## 相关页面

- [2.1.242 分水岭](00-split-esm-turning-point.md)
- [补丁落点登记表与扫描](02-patch-site-registry.md)
- [抽出进独立进程，与文本编码的坑](03-extraction-worker-and-encoding.md)
- [split 下的包布局与发布作业](05-split-package-layout-and-release.md)
- [BUN2JS/04：单文件时代的 P1–P10](../BUN2JS/04-node-compat-patches.md)
- [acorn 与 JavaScript AST 解析工具](../acorn/acorn-and-js-ast-parsers.md)

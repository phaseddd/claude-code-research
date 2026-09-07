# analysis 术语表（公开知识库）

> 受控词 + 解释。目的：避免同一个东西出现两种叫法（同义词漂移）。新词先加这里，再在页面里用。

## 标签（受控前缀）

### `topic:`（主题）

- `topic:ast` —— 抽象语法树（AST）及其解析工具这一主题域。
- `topic:acorn` —— acorn 这个 JavaScript 解析器及其生态。
- `topic:claude-code` —— Claude Code（Anthropic 官方 CLI）本体及其分发 / 逆向 / 补丁这一主题域。
- `topic:slash-command` —— Claude Code 斜杠命令（`/…`）子系统：命令对象、分发与 builtin/prompt/local 等形态。
- `topic:insights` —— Claude Code `/insights` 使用报告能力（会话扫描、usage-data、内嵌提示词与 HTML 报告）。
- `topic:bun-sea` —— Bun SEA（Single Executable Application）单文件可执行分发形态与其内嵌模块提取这一主题域。
- `topic:npm` —— npm 包的分发 / 分包 / 安装机制这一主题域。
- `topic:deepseek` —— DeepSeek（模型 / API / Anthropic 兼容端点）这一主题域。

### `form:`（形态）

- `form:concept` —— 解释「是什么」的概念页。
- `form:mechanism` —— 讲清一个流程 / 系统怎么运作的机制页。
- `form:case` —— 分析一个具体项目 / 对象的案例页。
- `form:decision` —— 记录本项目为什么这么选的决策页。
- `form:investigation` —— 调查 / 验证过程记录页。

## 核心术语（避免漂移）

- **AST（抽象语法树 / Abstract Syntax Tree）** —— 源码逻辑结构的树形表示，剥掉标点/括号等语法噪声。别和 CST 混用。
- **CST（具体语法树 / parse tree / Concrete Syntax Tree）** —— 保留全部语法细节的树；AST 是它「去噪」后的抽象版。
- **ESTree** —— JS AST 的社区事实标准格式，acorn / espree / esprima 等解析器「遵循」它输出。统一叫 ESTree，不叫「SpiderMonkey 格式」（那只是它的前身）。
- **Pratt 解析 / 运算符优先级解析** —— 把语义动作绑定到 token、用「绑定力」处理优先级的解析法；是递归下降的增强而非替代。acorn 表达式层用它。
- **Bun SEA** —— Bun 把 Claude Code 的 JavaScript 和 native 模块打进单个原生可执行文件的分发形态。官方从 v2.1.113 起用这种二进制代替原来可被 Node 直接跑的 JS 包；内嵌数据在 Mach-O 的 `__BUN/__bun` 或 PE/ELF 的 `.bun` 节里。
- **SEA（Single Executable Application / 单文件可执行）** —— 「把运行时 + 代码打进一个可执行文件」的统称。本库语境默认指 **Bun SEA**；注意与 Node.js 官方的 SEA 特性区分，别混。
- **cli.js** —— Claude Code 打包后的主程序 JavaScript（十几 MB 的单文件 bundle），是 Bun SEA 提取和 acorn 补丁的核心目标文件。
- **CDN 清单（manifest.json）** —— 某版本在 `https://downloads.claude.ai/claude-code-releases/{version}/manifest.json` 上的索引。`scripts/fetch-and-process.mjs` 用 `fetchJson` 读它的 `buildDate`，并用 `platforms[平台名].binary` 拼出真正要下载的文件名。
- **FIRST_SEA_VERSION** —— `scripts/check-new-versions.mjs` 里写死的 `2.1.113`。自动检测时，低于这个版本的官方 npm 包不会进入后续的 CDN 下载和提取。`.github/workflows/release.yml` 若手动填了 `version`，会跳过这一关，直接把该版本交给 `fetch-and-process.mjs`。
- **optionalDependencies** —— npm 的按需依赖字段：安装时只拉当前系统对得上的包。官方用它挂 `@anthropic-ai/claude-code-linux-x64` 这类平台包，`check-new-versions.mjs` 看到这个名字才认定该版本是 SEA 交付。Cometix 主包也用同一栏挂九个 `@cometix/claude-code-<平台>` 包。
- **平台键** —— `scripts/fetch-and-process.mjs` 常量 `SEA_PLATFORMS` 里那八个字符串，同时是 CDN 路径的一层目录名和 `manifest.platforms` 的键。缺键就 skip，不会改用别的名字去猜文件。
- **extractDir** —— `scripts/fetch-and-process.mjs` 把某个平台抽出的模块写到 `outputDir/.tmp/extract/<平台名>/` 这个目录。后续找 `cli.js` 和 `.node`，以及 `build-platform-package.mjs` 扫 assets，都相对这个目录。
- **BunFS** —— 模块表里给内嵌文件起的虚拟路径。POSIX 上前缀是 `/$bunfs/`，PE 上是 `B:/~BUN/`。`fetchAndProcess` 写盘前只在 `startsWith` 成立时把它剥掉，若接着以 `root/` 开头再剥这五字符，剩下的才是 extractDir 里的相对路径。
- **dual-runtime** —— 在 `scripts/verify-node-compat.mjs` 里，指抽出来的 `cli.js` 全文中 `typeof Bun` 出现次数达到十五次及以上。脚本据此把这份文件标成仍自带有 Bun 走 Bun、没有 Bun 走 Node 的分支。
- **bun-only** —— 在 `scripts/verify-node-compat.mjs` 里，指 `typeof Bun` 至少出现一次但不到十五次。独立运行该脚本时会打印将注入 polyfill；真正注入与否由 `patchFile` 用十次阈值另判，并不读这个 mode。
- **compatible** —— `verifyNodeCompat` 的返回字段，定义就是 fatal 等于零，与 dual-runtime 还是 bun-only 无关。`scripts/fetch-and-process.mjs` 只根据它决定是否继续调用 `patchFile`。
- **P6** —— `patchFile` 在 AST 补丁之后若 `typeof Bun` 少于十次，就把 `templates/bun-polyfill.js` 插进 `cli.js` 版权注释后面，给 Node 补上 `Bun.*`；不少于十次则跳过并打印 dual-runtime fallbacks present。
- **postinstall（Cometix 主包）** —— npm 装完 `@cometix/claude-code` 后自动执行 `node install.cjs`。该脚本按本机平台 resolve 到对应的 `@cometix/claude-code-<平台>`，把那里的 `cli.js` 和 `vendor` 拷进主包目录，并给 node-pty 的 spawn-helper 补可执行位。
- **Bun CJS 外壳** —— 官方打进二进制的 CommonJS 外壳：闸门认文件以 `// @bun` 开头且正文含有 `(function(exports, require, module, __filename, __dirname)`；`stripBunWrapper` 稍后才按 `// @bun @bytecode @bun-cjs` 或 CJS 开括号把它剥掉。Bun 加载器会调用这层函数，Node 直接求值则函数体不执行。
- **占位 cli.js** —— `templates/cli-placeholder.js` 在 postinstall 成功拷贝之前充当主包 `bin.claude` 的目标文件。它只说明平台包没装上或脚本被 `--ignore-scripts` 跳过，然后以状态码 1 退出。
- **android-arm64 别名** —— 官方 SEA 没有 android 二进制。`scripts/fetch-and-process.mjs` 的 `PLATFORM_ALIAS` 让名为 `android-arm64` 的包复用 `linux-arm64` 的抽出和补丁产物，但 `package.json` 的 `os` 写成 android，好让 Android 上的 npm 愿意安装。
- **musl** —— `SEA_PLATFORMS` 里的 `linux-arm64-musl` 与 `linux-x64-musl` 两个键。`scripts/fetch-and-process.mjs` 把它们和另外六个键同样处理：清单里有对应条目就按 `binary` 字段各下一份，缺键就 skip。`build-platform-package.mjs` 对三段式平台键让 `vendorDir` 返回 null 从而不拷 NAPI 的 `.node`；`install.cjs` 用进程报告里有没有 `glibcVersionRuntime` 来选择 `linux-*-musl` 包。
- **slash command（斜杠命令）** —— 用户以 `/` 开头触发的 CLI 内建或扩展命令；本库写「斜杠命令」，标签用 `topic:slash-command`。
- **/insights** —— Claude Code builtin 斜杠命令：本机扫历史会话与缓存，经内部模型调用生成 usage 报告 HTML；细节见 mechanisms / concepts 下 insights 相关页。
- **usage-data** —— Claude 配置根下存放 `/insights` 产物与缓存的目录名（含 `session-meta/`、`facets/`、`report*.html`）。
- **transcript（会话日志）** —— `projects/` 下单次会话的原始消息流水（常为 JSONL）；`/insights` 统计与语义分析的源数据。
- **mtime（modification time）** —— 文件最后修改时间。`/insights` 语境下多指 transcript 的 mtime：枚举会话排序，并判断 session-meta 是否过期。
- **session-meta（meta）** —— `/insights` 从 transcript **算出**的可复算统计缓存（时长、工具次数等），不调模型，目录 `usage-data/session-meta/`；transcript mtime 变了则刷新。
- **facet（会话 facet）** —— `/insights` 对单会话 LLM 抽取的结构化语义标签（目标、满意度、摩擦等），缓存于 `usage-data/facets/`。

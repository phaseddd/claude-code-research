# Claude Code Research

这是一个仅供个人使用的 Claude Code 研究仓库。

我用它整理 Claude Code 发布产物、运行链路、`cli.js` 补丁实验，以及
`@cometix/claude-code` npm 安装结果的本地复现材料。这个仓库不是 Claude
Code 的替代发行版，也不面向通用用户提供支持。

## Thanks

特别感谢 [CometixSpace/claude-code](https://github.com/CometixSpace/claude-code)。

本仓库会把它作为 `CometixSpace-claude-code` 引用，是因为我的研究
不只需要阅读 npm 发布后的产物，也需要对照一个可追溯的源码/补丁/重组路线。
这里选择引用上游项目，而不是 fork，是因为本仓库的重点是个人研究记录、补丁
实验和产物复现，不是维护 CometixSpace 项目的替代分支。

## Layout

- `docs/`: 准备公开的研究文档。
- `patches/`: 准备公开的 `cli.js` 补丁脚本或补丁说明。
- `scripts/`: 可复用的本地研究脚本。
- `artifacts/`: 由脚本生成的 npm 安装产物目录，目录保留，具体产物默认不进 Git。
- `CometixSpace-claude-code/`: 指向 CometixSpace 项目的 Git submodule。

私密文档和私密补丁脚本放在 `private/` 下，并由 `.gitignore` 排除。等内容适合公开
时，再复制到 `docs/` 或 `patches/`。

## Upstream Tracking

Git submodule 在 Git 机制上一定会记录一个具体 commit。本仓库通过 GitHub Actions
定时把 `CometixSpace-claude-code` 推进到上游 `origin/master` 的最新
提交，并自动提交新的 submodule 指针。

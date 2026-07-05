# Claude Code Research

This repository is my personal research workspace for Claude Code.

The purpose is to understand Claude Code as a real shipped product: its release
artifacts, runtime entry points, CLI behavior, npm installation shape, and the
patch surface around `cli.js`. It is not an unofficial distribution, not a
replacement client, and not a support project for general users.

## Upstream Baseline

This project uses [CometixSpace/claude-code](https://github.com/CometixSpace/claude-code)
as the upstream baseline.

I am grateful to the author of that project. Their work provides a practical
route for studying Claude Code from the published package instead of treating
the release artifact as an opaque black box. For this repository, that matters:
my research needs a traceable source-level baseline that can be compared with
npm-installed artifacts and local patch experiments.

The upstream project is kept here as a Git submodule, not as a fork, because the
focus is different. This repository is for my own Claude Code research notes,
reproducible experiments, and patch investigations. The submodule keeps the
upstream work visible, credited, and mechanically traceable as the baseline.

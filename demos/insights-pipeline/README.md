# insights-pipeline

交互演示：Claude Code `/insights` 从输入命令到写出 HTML 报告的流水线（报告引擎步骤、双模型角色、缓存与主会话交接）。

> 状态：目录已建，实现待补。下面「怎么跑」在有可运行入口后再填实。

## 关联知识页

- [Claude Code /insights 命令全程解析](../../analysis/mechanisms/claude-code-insights-slash-command.md)（mechanism：端到端链路）
- [Claude Code /insights 内嵌提示词](../../analysis/concepts/claude-code-insights-prompts.md)（concept：内部提示词与拼装）

## 怎么跑

```bash
npm install
npm run dev     # 打开 http://localhost:5173/
```

体验流程：黑场 → 标题浮现 → 按住按钮（模拟运行 /insights）→ 进入引擎。

> 需要支持 WebGL2 的浏览器；不支持时自动降级为静态科普页（序章全文 + 知识页链接）。

## 当前进度

- [x] M0 脚手架 + 序章（黑场排版 + 按住运行按钮 + 占位场景）
- [ ] M1 时间轴内核（scrollVh + gate 自动过渡 + skipTo）
- [ ] M2 TAP HOLD + HUD 轨道
- [ ] M3 光河 + 第一幕（S1~S3）
- [ ] M4 第二幕重场戏（S4/S5）
- [ ] M5 第三幕（S6~S8）
- [ ] M6 尾声 + 打磨
- [ ] M7 收尾

设计蓝图见 [PLAN.md](PLAN.md)。

## 技术栈

Vite · 原生 Three.js（WebGL2）· GSAP · 无框架

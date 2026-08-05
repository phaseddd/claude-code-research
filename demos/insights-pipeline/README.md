# insights-pipeline

交互演示：Claude Code `/insights` 从输入命令到写出 HTML 报告的流水线（报告引擎步骤、双模型角色、缓存与主会话交接）。

> 状态：M2 完成。序章按住进入引擎，三幕骨架 + gate 自动过渡 + 底部 HUD 轨道（8 节点可点击跳幕、站标题与计数数字随推进滚动更新）；M3 起接入光河与真实站场景。

## 关联知识页

- [Claude Code /insights 命令全程解析](../../analysis/mechanisms/claude-code-insights-slash-command.md)（mechanism：端到端链路）
- [Claude Code /insights 内嵌提示词](../../analysis/concepts/claude-code-insights-prompts.md)（concept：内部提示词与拼装）

## 怎么跑

```bash
npm install
npm run dev     # 打开 http://localhost:5173/
```

体验流程：黑场 → 标题浮现 → 按住按钮（模拟运行 /insights）→ 进入引擎三幕骨架。
引擎内滚动完全由 JS 接管（虚拟滚动）：滚轮 / 触屏 / 方向键（PageDown/Space 大步）探索
第一幕 → gate 自动过渡（黑场转场，无需滚动）→ 第二幕 → gate → 第三幕；第一幕右上角
"回到序章"可返回重看。底部 HUD 轨道显示八站进度：节点点击直接跳到对应幕，站标题与
计数数字随推进滚动更新（幕色微染：冷蓝 → 青紫 → 琥珀）。

> 需要支持 WebGL2 的浏览器；不支持时自动降级为静态科普页（序章全文 + 知识页链接）。
> `prefers-reduced-motion` 下：滚动即时跟随、星云静止、入场直接呈现（gate 黑场过渡仍按 3.5s 缓动推进，M6 打磨）。

## 当前进度

- [x] M0 脚手架 + 序章（黑场排版 + 按住运行按钮 + 占位场景）
- [x] M1 时间轴内核（MasterTimeline：scrollVh 预算 + segment 生命周期 + gate 自动过渡 + skipTo）
- [x] M2 TAP HOLD + HUD 轨道
- [ ] M3 光河 + 第一幕（S1~S3）
- [ ] M4 第二幕重场戏（S4/S5）
- [ ] M5 第三幕（S6~S8）
- [ ] M6 尾声 + 打磨
- [ ] M7 收尾

设计蓝图见 [PLAN.md](PLAN.md)。

## 技术栈

Vite · 原生 Three.js（WebGL2）· GSAP · 无框架

## 时间轴内核（M1）

- `src/scroll.js`：虚拟滚动输入层 —— wheel（×35 力度）/ 触屏 / 键盘 → targetVh；rAF lerp 平滑（帧率无关），内部单位 vh 与段预算同标尺
- `src/timeline.js`：MasterTimeline —— 段自包含生命周期 `enter(ctx) / scrub(ctx, p) / update(ctx, t, dt) / teardown(ctx)`；target 驱动段切换、current 驱动段内 scrub（滚到底即时切换、视觉连续）；gate 自动过渡段（autoScroll + duration 缓动推进）；`skipTo` 任意跳转；ctx 原语 `fadeScene / teardownOld / preEnterNext / advance`
- `src/scenes/act-skeleton.js`：三幕骨架共用工厂（幕色星云 + 光河起点 + 幕标题），M3 起逐幕替换为真实站场景

# insights-pipeline

交互演示：Claude Code `/insights` 从输入命令到写出 HTML 报告的流水线（报告引擎步骤、双模型角色、缓存与主会话交接）。

> 状态：M0~M3 **实现落地**，演出化验收待推进。序章 3 秒版（三段声部布局 + WebGL 月球 + 按住进入 + 揭示三连拍交接）→ 第一幕三站实景：共享一条连续光河（终端命中 → 星云扫盘 → 缓存分流）+ 幕内轻量 gate（河全程全亮、相机贴河滑行）+ HUD 轨道。**S1~S3 代码就位但未按序章标准验收**（序章重构后未重新走 grok-vision + 逐轮打磨，动效与文案仍可能大改）；第二/三幕仍为骨架占位（m4 重场戏规格推进中）。

## 关联知识页

- [Claude Code /insights 命令全程解析](../../analysis/mechanisms/claude-code-insights-slash-command.md)（mechanism：端到端链路）
- [Claude Code /insights 内嵌提示词](../../analysis/concepts/claude-code-insights-prompts.md)（concept：内部提示词与拼装）

## 怎么跑

```bash
npm install
npm run dev     # 打开 http://localhost:5173/
```

体验流程：黑场 → 序章一次摆好（报告卡展品 + 点题句暗态）→ 按住圆环 1.25s（模拟运行 /insights）
→ 揭示三连拍（首行聚焦 / 点题句琥珀 / 标题字重通电）→ 黑场 → S1 面板落下。
引擎内滚动完全由 JS 接管（虚拟滚动）：滚轮 / 触屏探索
第一幕三站（S1 终端命中 → S2 星云扫盘 → S3 缓存分流，幕内 gate 自动过渡、河全程全亮；全站无键盘，2026-08-12 裁决）
→ 幕间黑场 → 第二/三幕骨架 → 第三幕；HUD 常驻「回到序章」可返回重看。底部 HUD 轨道
显示八站进度：节点点击直接跳到对应站/幕，站标题与计数数字随推进滚动更新（幕色微染：冷蓝 → 青紫 → 琥珀）。

> 需要支持 WebGL2 的浏览器（序章月球 + 引擎全程 3D，无降级路径，2026-08-11 主人裁决）。
> `prefers-reduced-motion` 下：滚动即时跟随、星云静止、入场直接呈现（gate 黑场过渡仍按 3.5s 缓动推进，M6 打磨）。

## 当前进度

- [x] M0 脚手架 + 序章（黑场排版 + 按住运行按钮 + 占位场景）
- [x] M1 时间轴内核（MasterTimeline：scrollVh 预算 + segment 生命周期 + gate 自动过渡 + skipTo）
- [x] M2 TAP HOLD + HUD 轨道
- [x] M3 光河 + 第一幕（S1~S3）—— **实现落地，演出化验收待推进**（规格 = docs/m3-design.md）
- [ ] M4 第二幕重场戏（S4/S5）—— 前置：m4 设计简报（S4 信息密度裁决 + 数据层扩展）
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

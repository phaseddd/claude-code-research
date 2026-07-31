---
title: why.zero.university 交互机制解剖（叙事型 3D 落地页的"帅"从哪来）
kind: case
status: active
updated: 2026-07-31
applies_to: why.zero.university 2026-07-31 访问快照（bundle main-5CBRb2so.js）
tags:
  - topic:web-interaction
  - form:case
---

# why.zero.university 交互机制解剖

## 对象

[why.zero.university](https://why.zero.university/) —— "Zero，Human Infrastructure to Get Hired"，Awwwards / FWA of the Day 获奖的**叙事型 3D 互动落地页**：把"大学神话破灭"做成一部可交互的视觉短片，最后落到产品招募（Join Beta 邮箱表单）。

## 当前观察基线

- 2026-07-31 经 chrome-devtools MCP 实测（DOM 快照 + 网络请求 + bundle 静态分析 + 合成输入逐阶段验证）。
- 单页 bundle：`assets/main-5CBRb2so.js`（~1.2MB）、`main-2vyD99YC.css`。
- 换基线（站点改版 / 换 bundle）后本页需复核标 stale。

## 它解决什么问题

传统落地页用"板块堆砌"说服（hero + 特性 + 价格 + CTA）。Zero 要说服的是一句反直觉的话："大学不能保证你进大厂"——纯文字表达既无感染力也留不住人。它把论证变成**可交互的短片**：十屏情绪节拍（相信→承诺→神圣触碰→崩坏→怒骂→数据→金钱→燃烧→业界真相→抽象抉择），每屏只服务一个情绪节拍，信息密度克制；情绪先于功能说明，最后用 Join Beta 收束。**它卖的不是功能，是一场观看体验。**

## 关键结构

### 机制层（代码可验证）

**1. 多阶段时间轴（MasterTimeline）** —— 全站最核心的架构。页面无原生滚动（body overflow hidden），滚动完全被 JS 接管：

```
root
├── stage1  -100 BZ   scrollVh 175   autoScroll:false（独立滚动预算）
├── gate0to1          scrollVh 50    autoScroll:true  duration 3.5s（电影式自动过渡）
├── stage2  -75 BZ    scrollVh 250   autoScroll:false  advanceAtEnd:true
├── gate1to2          scrollVh 50    autoScroll:true
├── stage3  -50 BZ    scrollVh 325   autoScroll:false  deferPreviousTeardown:true
├── gate3to4          scrollVh 50    autoScroll:true  duration 3s
├── stage4  -25 BZ    scrollVh 368   autoScroll:false  advanceAtEnd:true
├── gate4to5          scrollVh 50    autoScroll:true
└── stage5    0 BZ    scrollVh 50    autoScroll:false  setPageTheme('white')
```

每个 stage 有**独立的滚动预算（scrollVh）**：滚完本段，进入 gate 自动滚动过渡，再进下一段。`skipTo(segmentId)` 可任意跳转。

**2. 滚动接管** —— wheel 监听 `{passive:true}`，`deltaY` 经系数（±500 clamp、×35 力度）累加进 `targetScrollPos`，rAF 循环 lerp 平滑推进（`SCROLL_LERP`）。

**3. TAP HOLD 推进** —— 按住按钮（`next-stage-hit`），SVG 进度环填充（周长 2π·46），按住时长/阈值 达成触发 onComplete；松开进度衰减（500ms 窗口内可续按 resume）。带 hold 音效。

**4. 画圆手势判定（新手引导）** —— 画零通过则进入正式体验（+100 XP）。判定算法 `_checkZeroGesture`：采样点拟合圆，平均半径² ≥0.02（太小忽略）、半径方差/均值 ≤0.35（圆度检查，不圆判废）、累计角度 ≥330°（`Dg=5.76` rad）、终点回起点（闭合）；`Og=0.9` 触发"接近完成"反馈。

**5. XP 计量** —— 每次推进 +100，数字滚动动画，满值 500。进度可感的核心。

**6. HUD 系统** —— XP / 任务状态（如 "DRAW A ZERO"）/ 标尺导航（-100~0 BZ 五按钮）/ SCROLL 指示 / 音频开关，常驻不抢戏，建立"产品宇宙"感。

**7. 终局仪式** —— body `frame-open`：折纸证书（`origami_certificate.webp`）展开 + 公司卡片视频（Nike / OpenAI / Google / Spotify，hover 播放）+ Join Beta 邮箱表单。

### 质感层（截图拆解交叉验证）

1. **十屏 = 十个情绪节拍**，每屏只服务一个节拍；场景复用 + 调色反转制造冲击（同一"创造亚当"式双手构图，从希望绿变成末日红，色彩即情节）
2. **一个贯穿的 3D 隐喻主体（手）** —— 概念可视化而非炫技堆模型
3. **数据不做列表，做成场景物体** —— 玻璃碎片=统计卡片、飞舞纸片=名人语录，信息本身成为场景美术
4. **字即图形** —— 超大 display 字 + 小 caption，大负空间，字与 3D 主体咬合
5. **统一交互语言** —— TAP HOLD 贯穿全场，交互即剧情（接近、确认、揭穿）
6. **艺术史/文化引用**（《创造亚当》构图、古典柱廊）抬高格调

> 本文档是 demos/insights-pipeline 的 showcase 参考素材（非知识库知识页，按仓库边界规则不入 `analysis/`）。

## 本项目可借鉴点

对应 demos/insights-pipeline 的实现（详见 [`../PLAN.md`](../PLAN.md)）：

1. **MasterTimeline 模式**：segments（id/scrollVh/autoScroll/enter 钩子）+ gate 自动过渡 —— 直接复用为八站三幕的时间轴内核
2. **节奏交错**：滚动（主动掌控）× TAP HOLD（蓄力）× 自动过渡（电影感）三种推进交替
3. **TAP HOLD 交互语言**：按住 + 进度环 + 松手衰减续按 —— 作为"引擎运转"仪式
4. **进度可感**：流水线轨道 + 数字滚动动画，任何时刻知道自己在旅程中的位置
5. **数据即场景物体**：facet JSON 字段卡、统计数字物件悬浮于场景，而非文字列表
6. **字阶排版**：超大展示字 + 等宽数据字 + 小 caption 的分层
7. **HUD 常驻**：低干扰，建立产品感

## 本项目不应照搬点

1. **画圆手势** —— 那是 Zero 的品牌仪式（画"零"）；我们的品牌仪式是"运行 /insights 命令"，用 TAP HOLD 即可
2. **证书 + 公司卡片终局** —— 贴它的"毕业进大厂"叙事；我们终局是"回到聊天窗看到两行英文"，首尾呼应
3. **具体配色段** —— 它的白/绿→红→暗绿绑定其主题情绪；我们按数据处理阶段走冷蓝→青紫→暖白
4. **花体/衬线大字体系** —— 中文环境无对应高质量 webfont 性价比；用 Noto Sans SC 900 超重字 + 大负空间达到同类张力
5. **Howler 音频体系** —— 非必需，WebAudio 轻量合成即可

## 证据

- bundle 静态分析：`assets/main-5CBRb2so.js`（2026-07-31 下载，1,218,729 字节，SHA-256 `d549f2ff258be439a7d585f914e548fa2bc1d205101ff744a66a30a72f5e61fa`）—— segments 结构、`_onWheel`/`Tg`/`_checkZeroGesture`/XP 常量（`Og=.9`、`Dg=5.76`、`kg=.35`、`Fg=500`、`Ig=35`）源码定位
- chrome-devtools 实测：合成 pointer/wheel 事件逐阶段推进，XP 100→200→300→400→500 全程采样；画零判定、TAP HOLD 进度环、body 状态迁移（`webgl-loader-overlay`→`nav-black`→`frame-open`）逐一验证
- 截图拆解：10 张页面截图由多模态模型识图描述，交叉验证视觉层（情绪节拍、色彩叙事、构图引用）
- **官方工程文章交叉验证**（Codrops 2026-07-17《ZERO: The Engineering Behind a Defiant Interactive Narrative》，[链接](https://tympanus.net/codrops/2026/07/17/zero-the-engineering-behind-a-defiant-interactive-narrative/)）：确认 9 个自包含 segment（`enter/scrub/update/teardown` 生命周期 + `scrollVh` 虚拟滚动驱动一切，无 ScrollTrigger）、TAP HOLD 共享配置（`showAt`/`holdDuration`/`onHoldProgress`/`onHoldComplete`）、画圆判定**数值与本页逆向完全吻合**（`totalSignedAngle > 5.76`、`radiusCV < 0.35`、闭合距离 < 平均半径）；补充实现细节：霜冻 ping-pong 四 pass、文字在 tone mapping 后延迟合成保持锐利、按压期间整帧渐暗红（碎裂 ~200ms 弹回）、七抽头六边形模糊文字对焦、烘焙光照贴图 + 双纹理槽交叉淡化、DRACO/KTX2 自托管解码、纹理上传三招（`createImageBitmap`/`requestIdleCallback`/256² 瓦片）、自适应质量管理器（avgMs >22 降档）、体积 35–40MB → <10MB
- 技术栈特征：three.js 独有字符串（`linearToOutputTexel`）、GSAP tween、Vite 产物命名

## 相关页面

- 无（本页是外部案例；配套实现蓝图在 [`../PLAN.md`](../PLAN.md)，不是知识页）

// M1 入口：序章（黑场 → 标题 → 按住运行）→ 引擎三幕骨架时间轴
// 时间轴：act1 → gate1to2 → act2 → gate2to3 → act3（滚动预算 + gate 自动过渡）
// 序章不在时间轴内（DOM 层独立管理）；按住完成 → skipTo('act1') 落入第一幕骨架
import './style.css'
import gsap from 'gsap'
import { mountPrologue } from './prologue.js'
import { createScroll } from './scroll.js'
import { createTimeline } from './timeline.js'
import { createActSkeleton } from './scenes/act-skeleton.js'
import { createHud } from './hud.js'
import { COLORS } from './theme.js'

// 尊重动效偏好：黑场三段式淡入在 reduce 下直接呈现
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

// WebGL2 检测：无则降级为静态科普页（科普信息不丢）
const supportsWebGL2 = (() => {
  try {
    const c = document.createElement('canvas')
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2'))
  } catch {
    return false
  }
})()

// 分层容器：#scene（3D 层，z-index 0）与 #ui（DOM 层，z-index 10），
// 统一挂到 index.html 的 #app 应用根（#app 的 fixed inset:0 规则由此生效）
const appEl = document.getElementById('app')

const sceneEl = document.createElement('div')
sceneEl.id = 'scene'
appEl.appendChild(sceneEl)

const uiEl = document.createElement('div')
uiEl.id = 'ui'
appEl.appendChild(uiEl)

// ---------- 段配置 ----------
// 每段 scrollVh 为虚拟滚动预算（vh 单位）：滚完本段 → gate 自动过渡 → 下一幕
// gate 是 autoScroll 过渡段：无需用户滚动，3.5s 缓动自动滚完（电影式转场）
const ACT_VH = 150 // 骨架站预算（M3 起按真实内容调整）
const GATE_VH = 60 // gate 自动过渡预算
const GATE_DURATION = 3.5 // gate 自动过渡时长（秒）

// 一幕骨架段：enter 构建场景 → scrub 同步标题视差 → teardown 释放
function makeActSegment({ id, ...opts }) {
  let skel = null // 当前场景实例（enter/teardown 配对创建销毁）
  return {
    id,
    scrollVh: ACT_VH,
    enter(ctx) {
      skel = createActSkeleton({ ...opts, sceneEl, uiEl })
      skel.enter()
    },
    scrub(ctx, p) {
      skel?.scrub(p)
    },
    update(ctx, t, dt) {
      skel?.update(t, dt)
    },
    teardown(ctx) {
      skel?.dispose()
      skel = null
    },
  }
}

// 黑场三段式 gate：旧场景淡出 → 卸旧 → 预挂新场景 → 淡入
//（deferPrev 把旧段 teardown 推迟给本段 scrub 显式执行，对齐零站点黑场过渡）
function makeFadeGate({ id }) {
  return {
    id,
    scrollVh: GATE_VH,
    autoScroll: true,
    duration: GATE_DURATION,
    deferPrev: true, // 进入本段时旧段不立即 teardown，由下方 scrub 的 teardownOld() 控制
    enter() {}, // gate 无场景
    scrub(ctx, p) {
      // 黑场三段式：0~0.35 旧场景淡出 → 0.35 卸旧 → 0.65 预挂新场景 → 0.65~1 淡入
      if (p < 0.35) {
        ctx.fadeScene(1 - p / 0.35)
      } else {
        ctx.teardownOld()
        if (p >= 0.65) {
          ctx.preEnterNext()
          ctx.fadeScene((p - 0.65) / 0.35)
        }
      }
    },
    update() {},
    // 离开 gate 时透明度不再写回（2026-08-05 修复，PLAN §4.1）：
    // 归 1 统一由 timeline 接管 —— 自然走完时时间驱动 scrub 已在末帧写 1；
    // 被打断（wheel 硬切）时由 switchTo 的接续补间从当前值平滑到 1；
    // skipTo 显式跳转由 force 分支瞬间归 1。teardown 写回会与接续补间互相覆盖 → 抖动
    teardown() {},
  }
}

// 三幕骨架段（文案措辞锚定 PLAN.md 三幕；回到序章入口仅第一幕）
const segments = [
  makeActSegment({
    id: 'act1',
    color: COLORS.act1,
    title: '第一幕 · 数据',
    subtitle: '引擎认识你的历史 —— 扫盘、缓存，快而奇观',
    showRestart: true,
    onRestart: backToPrologue, // 回到序章：销毁时间轴 → 重挂序章
  }),
  makeFadeGate({ id: 'gate1to2' }),
  makeActSegment({
    id: 'act2',
    color: COLORS.act2,
    title: '第二幕 · 理解',
    subtitle: '对话被压缩、被读懂 —— 投影、打标签，慢而重场',
  }),
  makeFadeGate({ id: 'gate2to3' }),
  makeActSegment({
    id: 'act3',
    color: COLORS.act3,
    title: '第三幕 · 生成',
    subtitle: '报告长出来 —— 七章并行、合成总览、落盘交付',
  }),
]

const totalVh = segments.reduce((a, s) => a + s.scrollVh, 0)

// ---------- 引擎装配（序章按住完成后创建；回到序章时销毁） ----------
let timeline = null // 当前时间轴实例（回到序章 → dispose 置空）
let scroll = null // 虚拟滚动控制器（与 timeline 同生命周期）
let hud = null // HUD 覆盖层（M2：8 节点轨道 + 站标题 + 数字滚动；与 timeline 同生命周期）

function bootTimeline() {
  // 虚拟滚动：wheel / 触屏 / 键盘 → targetVh；lerp 平滑 → 每帧喂给时间轴
  scroll = createScroll({ max: totalVh, onFrame: onScrollFrame })
  // HUD 覆盖层：节点点击 → 跳到对应幕（segments 是模块级常量，直接查）
  hud = createHud({ uiEl, onSelect: (segId) => timeline?.skipTo(segId) })
  timeline = createTimeline({
    segments,
    scroll,
    fadeScene: (v) => { sceneEl.style.opacity = String(v) },
    // 段切换联动 HUD：gate 段进入过渡态（标题 旧幕 → 新幕 + 轨道扫光），
    // 幕段进入更新节点点亮 / 标题 / 数字滚动
    onSegmentChange: (prev, next) => hud.setSeg(next.id, prev?.id),
  })
  // 落位第一幕（skipTo 复位位置；创建时已 enter，此处幂等）
  timeline.skipTo('act1')
  // 黑场三段式：场景先置 0（黑场）→ 停顿 0.3s → 淡入（电影化过渡，避免硬切换）。
  // 注：sceneEl 初始 opacity 为 1，不先置 0 则 gsap 1→1 是空操作，黑场停顿缺失
  sceneEl.style.opacity = '0'
  gsap.to(sceneEl, { opacity: 1, duration: reducedMotion ? 0.01 : 0.5, delay: reducedMotion ? 0 : 0.3 })
}

// 滚动帧 → 时间轴（scroll 只在引擎阶段存在：序章阶段未创建，
// 回到序章时已 dispose 取消 rAF，onFrame 不再被调用）
function onScrollFrame(current, target, dt) {
  timeline?.onFrame(current, target, dt)
}

// 回到序章：销毁时间轴 / HUD / 滚动 → 重置黑场态 → 重新挂载序章
function backToPrologue() {
  timeline?.dispose()
  timeline = null
  hud?.dispose()
  hud = null
  scroll?.dispose()
  scroll = null
  sceneEl.style.opacity = '1' // 重置黑场态，供下次进入复用
  bootPrologue()
}

// 序章挂载（可重复调用：首次进入 + 骨架"回到序章"）
function bootPrologue() {
  mountPrologue({
    uiEl,
    degraded: !supportsWebGL2,
    onEnter: supportsWebGL2
      ? () => {
          // 序章完成：淡出序章 → 进入引擎（时间轴落位第一幕骨架）
          bootTimeline()
        }
      : null,
  })
}

bootPrologue()

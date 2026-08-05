// M3 入口：序章（黑场 → 标题 → 按住运行）→ 第一幕三站（共享光河）→ 第二/三幕骨架时间轴
// 时间轴：s1 → g1 → s2 → g2 → s3 → gate1to2 → act2 → gate2to3 → act3（简报 §6.3）
//   s1/s2/s3 第一幕真实场景（三站共享同一光河实例,简报 §6.1）
//   g1/g2 幕内轻量 gate（1.5~2s 同幕色,避免幕内重黑场割裂「同一幕」感,简报 §6.1）
//   gate1to2/gate2to3 幕间 gate（3.5s,沿用现有机制）
//   act2/act3 极简骨架占位（第二/三幕 M4/M5 实现,原 act-skeleton.js 已删除,简报 §7.1-6）
// 序章不在时间轴内（DOM 层独立管理）；按住完成 → skipTo('s1') 落入第一幕
import './style.css'
import * as THREE from 'three'
import gsap from 'gsap'
import { mountPrologue } from './prologue.js'
import { createScroll } from './scroll.js'
import { createTimeline } from './timeline.js'
import { createRiver } from './river.js'
import { createS1 } from './scenes/s1.js'
import { createS2 } from './scenes/s2.js'
import { createS3 } from './scenes/s3.js'
import { createHud } from './hud.js'
import { STATS } from './data/sessions.js'

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

// ---------- 3D 装配（第一幕真实场景；与 timeline 同生命周期） ----------
// 透明 canvas 透出 body 背景 #05070d（简报 §2.3 背景禁止纯黑,现有底色已符合）；
// 无光照场景,粒子/星云自发光（AdditiveBlending）,不需要灯光
const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)) // DPR 钳制 2(简报 §3.1)
renderer.setSize(window.innerWidth, window.innerHeight)
sceneEl.appendChild(renderer.domElement)

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200)
camera.position.set(0, 0.7, 18.5) // 初始:S1 源头近景(各站 enter 再定位)

const onResize = () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
}
window.addEventListener('resize', onResize)

// ---------- 段配置 ----------
// 每段 scrollVh 为虚拟滚动预算（vh 单位）：滚完本段 → gate 自动过渡 → 下一段
// gate 是 autoScroll 过渡段：无需用户滚动，缓动自动滚完（电影式转场）
const SCENE_VH = 180 // 第一幕站预算（简报 §4 共用结构：0~0.2 入场 / 0.2~0.75 文案 / 0.75~1 收尾）
const GATE_VH = 60 // gate 自动过渡预算
const ACT_VH = 150 // 第二/三幕骨架站预算（保持 M1）
const GATE_DURATION = 3.5 // 幕间 gate 时长（秒,沿用现有）
const LIGHT_GATE_DURATION = 1.8 // 幕内轻量 gate（秒,简报 §6.1:1.5~2s）

// ---------- 三站共享的共享容器 ----------
// river 生命周期 = 第一幕全程（简报 §6.1:进入 S1 创建,离开 S3 时 teardown）:
// 由 s1 段 enter 创建、s3 段 teardown 销毁（s3 teardown 被 gate1to2 的 deferPrev
// 推迟到黑场中段执行,黑场里河已不可见,衔接安全）
const shared = { scene, camera, uiEl, river: null }

// 站级场景段：enter 构建场景 → scrub 站内滚动编排 → update 每帧 idle → teardown 释放
function makeSceneSegment({ id, create, scrollVh }) {
  let inst = null
  return {
    id,
    scrollVh,
    enter(ctx) {
      if (id === 's1' && !shared.river) {
        // 分流比来自合成数据统计(简报 §2.5:meta 支明显宽于 facet 支)
        shared.river = createRiver({ scene, branchShare: STATS.metaShare })
      }
      inst = create({ ...shared, onRestart: backToPrologue })
      inst.enter()
    },
    scrub(ctx, p) {
      inst?.scrub(p)
    },
    update(ctx, t, dt) {
      inst?.update(t, dt)
    },
    teardown(ctx) {
      inst?.dispose()
      inst = null
      if (id === 's3' && shared.river) {
        shared.river.dispose()
        shared.river = null
      }
    },
  }
}

// 黑场三段式 gate：旧场景淡出 → 卸旧 → 预挂新场景 → 淡入
//（deferPrev 把旧段 teardown 推迟给本段 scrub 显式执行,对齐零站点黑场过渡）
function makeFadeGate({ id, duration = GATE_DURATION }) {
  return {
    id,
    scrollVh: GATE_VH,
    autoScroll: true,
    duration,
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

// 第二/三幕骨架段（M1 act-skeleton 的 M3 内联版:原文件已删除,无残留引用,简报 §7.1-6）。
// 占位纯 DOM 覆盖层,文案措辞锚定 PLAN.md 三幕
function makeActSegment({ id, title, subtitle }) {
  let root = null
  return {
    id,
    scrollVh: ACT_VH,
    enter() {
      root = document.createElement('div')
      root.className = 'act-skeleton'
      root.innerHTML = `
        <div class="act-title">${title}</div>
        <div class="act-sub">${subtitle}</div>
        <div class="act-scroll">滚动探索</div>
      `
      uiEl.appendChild(root)
    },
    scrub(ctx, p) {
      // 骨架无场景内容,滚动只占预算(第二/三幕 M4/M5 实现真实编排)
      void p
    },
    update() {},
    teardown() {
      root?.remove()
      root = null
    },
  }
}

const segments = [
  makeSceneSegment({ id: 's1', create: createS1, scrollVh: SCENE_VH }),
  makeFadeGate({ id: 'g1', duration: LIGHT_GATE_DURATION }),
  makeSceneSegment({ id: 's2', create: createS2, scrollVh: SCENE_VH }),
  makeFadeGate({ id: 'g2', duration: LIGHT_GATE_DURATION }),
  makeSceneSegment({ id: 's3', create: createS3, scrollVh: SCENE_VH }),
  makeFadeGate({ id: 'gate1to2' }),
  makeActSegment({
    id: 'act2',
    title: '第二幕 · 理解',
    subtitle: '对话被压缩、被读懂 —— 投影、打标签，慢而重场',
  }),
  makeFadeGate({ id: 'gate2to3' }),
  makeActSegment({
    id: 'act3',
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
  // HUD 覆盖层：节点点击 → 跳到对应站/幕（segments 是模块级常量，直接查）
  hud = createHud({ uiEl, onSelect: (segId) => timeline?.skipTo(segId) })
  timeline = createTimeline({
    segments,
    scroll,
    fadeScene: (v) => {
      sceneEl.style.opacity = String(v)
    },
    // 段切换联动 HUD：gate 段进入过渡态（标题 旧站/幕 → 新站/幕 + 轨道扫光），
    // 站/幕段进入更新节点点亮 / 标题 / 数字滚动（M3 站级:1→2→3 逐个点亮）
    onSegmentChange: (prev, next) => hud.setSeg(next.id, prev?.id),
  })
  // 落位第一幕第一站（skipTo 复位位置；创建时已 enter，此处幂等）
  timeline.skipTo('s1')
  // 黑场三段式：场景先置 0（黑场）→ 停顿 0.3s → 淡入（电影化过渡，避免硬切换）。
  // 注：sceneEl 初始 opacity 为 1，不先置 0 则 gsap 1→1 是空操作，黑场停顿缺失
  sceneEl.style.opacity = '0'
  gsap.to(sceneEl, { opacity: 1, duration: reducedMotion ? 0.01 : 0.5, delay: reducedMotion ? 0 : 0.3 })
}

// 滚动帧 → 时间轴（scroll 只在引擎阶段存在：序章阶段未创建，
// 回到序章时已 dispose 取消 rAF，onFrame 不再被调用）→ 每帧渲染
function onScrollFrame(current, target, dt) {
  timeline?.onFrame(current, target, dt)
  renderer.render(scene, camera)
}

// 回到序章：销毁时间轴 / HUD / 滚动 / 渲染器 → 重置黑场态 → 重新挂载序章
function backToPrologue() {
  timeline?.dispose()
  timeline = null
  hud?.dispose()
  hud = null
  scroll?.dispose()
  scroll = null
  window.removeEventListener('resize', onResize)
  renderer.dispose()
  renderer.domElement.remove()
  sceneEl.style.opacity = '1' // 重置黑场态，供下次进入复用
  bootPrologue()
}

// 序章挂载（可重复调用：首次进入 + 第一幕"重新体验"回到序章）
function bootPrologue() {
  mountPrologue({
    uiEl,
    degraded: !supportsWebGL2,
    onEnter: supportsWebGL2
      ? () => {
          // 序章完成：淡出序章 → 进入引擎（时间轴落位第一幕第一站）
          bootTimeline()
        }
      : null,
  })
}

bootPrologue()

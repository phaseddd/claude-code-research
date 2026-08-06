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
import { createS1, S1_CAM_END, S1_LOOK_END } from './scenes/s1.js'
import { createS2, S2_CAM_ENTER, S2_LOOK_ENTER } from './scenes/s2.js'
import { createS3 } from './scenes/s3.js'
import { createHud, ACT_TITLES } from './hud.js'
import { STATS } from './data/sessions.js'
import { easeInOutSine, isReducedMotion, rampCamera } from './utils.js'

// 尊重动效偏好：黑场三段式淡入在 reduce 下直接呈现
const reducedMotion = isReducedMotion()

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

// ---------- 3D 装配（第一幕真实场景；引擎级生命周期,随 bootTimeline 创建） ----------
// 透明 canvas 透出 body 背景（简报 §2.3 背景禁止纯黑）；无光照场景,
// 粒子/星云自发光（AdditiveBlending）,不需要灯光。
// 2026-08-05 修复(主人实测)二连:「重新体验」后再次进入粒子河消失。
//   第一弹:shared.river 复用 → 旧纹理 immutable 报错(已修:backToPrologue 置空重建);
//   第二弹(本次):renderer 原是模块级常量只 append 一次,backToPrologue 里
//     domElement.remove() 后再次进入不重新挂载 → #scene 无 canvas,3D 层整个消失
//     (无 GL 报错、无粒子)。修复:renderer/scene/camera 全部随引擎会话创建销毁,
//     shared 的 scene/camera 字段每次赋值(场景模块运行时取 shared 最新值)。
// 2026-08-06 简化:scene/camera 不再持有模块级镜像 —— 场景模块只认 shared，
// 模块内部(渲染/滑轨/resize)也统一走 shared 字段,单一事实来源
let renderer = null // 渲染器(bootTimeline 新建 / backToPrologue 销毁;scene/camera 存 shared)

const onResize = () => {
  shared.camera.aspect = window.innerWidth / window.innerHeight
  shared.camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
}

// ---------- 段配置 ----------
// 每段 scrollVh 为虚拟滚动预算（vh 单位）：滚完本段 → gate 自动过渡 → 下一段
// gate 是 autoScroll 过渡段：无需用户滚动，缓动自动滚完（电影式转场）
const SCENE_VH = 180 // 第一幕站预算（简报 §4 共用结构：0~0.2 入场 / 0.2~0.75 文案 / 0.75~1 收尾）
const GATE_VH = 60 // gate 自动过渡预算
const ACT_VH = 150 // 第二/三幕骨架站预算（保持 M1）
const GATE_DURATION = 3.5 // 幕间 gate 时长（秒,沿用现有）
const LIGHT_GATE_DURATION = 1.8 // 幕内轻量 gate（秒,简报 §6.1:1.5~2s）

// ---------- 三站共享的共享容器 ----------
// river 生命周期 = 引擎级（简报 §6.1 贯穿三幕）:bootTimeline 创建 / backToPrologue
// 销毁（段只切可见窗口；M4/M5 的 S4~S6 继续沿用同一实例,不随站建毁）
const shared = { scene: null, camera: null, uiEl, river: null } // scene/camera 随引擎会话赋值

// 站级场景段：enter 构建场景 → scrub 站内滚动编排 → update 每帧 idle → teardown 释放
// （scrub/update 双可选：场景可实现全部或部分生命周期，timeline 侧 `?.()` 调用）
function makeSceneSegment({ id, create, scrollVh }) {
  let inst = null
  return {
    id,
    scrollVh,
    enter(ctx) {
      inst = create({ ...shared, onRestart: backToPrologue })
      inst.enter()
    },
    scrub(ctx, p) {
      inst?.scrub?.(p)
    },
    update(ctx, t, dt) {
      inst?.update?.(t, dt)
    },
    teardown(ctx) {
      inst?.dispose()
      inst = null
    },
  }
}

// 黑场三段式 gate：旧场景淡出 → 卸旧 → 预挂新场景 → 淡入
//（deferPrev 把旧段 teardown 推迟给本段 scrub 显式执行,对齐零站点黑场过渡）
// 2026-08-05 画卷扩展(仅 g1 启用,其余 gate 行为不变):
//   minOpacity   dip 底值(默认 0 = 全黑;g1 用 0.25 = 浅呼吸,画卷换卷不黑屏)
//   cameraPath / lookPath  门内相机滑轨(cam-end → 下一站相机,沿河连续,
//   无缝衔接的关键:滚动过站时画面是「镜头沿河滑行」而非硬切)
function makeFadeGate({ id, duration = GATE_DURATION, minOpacity = 0, cameraPath = null, lookPath = null }) {
  return {
    id,
    scrollVh: GATE_VH,
    autoScroll: true,
    duration,
    // 三段式淡入段占比（0.65~1）：timeline 的转场接续补间按此同速率折算，
    // 改门槛只改这里一处（原 0.35 魔法数跨两文件手抄）
    fadeInShare: 0.35,
    deferPrev: true, // 进入本段时旧段不立即 teardown，由下方 scrub 的 teardownOld() 控制
    scrub(ctx, p) {
      // 相机滑轨(画卷展卷的站间段):easeInOutSine 与时间轴自动推进同源,
      // 终点 = 下一站 enter 的相机位 → 无缝（终点由场景模块导出的 CAM_ENTER 提供）
      if (shared.camera && cameraPath && lookPath) {
        rampCamera(shared.camera, cameraPath[0], lookPath[0], cameraPath[1], lookPath[1], easeInOutSine(p))
      }
      // 三段式(浅 dip 版):0~0.35 旧场景淡出到 minOpacity → 0.35 卸旧
      // → 0.65 预挂新场景 → 0.65~1 淡入回全亮
      if (p < 0.35) {
        ctx.fadeScene(1 - (p / 0.35) * (1 - minOpacity))
      } else {
        ctx.teardownOld()
        if (p >= 0.65) {
          ctx.preEnterNext()
          ctx.fadeScene(minOpacity + ((p - 0.65) / 0.35) * (1 - minOpacity))
        }
      }
      // 离开 gate 时透明度不再写回（2026-08-05 修复，PLAN §4.1）：
      // 归 1 统一由 timeline 接管 —— 自然走完时时间驱动 scrub 已在末帧写 1；
      // 被打断（wheel 硬切）时由 switchTo 的接续补间从当前值平滑到 1；
      // skipTo 显式跳转由 force 分支瞬间归 1。teardown 写回会与接续补间互相覆盖 → 抖动
    },
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
    teardown() {
      root?.remove()
      root = null
    },
  }
}

const segments = [
  makeSceneSegment({ id: 's1', create: createS1, scrollVh: SCENE_VH }),
  // 画卷滑轨门(S1→S2):浅 dip(0.25)不黑屏 + 相机沿河滑行到 S2 开场位
  // (终点 = s2.js 导出的 S2_CAM_ENTER/S2_LOOK_ENTER,由场景模块对齐)——
  // 滚动过站 = 镜头追着河走,「天衣无缝」的衔接点
  makeFadeGate({
    id: 'g1',
    duration: LIGHT_GATE_DURATION,
    minOpacity: 0.25,
    cameraPath: [S1_CAM_END, S2_CAM_ENTER],
    lookPath: [S1_LOOK_END, S2_LOOK_ENTER],
  }),
  makeSceneSegment({ id: 's2', create: createS2, scrollVh: SCENE_VH }),
  makeFadeGate({ id: 'g2', duration: LIGHT_GATE_DURATION }),
  makeSceneSegment({ id: 's3', create: createS3, scrollVh: SCENE_VH }),
  makeFadeGate({ id: 'gate1to2' }),
  makeActSegment({
    id: 'act2',
    title: ACT_TITLES.act2, // 幕标题单一来源在 hud.js（HUD 轨道同款文案）
    subtitle: '对话被压缩、被读懂 —— 投影、打标签，慢而重场',
  }),
  makeFadeGate({ id: 'gate2to3' }),
  makeActSegment({
    id: 'act3',
    title: ACT_TITLES.act3,
    subtitle: '报告长出来 —— 七章并行、合成总览、落盘交付',
  }),
]

const totalVh = segments.reduce((a, s) => a + s.scrollVh, 0)

// ---------- 引擎装配（序章按住完成后创建；回到序章时销毁） ----------
let timeline = null // 当前时间轴实例（回到序章 → dispose 置空）
let scroll = null // 虚拟滚动控制器（与 timeline 同生命周期）
let hud = null // HUD 覆盖层（M2：8 节点轨道 + 站标题 + 数字滚动；与 timeline 同生命周期）

function bootTimeline() {
  // 引擎三件套:全新 renderer/scene/camera(「重新体验」后旧实例已销毁,
  // 新 canvas 重新挂载 —— 避免旧 GL 资源/旧 DOM 残留)
  renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)) // DPR 钳制 2(简报 §3.1)
  renderer.setSize(window.innerWidth, window.innerHeight)
  sceneEl.appendChild(renderer.domElement)
  shared.scene = new THREE.Scene()
  shared.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200)
  shared.camera.position.set(0, 0.7, 18.5) // 初始:S1 源头近景(各站 enter 再定位)
  // 引擎级光河:第一幕三站共享(简报 §6.1;bootTimeline 创建 / backToPrologue 销毁,
  // 段只切可见窗口)。分流比来自合成数据统计(简报 §2.5:meta 支明显宽于 facet 支)
  shared.river = createRiver({ scene: shared.scene, branchShare: STATS.metaShare })
  window.addEventListener('resize', onResize)
  // 虚拟滚动：wheel / 触屏 / 键盘 → targetVh；lerp 平滑 → 每帧喂给时间轴
  scroll = createScroll({ max: totalVh, onFrame: onScrollFrame })
  // HUD 覆盖层：节点点击 → 跳到对应站/幕（segments 是模块级常量，直接查）；
  // 常驻「回到序章」→ 销毁引擎重建序章（U5，全站逃生口）
  hud = createHud({ uiEl, onSelect: (segId) => timeline?.skipTo(segId), onRestart: backToPrologue })
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
  // 黑场三段式：场景先置 0（黑场）→ 停顿 0.15s → 淡入（电影化过渡，避免硬切换）。
  // 注：sceneEl 初始 opacity 为 1，不先置 0 则 gsap 1→1 是空操作，黑场停顿缺失
  // 2026-08-06 减半（停顿 0.3→0.15 / 淡入 0.5→0.25），加快进入 S1
  sceneEl.style.opacity = '0'
  gsap.to(sceneEl, { opacity: 1, duration: reducedMotion ? 0.01 : 0.25, delay: reducedMotion ? 0 : 0.15 })
}

// 滚动帧 → 时间轴（scroll 只在引擎阶段存在：序章阶段未创建，
// 回到序章时已 dispose 取消 rAF，onFrame 不再被调用）→ 每帧渲染
// 引擎级光河每帧推进也在这里统一执行（段不再各自转发 river.update，
// 新场景忘转发河即静止的问题从结构上消失）
function onScrollFrame(current, target, dt) {
  timeline?.onFrame(current, target, dt)
  shared.river?.update(0, dt)
  renderer.render(shared.scene, shared.camera)
}

// 回到序章：销毁时间轴 / HUD / 滚动 / 渲染器 → 重置黑场态 → 重新挂载序章
function backToPrologue() {
  timeline?.dispose()
  timeline = null
  hud?.dispose()
  hud = null
  scroll?.dispose()
  scroll = null
  // 2026-08-05 修复(主人实测):「重新体验」回序章后再次进入,粒子河全灭,
  // console 报 GL_INVALID_OPERATION: glTexStorage2D: Texture is immutable。
  // 根因:shared.river 只在 s3 teardown 销毁,从 s1 回序章时旧 river 实例
  // (含旧 DataTexture)仍活着;renderer.dispose() 释放 GPU 资源后,再次进入
  // s1 enter 因 !shared.river 为 false 复用旧 river,旧纹理二次 texStorage2D
  // 打在 immutable 纹理上 → uMap 采样失败 → 粒子全透明。此处销毁并置空,
  // 下次进入重建全新 river/纹理(renderer.dispose() 前置,先释放 JS 侧引用)
  shared.river?.dispose()
  shared.river = null
  window.removeEventListener('resize', onResize)
  renderer.dispose()
  renderer.domElement.remove()
  renderer = null
  shared.scene = null
  shared.camera = null
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

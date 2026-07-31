// M0 入口：序章（黑场 → 标题 → 按住运行）→ 进入引擎占位场景
// 后续里程碑将把占位场景替换为第一幕（S1~S3）真实场景
import './style.css'
import gsap from 'gsap'
import { mountPrologue } from './prologue.js'
import { createTimeline } from './timeline.js'
import { createPlaceholderScene } from './scenes/placeholder.js'

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

// M0 最小时间轴：序章 → 占位站（stage1 的位置，M3 起换成真实第一幕）
let activeScene = null // 当前场景实例（供"回到序章"销毁；异常路径下可能为 null）
const timeline = createTimeline({
  segments: [
    { id: 'prologue' },
    { id: 'stage1' },
  ],
  onEnter: (id) => {
    if (id === 'stage1') {
      // 黑场三段式：序章淡出后，场景先以黑场呈现（#scene opacity 0），
      // 停顿 0.3s 再淡入 —— 电影化的"黑场过渡"，避免硬切换
      sceneEl.style.opacity = '0'
      activeScene = createPlaceholderScene({
        container: sceneEl,
        // 占位浮层的"回到序章"：销毁场景 → 重置时间轴 → 重新挂载序章
        onRestart: () => {
          activeScene?.dispose()
          activeScene = null
          sceneEl.style.opacity = '1' // 重置黑场态，供下次进入复用
          // 重置时间轴：不重置的话 current 停在 stage1，再次进入会被
          // goTo 的"id === current 忽略"挡掉 → 场景永不创建 → 黑屏
          timeline.goTo('prologue')
          bootPrologue()
        },
      })
      activeScene.start()
      // 黑场停顿 0.3s → 场景淡入 0.5s（reduce 偏好：直接呈现）
      gsap.to(sceneEl, { opacity: 1, duration: reducedMotion ? 0.01 : 0.5, delay: reducedMotion ? 0 : 0.3 })
    }
  },
  onLeave: () => {},
})

// 序章挂载（可重复调用：首次进入 + 占位浮层"回到序章"）
function bootPrologue() {
  mountPrologue({
    uiEl,
    degraded: !supportsWebGL2,
    onEnter: supportsWebGL2
      ? () => {
          // 序章完成：淡出序章 → 进入引擎占位场景
          timeline.goTo('stage1')
        }
      : null,
  })
}

bootPrologue()

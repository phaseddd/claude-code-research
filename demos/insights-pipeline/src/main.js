// M0 入口：序章（黑场 → 标题 → 按住运行）→ 进入引擎占位场景
// 后续里程碑将把占位场景替换为第一幕（S1~S3）真实场景
import './style.css'
import { mountPrologue } from './prologue.js'
import { createTimeline } from './timeline.js'
import { createPlaceholderScene } from './scenes/placeholder.js'

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
      activeScene = createPlaceholderScene({
        container: sceneEl,
        // 占位浮层的"回到序章"：销毁场景 → 重置时间轴 → 重新挂载序章
        onRestart: () => {
          activeScene?.dispose()
          activeScene = null
          // 重置时间轴：不重置的话 current 停在 stage1，再次进入会被
          // goTo 的"id === current 忽略"挡掉 → 场景永不创建 → 黑屏
          timeline.goTo('prologue')
          bootPrologue()
        },
      })
      activeScene.start()
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

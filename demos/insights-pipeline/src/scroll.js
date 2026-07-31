// scroll.js —— 虚拟滚动输入层（M1）
// 滚动完全由 JS 接管（body overflow hidden）：wheel / 触屏拖动 / 键盘
// → 累加进 targetVh；rAF 循环把 currentVh 向 targetVh lerp 逼近，
// 每帧回调 onFrame(current, target, dt)。
//
// 内部单位 vh（与 MasterTimeline 的 scrollVh 预算同标尺，不理会视口像素）：
// wheel 的 px 增量经 /innerHeight 换算为 vh。
// 参照零站点 _onWheel（deltaY×35 + rAF lerp，SCROLL_LERP）。
//
// 本模块只负责"输入 → 目标值 → 平滑位置"，不知道 segment 概念；
// 分段与生命周期由 timeline.js 消费 onFrame 驱动。

const WHEEL_FACTOR = 35 // wheel 力度系数（对齐零站点 ×35）
const KEY_STEP = 0.9 // 方向键单步（vh）
const KEY_PAGE = 6 // PageDown / PageUp / Space 步进（vh）
const SNAP_EPS = 0.5 // target 与 current 差值小于此（vh）时直接对齐，
// 避免 lerp 渐近不达导致"滚到底却永远到不了段末"
const LERP_RATE = 5 // 帧率无关 lerp 速率（60fps 下每帧 ≈8% 收敛）

/**
 * 创建虚拟滚动控制器。
 * @param {Object} [opts]
 * @param {number} [opts.max] 滚动总量上限（vh，= 各段 scrollVh 之和）
 * @param {(current: number, target: number, dt: number) => void} [opts.onFrame] 每帧回调
 * @param {number} [opts.wheelFactor] wheel 力度系数（默认 35）
 * @returns {{setTarget: Function, snapTo: Function, dispose: Function}}
 */
export function createScroll({ max = 0, onFrame = null, wheelFactor = WHEEL_FACTOR } = {}) {
  // 尊重动效偏好：reduce 时滚动即时跟随（去掉 lerp 平滑与自动过渡的黏滞感）
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  let target = 0 // 目标滚动位置（用户意图 / gate 自动推进）
  let current = 0 // 实际滚动位置（lerp 平滑后，驱动段内 scrub）
  let rafId = 0
  let lastTime = performance.now()
  let disposed = false

  const clamp = (v) => Math.min(max, Math.max(0, v))

  const setTarget = (v) => {
    target = clamp(v)
  }
  const snapTo = (v) => {
    // skipTo 用：目标与实际都瞬移（跳转不滚动）
    target = current = clamp(v)
  }
  const bump = (dv) => {
    target = clamp(target + dv)
  }

  // rAF 主循环：lerp 平滑（帧率无关）+ snap 收敛
  const tick = (now) => {
    const dt = Math.min(0.1, (now - lastTime) / 1000) // clamp：tab 切回时 dt 过大
    lastTime = now
    if (reducedMotion) {
      current = target // reduce：即时跟随
    } else {
      const k = 1 - Math.exp(-LERP_RATE * dt)
      current += (target - current) * k
      if (Math.abs(target - current) < SNAP_EPS) current = target
    }
    onFrame?.(current, target, dt)
    rafId = requestAnimationFrame(tick)
  }
  rafId = requestAnimationFrame(tick)

  // ---------- 输入监听 ----------
  // wheel：deltaY 像素 → vh（÷视口高）；deltaMode 1（行）/ 2（页）先换算成像素
  const onWheel = (e) => {
    let px = e.deltaY
    if (e.deltaMode === 1) px *= 16
    else if (e.deltaMode === 2) px *= window.innerHeight
    bump((px * wheelFactor) / window.innerHeight)
  }

  // 触屏拖动：1px ≈ 1/innerHeight vh（拖满一屏 = 100vh）；上滑前进
  let touchY = null
  const onTouchStart = (e) => {
    touchY = e.touches[0].clientY
  }
  const onTouchMove = (e) => {
    if (touchY === null) return
    e.preventDefault() // 阻止浏览器手势（橡皮筋/回弹）
    const y = e.touches[0].clientY
    bump((touchY - y) / window.innerHeight)
    touchY = y
  }
  const onTouchEnd = () => {
    touchY = null
  }

  // 键盘：方向键小步、PageDown/PageUp/Space 大步（页面无原生滚动，键盘也归 JS 管）
  const onKeyDown = (e) => {
    // 焦点在按钮/输入控件时不劫持（如按住按钮聚焦时按 Space 是"按住"不是"滚动"）
    if (e.target.closest?.('button, [role="button"], input, textarea, select, a')) return
    let dv = 0
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        dv = KEY_STEP
        break
      case 'ArrowUp':
      case 'ArrowLeft':
        dv = -KEY_STEP
        break
      case 'PageDown':
      case ' ':
        dv = KEY_PAGE
        break
      case 'PageUp':
        dv = -KEY_PAGE
        break
      default:
        return
    }
    e.preventDefault()
    bump(dv)
  }

  window.addEventListener('wheel', onWheel, { passive: true })
  window.addEventListener('touchstart', onTouchStart, { passive: true })
  window.addEventListener('touchmove', onTouchMove, { passive: false })
  window.addEventListener('touchend', onTouchEnd)
  window.addEventListener('keydown', onKeyDown)

  return {
    setTarget,
    snapTo,
    dispose() {
      if (disposed) return
      disposed = true
      cancelAnimationFrame(rafId)
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('keydown', onKeyDown)
    },
  }
}

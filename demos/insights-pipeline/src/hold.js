// hold.js —— TAP HOLD 按住交互组件
// 长按 .hold-hit 填充 SVG 进度环，按满 duration 秒触发 onComplete；
// 松开后 500ms 内再按住可续接进度，超时则进度归零。
// 参照零大学 Tg 类机制简化：回落直接归零，不做衰减动画（KISS）。
//
// v2 扩展（序章规格 PROLOGUE-REDESIGN.md §5 交互通道）：
//   enabled=false  忽略一切输入（序章 0.98s「可走」前禁点），setEnabled() 开启
// 2026-08-11：键盘通道（Tab→Enter）与降级通道（instant 点击即走）整体移除 ——
//   主人裁决：项目不需要键盘，且 tabindex 移除 = 圆环不可聚焦，
//   同时根治焦点指示画方框的问题

import { clamp01 } from './utils.js'

const CIRC = 289.03 // 进度环周长 2π × 46，与 CSS stroke-dasharray 一致
const RESUME_WINDOW = 500 // 松开后允许续按的窗口（ms）

export function createHoldButton({
  el,
  duration = 2.5,
  enabled = true, // false 时忽略一切输入（序章摆好期间禁点）
  onComplete = null,
}) {
  const hitEl = el.querySelector('.hold-hit')
  // 进度弧（.hold-ring-progress）；底环 .hold-ring-base 是常驻引导环，不动它
  const ringEl = el.querySelector('.hold-ring-progress')

  // 按钮语义 + 完成播报（.hold-hit 是 div，默认可达性为零）。
  // 2026-08-11：无 tabindex（不可聚焦）—— 键盘通道已整体移除，
  // 且焦点落不到圆环 = 任何来源都画不出焦点方框
  if (hitEl) {
    hitEl.setAttribute('role', 'button')
    hitEl.setAttribute('aria-label', '进入演示')
    hitEl.setAttribute('aria-live', 'polite')
  }

  let progress = 0 // 当前进度 0~1
  let rafId = null // 推进循环的 rAF id
  let downTime = 0 // 本次（或续接）按下时刻
  let activePointerId = null // 多指保护：只认第一个指针
  let cancelTimer = null // 500ms 续接窗口的定时器
  let settled = false // 已完成/已销毁后忽略一切输入

  // 进度环可视进度 = 1 - progress（dashoffset 越大环越空）
  const setRing = (p) => {
    ringEl.style.strokeDashoffset = String(CIRC * (1 - p))
  }

  const stopLoop = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  // 撤销全部监听与定时器；完成或销毁时调用，避免泄漏
  const cleanup = () => {
    stopLoop()
    if (cancelTimer !== null) {
      clearTimeout(cancelTimer)
      cancelTimer = null
    }
    hitEl.removeEventListener('pointerdown', onPointerDown)
    hitEl.removeEventListener('lostpointercapture', onLostCapture)
    document.removeEventListener('pointerup', onPointerUp)
    document.removeEventListener('pointercancel', onPointerCancel)
    el.classList.remove('is-dragging')
    activePointerId = null
  }

  // 进度打满：清理后触发一次 onComplete
  const finishComplete = () => {
    if (settled) return
    settled = true
    progress = 1
    setRing(1)
    cleanup()
    hitEl?.setAttribute('aria-label', '引擎已启动') // 完成播报
    if (onComplete) onComplete()
  }

  // 续接窗口超时：进度直接归零
  const cancelNow = () => {
    if (settled) return
    cancelTimer = null
    progress = 0
    setRing(0)
  }

  // 每帧按按下以来经过的时间推进进度；达标即完成
  const tick = (now) => {
    rafId = null
    progress = clamp01((now - downTime) / (duration * 1000))
    setRing(progress)
    if (progress >= 1) {
      finishComplete()
      return
    }
    rafId = requestAnimationFrame(tick)
  }

  // 按住开始：记录指针 id、续接、启动推进循环
  const startHold = (pointerId) => {
    if (settled || activePointerId !== null) return // 多指保护：只认第一个
    activePointerId = pointerId
    el.classList.add('is-dragging')
    // 若仍在 500ms 续接窗口内，取消归零定时器，从当前进度续接
    if (cancelTimer !== null) {
      clearTimeout(cancelTimer)
      cancelTimer = null
    }
    // 把按下时刻回拨到"当前进度对应的时间点"，进度无缝续走
    downTime = performance.now() - progress * duration * 1000
    rafId = requestAnimationFrame(tick)
  }

  // 松开/系统打断：停推进，开 500ms 续接窗口
  const stopHold = () => {
    stopLoop()
    activePointerId = null
    el.classList.remove('is-dragging')
    cancelTimer = setTimeout(cancelNow, RESUME_WINDOW)
  }

  const onPointerDown = (e) => {
    if (!enabled || settled) return // 可走前禁点 / 完成后忽略
    e.preventDefault() // 避免触屏长按触发文本选择/系统菜单
    startHold(e.pointerId)
    // 指针 capture：拖出窗口松开也能收到 lostpointercapture 停止推进
    if (typeof hitEl.setPointerCapture === 'function' && typeof e.pointerId === 'number') {
      try {
        hitEl.setPointerCapture(e.pointerId)
      } catch {
        /* 合成事件下无真实 capture，忽略 */
      }
    }
  }

  const onPointerUp = (e) => {
    if (e.pointerId !== activePointerId) return
    stopHold()
  }

  const onPointerCancel = (e) => {
    if (e.pointerId !== activePointerId) return
    stopHold()
  }

  // capture 丢失（拖出窗口/系统抢占）：等同松开
  const onLostCapture = (e) => {
    if (e.pointerId !== activePointerId) return
    stopHold()
  }

  hitEl.addEventListener('pointerdown', onPointerDown)
  hitEl.addEventListener('lostpointercapture', onLostCapture)
  document.addEventListener('pointerup', onPointerUp)
  document.addEventListener('pointercancel', onPointerCancel)

  return {
    // 可走开关：false 忽略一切输入，true 恢复（序章 0.98s 摆好完成才放行）
    setEnabled(v) {
      enabled = v
    },
    // 销毁：撤销全部监听、取消 rAF，进度环归零
    dispose() {
      settled = true
      cleanup()
      progress = 0
      setRing(0)
    },
  }
}

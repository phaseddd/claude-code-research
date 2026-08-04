// hold.js —— TAP HOLD 按住交互组件
// 长按 .hold-hit 填充 SVG 进度环，按满 duration 秒触发 onComplete；
// 松开后 500ms 内再按住可续接进度，超时则进度归零并触发 onCancel。
// 参照零大学 Tg 类机制简化：回落直接归零，不做衰减动画（KISS）。

const CIRC = 289.03 // 进度环周长 2π × 46，与 CSS stroke-dasharray 一致
const RESUME_WINDOW = 500 // 松开后允许续按的窗口（ms）

export function createHoldButton({
  el,
  duration = 2.5,
  onProgress = null,
  onComplete = null,
  onCancel = null,
}) {
  const hitEl = el.querySelector('.hold-hit')
  // 进度弧（.hold-ring-progress）；底环 .hold-ring-base 是常驻引导环，不动它
  const ringEl = el.querySelector('.hold-ring-progress')
  const labelEl = el.querySelector('.hold-label')

  // 键盘/读屏可达：按钮语义 + 焦点 + 完成播报（.hold-hit 是 div，默认可达性为零）
  if (hitEl) {
    hitEl.setAttribute('role', 'button')
    hitEl.setAttribute('tabindex', '0')
    hitEl.setAttribute('aria-label', '按住启动 /insights 演示')
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
    hitEl.removeEventListener('keydown', onKeyDown)
    hitEl.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', onWindowBlur)
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

  // 续接窗口超时：进度直接归零并触发一次 onCancel
  const cancelNow = () => {
    if (settled) return
    cancelTimer = null
    progress = 0
    setRing(0)
    if (onCancel) onCancel()
  }

  // 每帧按按下以来经过的时间推进进度；达标即完成
  const tick = (now) => {
    rafId = null
    progress = Math.min(1, Math.max(0, (now - downTime) / (duration * 1000)))
    setRing(progress)
    if (onProgress) onProgress(progress)
    if (progress >= 1) {
      finishComplete()
      return
    }
    rafId = requestAnimationFrame(tick)
  }

  // 按住开始（pointer 与键盘共用）：记录指针 id、续接、启动推进循环
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

  // 键盘可达：Space/Enter 按住推进、松开停止（与 pointer 同一套逻辑）
  const onKeyDown = (e) => {
    if (e.key !== ' ' && e.key !== 'Enter') return
    if (e.repeat) return
    e.preventDefault()
    if (activePointerId !== null && activePointerId !== 'keyboard') return // 指针按住中忽略键盘，避免误按干扰
    startHold('keyboard')
  }

  const onKeyUp = (e) => {
    if (e.key !== ' ' && e.key !== 'Enter') return
    e.preventDefault()
    if (activePointerId !== 'keyboard') return // 只终止键盘按住（指针按住不受键盘 keyup 影响）
    stopHold()
  }

  // 失焦兜底：键盘按住中窗口失焦 → keyup 丢失，进度可能走满自动完成；
  // blur 时停止推进（500ms 续接窗口内回来再按可续接）
  const onWindowBlur = () => {
    if (activePointerId === 'keyboard') stopHold()
  }

  hitEl.addEventListener('pointerdown', onPointerDown)
  hitEl.addEventListener('lostpointercapture', onLostCapture)
  hitEl.addEventListener('keydown', onKeyDown)
  hitEl.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onWindowBlur)
  document.addEventListener('pointerup', onPointerUp)
  document.addEventListener('pointercancel', onPointerCancel)

  return {
    // 更新按钮文字（如"按住别松手"→"运行中…"）
    setLabel(text) {
      labelEl.textContent = text
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

// M0 最小时间轴：状态机只有「当前段」+ goTo 切换，段间无自动过渡
// 后续 M1 会在不破坏本接口的前提下扩展 scrollVh / autoScroll（滚动预算 + 自动过渡）

/**
 * 创建时间轴实例
 * @param {Object} [opts]
 * @param {Array<{id: string}>} [opts.segments] 段列表（M0 只含 'prologue' 与 'stage1'）
 * @param {(id: string, ctx: {goTo: Function}) => void} [opts.onEnter] 进入某段时回调
 * @param {(id: string, ctx: {goTo: Function}) => void} [opts.onLeave] 离开某段时回调
 * @returns {{goTo: Function, current: string|null}}
 */
export function createTimeline({ segments = [], onEnter = null, onLeave = null } = {}) {
  // 当前段 id，初始为首段；无段时恒为 null
  let current = segments[0]?.id ?? null

  // 场景回调的操作入口：onEnter / onLeave 里可据此再跳段（ctx.goTo）
  const ctx = { goTo }

  function goTo(id) {
    // 段列表为空：直接无操作（current 恒为 null）
    if (segments.length === 0) return
    // 与当前段相同：忽略，避免重复进入
    if (id === current) return
    // 未知 id：告警并忽略（容错，不抛异常）
    if (!segments.some((s) => s.id === id)) {
      console.warn(`[timeline] 未知段 id：${id}`)
      return
    }
    // 先通知离开旧段，再切换，最后通知进入新段
    onLeave?.(current, ctx)
    current = id
    onEnter?.(id, ctx)
  }

  return {
    goTo,
    get current() {
      return current
    },
  }
}

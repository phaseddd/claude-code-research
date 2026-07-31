// timeline.js —— MasterTimeline：多段虚拟时间轴内核（M1）
//
// 段（segment）自包含生命周期（形态对齐零大学官方工程文章，
// Codrops 2026-07-17《ZERO: The Engineering Behind a Defiant Interactive Narrative》）：
//   enter(ctx)     进入段：构建场景 / 挂载资源（M1 骨架为同步实现，接口允许异步）
//   scrub(ctx, p)  段内进度 0~1（由滚动实际位置 current 驱动，每帧调用）
//   update(ctx, t, dt) 每帧 idle 动画（时间驱动）
//   teardown(ctx)  离开段：释放资源
//
// 段属性：
//   id / scrollVh（虚拟滚动预算，vh 单位）/ autoScroll（自动过渡段，如 gate）/
//   duration（autoScroll 时长，秒）/ deferPrev（进入本段时推迟上一段的 teardown，
//   由本段通过 ctx.teardownOld() 显式执行 —— 对应零站点的 deferPreviousTeardown）
//
// 滚动与分段解耦：
//   target（用户意图 / gate 自动推进）驱动"段切换"——滚到段末立即进入下一段；
//   current（lerp 平滑后的实际位置）驱动"段内 scrub"——视觉连续，不跳变。
//   两者分离后，滚到底不会因 lerp 渐近不达而卡在旧段。
//
// ctx 原语（段回调可调用）：
//   skipTo(id) / advance()（推到下一段起点，M2 TAP HOLD 用）/
//   fadeScene(v)（注入的 #scene 透明度控制，黑场三段式）/ teardownOld()（执行推迟的旧段 teardown）/
//   preEnterNext()（预挂载下一段场景，幂等；gate 淡入前调用）

const easeInOutSine = (x) => -(Math.cos(Math.PI * x) - 1) / 2
const clamp = (v, min, max) => Math.min(max, Math.max(min, v))

/**
 * 创建时间轴实例。
 * @param {Object} [opts]
 * @param {Array<Object>} [opts.segments] 段列表（id / scrollVh / autoScroll / duration / deferPrev + 生命周期）
 * @param {Object} [opts.scroll] createScroll 实例（setTarget / snapTo / current）
 * @param {(v: number) => void} [opts.fadeScene] #scene 透明度注入（gate 黑场三段式用）
 * @returns {{skipTo: Function, dispose: Function, current: string|null}}
 */
export function createTimeline({ segments = [], scroll = null, fadeScene = null } = {}) {
  // ---------- 预算解析：每段换算成 [start, end) 的 vh 区间 ----------
  const segs = segments.map((s, i) => ({
    ...s,
    start: segments.slice(0, i).reduce((a, b) => a + b.scrollVh, 0),
    end: segments.slice(0, i + 1).reduce((a, b) => a + b.scrollVh, 0),
  }))

  let active = null // 当前激活段（由 target 驱动）
  let pending = null // deferPrev 推迟 teardown 的旧段（由 gate 的 ctx.teardownOld() 执行）
  let preEnteredSeg = null // 已被 gate 预挂载的段（进入时不重复 enter）
  let elapsed = 0 // 当前段内累计时间（autoScroll 推进用）
  let t = 0 // 时间轴累计时间（update 的 t）

  const activeIndex = () => (active ? segs.indexOf(active) : -1)

  // v 落在哪段：逐段找第一个 end > v 的段；越界（=total）取最后一段
  const locate = (v) => {
    for (let i = 0; i < segs.length; i++) {
      if (v < segs[i].end) return segs[i]
    }
    return segs[segs.length - 1]
  }

  // ---------- 段切换 ----------
  function enterSegment(next) {
    if (next === active || !next) return
    if (pending) {
      pending.teardown?.(ctx)
      pending = null
    }
    // 预挂过但没去成的段（反滚跳过了 gate 末）：卸掉，避免场景泄漏
    if (preEnteredSeg && preEnteredSeg !== next) {
      preEnteredSeg.teardown?.(ctx)
    }
    if (active) {
      if (next.deferPrev) pending = active // 旧段 teardown 推迟给 gate 显式执行
      else active.teardown?.(ctx)
    }
    const alreadyEntered = preEnteredSeg === next
    preEnteredSeg = null
    active = next
    elapsed = 0
    if (!alreadyEntered) next.enter?.(ctx) // gate 预挂过的段不重复构建
  }

  // ---------- ctx：段回调的操作入口 ----------
  const ctx = {
    skipTo,
    advance() {
      // 推到下一段起点（M2 TAP HOLD 完成时用；M1 站间连续滚动暂不调用）
      const next = segs[activeIndex() + 1]
      if (next && scroll) scroll.snapTo(next.start)
    },
    fadeScene,
    teardownOld() {
      // 幂等：gate 黑场中途卸下旧场景
      if (pending) {
        pending.teardown?.(ctx)
        pending = null
      }
    },
    preEnterNext() {
      // 幂等：gate 淡入前预挂下一段场景；目标段已是激活段则跳过
      if (preEnteredSeg) return
      const next = segs[activeIndex() + 1]
      if (next && next !== active) {
        next.enter?.(ctx)
        preEnteredSeg = next
      }
    },
  }

  // ---------- 每帧：段切换（target）→ 自动推进（gate）→ 段内驱动（current） ----------
  function onFrame(current, target, dt) {
    t += dt

    const targetSeg = locate(target)
    if (targetSeg !== active) enterSegment(targetSeg)

    // gate 自动过渡：把 target 按时间缓动推向段末；用户 wheel 可加速（max 叠加），不可减速
    if (active?.autoScroll) {
      elapsed += dt
      const p = clamp(elapsed / (active.duration ?? 3.5), 0, 1)
      scroll.setTarget(Math.max(target, active.start + easeInOutSine(p) * active.scrollVh))
    }

    // 段内 scrub 由实际位置 current 驱动（视觉连续）；update 每帧喂时间
    const curSeg = locate(current)
    if (curSeg?.scrollVh) {
      curSeg.scrub?.(ctx, clamp((current - curSeg.start) / curSeg.scrollVh, 0, 1))
    }
    active?.update?.(ctx, t, dt)
  }

  // ---------- 任意跳转：瞬移 + 强制挂载目标段 ----------
  function skipTo(id) {
    const seg = segs.find((s) => s.id === id)
    if (!seg) {
      console.warn(`[timeline] 未知段 id：${id}`)
      return
    }
    if (pending) {
      pending.teardown?.(ctx)
      pending = null
    }
    // 目标就是当前段（如创建后立刻落位首段）：只需复位位置，不重复构建
    if (seg === active) {
      scroll?.snapTo(seg.start)
      seg.scrub?.(ctx, 0)
      return
    }
    if (preEnteredSeg && preEnteredSeg !== seg) {
      preEnteredSeg.teardown?.(ctx)
    }
    if (active) active.teardown?.(ctx)
    const alreadyEntered = preEnteredSeg === seg
    preEnteredSeg = null
    scroll?.snapTo(seg.start)
    active = seg
    elapsed = 0
    if (!alreadyEntered) seg.enter?.(ctx)
    seg.scrub?.(ctx, 0)
  }

  // 初始：激活首段（首段 enter 由调用方 skipTo 或首帧 locate 触发；首帧即触发）
  if (segs.length > 0 && !active) active = segs[0]
  if (scroll) scroll.snapTo(active?.start ?? 0)
  active?.enter?.(ctx)

  return {
    skipTo,
    dispose() {
      if (pending) {
        pending.teardown?.(ctx)
        pending = null
      }
      if (preEnteredSeg) {
        preEnteredSeg.teardown?.(ctx)
        preEnteredSeg = null
      }
      if (active) {
        active.teardown?.(ctx)
        active = null
      }
    },
    get current() {
      return active?.id ?? null
    },
    // 每帧入口：由 scroll 的 onFrame 注入（main.js 装配）
    onFrame,
  }
}

// timeline.js —— MasterTimeline：多段虚拟时间轴内核（M1）
//
// 段（segment）自包含生命周期（形态对齐零大学官方工程文章，
// Codrops 2026-07-17《ZERO: The Engineering Behind a Defiant Interactive Narrative》）：
//   enter(ctx)     进入段：构建场景 / 挂载资源（M1~M2 同步实现；
//                  异步构建（纹理加载等）待 M3 真实场景接入时在调用处接 Promise）
//   scrub(ctx, p)  段内进度 0~1（由滚动实际位置 current 驱动，每帧调用）
//   update(ctx, t, dt) 每帧渲染 / idle 动画（时间驱动；场景不自持 rAF，单循环驱动）
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
// gate 黑场编舞的进度源是时间而非位置（2026-08-05 修复，PLAN §4.1）：
//   autoScroll 段由 elapsed/duration 驱动 scrub 与透明度三段式（0~0.35 旧场景淡出
//   → 0.35 卸旧 → 0.65 预挂新场景 → 0.65~1 淡入）。原实现由 current 驱动 scrub，
//   而段切换由 target 驱动 —— wheel 硬切把 target 推过 gate 末时 active 立即切走，
//   gate.teardown 瞬间归 1、下一帧 curSeg 仍写回淡出中间值 → 亮度抖动；
//   且 lerp 渐近不达让 current 永远停在淡入中间值 → 画面"卡半透明"。
//   修复三件套：
//     1. 时间驱动：gate.scrub 的 p 由 elapsed 决定（与 autoScroll 推进同源），
//        转场进行中状态唯一确定，与 target/current 打架无关
//     2. 转场接续：active 切走未走完的 autoScroll 段时，透明度从当前值线性
//        接续到 1（fadeTween），不瞬间归 1 也不中途卡死（skipTo 显式跳转除外）
//     3. 影子值：所有 fadeScene 写入经 setSceneOpacity 记录 sceneOpacity，
//        接续补间的起点与"是否已走完"判断都以此为准
//
// 单 rAF 驱动（scroll 的 tick 是唯一循环）：每帧把时间喂给
//   {视觉段 curSeg ∪ 逻辑段 active ∪ 预挂段 preEnteredSeg} 的 update ——
//   动画时间源唯一（本时间轴的 t），预挂段在 gate 淡入前就开始渲染（黑场转场期间画面在动）。
//
// ctx 原语（段回调可调用）：
//   skipTo(id) / advance()（推到下一段起点，M2 TAP HOLD 用）/
//   fadeScene(v)（注入的 #scene 透明度控制，黑场三段式；写入记录影子值）/
//   teardownOld()（执行推迟的旧段 teardown）/ preEnterNext()（预挂载下一段场景，幂等）

const easeInOutSine = (x) => -(Math.cos(Math.PI * x) - 1) / 2
const clamp = (v, min, max) => Math.min(max, Math.max(min, v))
const REVERSE_LOCK_FRAMES = 30 // 反向意图锁存帧数（≈0.5s @60fps）：检测到反滚后保持释放钳制

/**
 * 创建时间轴实例。
 * @param {Object} [opts]
 * @param {Array<Object>} [opts.segments] 段列表（id / scrollVh / autoScroll / duration / deferPrev + 生命周期）
 * @param {Object} [opts.scroll] createScroll 实例（setTarget / snapTo / current）
 * @param {(v: number) => void} [opts.fadeScene] #scene 透明度注入（gate 黑场三段式用）
 * @param {(prev: Object|null, next: Object) => void} [opts.onSegmentChange] 段切换回调（HUD 联动）
 * @returns {{skipTo: Function, dispose: Function, current: string|null}}
 */
export function createTimeline({ segments = [], scroll = null, fadeScene = null, onSegmentChange = null } = {}) {
  // ---------- 预算解析：每段换算成 [start, end) 的 vh 区间 ----------
  // n=5 量级，slice+reduce 的 O(n²) 可忽略（不做预累计缓存）
  const segs = segments.map((s, i) => ({
    ...s,
    start: segments.slice(0, i).reduce((a, b) => a + b.scrollVh, 0),
    end: segments.slice(0, i + 1).reduce((a, b) => a + b.scrollVh, 0),
  }))

  let active = null // 当前激活段（由 target 驱动）
  let pending = null // deferPrev 推迟 teardown 的旧段（由 gate 的 ctx.teardownOld() 执行）
  let preEnteredSeg = null // 已被 gate 预挂载的段（进入时不重复 enter）
  let elapsed = 0 // 当前段内累计时间（autoScroll 推进用）
  let t = 0 // 时间轴累计时间（update 的 t，全时间轴唯一时钟）
  let sceneOpacity = 1 // #scene 透明度影子值（所有 fadeScene 写入经 setSceneOpacity 记录）
  let fadeTween = null // 转场接续补间：{from, to, t0, dur}，gate 被打断时 从当前值 → 1
  let lastTarget = -1 // autoScroll 段的上一帧 target（帧间差分检测反滚意图；-1 首帧不误判）
  let reverseLock = 0 // 反向意图锁存帧数：差分检测到下降后保持释放钳制 N 帧
  //（低滚速用户 bump 之间 target 静止的帧会被钳制拉回——锁存让"持续反滚"保持释放；
  // 停手 N 帧后自动恢复钳制，gate 继续推进。N=30 ≈ 0.5s @60fps）

  const activeIndex = () => (active ? segs.indexOf(active) : -1)

  // v 落在哪段：逐段找第一个 end > v 的段；越界（=total）取最后一段
  const locate = (v) => {
    for (let i = 0; i < segs.length; i++) {
      if (v < segs[i].end) return segs[i]
    }
    return segs[segs.length - 1]
  }

  // ---------- 段切换统一编舞（滚动切换与 skipTo 共用） ----------
  // force 差异显式化：滚动切换尊重 next.deferPrev（旧段 teardown 推迟给 gate 黑场
  // 显式执行）；skipTo 无条件 teardown（直接跳转，不等转场）
  function switchTo(next, { force = false } = {}) {
    if (!next || next === active) return
    // 重置反向意图锁存：lastTarget/reverseLock 只在 autoScroll 分支更新，
    // 反滚逃生后残留会让下次 gate 重入误武装 30 帧钳制释放 → 0.5s 停滞+前冲
    // （2026-08-05 F2）
    lastTarget = -1
    reverseLock = 0
    const prev = active
    // 0. 转场接续：切走未走完的 autoScroll 段（wheel 硬切 / 反向穿越）时，
    //    透明度从当前值线性补间到 1 —— 黑场中途不停车、不跳变。
    //    force（skipTo 显式跳转）语义是"直接呈现"，瞬间归 1
    const leavingAuto = prev?.autoScroll && prev !== next
    if (leavingAuto) {
      if (!force && sceneOpacity < 0.999) {
        // 接续时长按淡入段速率（0.35 比例段内 0→1）折算剩余进度
        fadeTo(1, (1 - sceneOpacity) * (prev.duration ?? 3.5) * 0.35)
      } else {
        setSceneOpacity(1)
      }
    }
    // 1. 先卸掉已推迟的旧段（pending）与预挂过但没去成的段（反滚跳过了 gate 末），
    //    避免场景泄漏
    if (pending) {
      pending.teardown?.(ctx)
      pending = null
    }
    if (preEnteredSeg && preEnteredSeg !== next) {
      preEnteredSeg.teardown?.(ctx)
    }
    // 2. 旧段（gate.teardown 不再写回透明度：归 1 统一由上方接续 / 兜底接管，
    //    否则与接续补间互相覆盖 → 抖动）
    if (active) {
      if (!force && next.deferPrev) pending = active
      else active.teardown?.(ctx)
    }
    // 3. gate 预挂过的段不重复构建
    const alreadyEntered = preEnteredSeg === next
    preEnteredSeg = null
    active = next
    elapsed = 0
    if (!alreadyEntered) next.enter?.(ctx)
    onSegmentChange?.(prev, active) // HUD 联动（滚动切换与 skipTo 都走这里）
  }

  // ---------- ctx：段回调的操作入口 ----------
  // fadeScene 写入统一经 setSceneOpacity 记录影子值（接续补间取起点）
  const setSceneOpacity = (v) => {
    sceneOpacity = v
    fadeScene?.(v)
  }
  // 启动接续补间：从当前影子值线性推进到 to（时长 dur 秒，时间轴时钟驱动）
  const fadeTo = (to, dur) => {
    fadeTween = { from: sceneOpacity, to, t0: t, dur }
  }

  const ctx = {
    skipTo,
    advance() {
      // 推到下一段起点（M2 TAP HOLD 完成时用；M1 站间连续滚动暂不调用）
      const next = segs[activeIndex() + 1]
      if (next && scroll) scroll.snapTo(next.start)
    },
    fadeScene: setSceneOpacity,
    teardownOld() {
      // 幂等：gate 黑场中途卸下旧场景
      if (pending) {
        pending.teardown?.(ctx)
        pending = null
      }
    },
    preEnterNext() {
      // 幂等：gate 淡入前预挂下一段场景；目标段已是激活段则跳过。
      // 反向穿越守卫：next === pending（被 deferPrev 推迟的上一段）时不预挂——
      // 它仍挂载在 DOM，二次 enter 会创建重复实例（skel 覆盖 → 旧实例孤儿泄漏、
      // teardown 误杀新实例 → 该幕空白）
      if (preEnteredSeg) return
      const next = segs[activeIndex() + 1]
      if (next && next !== active && next !== pending) {
        next.enter?.(ctx)
        preEnteredSeg = next
      }
    },
  }

  // ---------- 每帧：段切换（target）→ 自动推进（gate，时间驱动）→ 段内驱动（current） ----------
  function onFrame(current, target, dt) {
    t += dt

    const targetSeg = locate(target)
    if (targetSeg !== active) switchTo(targetSeg)

    // gate 自动过渡：把 target 按时间缓动推向段末；用户 wheel 可加速（max 叠加），
    // 不可减速（电影式转场，滚过头需滚回上一段再进；记入 PLAN §4 决策记录）。
    // 黑场三段式由同一时间进度驱动（见文件头注释，修复 §4.1 gate 抖动）：
    // 进入本分支即接管透明度编舞，先取消遗留的接续补间（防双写）
    if (active?.autoScroll) {
      fadeTween = null
      elapsed += dt
      const p = clamp(elapsed / (active.duration ?? 3.5), 0, 1)
      const forward = active.start + easeInOutSine(p) * active.scrollVh
      // 反向意图检测（帧间差分 + 锁存）：target 比上一帧下降 = 用户正在反滚 →
      // 释放下限钳制（不 setTarget），target 自由穿出 gate 回到前一段。修复
      // 2026-08-05（PLAN §4）：原实现每帧 setTarget(max(target, forward)) 是单方向
      // 棘轮——反滚每帧被擦除，locate 永不落回前一段、gate 反复重启（elapsed 重置），
      // PLAN"滚过头需滚回上一段再进"的逃生口被同一条钳制封死（Workflow 3 agent
      // 交叉复核 + 帧日志实测：普通滚轮 8~60vh/s 远低于逃逸阈值 ~135vh/s 永久困死；
      // 且 gate 走满后 target 钉死 gate.end，反滚 [entry, end] 区间全被弹回）。
      // 锁存必要性：仅差分（下降帧释放）时，低滚速用户 bump 之间 target 静止的帧
      // 走钳制分支，forward 涨过静止 target 后拉回 → 仍穿不出（实测 slow-rev35 困死）；
      // 锁存让"持续反滚"（每格刷新）全程释放，停手 0.5s 后自动恢复钳制。
      // 判据演进：曾用 target < forward（推进反超）——正向停住也成立 → 误伤正向
      // 路径（gate 停摆不自动走完，实测 fwd8-wait）；差分+锁存只在"用户主动反滚"
      // 时成立，正向停手 → 无下降 → 无锁存 → 钳制 → gate 正常走完（电影式转场语义
      // 保留，无黑洞）。黑场编舞照常时间驱动：旧幕淡出→黑场；穿出 gate 由 switchTo
      // 的 leavingAuto 接续补间把新幕从黑场淡入（无白屏）。
      if (target < lastTarget) reverseLock = REVERSE_LOCK_FRAMES
      else if (reverseLock > 0) reverseLock--
      if (reverseLock > 0) {
        active.scrub?.(ctx, p)
      } else {
        scroll.setTarget(Math.max(target, forward))
        active.scrub?.(ctx, p)
      }
      lastTarget = target
    }

    // 转场接续补间推进（gate 被打断后 从当前透明度 → 1，线性同速）
    if (fadeTween) {
      const k = clamp((t - fadeTween.t0) / fadeTween.dur, 0, 1)
      setSceneOpacity(fadeTween.from + (fadeTween.to - fadeTween.from) * k)
      if (k >= 1) fadeTween = null
    }

    // 段内 scrub 由实际位置 current 驱动（视觉连续）；
    // autoScroll 段已由上方时间驱动，跳过防止双写
    const curSeg = locate(current)
    if (curSeg?.scrollVh && !curSeg.autoScroll) {
      curSeg.scrub?.(ctx, clamp((current - curSeg.start) / curSeg.scrollVh, 0, 1))
    }
    // 注：M1 的"视觉段离开 gate 兜底归 1"已删除（2026-08-05）——时间驱动重构后
    // opacity 归 1 各有责任方（gate 自然走完末帧写 1 / 硬切由接续补间 / skipTo 由
    // force 分支），不再有残留中间值；原兜底反而会在正向硬切时误杀接续补间（0.26
    // → 瞬间 1 的抖动，实测复现）。

    // 渲染 / 动画驱动：视觉段 ∪ 逻辑段 ∪ 预挂段（去重后各调一次 update）
    // 场景不自持 rAF，时间源唯一；反滚跨段过渡期旧段画面不冻结
    const driving = new Set([curSeg, active, preEnteredSeg].filter(Boolean))
    for (const seg of driving) seg.update?.(ctx, t, dt)
  }

  // ---------- 任意跳转：瞬移 + 强制挂载目标段 ----------
  function skipTo(id) {
    const seg = segs.find((s) => s.id === id)
    if (!seg) {
      console.warn(`[timeline] 未知段 id：${id}`)
      return
    }
    // 目标就是当前段（如创建后立刻落位首段）：只需复位位置，不重复构建
    if (seg === active) {
      scroll?.snapTo(seg.start)
      seg.scrub?.(ctx, 0)
      // 仍广播一次（prev === next）：HUD 等订阅方依赖此信号完成初始状态
      onSegmentChange?.(seg, seg)
      return
    }
    switchTo(seg, { force: true })
    scroll?.snapTo(seg.start)
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

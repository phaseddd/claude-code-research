// hud.js —— 引擎 HUD 覆盖层（M2）
// 底部流水线轨道：8 节点（对应八站，字即图形 = 序号字符 + 几何，不引图标库）
// + 站标题 + 数字滚动反馈（站间推进的即时反馈）。
//
// 契约：
//   createHud({ uiEl, onSelect, onRestart }) → { setSeg, dispose }
//   - uiEl       DOM 层容器（#ui，pointer-events: none，由 main.js 创建）
//   - onSelect   节点点击回调（main.js 接 timeline.skipTo）
//   - onRestart  常驻「回到序章」点击回调（main.js 接 backToPrologue；全站逃生口）
//   - setSeg(segId, prevId)  段切换联动：站/幕段更新节点/标题/数字滚动
//                            （M3 站级:第一幕 s1→s2→s3 节点逐个点亮）；
//                            gate 段进入过渡态（标题 旧站/幕 → 新站/幕 + 轨道扫光）
//   - dispose()  移除 DOM、杀数字滚动补间、撤节点/回到序章监听
//
// 节点语义（状态机由 paintNodes 驱动 class）：
//   is-done 已完成幕的节点（青色实心 + 光晕）→ 数据已流过
//   is-cur  当前幕起点（白亮 + 脉冲放大）→ 正在发生
//   is-in   当前幕其余节点（半亮）→ 幕内即将展开
//   无 class = 未来幕（暗色描边）→ 尚未到达
//
// 数字滚动：当前数字 = 当前站/幕起始站号（M3 站级:s1→1 / s2→2 / s3→3；
// 第二/三幕幕级:act2→4 / act3→6），站间推进时 gsap 补间滚动（power2.out），
// 是"站间推进有即时反馈"的计量层。

import gsap from 'gsap'

// 幕标题单一来源（main.js 的 act-skeleton 标题也引用这里，改措辞只动一处）
export const ACT_TITLES = { act2: '第二幕 · 理解', act3: '第三幕 · 生成' }

// 段 → 轨道区间映射（M3 站级化，简报 §6.4）：
//   第一幕细化为站级 s1/s2/s3（数字 1→2→3 滚动、节点逐个点亮，prevDone 驱动
//   已完成态）；第二/三幕保持幕级（骨架，act2 → 节点 4、act3 → 节点 6，不动）。
// prevDone = 进入本段前已完成的节点数（is-done 判定）；act = 所属幕
// （第一幕三站同属 act1 —— 幕色微染不变，站间不换色，保持「幕」的色块感，简报 §6.4）。
// 站名锚定 PLAN.md §2.2 三幕八站措辞；随幕微染由 data-act（CSS 侧 --hud-accent）驱动
const STOPS = [
  { seg: 's1', nodes: [1], prevDone: 0, act: 'act1', short: '命令命中' },
  { seg: 's2', nodes: [2], prevDone: 1, act: 'act1', short: '扫盘' },
  { seg: 's3', nodes: [3], prevDone: 2, act: 'act1', short: '缓存分流' },
  { seg: 'act2', nodes: [4, 5], prevDone: 3, act: 'act2', short: ACT_TITLES.act2 },
  { seg: 'act3', nodes: [6, 7, 8], prevDone: 5, act: 'act3', short: ACT_TITLES.act3 },
]
// gate → 夹住它的两段（正向入口 / 出口）：gate 标题按穿越方向显示
// （正向"第二幕 → 第三幕"，反向"第三幕 → 第二幕"）——
// 方向感知取代原 prev.next 拼接（反穿显示错误方向甚至 "→ null"，2026-08-05 实测）
const GATE_DIR = {
  g1: ['s1', 's2'], // 幕内轻量 gate（同幕色，简报 §6.1）
  g2: ['s2', 's3'],
  gate1to2: ['s3', 'act2'],
  gate2to3: ['act2', 'act3'],
}
const STATION_NAMES = [
  '命令命中',
  '扫盘',
  '缓存分流',
  '过滤与投影',
  '打标签',
  '七章并行',
  '总览合成',
  '落盘交付',
]
const TOTAL = STATION_NAMES.length

export function createHud({ uiEl, onSelect = null, onRestart = null } = {}) {
  // ---------- 1. 创建 DOM（类名契约与 style.css 一致） ----------
  // 节点按钮：序号字符本身作图形（字即图形）；--i 供入场 stagger 的 animation-delay
  const nodesHtml = STATION_NAMES.map(
    (name, i) =>
      `<button class="hud-node" type="button" data-node="${i + 1}" data-title="${i + 1} · ${name}" aria-label="跳转到第 ${i + 1} 站 ${name}" style="--i:${i}">${i + 1}</button>`
  ).join('')

  const root = document.createElement('div')
  root.className = 'hud hud-enter'
  root.setAttribute('aria-label', '报告引擎流水线进度')
  root.innerHTML = `
    <div class="hud-bar">
      <div class="hud-title" aria-live="polite">第一幕 · 数据</div>
      <div class="hud-track" role="navigation" aria-label="八站流水线轨道">
        <div class="hud-rail" aria-hidden="true">
          <div class="hud-rail-fill"></div>
          <div class="hud-flow"></div>
        </div>
        ${nodesHtml}
      </div>
      <div class="hud-counter" aria-hidden="true">
        <span class="hud-num">1</span><span class="hud-total"> / ${TOTAL}</span>
      </div>
      <!-- 常驻「回到序章」（U5）：hud-bar 右缘的小链接，全站（S1→S8）一致，
           取代 S1 终端内独享的「重新体验」（.s1-restart 将由 U2 移除，
           过渡期内两者并存，本单元不改 s1.js）。← 是排版字符，字即图形 -->
      <button class="hud-restart" type="button" aria-label="回到序章">← 回到序章</button>
    </div>
  `
  uiEl.appendChild(root)

  // ---------- 2. 引用与状态 ----------
  const titleEl = root.querySelector('.hud-title')
  const fillEl = root.querySelector('.hud-rail-fill')
  const numEl = root.querySelector('.hud-num')
  const nodeEls = [...root.querySelectorAll('.hud-node')]
  // tooltip 边缘修正：首尾节点居中 tooltip 会溢出屏幕，向内侧平移
  nodeEls[0]?.style.setProperty('--shift', '30px')
  nodeEls[nodeEls.length - 1]?.style.setProperty('--shift', '-30px')
  let numTween = null // 数字滚动补间（dispose 时释放）

  // 数字滚动：当前站号从旧值滚到新值（act1→act2：1 → 4）。
  // 时长 1.2s：0.55s/0.9s 太快，30fps 按秒抽帧抓不到中间值（grok 复验仍报
  // "端点跳变"）；1.2s 后中间帧窗口 ~0.5s，肉眼与抽帧都能读到滚动过程
  const rollTo = (n) => {
    // 先杀在飞补间再读当前值：补间途中显示值恰为新目标时提前 return 会让旧补间
    // 滚完停错值（2026-08-05 F1，快速跨幕连点时数字与幕错位）
    numTween?.kill()
    const cur = parseInt(numEl.textContent, 10) || 1
    if (cur === n) return
    const obj = { v: cur }
    numTween = gsap.to(obj, {
      v: n,
      duration: 1.2,
      ease: 'power3.out',
      onUpdate: () => {
        numEl.textContent = String(Math.round(obj.v))
      },
      onComplete: () => {
        numEl.textContent = String(n)
        numTween = null
      },
    })
  }

  // 节点状态机：paintNodes(stop) 按当前段重绘 8 个节点 class。
  // 站级化（简报 §6.4）：is-done 由 prevDone 驱动 —— 第一幕内节点逐个点亮
  // （s2 时节点 1 已 done、2 为 cur、3 待展开），而非整幕一次性标完
  const paintNodes = (stop) => {
    nodeEls.forEach((el, i) => {
      const n = i + 1
      const isCurStart = n === stop.nodes[0]
      const isInCur = n <= stop.nodes[stop.nodes.length - 1] && n > stop.nodes[0]
      el.classList.toggle('is-done', n <= stop.prevDone)
      el.classList.toggle('is-cur', isCurStart)
      el.classList.toggle('is-in', isInCur && !isCurStart)
    })
    // 已完成部分的轨道填充：到当前段起点节点中心（节点中心 = (n-0.5)/8）
    fillEl.style.width = `${((stop.nodes[0] - 0.5) / TOTAL) * 100}%`
  }

  // ---------- 3. 交互：节点点击跳转（轨道导航，PLAN §4 决策"直接跳转"） ----------
  const onNodeClick = (e) => {
    const n = parseInt(e.currentTarget.dataset.node, 10)
    const stop = STOPS.find((s) => s.nodes.includes(n))
    if (stop) onSelect?.(stop.seg) // main.js 接 timeline.skipTo(segId)
  }
  nodeEls.forEach((el) => el.addEventListener('click', onNodeClick))

  // 「回到序章」：全站常驻逃生口（U5）。回调 = main.js 的 backToPrologue
  // （销毁时间轴/HUD/渲染器 → 重建序章），与节点导航同走 click，无额外状态
  const restartEl = root.querySelector('.hud-restart')
  const onRestartClick = () => onRestart?.()
  restartEl.addEventListener('click', onRestartClick)

  // 入场动画收尾：全部节点 stagger 完成后移除 .hud-enter。
  // 若不移除，`.hud-enter .hud-node`（0,2,0，文件末尾后声明）会覆盖
  // `.hud-node.is-cur` 的 hud-pulse 动画（同特异性后声明胜）→ 脉冲从未生效
  // （grok 复验"脉冲克制"根因，2026-08-05 实测 animation-name 被入场动画占用）
  let animDone = 0
  const onNodeAnimEnd = () => {
    if (++animDone >= nodeEls.length) {
      root.classList.remove('hud-enter')
      nodeEls.forEach((el) => el.removeEventListener('animationend', onNodeAnimEnd))
    }
  }
  nodeEls.forEach((el) => el.addEventListener('animationend', onNodeAnimEnd))

  // ---------- 4. 对外契约：段切换联动 ----------
  return {
    /**
     * 段切换联动（timeline.onSegmentChange 接线）。
     * @param {string} segId 激活段 id（act1/2/3 或 gate1to2/gate2to3）
     * @param {string} [prevId] 上一激活段 id（gate 过渡态取旧幕标题用）
     */
    setSeg(segId, prevId = null) {
      const stop = STOPS.find((s) => s.seg === segId)
      if (stop) {
        // 幕段：节点点亮 / 标题 / 数字滚动 / 填充推进 + 随幕微染
        // （data-act 驱动 CSS 侧 --hud-accent，见 style.css；hex 直接 setProperty
        // 是不透明色，光晕过浓，2026-08-05 弃用）
        root.classList.remove('is-gating')
        // data-act 用 stop.act（站级）而非 seg：第一幕三站同属 act1，
        // 微染不换色（简报 §6.4 幕的色块感）
        root.dataset.act = stop.act
        titleEl.textContent = stop.short
        paintNodes(stop)
        rollTo(stop.nodes[0])
      } else if (prevId) {
        // gate 过渡段：标题显示 旧幕 → 新幕（青色 → 是排版符号非 emoji，
        // 见 PLAN §2.4 措辞规范第 6 条），轨道扫光表示流水线在运转。
        // 方向感知：prevId 是 gate 前的 active——等于 GATE_DIR 首元素 = 正向
        // （从出口前的一幕进入），等于次元素 = 反向（从出口后的一幕退回）。
        // 注意用 innerHTML：hud-arrow 是 <i> 装饰元素，textContent 会把标签
        // 原文打到屏幕上（grok 实测抓到的泄漏 bug 2026-08-05）；
        // 内容全部来自上方 STOPS 常量（代码内定义），无注入面
        const pair = GATE_DIR[segId]
        const a = STOPS.find((s) => s.seg === pair?.[0])
        const b = STOPS.find((s) => s.seg === pair?.[1])
        if (a && b) {
          // 方向判定：prevId 等于 pair[0]（从入口前一段正向进入）= 正向；
          // prevId 等于 pair[1]（从出口后一段反穿回来）= 反向；
          // 其余（快速滚动 target 一次跨多段，prev 不在本 gate 的 pair 内，如
          // S3 直接跳 gate2to3）按正向兜底 —— 原逻辑把这种情况误判成反向，
          // 显示 "第三幕 → 第二幕" 的错误方向（2026-08-05 实测）
          const forward = prevId === pair[0] || !pair.includes(prevId)
          const from = forward ? a : b
          const to = forward ? b : a
          root.classList.add('is-gating')
          titleEl.innerHTML = `${from.short} <i class="hud-arrow">→</i> ${to.short}`
        }
      }
    },
    // 销毁：撤节点/回到序章监听、杀数字滚动补间、移除 DOM
    dispose() {
      nodeEls.forEach((el) => el.removeEventListener('click', onNodeClick))
      restartEl.removeEventListener('click', onRestartClick)
      numTween?.kill()
      root.remove()
    },
  }
}

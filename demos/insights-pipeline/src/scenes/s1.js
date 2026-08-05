// ============================================================
// scenes/s1.js —— 第一幕 S1「命令命中」终端风 UI(设计简报 §4 S1 + §3.5 锚点机制)
//
// 契约:
//   createS1({ scene, camera, uiEl, river, onRestart = null }) → { enter, scrub, update, dispose }
//     scene/camera/uiEl   三站共享的 3D 层与 DOM 层(由 main.js 装配,本站不建渲染器)
//     river               共享光河实例(简报 §6.1:main.js 在 s1 enter 时 createRiver,
//                         离开 S3 时 dispose —— 本站只用不建不毁)
//     onRestart           终端右上角「重新体验」点击回调(main.js 注入,回到序章)
//
// 生命周期对齐 timeline.js 段契约(§6.2):
//   enter()   定位共享相机 → 挂 DOM → 锚点逆投影 → 自动播放 4 拍入场节拍(简报 §4「入场节拍自动播放」)
//   scrub(p)  站内滚动进度 0~1:0.20~0.75 文案浮现(简报 §4 站内滚动编排)
//   update(t, dt) 每帧 river.update(渲染由 main.js 的 onScrollFrame 统一执行)
//   dispose() 释放本站资源(gsap 时间线 / DOM / 本站监听;river 与 renderer 归 main 管)
// ============================================================

import * as THREE from 'three'
import gsap from 'gsap'
import { SESSIONS } from '../data/sessions.js'
import { COLORS } from '../theme.js'

// ---------- 参数(简报 §4 S1 基线;偏离处见注释,§0.6「改了要能说出为什么」) ----------
const TARGET_Z = 12 // 源头深度:锚点射线沿视线走到 z=12(简报 §3.5)
const CAM_POS = new THREE.Vector3(0, 0.7, 18.5) // S1 相机几乎不动(简报 §3.5 简化策略)
const CAM_LOOK = new THREE.Vector3(0, -0.8, 10)
const TYPED_CMD = '/insights'
// 逐字非匀速:标点略慢、字母略快(简报 §4「28~42ms/字符」;确定性,不随机)
const CHAR_MS = { '/': 40, i: 28, n: 32, s: 32, g: 32, h: 32, t: 32 }
// 命中表行(合成,简报 §4 措辞诚实注记:不代表真实命令表内容;耗时数字为设计参考值)
const HITS = [
  { name: 'session:list', ms: '0.8ms' },
  { name: 'session:stats', ms: '1.1ms' },
  { name: 'cache:probe', ms: '0.4ms' },
]
const MATCH_TOTAL = SESSIONS.length // 12(MATCH 03/12 的分母)
// 拍4 河宽输入(简报 §4 拍4):命令链命中的会话信息量 = tokens / 1000。
// 任务规格钉死「s02+s03+s04 ≈ 54」;s02/s03/s04 恰为数据里最老三个 facet
// 分支会话(ageDays 12/9/8,排除元会话,数据驱动不硬编码)。
// 决策记录:若按纯 ageDays 排序,最老三实为 s04/s05/s03(=84,s05 是 meta
// 分支工程会话)——任务钉值优先,且 54 让 S1 源头与 S2 全量的河宽差更大
// (log1p 编码:1.21 vs 1.52,≥20%);改回真·最老三只需换排序键,一处。
const HIT_INFO = (() => {
  const facets = SESSIONS.filter((s) => !s.isMeta && s.branch === 'facet')
  const oldest = [...facets].sort((a, b) => b.ageDays - a.ageDays).slice(0, 3)
  return oldest.reduce((a, s) => a + s.tokens, 0) / 1000 // = 54
})()

// 字符光晕(简报 §4 终端细节):唯一亮色焦点用;EMBER 白 = 简报 §2.3 river.ember
const EMBER = '#E8F4FF'
const GLOW = '0 0 6px rgba(122,210,255,0.35), 0 0 14px rgba(74,168,255,0.15)'
const GLOW_HIT = '0 0 10px rgba(125,211,252,0.7), 0 0 22px rgba(74,168,255,0.35)'
const HIT_DIM = 'rgba(125, 211, 252, 0.45)' // hit 标记落定色(与 CSS .s1-row-hit 同)

export function createS1({ scene, camera, uiEl, river = null, onRestart = null } = {}) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const d = (x) => (reducedMotion ? 0 : x) // 简报 §5:reduce 下节拍直接呈现(gsap duration 0)

  let tl = null
  let root = null
  let termEl = null
  let copyBig = null
  let copySmall = null
  let copyNotes = null
  let built = false
  let disposed = false

  // ---------- DOM:终端面板(挂 #ui 层)+ 站内文案(文案逐字锚定简报 §4,不得改写) ----------
  function buildDom() {
    root = document.createElement('div')
    root.className = 's1-scene'
    root.innerHTML = `
      <div class="s1-terminal">
        <div class="s1-term-bar">
          <span class="s1-term-title">~/insights</span>
          <button class="s1-restart" type="button">重新体验</button>
        </div>
        <div class="s1-term-body">
          <div class="s1-prompt"><span class="s1-prompt-sign">&gt;</span> <span class="s1-typed"></span><span class="s1-cursor"></span></div>
          <div class="s1-match">
            <div class="s1-match-title">MATCH ${String(HITS.length).padStart(2, '0')}/${MATCH_TOTAL}</div>
            ${HITS.map(
              (h) => `
            <div class="s1-row">
              <span class="s1-row-name">· ${h.name}</span>
              <span class="s1-row-tail"><span class="s1-row-hit">—— hit ——</span><span class="s1-row-ms">${h.ms}</span></span>
            </div>`
            ).join('')}
          </div>
          <div class="s1-analyzing">analyzing your sessions…</div>
          <div class="s1-progress">
            <div class="s1-progress-bar"><div class="s1-progress-fill"></div></div>
            <span class="s1-progress-pct">62%</span>
          </div>
        </div>
        <div class="s1-scanline"></div>
      </div>
      <div class="s1-copy">
        <p class="s1-copy-big">/insights 是内置命令,不是模型现场想出来的。</p>
        <p class="s1-copy-small">它命中命令表,屏幕上出现进度提示:'analyzing your sessions'。真正干活的是报告引擎;当前对话的模型只负责最后递链接 —— 两个角色,各司其职。</p>
        <p class="s1-copy-notes">本演示使用合成示例数据<br>终端为演示的合成视觉 —— 引擎是纯代码流程,没有界面</p>
      </div>
    `
    uiEl.appendChild(root)
    termEl = root.querySelector('.s1-terminal')
    copyBig = root.querySelector('.s1-copy-big')
    copySmall = root.querySelector('.s1-copy-small')
    copyNotes = root.querySelector('.s1-copy-notes')

    // 「重新体验」:右上角小链接,点击回到序章(回调由 main.js 注入 onRestart)
    root.querySelector('.s1-restart').addEventListener('click', () => onRestart?.())
  }

  // ---------- DOM-3D 锚点(简报 §3.5):面板底部中心 → 屏幕坐标 → 逆投影 → 沿视线走到 z=12 ----------
  function anchor() {
    if (!termEl || !camera || !river) return
    const rect = termEl.getBoundingClientRect()
    const sx = rect.left + rect.width / 2
    const sy = rect.bottom
    const ndc = new THREE.Vector3(
      (sx / window.innerWidth) * 2 - 1,
      -(sy / window.innerHeight) * 2 + 1,
      0.5
    )
    ndc.unproject(camera)
    const dir = ndc.sub(camera.position).normalize()
    if (Math.abs(dir.z) < 1e-6) return
    const t = (TARGET_Z - camera.position.z) / dir.z
    river.setSource(camera.position.clone().addScaledVector(dir, t))
  }

  // ---------- 4 拍入场节拍(简报 §4;每拍 0.4~0.8s,错峰不齐步;第 1 拍 ≤0.4s) ----------
  function buildBeats() {
    const typedEl = root.querySelector('.s1-typed')
    const cursorEl = root.querySelector('.s1-cursor')
    const matchTitle = root.querySelector('.s1-match-title')
    const rows = [...root.querySelectorAll('.s1-row')]
    const analyzingEl = root.querySelector('.s1-analyzing')
    const fillEl = root.querySelector('.s1-progress-fill')
    const pctEl = root.querySelector('.s1-progress-pct')

    const beats = gsap.timeline({ defaults: { ease: 'power2.out' } })
    // 面板入场(fade ≤ 150ms,简报 §5「无长 fade」)
    beats.to(termEl, { opacity: 1, duration: d(0.12) }, 0)

    // ---- 拍1 输入:逐字回显(简报 §4 节奏注记:观众刚按过回车,首拍可快,不做仪式重复) ----
    let pos = 0
    const typeChar = () => {
      typedEl.textContent += TYPED_CMD[pos]
      if (pos === 0) {
        cursorEl.classList.add('is-steady') // 输入中停闪常亮(简报 §4 块状光标)
        river?.pulseAt(0, 0.5) // 首字输入:源头 L3 微闪 hint(简报 §4 拍1)
      }
      pos++
    }
    let t = 0
    for (const ch of TYPED_CMD) {
      beats.call(typeChar, [], t)
      t += d(CHAR_MS[ch] / 1000)
    }
    const typedEnd = t // ≈0.29s
    // 提交:光标常亮 200ms 再淡出(简报 §4 块状光标)
    beats.to(cursorEl, { opacity: 0, duration: d(0.18), ease: 'power2.in' }, typedEnd + d(0.2))

    // ---- 拍2 命中:行间 stagger 45~60ms 连击感 + hit 闪 80ms 硬边沿(简报 §4 / §5) ----
    const rowStart = typedEnd + d(0.45)
    beats.to(matchTitle, { opacity: 1, duration: d(0.12) }, rowStart)
    rows.forEach((rowEl, i) => {
      const rt = rowStart + d(0.08) + d(i * 0.055)
      const nameEl = rowEl.querySelector('.s1-row-name')
      const hitEl = rowEl.querySelector('.s1-row-hit')
      beats.to(rowEl, { opacity: 1, y: 0, duration: d(0.12) }, rt)
      // 命中行 = 唯一亮色焦点:行名提亮 + 光晕(简报 §4;textShadow 硬切,避免字符串补间)
      beats.to(nameEl, { color: COLORS.mono, duration: d(0.12) }, rt + d(0.02))
      beats.set(nameEl, { textShadow: GLOW }, rt + d(0.02))
      // —— hit —— 闪 80ms 硬状态边沿(简报 §5「1~3 帧 flash,不用 600ms soft fade」)
      beats.set(hitEl, { color: EMBER, opacity: 1, textShadow: GLOW_HIT }, rt + d(0.02))
      beats.set(hitEl, { color: HIT_DIM, opacity: 0.55, textShadow: 'none' }, rt + d(0.1))
      // 每次 hit:源头增强一档(简报 §4 拍2)
      beats.call(() => river?.pulseAt(0, 0.4), [], rt + d(0.02))
    })
    const lastFlashEnd = rowStart + d(0.08) + d(2 * 0.055) + d(0.1)
    // 三次完成:源头拉满 + ember 脉冲一次(简报 §4 拍2)
    beats.call(() => river?.pulseAt(0, 1), [], lastFlashEnd + d(0.15))

    // ---- 拍3:analyzing 浮现(命令表结束后 120~180ms,勿过早)+ 确定性假进度 ----
    const anaT = lastFlashEnd + d(0.18)
    beats.to(analyzingEl, { opacity: 1, duration: d(0.12) }, anaT)
    const progT = anaT + d(0.1)
    // 确定性假进度 0→62% 400ms 内、再 hold(简报 §4:「引擎在跑,但结果是确定的」)
    beats.to(fillEl, { width: '62%', duration: d(0.4), ease: 'none' }, progT)
    beats.to(pctEl, { opacity: 1, duration: d(0.05) }, progT)

    // ---- 拍4 河亮:视线焦点从终端移到河(简报 §4 拍4) ----
    // 叙事(2026-08-05 主人实测「不明所以」修复):进度条 62→100 与河变宽同步
    // 走完 ——「加载完成的那一刻,数据注入河床」因果可视;宽度补间 1.2s
    // (原瞬跳 0.6→1.21 突兀;0.8s 有中段「腰部鼓起」瞬态,1.2s 定稿);
    // 注入前锋让源头先宽、波浪顺流而下(「数据从终端流入河」的物理)
    const T0 = progT + d(0.4) + d(0.55)
    // 记录注入时刻(reduce 守卫:uTime 冻结时记录会让前锋卡在源头,不调即瞬达)
    beats.call(() => { if (!reducedMotion) river?.injectInfoVolume() }, [], T0)
    // 宽度:平滑补间到信息量全量(简报 §3.3 河宽随信息量,连续量)
    const vh = { v: river?.getInfoVolume?.() ?? 0 }
    beats.to(
      vh,
      {
        v: HIT_INFO, // 命中会话信息量 ≈ 54(最老三 facet 会话 token 和 / 1000)
        duration: d(1.2),
        ease: 'power2.out',
        onUpdate: () => river?.setInfoVolume(vh.v),
      },
      T0
    )
    // 进度条 62→100 与宽度同起点同长同 ease(「加载完成 → 数据注入」因果)
    beats.to(fillEl, { width: '100%', duration: d(1.2), ease: 'power2.out' }, T0)
    const pct = { p: 62 } // textContent 不能直接补间,代理对象每帧写入
    beats.to(
      pct,
      {
        p: 100,
        duration: d(1.2),
        ease: 'power2.out',
        onUpdate: () => {
          pctEl.textContent = Math.round(pct.p) + '%'
        },
      },
      T0
    )
    // 流速仍瞬切(「唰」是流速语义,不参与宽度补间;简报 §4 拍4)
    beats.call(() => river?.setFlow('s1'), [], T0)

    return beats
  }

  // ---------- 视口变化:锚点重算(相机宽高比/渲染尺寸由 main.js 统一处理) ----------
  // 简报 §3.5「滚动/相机移动时源头保持接入终端底部」——相机 S1 内固定,
  // 面板视口固定,唯一打破衔接的是 resize 与字体加载,均在此重算
  function onResize() {
    anchor()
  }

  return {
    enter() {
      if (built || disposed) return
      built = true
      // 相机定位:S1 相机几乎不动(简报 §3.5 简化策略;站内滚动只驱动粒子与文案)
      camera.position.copy(CAM_POS)
      camera.lookAt(CAM_LOOK)

      buildDom()
      anchor()
      // 字体加载会改变面板高度 → 重算锚点(等宽字就绪后终端底部位置才稳定)
      document.fonts?.ready.then(() => {
        if (!disposed) anchor()
      })
      window.addEventListener('resize', onResize)

      tl = buildBeats()
    },

    // 站内滚动:0.20~0.75 文案浮现(大字 → 小字 → 注记;简报 §4 站内滚动编排)
    scrub(p) {
      const show = (el, a, b) => {
        if (!el) return
        const k = Math.min(1, Math.max(0, (p - a) / (b - a)))
        el.style.opacity = String(k)
        el.style.transform = `translateY(${(1 - k) * 22}px)`
      }
      show(copyBig, 0.2, 0.42)
      show(copySmall, 0.36, 0.6)
      show(copyNotes, 0.55, 0.75)
    },

    // 每帧:粒子时间推进(渲染由 main.js 的 onScrollFrame 统一执行)
    update(t, dt) {
      river?.update(t, dt)
    },

    dispose() {
      if (disposed) return
      disposed = true
      built = false
      tl?.kill()
      window.removeEventListener('resize', onResize)
      root?.remove()
    },
  }
}

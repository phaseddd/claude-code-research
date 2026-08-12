// ============================================================
// scenes/s1.js —— 第一幕 S1「命令命中」终端风 UI(设计简报 §4 S1 + §3.5 锚点机制)
//
// 契约:
//   createS1({ scene, camera, uiEl, river, onRestart = null }) → { enter, scrub, update, dispose }
//     scene/camera/uiEl   三站共享的 3D 层与 DOM 层(由 main.js 装配,本站不建渲染器)
//     river               共享光河实例(简报 §6.1:main.js 在 s1 enter 时 createRiver,
//                         离开 S3 时 dispose —— 本站只用不建不毁)
//     onRestart           保留参数(演出化调整 2026-08-06:终端内「重新体验」按钮
//                         已移除,「回到序章」改由 U5 的 HUD 常驻链接承担;
//                         参数保留仅为保持 createS1 契约不变,本站不再使用)
//
// 画卷重构(2026-08-05 主人定稿):
//   构图 = 左仪器柱(终端面板 + 文案同左缘同列宽,与河道右 2/3 呼应);
//   河 = 从进度条右端出生(锚点 = 进度条右端,fill 100% 触达 = 河出生的因果顶点),
//   蜿蜒(谷→峰)→ 右缘出口;滚动 = 展卷(cam-start 全带 → cam-end 出口)。
//   数值经 .vision/verify-geom.mjs 投影验证(28/28,1707×850 与 1920×1080)。
//
// 生命周期对齐 timeline.js 段契约(§6.2):
//   enter()   定位共享相机 → 挂 DOM → 锚点逆投影 → 自动播放 4 拍入场节拍(简报 §4「入场节拍自动播放」)
//   scrub(p)  站内滚动进度 0~1:相机沿河带游移 + 0.20~0.75 文案浮现(简报 §4 站内滚动编排)
//   dispose() 释放本站资源(渲染与共享河推进由 main.js 统一执行,本站无 update)
// ============================================================

import * as THREE from 'three'
import gsap from 'gsap'
import { SESSIONS } from '../data/sessions.js'
import { COLORS } from '../theme.js'
import { COL as RIVER_COL, RIVER_SPLIT } from '../river.js'
import { easeInOutQuad, scrubFade, rampCamera } from '../utils.js'

// ---------- 参数(简报 §4 S1 基线;偏离处见注释,§0.6「改了要能说出为什么」) ----------
const TARGET_Z = 12 // 源头深度:锚点射线沿视线走到 z=12(简报 §3.5)
// 相机游移(画卷展卷):cam-start 看全带(出生点 31%W + 出口 92%W 同框,S 弯可见);
// cam-end 看出口(河抵右缘,面板出屏 —— S1 站末画面 = 河抵达最右)。
// S1_CAM_END/S1_LOOK_END 导出给 main.js 的 g1 门内滑轨(与 S2 开场相机无缝衔接)
const CAM_START = new THREE.Vector3(5.2, 0.5, 14.2)
const CAM_LOOK_START = new THREE.Vector3(1.7, -0.46, 11.5)
export const S1_CAM_END = new THREE.Vector3(2.2, -0.1, 11.5)
export const S1_LOOK_END = new THREE.Vector3(0.85, -1.59, 8.0)
// 河段可见窗口(画卷站界,与 river.js uSegRange 配套):
//   S1 出生→右缘 [0,RIVER_SPLIT](淡出带 [RIVER_SPLIT-0.03,RIVER_SPLIT])/
//   S2 [RIVER_SPLIT,1](淡入同带)→ 重叠带无缝衔接
//   S2 窗口由 s2 自身 enter 设置（交接不在此处，删除了原 dispose 里的 HANDOFF 冗余写）
//   站界单一来源 = river.js RIVER_SPLIT(s2/main 同引用,改站界只动一处)
const RANGE_S1 = [0, RIVER_SPLIT]
const TYPED_CMD = '/insights'
// 逐字非匀速:标点略慢、字母略快(简报 §4「28~42ms/字符」;确定性,不随机)
const CHAR_MS = { '/': 40, i: 28, n: 32, s: 32, g: 32, h: 32, t: 32 }
// 命中演出行(演出化调整 2026-08-06,演出基线「S1 · 终端演剧情」):
// 原 session:list / session:stats / cache:probe 内部命令名 + 耗时数字,
// 对第一次进场的观众是噪音(基线:「观众无法解读」),改为「动作演出行」——
// 两个角色(报告引擎/对话模型)的分工 + 历史会话入缓存,中文大白话紧跟英文
// 术语;仍为合成数据,不代表真实命令表内容(措辞诚实注记不变,简报 §4)。
// 字符串数组即可(唯一用法 = 行名渲染;留位式对象形态无现值,去掉)
const HITS = [
  'engine takes over · 报告引擎接手',
  'model steps back · 对话模型退居二线',
  'history cached · 历史会话入缓存',
]
// 命中标题(演出化调整):原「MATCH 03/12 · 命中 3 项」的分母(12 = 会话数)
// 观众无法解读,去掉分母,改为 built-in command 双语文案 —— 内置命令命中
const MATCH_TITLE = 'built-in command · 内置命令命中'
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
// 字符光晕(简报 §4 终端细节):唯一亮色焦点用;EMBER 白 = river.js 源头色(单一来源)
const EMBER = RIVER_COL.ember.getStyle()
const GLOW = '0 0 6px rgba(122,210,255,0.35), 0 0 14px rgba(74,168,255,0.15)'
const GLOW_HIT = '0 0 10px rgba(125,211,252,0.7), 0 0 22px rgba(74,168,255,0.35)'
const HIT_DIM = 'rgba(125, 211, 252, 0.45)' // hit 标记落定色(与 CSS .s1-row-hit 同)

// river 为必传参数（main.js 引擎级创建共享河，本站只用不建不毁）
// 无 onRestart:「回到序章」职责已移交 HUD 常驻按钮(main.js createHud 接线),旧
// 终端内按钮移除时该参数已无使用者,签名保持最小
export function createS1({ scene, camera, uiEl, river } = {}) {
  let tl = null
  let root = null
  let termEl = null
  let barEl = null // 进度条(锚点 = 其右端,河的出生点)
  let copyBig = null
  let copySmall = null
  let copyNotes = null
  let built = false
  let disposed = false
  let lastP = -1 // scrub p 判等（滚动静止时跳过重复写入）

  // ---------- DOM:终端面板(挂 #ui 层)+ 站内文案 ----------
  // 文案(演出化调整 2026-08-06,演出基线「S1 · 终端演剧情」):小字骨架句
  // 「它命中命令表…两个角色,各司其职」保留,中段改写为与终端行措辞呼应
  // (报告引擎接手/对话模型退居二线/历史会话入缓存);术语首现给大白话 ——
  // 内置命令 = 不靠模型现场想(大字)、缓存 = 存档(小字括注)、
  // 引擎/模型分工 = 干活 vs 递链接
  function buildDom() {
    root = document.createElement('div')
    root.className = 's1-scene'
    root.innerHTML = `
      <div class="s1-terminal">
        <div class="s1-term-bar">
          <span class="s1-term-title">~/insights</span>
        </div>
        <div class="s1-term-body">
          <div class="s1-prompt"><span class="s1-prompt-sign">&gt;</span> <span class="s1-typed"></span><span class="s1-cursor"></span></div>
          <div class="s1-match">
            <div class="s1-match-title">${MATCH_TITLE}</div>
            ${HITS.map(
              (h) => `
            <div class="s1-row">
              <span class="s1-row-name">${h}</span>
              <span class="s1-row-tail"><span class="s1-row-hit">—— hit ——</span></span>
            </div>`
            ).join('')}
          </div>
          <div class="s1-analyzing">analyzing your sessions…</div>
          <div class="s1-progress">
            <div class="s1-progress-bar">
              <div class="s1-progress-fill"></div>
              <span class="s1-bar-mouth"></span>
            </div>
            <span class="s1-progress-pct">62%</span>
          </div>
        </div>
        <div class="s1-scanline"></div>
      </div>
      <div class="s1-copy">
        <p class="s1-copy-big">/insights 是内置命令,不是模型现场想出来的。</p>
        <p class="s1-copy-small">它命中命令表:报告引擎接手、对话模型退居二线 —— 干活的是引擎,递链接的是模型。历史会话入缓存(存档),进度提示:'analyzing your sessions'。两个角色,各司其职。</p>
        <p class="s1-copy-notes">本演示使用合成示例数据<br>终端为演示的合成视觉 —— 引擎是纯代码流程,没有界面</p>
      </div>
    `
    uiEl.appendChild(root)
    termEl = root.querySelector('.s1-terminal')
    barEl = root.querySelector('.s1-progress-bar')
    copyBig = root.querySelector('.s1-copy-big')
    copySmall = root.querySelector('.s1-copy-small')
    copyNotes = root.querySelector('.s1-copy-notes')
  }

  // ---------- DOM-3D 锚点(简报 §3.5):进度条右端 → 逆投影 → 沿视线走到 z=12 ----------
  // 画卷因果:进度条 fill 走满 100% 的瞬间触达进度条右端 = 河的出生点(同一位置)。
  // 粒子从面板右下角区域涌出向右(河道方向),出口干净 —— 锚点内移只换因果锚,
  // 不重演 grok 否决过的「中心锚点斜穿面板右缘中部」(2026-08-05 决策记录)。
  // 2026-08-05 修复(主人实测「入口漂移」):原 anchor 用实时 camera 逆投影,而
  // enter() 时 camera.matrixWorld 要等首次 render 才刷新 —— 刷新态靠 fonts.ready
  // 二次锚点碰巧修正;滚回重入时 fonts 已加载 → 微任务先于下一帧 render → 锚点
  // 永远用陈旧矩阵 → 入口在「刷新位置」与「滚回位置」间漂移。修复:一律经
  // CAM_START 克隆相机逆投影(与实时相机/滚动位置无关,确定性;clone 后必须
  // updateMatrixWorld,否则 unproject 仍吃副本的陈旧矩阵)
  function anchor() {
    if (!barEl || !camera) return
    const rect = barEl.getBoundingClientRect()
    const sx = rect.left + rect.width // 进度条右端(100% 时刻 fill 到达处)
    const sy = rect.top + rect.height / 2
    const tmp = camera.clone()
    tmp.position.copy(CAM_START)
    tmp.lookAt(CAM_LOOK_START)
    tmp.updateMatrixWorld()
    tmp.updateProjectionMatrix()
    const ndc = new THREE.Vector3(
      (sx / window.innerWidth) * 2 - 1,
      -(sy / window.innerHeight) * 2 + 1,
      0.5
    )
    ndc.unproject(tmp)
    const dir = ndc.sub(tmp.position).normalize()
    if (Math.abs(dir.z) < 1e-6) return
    const t = (TARGET_Z - tmp.position.z) / dir.z
    river.setSource(tmp.position.clone().addScaledVector(dir, t))
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
    // 进度数字补间(拍3/拍4 共用):gsap 不能直接补间 textContent,代理对象每帧写回;
    // 「N%」显示格式集中于此 —— 改格式只动一处(原两处复制粘贴微变)
    function tweenPct(el, from, to, duration, ease, at) {
      const proxy = { p: from }
      beats.to(
        proxy,
        {
          p: to,
          duration,
          ease,
          onUpdate: () => {
            el.textContent = Math.round(proxy.p) + '%'
          },
        },
        at
      )
    }
    // 面板斩截闪(命中/MATCH 与注入完成顶点;remove + reflow 重启动画)
    const flashTerm = () => {
      termEl.classList.remove('s1-hit-flash')
      void termEl.offsetWidth
      termEl.classList.add('s1-hit-flash')
    }
    // 面板入场:下落 + 淡入(影评人 2026-08-05:纯淡入像「UI 截图在呼吸」,
    // 下落 24px 给「砸入」的参与感;0.18s 仍在简报 §5 无长 fade 上限内)。
    // 必须 fromTo:from() 的目标值是当前值,而 termEl CSS opacity 初始为 0,
    // from({opacity:0}) 会让面板永远透明(实测 bug,2026-08-05)
    beats.fromTo(
      termEl,
      { y: -24, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.18, ease: 'power3.out' },
      0
    )

    // ---- 拍1 输入:逐字回显(简报 §4 节奏注记:观众刚按过回车,首拍可快,不做仪式重复) ----
    let pos = 0
    const typeChar = () => {
      typedEl.textContent += TYPED_CMD[pos]
      if (pos === 0) cursorEl.classList.add('is-steady') // 输入中停闪常亮(简报 §4 块状光标)
      // 2026-08-12:原源头微闪(hint)随「拍4 前河零存在」删除 —— 河隐藏期不可见
      pos++
    }
    let t = 0
    for (const ch of TYPED_CMD) {
      beats.call(typeChar, [], t)
      t += CHAR_MS[ch] / 1000
    }
    const typedEnd = t // ≈0.29s
    // 提交:光标常亮 200ms 再淡出(简报 §4 块状光标)
    beats.to(cursorEl, { opacity: 0, duration: 0.18, ease: 'power2.in' }, typedEnd + 0.2)

    // ---- 拍2 命中:行间 stagger 45~60ms 连击感 + hit 闪 80ms 硬边沿(简报 §4 / §5) ----
    const rowStart = typedEnd + 0.45
    beats.to(matchTitle, { opacity: 1, duration: 0.12 }, rowStart)
    // 面板斩截闪(影评人 2026-08-05:「命中」要有身体感,别只加两行字)
    beats.call(flashTerm, [], rowStart)
    rows.forEach((rowEl, i) => {
      const rt = rowStart + 0.08 + i * 0.055
      const nameEl = rowEl.querySelector('.s1-row-name')
      const hitEl = rowEl.querySelector('.s1-row-hit')
      beats.to(rowEl, { opacity: 1, y: 0, duration: 0.12 }, rt)
      // 命中行 = 唯一亮色焦点:行名提亮 + 光晕(简报 §4;textShadow 硬切,避免字符串补间)
      beats.to(nameEl, { color: COLORS.mono, duration: 0.12 }, rt + 0.02)
      beats.set(nameEl, { textShadow: GLOW }, rt + 0.02)
      // —— hit —— 闪 80ms 硬状态边沿(简报 §5「1~3 帧 flash,不用 600ms soft fade」)
      beats.set(hitEl, { color: EMBER, opacity: 1, textShadow: GLOW_HIT }, rt + 0.02)
      beats.set(hitEl, { color: HIT_DIM, opacity: 0.55, textShadow: 'none' }, rt + 0.1)
      // 2026-08-12:原「每次 hit 源头增强一档」随「拍4 前河零存在」删除 ——
      // 河隐藏期脉冲不可见,「沉睡→预热→注入」三级改为「隐没→喷发」两级;
      // 拍4 的源头脉冲(见下)是唯一保留的河反应
    })
    const lastFlashEnd = rowStart + 0.08 + 2 * 0.055 + 0.1

    // ---- 拍3:analyzing 浮现(命令表结束后 120~180ms,勿过早)+ 确定性假进度 ----
    const anaT = lastFlashEnd + 0.18
    beats.to(analyzingEl, { opacity: 1, duration: 0.12 }, anaT)
    // 拍4 前河零存在(2026-08-12 主人裁决「进度条满的那一刻,星河才出现」):
    // 原预热(河微宽 0.42 + setFlow('warm'))与「沉睡→预热→注入」三级整体删除,
    // 河在 enter 置隐藏,拍4 揭幕同帧恢复 —— analyzing 期「引擎在跑」由进度条/数字承担
    const progT = anaT + 0.1
    // 确定性假进度 0→62% easeInOut(演出化调整 2026-08-06,演出基线
    // 「62% 进度修复:观众亲眼看到进度从零走起」):原 0.4s linear 太快,
    // 观众看到的是「62% 凭空出现」;拉长后进度条与数字同步从 0 爬到 62
    // 停住 —— 引擎在跑的呼吸感。简报 §4「引擎在跑,但结果是确定的」不变,
    // 拍4 62→100 与河变宽同步逻辑不变。
    // PROG_TARGET/PROG_CLIMB 单点命名:拍4 起点 T0 由 PROG_CLIMB 派生,
    // 改目标/时长只动这两处(原 62/1.2 手抄多处,漏改则进度与数字跳变、拍4 脱节)
    const PROG_TARGET = 62
    const PROG_CLIMB = 1.2
    // 拍4 注入时长(2026-08-12 simplify: 原 1.2 在河宽/进度条/数字/流速/顶点五处
    // 手抄 —— 单点命名与 PROG_CLIMB 同款纪律,漏改则因果脱节)
    const INJECT_SECONDS = 1.2
    beats.to(fillEl, { width: `${PROG_TARGET}%`, duration: PROG_CLIMB, ease: 'power1.inOut' }, progT)
    beats.to(pctEl, { opacity: 1, duration: 0.05 }, progT)
    // 数字与进度条同步爬升(DOM 初始 62% 在 opacity 0 下不可见,首帧即被 0% 覆盖)
    tweenPct(pctEl, 0, PROG_TARGET, PROG_CLIMB, 'power1.inOut', progT)

    // ---- 拍4 河亮:视线焦点从终端移到河(简报 §4 拍4;2026-08-12 重构) ----
    // 叙事:进度条 62→100 与河变宽同步走完 ——「加载完成的那一刻,河出现」;
    // 揭幕 = 隐藏解除 + 注入前锋同帧(源头先宽、波浪顺流而下,「数据从终端流入河」);
    // 宽度补间 1.2s 从 0 起(原预热基线 0.42 已删 ——「沉睡→预热→注入」三级改为
    // 「隐没→喷发」两级,主人裁决「星河才出现-喷发-流动起来」);
    // 停顿 0.35s = 62% 停驻的呼吸(进度爬升完成 → 揭幕的间隙,原预热参照已删除)
    // PROG_CLIMB = 拍3 进度 0→62 的补间时长(拍4 起点随之后移)
    const T0 = progT + PROG_CLIMB + 0.35
    // 拍4 揭幕(2026-08-12):隐藏解除 + 注入前锋同帧 —— 河「出现-喷发」于此帧
    beats.call(() => {
      river.setHidden(false)
      river.injectInfoVolume()
    }, [], T0)
    // 宽度:平滑补间到信息量全量(简报 §3.3 河宽随信息量,连续量);
    // 起点 = 0(预热已删,getInfoVolume 未被写过 → 初始 0 = W_MIN 最窄)
    const vh = { v: river.getInfoVolume() }
    beats.to(
      vh,
      {
        v: HIT_INFO, // 命中会话信息量 ≈ 54(最老三 facet 会话 token 和 / 1000)
        duration: INJECT_SECONDS,
        ease: 'power2.out',
        onUpdate: () => river.setInfoVolume(vh.v),
      },
      T0
    )
    // 进度条 62→100 与宽度同起点同长同 ease(「加载完成 → 数据注入」因果)
    beats.to(fillEl, { width: '100%', duration: INJECT_SECONDS, ease: 'power2.out' }, T0)
    // 拍4 数字(INJECT_SECONDS = 注入补间时长,与河宽同长;tweenPct 共享手法)
    tweenPct(pctEl, PROG_TARGET, 100, INJECT_SECONDS, 'power2.out', T0)
    // 流速错峰:宽度补间完成后 +0.1s 才「唰」(影评人 2026-08-05 两轮:0.35s/0.7s
    // 时宽度还在爬升,「宽波」和「加速」被读成一起涨;补间完成后宽度已到位,
    // 观众先读「信息量上来了」,再整体加速,两拍可分)
    beats.call(() => river.setFlow('s1'), [], T0 + INJECT_SECONDS + 0.1)
    // 走满顶点(影评人 2026-08-05:「analyzing 走满的那帧必须是因果顶点」):
    // 进度条 100% 瞬间 —— 源头再白闪一次(注入完成)+ 面板斩截闪
    beats.call(
      () => {
        river.pulseAt(0, 1)
        flashTerm()
      },
      [],
      T0 + INJECT_SECONDS
    )

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
      // 相机定位:cam-start(画卷全带视角;展卷游移由 scrub 驱动)
      camera.position.copy(CAM_START)
      camera.lookAt(CAM_LOOK_START)
      // 河段窗口:S1 带(出生→右缘);重入时重置(旧值可能是 S3 的全河)
      river.setVisibleRange(...RANGE_S1)
      // 整河隐藏(2026-08-12 主人裁决):河在拍4 进度 100% 前零存在,
      // 揭幕 = setHidden(false) + injectInfoVolume 同帧(拍4 T0)
      river.setHidden(true)
      // 拍4 起点确定性(2026-08-12 simplify):重入 S1 时残留 S2/S3 的全量信息量
      // (≈1.52),拍4「从最窄喷发」不成立 —— enter 显式归 0(与 setVisibleRange
      // 同款「enter 建立完整状态」纪律,原 PREWARM 锚点删除后的替代)
      river.setInfoVolume(0)

      buildDom()
      anchor()
      // 字体加载会改变面板高度 → 重算锚点(等宽字就绪后进度条位置才稳定;
      // 确定性相机克隆使字体重锚与实时相机无关)
      document.fonts?.ready.then(() => {
        if (!disposed) anchor()
      })
      window.addEventListener('resize', onResize)

      tl = buildBeats()
    },

    // 站内滚动:相机沿河带游移(展卷)+ 0.20~0.75 文案浮现(大字 → 小字 → 注记)
    scrub(p) {
      if (p === lastP) return // p 判等：滚动静止时跳过（timeline 每帧都调 scrub）
      lastP = p
      // 画卷展卷:cam-start 全带 → cam-end 出口(easeInOutQuad 同 S2/S3 相机语言;
      // 河源头随相机游移滚出屏,站末画面 = 河抵右缘)
      rampCamera(camera, CAM_START, CAM_LOOK_START, S1_CAM_END, S1_LOOK_END, easeInOutQuad(p))
      // 面板柱随卷出屏(2026-08-05 实测修复):DOM 面板不随相机移动,相机右移后
      // 面板若留在屏内会与已滚出屏的河源头脱节成「贴纸」。0.75 后文案已浮现完,
      // 柱整体左移 + 渐隐出屏(55vw = 面板+文案完全滚出),与源头出屏同节奏
      const pan = Math.max(0, (p - 0.75) / 0.25)
      root.style.transform = `translateX(${-pan * 55}vw)`
      root.style.opacity = String(1 - pan * 0.9)
      scrubFade(copyBig, p, 0.2, 0.42, 22)
      scrubFade(copySmall, p, 0.36, 0.6, 22)
      scrubFade(copyNotes, p, 0.55, 0.75, 22)
    },

    dispose() {
      if (disposed) return
      disposed = true
      built = false
      tl?.kill()
      window.removeEventListener('resize', onResize)
      // 河段窗口交接由 s2 enter 自行设置（幂等；本站不再写 HANDOFF，删冗余）
      // 隐藏恢复默认(2026-08-12 simplify 生命周期纪律):快速跳过 S1 时若拍4 未走,
      // 隐藏态会漏进 g1/S2 —— teardown 恢复 false 兜底(enter 建立完整状态的对称)
      river.setHidden(false)
      root?.remove()
    },
  }
}

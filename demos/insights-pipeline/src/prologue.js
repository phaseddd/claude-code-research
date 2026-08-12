// ============================================================
// 序章模块（prologue v3）：2026-08-12 主人裁决退场重构 —— 旧揭示拍+黑场整体推翻
//
// 3 秒时间轴（规格 §1 保留）：
//   0~0.9s    一次摆好（标题逐字锐化保持暗 → 副题+钩子合拍 → 报告条目块
//             整块落位 → 尾部轻落；点题句暗态在场、圆环常量首帧可见）
//   0.9s      首行 ▌ 光标开始闪烁（CSS animation-delay 0.9s）
//   0.9~0.98s 停顿 80ms 真空（心跳星/圆环全停一拍，.paused）
//   0.98s     可走：圆环恢复交互（hold.setEnabled(true)）
//   扫读      按住 1.25s 打满（最迟 2.23s 走；2026-08-11 键盘通道已移除）
//   按住期    全屏 520 颗星（星点 500 + 心跳星 20，WebGL 粒子）恒星坍缩：
//             壳层外圈先动 + 运动拉丝 + 核心挤压发光（starfield.js，主人裁决
//             「不要这么平静，我们可是 WebGL 技术栈」）‖ 圆环同步坍缩 scale
//             1→0.25 ‖ 两侧标注 e>0.5 后渐隐（修订 ⑤ 增密 + ⑦ WebGL 化）
//   环满帧    星已全部收进环心 = 一点光团；月球（右上）发出白光 0.7s 扫向全屏
//             （WebGL 光罩：径向扩散 + 白→青渐变，starfield.js；文本层随光
//             扫过被洗掉）→ 终点 = 青雾罩全屏（2026-08-12 二次裁决：原 0.12s
//             扩散太快 + 全白硬切 S1 无过渡）
//   青雾峰值  层交换窗口（2D 卸载 + 3D 接管同一帧，onEnter）→ S1 从青雾中现出
//   —— 旧揭示拍（首行聚焦/点题句琥珀通电/标题字重补间）与 0.15s 黑场整体删除：
//     主人裁决「现在的那个转场特效不要，只有一瞬间的亮」；琥珀点题句随白光吞没
//
// 契约：
//   mountPrologue({ uiEl, onEnter = null }) → { dispose }
//   - uiEl      DOM 层容器（#ui，pointer-events: none，由 main.js 创建）
//   - onEnter   白光峰值帧调用（进入引擎，bootTimeline 由 main.js 负责）
//   - 月球 = WebGL 真球体网格（2026-08-11 起无降级路径：本 demo 全程要求 WebGL2，
//     不支持即白屏，见 main.js）
// ============================================================
import gsap from 'gsap'
import * as THREE from 'three'
import { createHoldButton } from './hold.js'
import { createStarfield } from './starfield.js'
import { clamp01, disposeRenderer } from './utils.js'

// 规格 §1 时间轴常量（秒）
const T_PAUSE = 0.08 // 停顿 80ms 真空（0.9~0.98s）
const T_READY = 0.9 + T_PAUSE // 可走时刻（0.98s）
const HOLD_SECONDS = 1.25 // 按住时长（规格 §5 鼠标/触屏通道）
// 月球布光（2026-08-12 主人裁决：闪白的光源 = 月球；WebGL 光罩在 starfield.js）
// 2026-08-12 二次裁决：0.12s 扩散太快看不出扫过过程 + 全白硬切 S1 青色无过渡
// → 0.55s 扩散 + 白→青渐变；三次裁决（2026-08-12）：0.55s → 0.7s 更舒服
const T_BURST = 0.7
// 月球发条峰值（2026-08-13）：按住时自转提速上限 1.35× —— 主人：「不用转得那么快」
const MOON_WIND_PEAK = 0.35

// 报告条目（2026-08-11 主人逐条裁决终稿，六条）：
//   首行 = 特殊条目「38% 的摩擦，同一个原因」—— 数值取主人本机真实月报校准
//   （摩擦分布 24/63 ≈ 38%，同因集中于带 bug 代码）；悬置光标，裸奔无标签；
//   末条 = Edit 工具调用（真实月报 637 次 → 600+），右缘裁切 + 省略号，
//   与首行同构的「原因」悬念首尾呼应；合成注记已按主人裁决移除
const REPORT_LINES = [
  '38% 的摩擦，同一个原因',
  '10 场会话，8 场在修 bug',
  '4 小时的会话，最长的一次',
  '3 场对话，同时开着',
  '23 个话题，一半绕不开…',
  '600+ 次 Edit 工具调用，背后原因是…',
]
const REPORT_OPACITY = [1, 0.78, 0.6, 0.44, 0.3, 0.18] // 透明度渐进（首行 100% → 末行 18%；
// 步长递减的收敛曲线：前几档快、末档沉进背景，首末差 0.82 保证阶梯一眼可见；
// 恒定基线（原「揭示时压暗 50%」已随揭示拍删除，2026-08-12））

// 星点固定种子 LCG 已随 DOM 星迁移移入 starfield.js（唯一持有者，2026-08-12）

// 三维月球（2026-08-11：WebGL 真·球体网格，替代 2D canvas 球面投影）：
//   结构 = tilt 组（斜轴：右上北极 → 左下南极，23.4°，一个 rotation 完事）
//          ⊃ moon 网格（绕自身 Y = 斜轴自转，60s/圈，时间驱动帧率无关）
//   贴图 = 本地资产 public/moon.jpg（无网络依赖、无降级路径）；
//   mipmap 自动生成（缩小不噪）+ antialias + GPU 渲染，全部渲染器免费提供。
//   发条（2026-08-13 主人裁决）：setWind(p) 按住加速自转、松开回落 ——
//   视觉映射单点入口，与序章「applyProgress = progress→视觉纯函数」契约一致
//   返回 { setWind, stop }：stop 清理 GL 资源（含 forceContextLoss 确定性释放）并移除 canvas
function createMoonMesh(container, root) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(200, 200) // = CSS clamp 上限：DPR2 下缓冲 400px = 显示设备像素，零过绘
  renderer.domElement.style.width = '100%' // 覆盖 three 内联尺寸：CSS clamp(120-200px) 缩放
  renderer.domElement.style.height = '100%'
  container.replaceChildren(renderer.domElement)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10)
  camera.position.set(0, 0, 2.85) // 球径 2 在 FOV40 下占满 ~96% 高度（贴缘不留空隙）

  const tilt = new THREE.Group()
  tilt.rotation.z = (-23.4 * Math.PI) / 180 // 局部 +Y（北极）映射到屏幕右上
  scene.add(tilt)

  const geo = new THREE.SphereGeometry(1, 32, 32) // ≤200px 球：32 段与 96 段视觉无差，顶点省 9 倍
  const mat = new THREE.MeshPhongMaterial({ color: 0x9a9a9a, shininess: 2 })
  const moon = new THREE.Mesh(geo, mat)
  tilt.add(moon)

  // 贴图本地资产（无失败路径）：纹理异步到达后覆盖灰底；disposed 守卫防
  // 卸载后回调给已释放材质赋值（本地贴图 <50ms 到达，实际几乎不可能触发）
  let disposed = false
  new THREE.TextureLoader().load(import.meta.env.BASE_URL + 'moon.jpg', (tex) => {
    if (disposed) return
    tex.colorSpace = THREE.SRGBColorSpace
    mat.map = tex
    mat.color.set(0xffffff)
    mat.needsUpdate = true
  })

  const light = new THREE.DirectionalLight(0xffffff, 1.3)
  light.position.set(0.45, -0.4, 0.8) // 左上光源（与 canvas 版一致的屏面方向）
  scene.add(light)
  scene.add(new THREE.AmbientLight(0xffffff, 0.35))

  let wind = 0 // 发条强度 0~1（setWind 驱动；按住加速、松开回落）
  let skipFrame = false // 隔帧渲染：60s/圈 = 0.1°/帧亚像素位移，30fps 视觉无损
  renderer.setAnimationLoop((t) => {
    if (root.classList.contains('paused')) return // 80ms 真空：冻结帧
    skipFrame = !skipFrame
    if (skipFrame) return
    // 按住加速自转（2026-08-13 主人裁决：按紧 = 给它上发条，松开原速回落；
    // 峰值 1.35× —— 主人：「不用转得那么快」）
    moon.rotation.y = (t / (60000 / (1 + MOON_WIND_PEAK * wind))) * Math.PI * 2
    renderer.render(scene, camera)
  })

  return {
    setWind(p) {
      wind = clamp01(p)
    },
    stop() {
      disposed = true
      renderer.setAnimationLoop(null)
      geo.dispose()
      mat.dispose()
      mat.map?.dispose()
      disposeRenderer(renderer) // 三段式释放契约（utils，防反复进序章耗尽 context）
    },
  }
}

export function mountPrologue({ uiEl, onEnter = null }) {

  // ---------- 1. 创建 DOM（八块文案，2026-08-11 主人逐条裁决终稿） ----------
  const root = document.createElement('div')
  root.className = 'prologue'
  root.innerHTML = `
    <h1 class="prologue-title">
      <!-- 门牌：/insights 字即图形（暗着，通电才亮）；副题 = 门牌副文 -->
      <span class="title-display">/<span class="hl">insights</span></span>
      <span class="title-cn">这个月，你都和它说了什么？</span>
    </h1>
    <!-- 钩子：<br> 强制两行（反转节奏靠两行的停顿感，禁宽度自然折行）；
         「点评你」三字青色高亮 + 加大（2026-08-11 主人裁决：蓝色与放大从「你」
         扩到整组动词，第一眼命中「关于你」锚点） -->
    <div class="prologue-hook">你每天指挥它干活。<br>今天轮到它<span class="hl-you">点评你</span>。</div>
    <!-- 报告条目块：6 条展品（首行 = 特殊条目带悬置光标，
         末条右缘裁切 + 省略号；透明度渐进由下方 JS 内联写入。
         私有标记行与合成注记已按 2026-08-11 主人裁决移除） -->
    <div class="prologue-report" aria-label="你的会话报告条目（合成示例数据）">
      ${REPORT_LINES.map(
        (t, i) =>
          `<div class="report-line${i === REPORT_LINES.length - 1 ? ' is-cut' : ''}">${t}${
            i === 0 ? '<span class="line-cursor">▌</span>' : ''
          }</div>`
      ).join('')}
      <!-- 生成过程行：并入报告卡（2026-08-11 布局重构「展品即主角」——
           报告卡 = 完整展品：条目区 + 分隔线 + 生成过程单句） -->
      <div class="prologue-steps" aria-label="报告生成过程">读你一个月的会话记录，写成七章，归纳成一份 HTML 报告。</div>
    </div>
    <!-- 点题句：暗态在场恒定（停顿必须有凝视对象；琥珀通电已随揭示拍删除） -->
    <p class="prologue-theme">报告是它写的。句句说的是你。</p>
    <!-- 来源行（展签）：压一行贴右，锚点契约不可删字 -->
    <p class="prologue-source">基于 @cometix/claude-code 2.1.209 静态源码分析 · 配套知识页：<a class="prologue-link" href="../../analysis/mechanisms/claude-code-insights-slash-command.md" target="_blank" rel="noopener">机制 · 命令全程解析</a> · <a class="prologue-link" href="../../analysis/concepts/claude-code-insights-prompts.md" target="_blank" rel="noopener">概念 · 内嵌提示词全文</a></p>
    <div class="prologue-hold">
      <span class="hold-label hold-label-l"><span class="hold-label-inner">按紧它，别松手</span></span>
      <div class="hold-hit">
        <svg class="hold-ring" viewBox="0 0 100 100" aria-hidden="true">
          <circle class="hold-ring-base" cx="50" cy="50" r="46"/>
          <circle class="hold-ring-progress" cx="50" cy="50" r="46"/>
        </svg>
        <span class="hold-core">/insights</span>
      </div>
      <span class="hold-label hold-label-r"><span class="hold-label-inner">等它转满</span></span>
    </div>
  `
  uiEl.appendChild(root)

  // ---------- 1.5 背景视差层（星点/心跳星生成 + 指针微移 ±6px，三层只碰背景） ----------
  const fxEl = document.createElement('div')
  fxEl.className = 'prologue-fx'
  root.prepend(fxEl)
  // 星场（2026-08-12 恒星坍缩，WebGL 粒子）：DOM 容器均匀缩放保留矩形轮廓
  // =「方框状缩进去」（仿射变换的必然），主人裁决换 GPU —— 520 星一个 draw
  // call，坍缩（外圈先动/拉丝/核心发光）全在顶点着色器（starfield.js）
  const starfield = createStarfield({ container: fxEl, pausedEl: root })

  // 月球（右上角补白，2026-08-11）：WebGL 真球体网格；挂在 fx 视差层内
  // → 随指针视差 ±6px 一起微动；贴图本地资产，无降级路径
  const moonEl = document.createElement('div')
  moonEl.className = 'fx-moon'
  fxEl.appendChild(moonEl)
  const moon = createMoonMesh(moonEl, root) // {setWind, stop}（2026-08-13 发条契约）

  let parallaxRaf = 0
  let px = 0
  let py = 0
  let tx = 0
  let ty = 0
  const onPointerMove = (e) => {
    // 归一化到 [-1, 1]；视差 ±6px（规格 §4，只碰背景层）
    tx = (e.clientX / window.innerWidth) * 2 - 1
    ty = (e.clientY / window.innerHeight) * 2 - 1
    if (!parallaxRaf) parallaxRaf = requestAnimationFrame(applyParallax)
  }
  const applyParallax = () => {
    parallaxRaf = 0
    px += (tx - px) * 0.06 // lerp 平滑跟随
    py += (ty - py) * 0.06
    fxEl.style.transform = `translate(${px * 6}px, ${py * 6}px)`
  }
  window.addEventListener('pointermove', onPointerMove, { passive: true })

  // ---------- 2. 元素引用与标题逐字包裹（供「逐字锐化」stagger） ----------
  // 只包 title-display（/insights 字即图形）；副题合拍轻落不拆字
  const titleEl = root.querySelector('.title-display')
  const titleChars = wrapChars(titleEl)
  const titleCn = root.querySelector('.title-cn')
  const hookEl = root.querySelector('.prologue-hook')
  const reportEl = root.querySelector('.prologue-report')
  const reportLines = [...root.querySelectorAll('.report-line')]
  const sourceEl = root.querySelector('.prologue-source')
  // cursorEl/themeEl 引用已随旧揭示拍整体删除（2026-08-12 退场重构）
  const labelEls = [...root.querySelectorAll('.hold-label')]
  const holdEl = root.querySelector('.prologue-hold')

  // 条目透明度渐进（首行 100% → 末行 18%）：内联写入（CSS 无状态，
  // 揭示时「其余条目压暗 50%」在此基线上减半）
  reportLines.forEach((l, i) => (l.style.opacity = String(REPORT_OPACITY[i])))

  // ---------- 3. 入场动画（0~0.9s 一次摆好；规格 §1） ----------
  // 圆环是常量（全程在场、不参与入场动画）→ 不入组；
  // 点题句暗态在场（opacity 0.2，CSS 静态）→ 不入组
  const fadeIns = [titleCn, hookEl, sourceEl, ...labelEls] // 尾部轻落组（生成过程随报告卡整块落位）
  gsap.set(titleChars, { opacity: 0, y: 20, filter: 'blur(10px)' })
  gsap.set(fadeIns, { opacity: 0, y: 12 })
  gsap.set(reportEl, { opacity: 0, y: 4 }) // 条目块整块：4px 盖章位移
  // 入场隐藏期间链接禁点（.prologue-link 的 CSS pointer-events: auto 覆盖父级继承，
  // 必须直接设内联样式；恢复时机 = 尾部轻落完成）
  gsap.set(root.querySelectorAll('.prologue-link'), { pointerEvents: 'none' })
  function restorePointer() {
    root.querySelectorAll('.prologue-link').forEach((el) => {
      el.style.pointerEvents = ''
    })
  }

  const entrance = gsap.timeline({ defaults: { ease: 'power2.out' } })
  entrance
    // 标题逐字锐化：单字符 0.35s、stagger 0.05s、保持暗（opacity 0.4 = 还没通电的灯）
    .to(
      titleChars,
      { opacity: 0.4, y: 0, filter: 'blur(0px)', duration: 0.35, stagger: 0.05, clearProps: 'filter,transform' },
      0
    )
    // 副题+钩子合拍轻落（同一拍，不轮流登场）
    .to([titleCn, hookEl], { opacity: 1, y: 0, duration: 0.2 }, 0.55)
    // 报告条目块整块落位（≤400ms，禁逐字弹入），之后死住
    .to(reportEl, { opacity: 1, y: 0, duration: 0.15 }, 0.72)
    // 尾部轻落：来源/两侧标注（完成后恢复链接可点）
    .to(
      [sourceEl, ...labelEls],
      { opacity: 1, y: 0, duration: 0.1, stagger: 0.03, onComplete: restorePointer },
      0.8
    )
    // 停顿 80ms 真空：心跳星/圆环全停一拍（规格 §1/§8.6；0.9 = T_READY - T_PAUSE）
    .call(() => root.classList.add('paused'), [], T_READY - T_PAUSE)
    // 可走：圆环恢复交互（0.98s）
    .call(() => {
      root.classList.remove('paused')
      hold.setEnabled(true)
    }, [], T_READY)

  // ---------- 4. 按住交互（2026-08-12 重构：按住 = 星收环坍缩的驱动源） ----------
  // 全屏 520 颗星（星点 500 + 心跳星 20，统一处理——主人视角「只有亮一点和
  // 几乎看不见的区别」）按进度向环心收缩：位移 = 进度^1.8（前缓后急 = 吸入感）
  // ‖ 环同步坍缩 scale 1→0.25（保留形态到最后一帧，白光从「环心」炸出更有来源感）
  // ‖ 两侧标注 e>0.5 后渐隐。
  // 实现 = starfield（WebGL 粒子，恒星坍缩全在 shader，见 1.5 节生成处注释）。
  // 2026-08-12 主人裁决「原速原样恢复」：回退逻辑在 hold.js 的 progress 本身
  // （续接窗口超时后 progress 以 1/duration 线性回退，环弧同步退、星沿收缩
  // 曲线镜像返回，按住即从当前位置续走）—— 本层只是 progress → 视觉的纯函数
  // 映射，无中间状态（原 lerp 渲染循环已删，满环帧无需强制落定）
  const holdHit = root.querySelector('.hold-hit')
  // 环心屏幕中心缓存（2026-08-12 simplify：热路径每帧 getBoundingClientRect 是
  // 冗余读取 —— transform 缩放走合成器、不改变布局矩形，仅 resize 会变；
  // 首次惰性取 + resize 刷新，每帧只用便宜的视差折算）
  let ringCX = 0
  let ringCY = 0
  const refreshRingCenter = () => {
    const r = holdHit.getBoundingClientRect()
    ringCX = r.left + r.width / 2
    ringCY = r.top + r.height / 2
  }
  // 屏幕坐标 → fxEl 局部坐标（fxEl = fixed inset −20 + 视差 translate(px*6, py*6)；
  // applyProgress 与 runBurst 共用，2026-08-12 simplify）
  const toFx = (sx, sy) => ({ x: sx + 20 - px * 6, y: sy + 20 - py * 6 })
  const applyProgress = (p) => {
    if (!ringCX) refreshRingCenter() // 首次惰性（入场完成、布局稳定后才可能按住）
    const e = p ** 1.8 // 前缓后急：吸入感（与 hold 回退同源 = 原速原样）
    moon.setWind(p) // 月球发条（回退时同步松开 = 原速原样）
    const c = toFx(ringCX, ringCY)
    starfield.setCenter(c.x, c.y) // 坍缩中心（恒星坍缩的引力点）
    starfield.setE(e) // 收缩程度（外圈先动/拉丝/核心发光全在 shader）
    holdHit.style.transform = `scale(${1 - 0.75 * e})` // 环坍缩
    const labelO = 1 - Math.max(0, (e - 0.5) / 0.5) // 标注渐隐（环缩了字还挂着会穿帮）
    labelEls.forEach((l) => (l.style.opacity = String(labelO)))
  }
  window.addEventListener('resize', refreshRingCenter)

  // const hold：入场 timeline 的 0.98s call 引用它，闭包在赋值后才执行（无 TDZ）
  const hold = createHoldButton({
    el: holdEl,
    duration: HOLD_SECONDS, // 按住 1.25s（规格 §5 鼠标/触屏通道）
    // 0.98s 可走前忽略一切输入（摆好期间禁点防误触，
    // setEnabled(true) 由入场 timeline 的 0.98s call 执行）
    enabled: false,
    onProgress: applyProgress, // 进度 → 视觉纯函数映射（原速回退由 hold 驱动）
    onComplete: () => {
      if (done) return
      done = true
      runBurst()
    },
  })
  let done = false // 防重复触发
  let burstTween = null // 月球布光动画引用（dispose 时释放）

  // ---------- 5. 退场：月球布光 0.7s 白→青 → 青雾峰值层交换（2026-08-12 主人裁决） ----------
  // 旧揭示拍（首行聚焦/琥珀通电/标题字重）与 0.15s 黑场整体删除 —— 主人：
  // 「现在的那个转场特效不要，不要花里胡哨，只有一瞬间的亮」。
  // 布光 = starfield GPU 光罩（第二 mesh，2026-08-12 二次裁决 WebGL 化）：
  // 白光以月球为源点径向扩散 0.7s（power1.in），颜色白→青，终点 = 青雾罩全屏
  // → 峰值帧同一帧 dispose（2D 卸载，含星场/月球/光罩）+ onEnter（3D 接管）
  // → S1 从青雾中现出（硬切，色彩连续）
  function runBurst() {
    // 满环帧状态已由 hold 最后 tick 精确落定（progress=1 → onProgress → applyProgress(1)）
    // 月球 → fxEl 局部 → NDC（光罩光源源点；视差 ±6px 在 0.7s 内可忽略）
    const rect = moonEl.getBoundingClientRect() // 月球在 fxEl 视差层内，rect 含视差
    const c = toFx(rect.left + rect.width / 2, rect.top + rect.height / 2)
    const vw = window.innerWidth + 40
    const vh = window.innerHeight + 40
    const moonUV = { x: (c.x / vw) * 2 - 1, y: 1 - (c.y / vh) * 2 }
    // 文本层（标题/报告卡/点题句/来源/标注）随布光淡出 =「被光洗掉」。
    // 2026-08-12 simplify 备注：DOM 序 stagger（视觉验收定稿版），非「光扫到的
    // 空间序」—— 有意保留，改顺序需重新过视觉验收；时长 0.4s 在 0.7s 布光内完成
    gsap.to(
      [...root.children].filter((el) => !el.classList.contains('prologue-fx')),
      { opacity: 0, duration: 0.4, stagger: 0.04, ease: 'power1.in' }
    )
    // GPU 光罩扩散（starfield 第二 mesh）：白→青渐变在扩散中完成，
    // 终点 = 青雾罩全屏 → 峰值帧层交换，S1 从青雾中现出（色彩连续）
    const burst = { p: 0 }
    burstTween = gsap.to(burst, {
      p: 1,
      duration: T_BURST,
      ease: 'power1.in', // 扩散加速：光从月球「冲」向全屏的动能感
      onUpdate: () => starfield.setBurst(burst.p, moonUV),
      onComplete: () => {
        dispose() // 2D 卸载
        if (onEnter) onEnter() // 3D 接管（同一帧）→ S1 面板落下（硬切）
      },
    })
  }

  // ---------- 6. 清理：移除 DOM 并释放所有监听/动画 ----------
  let disposed = false
  function dispose() {
    if (disposed) return
    disposed = true
    entrance?.kill() // 入场动画
    burstTween?.kill() // 月球布光动画
    window.removeEventListener('resize', refreshRingCenter) // 环心缓存刷新
    starfield.dispose() // 星场 GL 释放（disposeRenderer 契约）
    hold.dispose() // 按住组件自清理
    if (parallaxRaf) cancelAnimationFrame(parallaxRaf) // 视差 rAF
    moon?.stop() // 月球自转 rAF
    window.removeEventListener('pointermove', onPointerMove) // 视差监听
    root.remove() // 从 uiEl 移除 .prologue 节点
  }

  return { dispose }
}

// 把标题文本按字符拆成 span（保留 .hl 等子元素结构），
// 空白字符保持原样，其余每个字符包一个 .prologue-char 供 GSAP stagger
function wrapChars(el) {
  const frag = document.createDocumentFragment()

  const splitText = (parent, text) => {
    for (const ch of text) {
      if (/\s/.test(ch)) {
        parent.appendChild(document.createTextNode(ch))
      } else {
        const s = document.createElement('span')
        s.className = 'prologue-char'
        s.style.display = 'inline-block' // 行内元素无法应用 transform，需 inline-block
        s.textContent = ch
        parent.appendChild(s)
      }
    }
  }

  const walk = (dest, node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        splitText(dest, child.textContent)
      } else {
        const clone = child.cloneNode(false) // 保留标签与 class（如 .hl）
        walk(clone, child)
        dest.appendChild(clone)
      }
    }
  }

  walk(frag, el)
  el.replaceChildren(frag)
  return el.querySelectorAll('.prologue-char')
}

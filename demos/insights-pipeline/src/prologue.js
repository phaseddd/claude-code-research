// ============================================================
// 序章模块（prologue）：黑场排版 → 标题逐字浮现 → 背景段 → 按住运行
//
// 契约：
//   mountPrologue({ uiEl, degraded = false, onEnter = null }) → { dispose }
//   - uiEl      DOM 层容器（#ui，pointer-events: none，由 main.js 创建）
//   - degraded  true 时无 WebGL2：显示全文 + 降级提示，无按住交互、不调 onEnter
//   - onEnter   非降级时"按住完成 → 退场动画结束"后的回调（进入引擎）
//
// 时序（非降级）：按住 2.5s 完成 → 序章 0.5s 淡出上移 20px → dispose 清理
//                 DOM → 调用 onEnter()，把"按住 → 黑场 → 进入引擎"串起来
// ============================================================
import gsap from 'gsap'
import { createHoldButton } from './hold.js'
import { isReducedMotion } from './utils.js'

export function mountPrologue({ uiEl, degraded = false, onEnter = null }) {
  // ---------- 1. 创建 DOM（类名契约与 style.css 一致） ----------
  // 文案逐字取自知识库事实（PLAN.md 2.1 定稿），不得改写删减
  const root = document.createElement('div')
  root.className = 'prologue'
  root.innerHTML = `
    <!-- 标题两行结构（字即图形）：行1 /insights 命令本身做成超大 display 图形
         （Playfair Display 900 斜体，参照零大学衬线大字张力）；
         行2 中文副题思源宋体 Heavy（报告/档案感，呼应"生成 HTML 报告"母题）。
         冒号为排版连接符，由两行层级取代；逐字动画仍按 DOM 顺序（先命令后副题） -->
    <h1 class="prologue-title">
      <span class="title-display">/<span class="hl">insights</span></span>
      <span class="title-cn">回车之后，发生了什么？</span>
    </h1>
    <div class="prologue-body">
      <p>你输入 /insights，回车。屏幕卡住几十秒 —— 然后聊天窗弹出这个：</p>
      <!-- 聊天窗输出示例：两行英文 + file:// 链接（文本锚定知识页话术原文，非虚构；
           等宽字体 = 数据与终端层，聊天窗是它天然场景） -->
      <div class="prologue-chat" aria-label="聊天窗输出示例">
        <p>Your shareable insights report is ready:</p>
        <p class="chat-file">file:///Users/you/.claude/usage-data/report.html</p>
        <p>Want to dig into any section or try one of the suggestions?</p>
      </div>
      <!-- 正文信息分层（与标题/聊天窗组成四层字阶）：
           body-lead 黑体 700 白（引导）> body-detail 黑体 400 dim（展开）
           > pipeline 青色箭头（数据点缀，呼应 HUD 轨道）> body-theme 思源宋体 900（点题） -->
      <p class="body-lead">点开这个链接，是一份漂亮的 HTML 使用报告：</p>
      <p class="body-detail">这个月你用 Claude 做了什么、哪里顺畅、哪里卡壳，<br>甚至还有几条“要不要试试这个功能”的建议。</p>
      <p class="body-detail">这份报告不是凭空出现的。在你等待的那段时间里，</p>
      <p class="body-lead">一条看不见的流水线在工作：</p>
      <div class="pipeline" aria-label="报告引擎流水线六个环节">
        <span>扫盘</span><i class="pipe-arrow">→</i><span>缓存</span><i class="pipe-arrow">→</i><span>压缩</span><i class="pipe-arrow">→</i><span>打标签</span><i class="pipe-arrow">→</i><span>并行写七章</span><i class="pipe-arrow">→</i><span>合成总览</span>
      </div>
      <p class="body-detail">本演示带你走进那段等待时间</p>
      <p class="body-theme">一条数据河的旅程。</p>
    </div>
    <p class="prologue-source">基于 @cometix/claude-code 2.1.209 静态源码分析<br>配套知识页：<a class="prologue-link" href="../../analysis/mechanisms/claude-code-insights-slash-command.md" target="_blank" rel="noopener">机制 · 命令全程解析</a> · <a class="prologue-link" href="../../analysis/concepts/claude-code-insights-prompts.md" target="_blank" rel="noopener">概念 · 内嵌提示词全文</a></p>
    ${
      degraded
        ? `<p class="degraded-note">当前浏览器不支持 WebGL2 —— 3D 演示不可用，以上为静态说明。</p>`
        : `<div class="prologue-hold">
      <div class="hold-hit">
        <svg class="hold-ring" viewBox="0 0 100 100" aria-hidden="true">
          <circle class="hold-ring-base" cx="50" cy="50" r="46"/>
          <circle class="hold-ring-progress" cx="50" cy="50" r="46"/>
        </svg>
        <span class="hold-core">/</span>
      </div>
      <div class="hold-label">按住按钮，模拟运行 /insights</div>
      <p class="hold-hint">按住别松手 —— 引擎跑起来需要一点时间，就像真的。</p>
    </div>`
    }
  `
  uiEl.appendChild(root)

  // ---------- 1.5 背景视差层（星点/微光独立层，随指针微移） ----------
  // 参照零站点 stage1Parallax：背景位移制造景深感；dispose 时清理监听
  const fxEl = document.createElement('div')
  fxEl.className = 'prologue-fx'
  root.prepend(fxEl)

  let parallaxRaf = 0
  let px = 0
  let py = 0
  let tx = 0
  let ty = 0
  const onPointerMove = (e) => {
    // 归一化到 [-1, 1]，位移幅度 ±14px / ±10px
    tx = (e.clientX / window.innerWidth) * 2 - 1
    ty = (e.clientY / window.innerHeight) * 2 - 1
    if (!parallaxRaf) parallaxRaf = requestAnimationFrame(applyParallax)
  }
  const applyParallax = () => {
    parallaxRaf = 0
    px += (tx - px) * 0.06 // lerp 平滑跟随
    py += (ty - py) * 0.06
    fxEl.style.transform = `translate(${px * 14}px, ${py * 10}px)`
  }
  window.addEventListener('pointermove', onPointerMove, { passive: true })

  // ---------- 2. 标题逐字包裹（供"逐字浮现"stagger 动画） ----------
  // 保留 <span class="hl"> 高亮结构，字符拆成 .prologue-char（行内块）便于位移动画
  const titleEl = root.querySelector('.prologue-title')
  const titleChars = wrapChars(titleEl)

  // ---------- 3. 入场动画（总时长 ≈2.5s） ----------
  // > p 直选 + chat/pipeline 块：聊天窗与流水线整体作为一块进入
  // （pipeline 是 div 不是 p，漏掉会导致它不参与隐藏/浮现，动画前就露在屏幕上）
  const bodyPs = root.querySelectorAll('.prologue-body > p, .prologue-chat, .pipeline')
  const sourceEl = root.querySelector('.prologue-source')
  const tailEls = degraded
    ? [sourceEl, root.querySelector('.degraded-note')]
    : [sourceEl, root.querySelector('.prologue-hold')]

  // 先整体置为不可见，再按节奏依次进入（避免首帧闪现）
  // 标题带模糊锐化入场（参照零站点"文字随进入视野逐渐锐化"的对焦手法）
  // 注意：tailEls 含按住按钮与知识页链接（pointer-events: auto），
  // 隐藏期间必须同步禁点，否则观众会在"看不见按钮"时误触开始按住；
  // .prologue-link 有自己的 CSS pointer-events: auto（覆盖父级继承），必须直接设内联样式
  gsap.set(titleChars, { opacity: 0, y: 24, filter: 'blur(10px)' })
  gsap.set(bodyPs, { opacity: 0, y: 14 })
  gsap.set(tailEls, { opacity: 0, y: 12, pointerEvents: 'none' })
  gsap.set(root.querySelectorAll('.prologue-link'), { pointerEvents: 'none' })

  // 入场动画收尾后恢复按住按钮与链接的可交互性（stagger 全部完成时触发）；
  // 同时清掉 gsap.set 写下的内联样式（tailEls 的 pointerEvents: none）
  function restorePointer() {
    root.querySelectorAll('.prologue-hold, .prologue-link, .prologue-source').forEach((el) => {
      el.style.pointerEvents = ''
    })
  }

  // 尊重动效偏好：reduce 时跳过入场动画，直接呈现全部内容（JS 侧同样生效）
  const reducedMotion = isReducedMotion()
  let entrance = null
  if (reducedMotion) {
    gsap.set(titleChars, { opacity: 1, y: 0, filter: 'blur(0px)' })
    gsap.set(bodyPs, { opacity: 1, y: 0 })
    gsap.set(tailEls, { opacity: 1, y: 0 })
    restorePointer()
  } else {
    entrance = gsap.timeline({ defaults: { ease: 'power2.out' } })
    entrance
      // 标题逐字（模糊锐化）。clearProps 清除动画残留的内联 filter/transform：
      // 子元素带非 none 的 filter 会创建合成层，父级 background-clip: text 的
      // 文字裁剪因此失效 → 整行渐变标题不可见（实测 blur(0px) 残留导致）
      .to(titleChars, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.45, stagger: 0.02, clearProps: 'filter,transform' })
      .to(bodyPs, { opacity: 1, y: 0, duration: 0.4, stagger: 0.3 }, '+=0.1') // 三段背景依次
      .to(
        tailEls,
        { opacity: 1, y: 0, duration: 0.35, stagger: 0.1, onComplete: restorePointer },
        '+=0.1'
      ) // 来源/按住区收尾（完成后恢复交互）
  }

  // ---------- 4. 按住交互（仅非降级） ----------
  let hold = null // createHoldButton 的返回（可能带 dispose）
  let done = false // 防重复触发
  let exitTween = null // 退场动画引用（dispose 时释放）

  if (!degraded) {
    const holdEl = root.querySelector('.prologue-hold')
    hold = createHoldButton({
      el: holdEl,
      duration: 2.5, // 按住时长：模拟"引擎运转需要一点时间"
      // onProgress 不传：进度环由 hold.js 内部驱动
      onComplete: () => {
        if (done) return
        done = true
        // 按住完成 → 序章退场：0.5s 淡出并上移 20px（退场期间禁点，防二次触发）
        holdEl.style.pointerEvents = 'none'
        // 黑场三段式第一段：纯淡出（去掉位移 —— 20px 上移+加速曲线
        // 会形成"抽一下"的干扰，黑场停顿由 main.js 在场景侧接管）
        exitTween = gsap.to(root, {
          opacity: 0,
          duration: reducedMotion ? 0.01 : 0.4,
          ease: 'power2.in',
          onComplete: () => {
            dispose()
            // 退场动画结束才进入引擎
            if (onEnter) onEnter()
          },
        })
      },
    })
  }

  // ---------- 5. 清理：移除 DOM 并释放所有监听/动画 ----------
  let disposed = false
  function dispose() {
    if (disposed) return
    disposed = true
    entrance?.kill() // 入场动画（reduce 模式下为 null）
    exitTween?.kill() // 退场动画
    hold?.dispose?.() // 按住组件自清理（若有）
    if (parallaxRaf) cancelAnimationFrame(parallaxRaf) // 视差 rAF
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

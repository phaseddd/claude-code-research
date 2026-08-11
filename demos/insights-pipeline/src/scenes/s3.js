// scenes/s3.js —— 第一幕 S3「缓存分流」：双色河 + 缓存盒（设计简报 §4 S3 / §5 / §2.3）
//
// 构图：河到分流点（Y 型，meta 青 / facet 品红）各流向一个缓存盒；需要更新的盒亮起、
// 未变的盒不发光（暗盒）——「有的亮有的哑」的对比语法（简报 §4.3 / §7.2-7）。
//
// 契约（与 s1.js 同构，main.js 站级装配）：
//   createS3({ scene, camera, uiEl, river }) → { enter, scrub, dispose }
//     scene/camera/uiEl   三站共享的 3D 层与 DOM 层（由 main.js 装配，本站不建渲染器；
//                         渲染由 main.js 的 onScrollFrame 统一执行）
//     river               共享光河实例（必传；main.js 引擎级创建、backToPrologue 销毁，
//                         本站只用不建不毁，推进由 main.js 统一执行）
//
// 节拍（简报 §4.3 三拍，由「首帧 scrub」触发 —— gate 预挂期间不 scrub、不播，
// 观众真正看到本站时才入场；reduced-motion 直接落定，简报 §5）：
//   拍1 汇聚：setInfoVolume(STATS.totalInfo)（第一幕最宽，信息量全量）+ setFlow('s3')
//   拍2 分流：setBranchMix(0→1，0.5s easeInOutCubic，简报 §4.3 0.45~0.65s）
//            + pulseAt(1.0, 0.8)（叉口火花，pathT 1.0 = 主干末点 = 叉口）
//   拍3 入盒：setAbsorbers(两盒位置, r=1.5, on) + setFlow('s3split')（减速入盒，简报 §3.3.1）；
//            meta 盒 intensity 0→1（写更新）、facet 盒 80ms 边线闪灰（复用确认）后灭
//   结算：两支河退潮变细 setInfoVolume(STATS.metaInfo + STATS.facetInfo × 0.7)
//         （任务给定公式，简报 §4.3「全部结算后两支河变细」）
//
// 相机（简报 §4.3 / §5「相机少犹豫」）：enter (0, 0.35, 6) lookAt (0, 0.4, -8)；
// scrub 单调推进到 (0, 0.7, -6)（看叉口与两盒），不回摆。
//
// 文案锚点：PLAN §2.2 S3 原文为基线；lead 数字口径按演出基线调整（演出化调整，
// 2026-08-06：PLAN「几百个会话」与合成数据 11 个会话矛盾，观众跨站对比露馅，改「十几个会话」）；
// 大字/小字分层与合成标注措辞诚实不变。
//
// 决策记录（简报 §0.6：参数是基线，改了要能说出为什么）：
//   1. 线宽：WebGL 线宽钳制 1px，「1.5px 边线 / 0.5px 细边」用亮度与透明度区分
//      （meta 青 0.15→1.0 vs facet 灰 0.4），简报 §4.3 允许「线框 mesh 或发光材质
//      做视觉近似」。
//   2. 外晕 8~12px：用 1.35× 透明加法混合盒壳（简报 §4.3 认可的「略大透明盒」），
//      相机距盒 ~17~29 单位处约合 6~11px（视角换算），opacity 与 intensity 联动。
//   3. 标签语义（演出化调整，2026-08-06，演出基线优先）：「SET · written」→「WRITE · 写更新」
//      （meta 盒）、「HIT · mtime=」→「REUSE · 复用确认」（facet 盒）—— 原「HIT · mtime=」
//      以等号结尾像截断 bug，英文术语对观众不透明；仍不补数值（合成数据里没有真实 mtime），
//      但语义改为观众可读的中文对照，不再出现等号。
//   4. 入盒速度：简报 §4.3 拍3「×1.3 加速」与 §3.3.1「分流后减速」冲突，river.js
//      已裁定减速入盒（s3split 0.06），本场景遵循 river 决议（任务亦写「减速入盒」）。
//   5. 退潮公式按任务给定（metaInfo + facetInfo×0.7 = 237.6）：log1p 压缩下该值仅
//      比全量 258 窄 ≈2%，肉眼可感的「变细」主要由吸收（粒子入盒渐隐）承担；
//      如需更显著的退潮可调系数，改此一行即可。
//   6. 终点 lookAt：简报只给了 enter lookAt (0, 0.4, -8) 与终点相机位，未给终点
//      lookAt —— 取叉口 (0, 0.5, -13) 与两盒 (y≈0.2, z=-23) 之间的 (0, 0.45, -15)，
//      单调向不回摆。
//   7. 节拍触发点：s1 在 enter 直接开播（部分打在 gate 黑场里）；s3 改为首帧 scrub
//      触发 —— gate 预挂期（黑场）不 scrub，节拍全部落在观众可见时段，不浪费。

import * as THREE from 'three'
import gsap from 'gsap'
import { RIVER } from '../river.js'
import { STATS } from '../data/sessions.js'
import { COLORS } from '../theme.js'
import { easeInOutQuad, clamp01, scrubFade, rampCamera } from '../utils.js'

// ---------- 场景常量（简报 §2.3 / §4.3） ----------
const META_C = COLORS.mono // meta 青（theme.js 单一来源）
const EDGE_FACET = 0x7a5a68 // facet 细边暗粉灰（0.5px 视觉近似；原纯灰 0x66707e
// 在暗背景上完全消失,略带品红倾向让「哑盒属于 facet 支」可读,grok 复核,2026-08-05）
const EDGE_FLASH = 0xdfe9f5 // facet 确认闪青白（80ms，简报 §4.3「收到碰触闪一下」；
// 原灰闪 0xc8d2e0 在 30fps 抽帧下不可见,grok 复核提亮,2026-08-05）
const ABSORB_R = 1.5 // 吸收半径（任务规格，覆盖盒体 + 外晕区）
const BOX_W = 1.2
const BOX_H = 1.6
const BOX_D = 1.2 // 简报 §4.3：BoxGeometry(1.2, 1.6, 1.2)
const HALO_SCALE = 1.35 // 外晕壳缩放（决策记录 2）

// 相机（简报 §4.3 / §5）：enter 定位 / scrub 单调推进；lookAt 终点见决策记录 6
// 2026-08-05 grok 复核修正三轮：
//   ① 原终点 (0,0.7,-6) 推进过深 —— 主干横穿相机、分叉缩成细线；
//   ② 收敛 (0,0.5,2) 后分支几何外移(±4.8,展开角 ~35°)投影仍是一条水平细线
//      (分支在 XZ 平面展开、相机同高度 → 投影纵向分量 ≈0,无 Y 形张开);
//   ③ 相机终点升高到 (0,3,2) 俯视叉口 —— 俯视 XZ 平面 = 经典 Y 形视角
//      (数学验证:分支端点投影 ≈(42%,43%)/(58.5%,42.4%),叉口 (50%,50%),
//      横向 ±8.5% + 纵向 ±7.5% 的张开,一眼可读)
const CAM_ENTER = new THREE.Vector3(0, 0.35, 6)
const CAM_END = new THREE.Vector3(0, 3, 2)
const LOOK_ENTER = new THREE.Vector3(0, 0.4, -8)
const LOOK_END = new THREE.Vector3(0, 0.5, -13)

// river 为必传参数（main.js 引擎级创建共享河，本站只用不建不毁）
export function createS3({ scene, camera, uiEl, river }) {
  let disposed = false

  // ---------- 缓存盒位置（与 shader 内路径采样同源，river.js RIVER 对象） ----------
  const metaPos = RIVER.getBranchEnd('meta') // (2.7, 0.2, -23)
  const facetPos = RIVER.getBranchEnd('facet') // (-2.5, 0.1, -23)

  // ---------- 缓存盒（简报 §4.3：同几何、不同能量 —— 形状一致，只关 emissive；无光照场景，发光 = 强度） ----------
  const boxGeo = new THREE.BoxGeometry(BOX_W, BOX_H, BOX_D)
  const edgeGeo = new THREE.EdgesGeometry(boxGeo)
  const haloGeo = new THREE.BoxGeometry(BOX_W * HALO_SCALE, BOX_H * HALO_SCALE, BOX_D * HALO_SCALE)

  // meta 盒（Write/更新）：青填充（加法混合 = 自发光强度）+ 青边线 + 外晕壳
  const metaFill = new THREE.Mesh(
    boxGeo,
    new THREE.MeshBasicMaterial({
      color: META_C,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: true,
    })
  )
  const metaEdge = new THREE.LineSegments(
    edgeGeo,
    new THREE.LineBasicMaterial({ color: META_C, transparent: true, opacity: 0.15 })
  )
  const metaHalo = new THREE.Mesh(
    haloGeo,
    new THREE.MeshBasicMaterial({
      color: META_C,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  )
  metaFill.position.copy(metaPos)
  metaEdge.position.copy(metaPos)
  metaHalo.position.copy(metaPos)
  scene.add(metaFill, metaEdge, metaHalo)

  // facet 盒（Hit/复用）：暗底 + 灰细边、无外晕；收到碰触闪灰 80ms 后灭（简报 §4.3）
  const facetFill = new THREE.Mesh(
    boxGeo,
    new THREE.MeshBasicMaterial({
      color: 0x1a1e26, // 暗底（复用 = 不发光）
      transparent: true,
      opacity: 0.55,
      depthWrite: true,
    })
  )
  const facetEdge = new THREE.LineSegments(
    edgeGeo,
    new THREE.LineBasicMaterial({ color: EDGE_FACET, transparent: true, opacity: 0.4 })
  )
  facetFill.position.copy(facetPos)
  facetEdge.position.copy(facetPos)
  scene.add(facetFill, facetEdge)

  // intensity 驱动（meta：Idle 轮廓 15% alpha → 满亮 + 外晕联动）
  const setMetaIntensity = (i) => {
    metaFill.material.opacity = i
    metaEdge.material.opacity = 0.15 + 0.85 * i
    metaHalo.material.opacity = 0.45 * i
  }
  // facet 确认闪：闪灰（读到了）→ 灭回基线灰（不维持发光，「不是死寂」，简报 §4.3）
  const _facetBase = new THREE.Color(EDGE_FACET)
  const _flashC = new THREE.Color(EDGE_FLASH)
  const setFacetFlash = (v) => {
    facetEdge.material.color.copy(_facetBase).lerp(_flashC, clamp01(v))
    facetEdge.material.opacity = 0.4 + 0.6 * clamp01(v)
  }
  setMetaIntensity(0)
  setFacetFlash(0)

  // ---------- 标签（字即图形，简报 §4.3）：极小等宽字符，3D 盒顶投影到屏幕坐标，update 每帧刷新 ----------
  const labelMeta = document.createElement('span')
  labelMeta.className = 's3-label s3-label-meta'
  labelMeta.textContent = 'WRITE · 写更新' // meta 是统计 → 写更新（演出化调整：原「SET · written」，见决策记录 3）
  const labelFacet = document.createElement('span')
  labelFacet.className = 's3-label s3-label-facet'
  labelFacet.textContent = 'REUSE · 复用确认' // facet 是判定 → 复用确认（演出化调整：原「HIT · mtime=」，见决策记录 3）
  uiEl.appendChild(labelMeta)
  uiEl.appendChild(labelFacet)

  // 盒顶锚点（投影用：标签贴在盒上沿）
  const metaTop = metaPos.clone().add(new THREE.Vector3(0, BOX_H / 2, 0))
  const facetTop = facetPos.clone().add(new THREE.Vector3(0, BOX_H / 2, 0))

  // ---------- 文案（PLAN §2.2 S3 原文为基线，lead 数字口径按演出基线调整（演出化调整，见文件头注释）；
  //           大字/小字分层，滚动 0.2~0.75 浮现） ----------
  const copy = document.createElement('div')
  copy.className = 's3-copy'
  copy.innerHTML = `
    <p class="s3-lead">十几个会话，每次都从头分析太慢。</p>
    <div class="s3-body">
      <p>引擎有两层缓存：meta 是算得出来的统计 —— 时长、工具次数、token 消耗，文件没变就复用；facet 是模型才判断得了的语义标签 —— 目标、满意度、摩擦，每次抽取都花 token，所以保守。</p>
      <p>两层分开存，更新互不误伤。成本与确定性不同，待遇就不同。</p>
    </div>
    <p class="s3-syn">本演示使用合成示例数据 · 分流比由合成会话的 token 统计而来</p>
  `
  uiEl.appendChild(copy)
  const leadEl = copy.querySelector('.s3-lead')
  const bodyPs = [...copy.querySelectorAll('.s3-body p')]
  const synEl = copy.querySelector('.s3-syn')

  // 拍1 汇聚（进入即设；共享河在黑场期已完成变宽，观众见到时已是最宽）：简报 §4.3
  river.setInfoVolume(STATS.totalInfo)
  river.setFlow('s3')
  // 河段窗口复位全河（画卷站界：S1 [0,0.35] / S2 [0.35,1] / S3 全河）
  river.setVisibleRange(0, 1)

  // ---------- 节拍（简报 §4.3 三拍；首帧 scrub 触发，避开 gate 预挂黑场期，决策记录 7） ----------
  let beats = null
  let started = false

  function runBeats() {
    const mix = { v: 0 } // 分叉 morph
    const mi = { v: 0 } // meta 盒 intensity
    const ff = { v: 0 } // facet 确认闪
    beats = gsap.timeline({ defaults: { ease: 'power2.out' } })
    // facet 闪灰序列：80ms 上亮 → 短暂峰值 → 灭回基线（峰值 ≈100ms，80ms 规格 + 余量）
    // REUSE 标签直接挂链尾 ——「闪结束后浮现」语义写在链上(原 flashSeq.duration()
    // 派生是运行时求隐式总长,追加内容会让时序悄悄漂移)
    const flashSeq = gsap.timeline()
    flashSeq
      .to(ff, { v: 1, duration: 0.08, ease: 'none', onUpdate: () => setFacetFlash(ff.v) })
      .to(ff, { v: 0, duration: 0.28, ease: 'power2.out', onUpdate: () => setFacetFlash(ff.v) }, '+=0.02')
      .to(labelFacet, { opacity: 1, duration: 0.3 })
    beats
      // 拍1 汇聚：信息量全量（第一幕最宽）短暂停留，让观众看见最宽段
      .to({}, { duration: 0.45 })
      // 拍2 分流：叉口火花 + 双色分叉 morph（0.5s,简报 §4.3 0.45~0.65s 缓动 ≈ 三次幂）
      .call(() => river.pulseAt(1.0, 0.8)) // pathT 1.0 = 主干末点 = 叉口
      // power3.inOut = gsap 三次幂缓动(easeInOutCubic 的 gsap 等价名;
      // 原 'easeInOutCubic' 非 gsap 内置名,时间线可能在此补间后停走,
      // 入盒节拍(absorbOn)从未触发 —— 2026-08-05 实测定位)
      .to(mix, { v: 1, duration: 0.5, ease: 'power3.inOut', onUpdate: () => river.setBranchMix(mix.v) }, '<')
      // 拍3 入盒：吸收开 + 减速入盒；meta 亮 / facet 闪灰（与吸收同刻）。
      // 用空对象补间 + onStart 触发(原 .call 回调在时间线走完后从未执行,
      // absorbOn 恒 0 —— 2026-08-05 实测定位;onStart 锚定补间起点,调度可靠)
      .to({}, {
        duration: 0.2,
        onStart: () => {
          river.setAbsorbers(metaPos, facetPos, ABSORB_R, true)
          river.setFlow('s3split')
        },
      })
      .add(flashSeq, '<')
      .to(mi, { v: 1, duration: 0.55, ease: 'power2.out', onUpdate: () => setMetaIntensity(mi.v) }, '<')
      // 标签与状态语义对齐（演出化调整，2026-08-06）：
      // WRITE 在 meta 亮起（写入中）同刻浮现；REUSE 挂 flashSeq 链尾 = facet
      // 确认闪结束后浮现并保持 ——「闪后保持」= 复用确认是持久状态，
      // 不跟 80ms 闪光一起灭（见 flashSeq 定义处）
      .to(labelMeta, { opacity: 1, duration: 0.3 }, '<')
      // 结算：两支河退潮变细（简报 §4.3；公式按任务给定，决策记录 5）
      .to({}, { duration: 0.3, onStart: () => river.setInfoVolume(STATS.metaInfo + STATS.facetInfo * 0.7) })
  }

  // ---------- 标签投影（3D 盒顶 → 屏幕坐标，每帧刷新） ----------
  const _pv = new THREE.Vector3()
  function projectLabels() {
    camera.updateMatrixWorld()
    const w = window.innerWidth
    const h = window.innerHeight
    const place = (el, pos) => {
      _pv.copy(pos).project(camera)
      if (_pv.z > 1 || _pv.z < -1) {
        // 盒在相机后方/超出远平面：隐藏，避免标签飘在视口角
        el.style.visibility = 'hidden'
        return
      }
      el.style.visibility = 'visible'
      el.style.left = `${(_pv.x * 0.5 + 0.5) * w}px`
      el.style.top = `${(-_pv.y * 0.5 + 0.5) * h}px`
    }
    place(labelMeta, metaTop)
    place(labelFacet, facetTop)
  }

  // ---------- 对外契约（对齐 MasterTimeline segment 生命周期） ----------
  // resize：标签投影依赖视口尺寸（相机移动由 scrub 重算）
  const onResize = () => projectLabels()
  let lastP = -1 // scrub p 判等（滚动静止时跳过重复写入；投影随相机静止免跑）
  return {
    enter() {
      // 相机定位（共享相机；S1 的初始位不属于本站，简报 §4.3 enter 定位）
      camera.position.copy(CAM_ENTER)
      camera.lookAt(LOOK_ENTER)
      window.addEventListener('resize', onResize)
    },
    scrub(p) {
      // 首帧 scrub = 本站成为当前视觉段（gate 预挂期间不 scrub）→ 入场节拍开播
      if (!started) {
        started = true
        runBeats()
      }
      if (p === lastP) return
      lastP = p
      // 文案浮现（滚动 0.2~0.75，简报 §4 站内滚动编排：大字 → 小字 → 合成标注）
      scrubFade(leadEl, p, 0.2, 0.32)
      scrubFade(bodyPs[0], p, 0.3, 0.45, 0)
      scrubFade(bodyPs[1], p, 0.45, 0.6, 0)
      scrubFade(synEl, p, 0.65, 0.75, 0)
      // 相机：单调推进看叉口与两盒（简报 §5「相机少犹豫」，不回摆）
      rampCamera(camera, CAM_ENTER, LOOK_ENTER, CAM_END, LOOK_END, easeInOutQuad(p))
      projectLabels() // 相机动了 → 标签投影重算（原在 update 每帧空转，现随相机移动执行）
    },
    dispose() {
      if (disposed) return
      disposed = true
      beats?.kill()
      gsap.killTweensOf([labelMeta, labelFacet]) // 兜底：label 补间若脱离 beats 也一并清
      window.removeEventListener('resize', onResize)
      scene.remove(metaFill, metaEdge, metaHalo, facetFill, facetEdge)
      boxGeo.dispose()
      edgeGeo.dispose()
      haloGeo.dispose()
      metaFill.material.dispose()
      metaEdge.material.dispose()
      metaHalo.material.dispose()
      facetFill.material.dispose()
      facetEdge.material.dispose()
      copy.remove()
      labelMeta.remove()
      labelFacet.remove()
    },
  }
}

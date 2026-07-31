// scenes/act-skeleton.js —— 三幕骨架场景（M1）
// M0 占位场景的正式继任者：幕色粒子星云 + 光河起点 + 幕标题覆盖层。
// 三幕共用本工厂（色彩 / 文案参数化），M3 起逐幕替换为真实站场景。
// 实现约束：WebGL2 + 原生 Three.js，粒子总量 ~3120、单 canvas，符合性能预算。
//
// 生命周期对齐 MasterTimeline segment：enter 构建挂载 → scrub(p) 标题视差
// → update(t, dt) 时间动画 → teardown 释放。渲染循环在模块内自持（rAF），
// scrub / update 只做同步，不参与渲染驱动。

import * as THREE from 'three'
import { COLORS } from '../theme.js' // 颜色单一来源（与 style.css 互指注释同步）

const NEBULA_COUNT = 3000 // 星云粒子数
const RIVER_COUNT = 120 // 光河起点粒子数
const RIVER_SPAN = 8 // 光河粒子铺满 x ∈ [-SPAN/2, SPAN/2]，逐粒子回卷范围

// 尊重动效偏好：reduce 时静止渲染（不自转/不漂移/不呼吸）
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * 创建一幕骨架场景。
 * @param {Object} opts
 *   - sceneEl: #scene 容器（3D 层，canvas 挂这里）
 *   - uiEl:    #ui 容器（DOM 层，幕标题覆盖层挂这里）
 *   - color:   幕色（COLORS.act1/2/3，星云粒子色）
 *   - title:   幕标题（如 "第一幕 · 数据"）
 *   - subtitle: 幕副标题（文案锚定 PLAN.md 三幕措辞）
 *   - showRestart: 是否显示"回到序章"（仅第一幕）
 *   - onRestart:   回到序章回调（main.js 提供）
 * @returns {{enter: () => void, scrub: (p: number) => void, update: () => void, dispose: () => void}}
 */
export function createActSkeleton({ sceneEl, uiEl, color, title, subtitle, showRestart = false, onRestart = null }) {
  // 防重复 enter / dispose 的守卫
  let disposed = false
  let started = false

  // ---------- 渲染器 ----------
  // WebGL2 渲染器：抗锯齿开、alpha 关（背景由 clearColor 决定）
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)) // 高分屏限 2x，控性能
  renderer.setClearColor(new THREE.Color(COLORS.bg), 1) // 深空黑蓝（theme 单一来源）
  sceneEl.appendChild(renderer.domElement)

  // ---------- 场景与相机 ----------
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000)
  camera.position.set(0, 0, 6)

  // resize：同步相机宽高比与渲染尺寸（dispose 时移除监听）
  const onResize = () => {
    const w = sceneEl.clientWidth || 1
    const h = sceneEl.clientHeight || 1
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
  }
  onResize()
  window.addEventListener('resize', onResize)

  // ---------- 粒子星云（幕色） ----------
  // 球壳/扁椭球分布：半径 3~5 随机，y 方向压扁 0.6 呈扁椭球
  const nebulaGeometry = new THREE.BufferGeometry()
  const nebulaPositions = new Float32Array(NEBULA_COUNT * 3)
  for (let i = 0; i < NEBULA_COUNT; i++) {
    // 单位球面均匀随机方向：经度均匀 + 纬度按 cos 加权（避免极点堆积）
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    const r = 3 + Math.random() * 2 // 半径 3~5 的球壳带
    const sinPhi = Math.sin(phi)
    nebulaPositions[i * 3] = r * sinPhi * Math.cos(theta)
    nebulaPositions[i * 3 + 1] = r * Math.cos(phi) * 0.6 // 压扁 → 扁椭球
    nebulaPositions[i * 3 + 2] = r * sinPhi * Math.sin(theta)
  }
  nebulaGeometry.setAttribute('position', new THREE.BufferAttribute(nebulaPositions, 3))
  const nebulaMaterial = new THREE.PointsMaterial({
    size: 0.05,
    color: new THREE.Color(color), // 幕色（三幕色彩叙事）
    transparent: true,
    opacity: 0.8,
    depthWrite: false, // 加法混合下关深度写，避免重叠粒子发黑
    blending: THREE.AdditiveBlending, // 叠加出星云辉光感
  })
  const nebula = new THREE.Points(nebulaGeometry, nebulaMaterial)
  scene.add(nebula)

  // ---------- 光河起点 ----------
  // 贯穿主体的第一笔：画面底部 y ≈ -2.2 的一行流动粒子
  // 逐粒子回卷（非整组位移）：每帧把 x 写回 [-SPAN/2, SPAN/2] 区间，
  // 保证可视区左右始终有粒子，回卷瞬间无跳变（120 个粒子开销可忽略）
  const riverGeometry = new THREE.BufferGeometry()
  const riverPositions = new Float32Array(RIVER_COUNT * 3)
  const riverBaseX = new Float32Array(RIVER_COUNT) // 初始 x 基准（用于流速叠加）
  for (let i = 0; i < RIVER_COUNT; i++) {
    riverBaseX[i] = -RIVER_SPAN / 2 + (RIVER_SPAN * i) / (RIVER_COUNT - 1) // 均匀铺满
    riverPositions[i * 3] = riverBaseX[i]
    riverPositions[i * 3 + 1] = -2.2
    riverPositions[i * 3 + 2] = (Math.random() - 0.5) * 0.06 // 微小 z 抖动，避免纯平面
  }
  riverGeometry.setAttribute('position', new THREE.BufferAttribute(riverPositions, 3))
  const riverMaterial = new THREE.PointsMaterial({
    size: 0.04,
    color: new THREE.Color(COLORS.mono), // 等宽数据色
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const river = new THREE.Points(riverGeometry, riverMaterial)
  scene.add(river)

  // ---------- 幕标题覆盖层 DOM（挂 #ui，类名与 style.css 契约一致） ----------
  // 文案措辞锚定 PLAN.md 三幕（数据 → 理解 → 生成），不虚构流程
  const overlay = document.createElement('div')
  overlay.className = 'act-skeleton'
  overlay.innerHTML = `
    <div class="act-title">${title}</div>
    <div class="act-sub">${subtitle}</div>
    <div class="act-scroll">滚动探索</div>
    ${
      showRestart
        ? `<button class="act-restart" type="button">回到序章</button>`
        : ''
    }
  `
  uiEl.appendChild(overlay)
  const restartBtn = overlay.querySelector('.act-restart')
  const onRestartClick = () => {
    if (onRestart) onRestart()
  }
  restartBtn?.addEventListener('click', onRestartClick)

  // ---------- 渲染循环（自持 rAF；scrub/update 只做同步） ----------
  let rafId = 0
  const clock = new THREE.Clock()
  const tick = () => {
    const t = clock.getElapsedTime()

    if (!reducedMotion) {
      // 星云缓慢自转（M1 不做顶点呼吸）
      nebula.rotation.y += 0.0008

      // 光河逐粒子回卷：流速 0.35 单位/秒，x 始终落在 [-SPAN/2, SPAN/2]
      const pos = riverGeometry.attributes.position.array
      for (let i = 0; i < RIVER_COUNT; i++) {
        let x = (riverBaseX[i] - t * 0.35) % RIVER_SPAN
        if (x < -RIVER_SPAN / 2) x += RIVER_SPAN
        pos[i * 3] = x
      }
      riverGeometry.attributes.position.needsUpdate = true

      // 明暗呼吸（最简实现：透明度正弦脉动，代替发光线段呼吸）
      riverMaterial.opacity = 0.75 + 0.18 * Math.sin(t * 1.6)

      // 相机轻微正弦漂移（与鼠标无关，幅度小），镜头始终看向原点
      camera.position.x = Math.sin(t * 0.21) * 0.18
      camera.position.y = Math.cos(t * 0.17) * 0.12
      camera.lookAt(0, 0, 0)
    }

    renderer.render(scene, camera)
    rafId = requestAnimationFrame(tick)
  }

  // ---------- 对外契约（对齐 MasterTimeline segment 生命周期） ----------
  return {
    // enter：挂载完成（canvas 与覆盖层已在构造函数中创建），启动渲染
    enter() {
      if (disposed || started) return
      started = true
      rafId = requestAnimationFrame(tick)
    },
    // scrub：段内进度 0~1 → 幕标题从下方 40px 升到原位（验证 scrub 通路，
    // M3 真实站替换为内容驱动的场景同步）
    scrub(p) {
      overlay.style.transform = `translateY(${(1 - p) * 40}px)`
    },
    // update：时间动画已由渲染循环自持（与 scrub 驱动分离），此处空实现
    update() {},
    // teardown：释放 GPU 资源、移除 canvas 与覆盖层 DOM、撤销监听
    dispose() {
      if (disposed) return
      disposed = true
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', onResize)
      restartBtn?.removeEventListener('click', onRestartClick)
      // 释放 GPU 资源：geometry / material（本场景未用纹理）
      nebulaGeometry.dispose()
      riverGeometry.dispose()
      nebulaMaterial.dispose()
      riverMaterial.dispose()
      renderer.dispose()
      // 移除 canvas 与覆盖层 DOM
      renderer.domElement.remove()
      overlay.remove()
    },
  }
}

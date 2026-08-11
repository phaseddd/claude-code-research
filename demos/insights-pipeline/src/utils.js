// utils.js —— 场景与内核共享小工具（消除跨文件复制粘贴；改一处全部生效）
// 契约：纯函数 + 无状态，不依赖具体场景概念
import * as THREE from 'three'

// ---------- 数值 ----------
export const clamp01 = (v) => Math.min(1, Math.max(0, v))
export const easeInOutSine = (x) => -(Math.cos(Math.PI * x) - 1) / 2
export const easeInOutQuad = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2)

// ---------- 滚动浮现文案（各站 scrub 共用）：p 在 [a,b] 内 0→1 淡入 + 上移 shiftPx ----------
export function scrubFade(el, p, a, b, shiftPx = 14) {
  const k = clamp01((p - a) / (b - a))
  el.style.opacity = String(k)
  el.style.transform = `translateY(${(1 - k) * shiftPx}px)`
}

// ---------- 相机沿路径 ramp：from/lookFrom → to/lookTo（内部自持临时量，避免每帧 new） ----------
const _look = new THREE.Vector3()
export function rampCamera(camera, from, lookFrom, to, lookTo, k) {
  camera.position.lerpVectors(from, to, k)
  camera.lookAt(_look.copy(lookFrom).lerp(lookTo, k))
}

// ---------- 相机沿多点路径 ramp（g1 门内滑轨用：path = 关键帧链，look 两端线性） ----------
// 与 rampCamera 同款内部暂存（避免每帧 new）；k 已缓动（easeInOutSine 等），
// 在路径链上分段线性插值 —— 镜头轨迹可复制河的 S 形扫掠，而非空间直线
const _lookPath = new THREE.Vector3()
export function rampCameraPath(camera, path, lookFrom, lookTo, k) {
  const n = path.length - 1
  const f = k * n
  const i = Math.min(Math.floor(f), n - 1)
  const u = f - i
  camera.position.lerpVectors(path[i], path[i + 1], u)
  camera.lookAt(_lookPath.copy(lookFrom).lerp(lookTo, k))
}

// ---------- 粒子纹理:64² 径向软斑 + smoothstep 外圈(禁止硬圆点,简报 §3.1) ----------
// 中心 alpha 1.0、半径 40% 内保持高亮、外 60% 指数衰减
export function makeSoftTexture() {
  const size = 64
  const data = new Uint8Array(size * size * 4)
  const r = size / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - r
      const dy = y + 0.5 - r
      const d = Math.sqrt(dx * dx + dy * dy) / r
      const i = (y * size + x) * 4
      let a
      if (d <= 0.4) a = 1.0 // 核心 40%:高亮保持
      else {
        const k = (d - 0.4) / 0.6
        a = Math.pow(1 - k, 2.2) // 外 60%:指数衰减
      }
      a = a * a * (3 - 2 * a) // smoothstep 平滑外圈
      data[i] = data[i + 1] = data[i + 2] = 255
      data[i + 3] = Math.round(a * 255)
    }
  }
  const tex = new THREE.DataTexture(data, size, size)
  tex.needsUpdate = true
  return tex
}

// ---------- 软圆粒子公共片元着色器（river 光河与 s2 星云共用同一柔光 FRAG） ----------
export const SOFT_POINT_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  varying float vAlpha;
  varying vec3  vColor;

  void main() {
    vec4 tex = texture2D(uMap, gl_PointCoord);
    gl_FragColor = vec4(vColor, vAlpha) * tex;
  }
`

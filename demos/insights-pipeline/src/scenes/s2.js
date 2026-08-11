// s2.js —— 第一幕 S2「扫盘」会话星云(设计简报 §4 S2,264~286 行)
//
// 契约(与 main.js 装配一致):createS2({ scene, camera, uiEl, river })
//   → { enter, scrub, update, dispose }
//   scene / camera / river 由 main.js 共享(简报 §6.1:三站共享同一光河与坐标系);
//   渲染由 main.js 统一 renderer.render(scene, camera),本场景不自持 rAF、不渲染。
//   river 为必传（main.js 引擎级创建，backToPrologue 销毁；本站只用不建不毁）。
//
// 星云 = 单个 THREE.Points(一个 draw call,简报 §7.1「粒子 draw call = 1」):
//   亮星 = STATS.stars(合成会话,视觉锚点,亮度/色相 = 新旧)
//   中景星 / 远景尘 = 随机历史(数量自由,构成星云壮丽)
//   元会话星 = s12 isMeta(弃置角落:小、哑、无闪烁、缓慢下坠;
//   抽河时径向弹飞 + 暗红「拒绝」光闪,演出化调整(U3))
// 闪烁 / 展开 / 扫盘点亮 / 抽取转化全部在 shader 内做(attribute + uniform 驱动,
// 简报 §3.1「不做 JS 逐粒子循环」)—— 本场景零逐星循环。
//
// 节拍(gsap timeline,简报 §4 S2「3 拍 + 抽取转化」):
//   拍1 星云展开  星依次淡入散开(stagger 按 aPhase 错峰,禁止全体同步)
//   拍2 扫盘      亮光带(PlaneGeometry,additive)扫过星云 ≈0.9s,扫过的星在
//                 shader 内 亮度 += 扫描带(uScanT/uScanGlow 推进)
//   拍3 抽河      0~0.4s 近中景星位置 lerp 向河采样点(RIVER.getMidPoint() 附近)
//                 → 0.4~1.2s 星→粒子转化(缩小变暗、色转入 river.body 蓝)
//                 → 1.2~3.5s 主流成形:河宽随已抽取量变宽(全量最宽)+ setFlow('s2')
//                 + pulseAt(0.5, 1);元会话不入河,被弹飞 + 暗红光闪后淡出(弃置演出,U3);
//                 完成后星云 dim ×0.55

import * as THREE from 'three'
import gsap from 'gsap'
import { RIVER, COL as RIVER_COL, RIVER_SPLIT } from '../river.js'
import { STATS, starBrightness } from '../data/sessions.js'
import { makeSoftTexture, SOFT_POINT_FRAG, easeInOutQuad, scrubFade, rampCamera } from '../utils.js'

// ---------- 星云色(简报 §2.3 river 色阶 + §4.2 新旧梯度) ----------
const COL = {
  starNew: new THREE.Color('#C8ECFF'), // 新星:冷白(mtime 越新越亮越白,简报 §4.2)
  starOld: new THREE.Color('#5A7A9A'), // 旧星:灰蓝降饱和
  mid: new THREE.Color('#A9C8F2'), // 中景星基色
  far: new THREE.Color('#5D83AF'), // 远景尘基色
  scan: new THREE.Color('#B8E7FF'), // 扫盘光带(river.core 同色相)
}
// 抽河转化目标色 = 河当前 body 色(river.js 单一来源;原复制旧蓝 #4AA8FF
// 与转青后的河色漂移 ~22° 色相,2026-08-05 已修正)
const BODY_BLUE = RIVER_COL.body
const TAU = 18 // 新旧梯度时间常数(简报 §4.2:τ ≈ 14~21 天)
const META_FALL = 0.03 // 元会话星下坠速率(局部坐标单位/秒,缓慢)

// ---------- 星云几何 ----------
// 椭球半径(简报 §4 S2:半径 ~3.2 × 2.2 × 1.8),group 倾斜 14.3°(12~18° 区间,
// 简报 §4.2「避免正对相机的平面感」)——绕 x 轴倾斜,长轴保持水平,扫盘沿长轴水平扫。
// 2026-08-05 画卷复核 ×1.25(grok:S2 星云读成「河的一个结」而非「会话星云天体」,
// 体积偏小 2~3 倍)—— 相机 scrub 末距星云 4.57 时星云占屏 ~73% 高(原 58%),
// 配套补点维持密度(中景 150→190、远景 350→430,简报 §4.2「数量自由」条款)
const RX = 4.0
const RY = 2.75
const RZ = 2.25
const TILT = 0.25 // ≈14.3°,简报 §4.2:12~18°
// 扫描带参数(拍2):带中心沿局部 x 从一侧扫到另一侧;带半宽 0.35 世界单位
// (与扫盘平面纹理的 sigma 匹配:平面宽 3.6 → 纹理 u±0.18 → 世界 ±0.32,同量级)
const SCAN_MIN = -3.4
const SCAN_MAX = 3.4
const SCAN_W = 0.35
const SCAN_GLOW = 0.5 // 扫过星云的星 亮度 += uScanGlow × 带形(微微点亮)
// 抽河目标:河采样点(RIVER.getMidPoint() 附近)——局部坐标 = 星云中心 + 微抬
// (星云中心就位在河主干 t=0.5 处,微抬让星收敛到河身中轴附近而非路径线上一点)
const EXTRACT_TARGET = new THREE.Vector3(0, 0.15, 0)

// ---------- 层规格(简报 §4.2 星点三层 + 元会话星) ----------
// count: 亮星 = 合成会话数(数据即物体);中景 30% / 远景 70%(暗星 500,简报「数量自由」)
const LAYER = {
  bright: { sizeMin: 2.5, sizeMax: 4.0 }, // 亮而大,视觉锚点
  mid: { count: 190, sizeMin: 1.2, sizeMax: 2.2, brightMin: 0.45, brightMax: 0.75 }, // 25~35%(×1.25 放大补密度)
  far: { count: 430, sizeMin: 0.6, sizeMax: 1.2, brightMin: 0.08, brightMax: 0.25 }, // 55~70%(同上)
}
const Z14 = 14 // 尺寸基线深度(与 river.js 同约定:aSize = px·14/300,shader 300/z 还原)

// ---------- 着色器(软圆粒子复用光河 fragment 的柔光思路:64² 软斑 + smoothstep) ----------
const VERT = /* glsl */ `
  attribute float aSize;    // 星尺寸 px@z≈14(river 同约定:px·14/300)
  attribute float aBright;  // 星基亮度(CPU 已折入层内随机抖动)
  attribute vec3  aColor;   // 星基色(亮星 = 新旧梯度;暗星 = 层内蓝白变化)
  attribute float aPhase;   // hash(id) 随机相位:闪烁错峰 + 展开 stagger 复用
  attribute float aPeriod;  // 闪烁周期 1.8~4.5s(非同步,简报 §4.2)
  attribute vec3  aDrift;   // 微漂振幅(近景极慢 / 中景微漂 / 远景几乎静;有界 sin)
  attribute float aFlick;   // 闪烁振幅(近景 ±0.18 / 远景 ±0.08 / 元会话 0)
  attribute float aFall;    // 元会话星缓慢下坠速率(其余 0;aFall>0 ⇔ 元会话)
  attribute float aExtract; // 抽河标记(近中景 1:被勾向河床 / 远景尘与元会话 0)

  uniform float uTime;
  uniform float uReveal;        // 拍1 展开 0→1(星按 aPhase 错峰依次淡入散开)
  uniform float uScanT;         // 拍2 扫盘 0→1(亮光带推进;星亮度 += 扫描带)
  uniform float uScanGlow;      // 拍2 光带强度(带 uScanT 推进,扫过即微亮)
  uniform float uExtract;       // 拍3a 0→1 星位置 lerp 向河采样点
  uniform vec3  uExtractTarget; // 河采样点(星云局部坐标)
  uniform float uConvert;       // 拍3b 0→1 星→粒子转化(缩小变暗,色转入 river.body)
  uniform float uDim;           // 拍3c 0→1 星云整体 dim ×0.55(河成为焦点)
  uniform float uReject;        // 元会话星弃置演出(演出化调整(U3)):0→1→0 一次性「拒绝」脉冲
  uniform vec3  uBodyBlue;      // river.body 当前色(转化目标色)
  uniform float uPixelRatio;    // DPR(已钳制 2)
  uniform sampler2D uMap;       // 64² 软斑纹理

  varying float vAlpha;
  varying vec3  vColor;

  const float TWO_PI = 6.2831853;
  const float SCAN_MIN = -3.4; // 扫盘带中心范围(局部 x,与 JS 侧 SCAN_MIN/SCAN_MAX 同步)
  const float SCAN_MAX = 3.4;
  const float SCAN_WC = 0.35;
  // 元会话星弃置演出参数(演出化调整(U3);与 JS 侧 META_FALL 配合):
  //   META_FLING —— 抽河时径向弹飞距离(原 aFall×2≈0.06 单位肉眼不可读,
  //                  1.4 ≈ 星云半径 1/3,「弹出去」可读)
  //   META_REJECT_COL / META_REJECT_I —— 暗红「拒绝」光闪的色与亮度脉冲
  //                   (只一次,不做常驻;原亮度 0.12 太暗,脉冲 1.6 才可见;
  //                   尺寸同步 ×(1+rej×1.8),2px 小点放大才读得到「闪」)
  //   META_REJECT_HIDE —— 抽河期间熄灭窗口系数(rej 达 0.5 前星已不可见,
  //                   弹飞动作由 META_FLING 承担,熄灭只是陪衬)
  const float META_FLING = 1.4;
  const vec3  META_REJECT_COL = vec3(0.66, 0.19, 0.22);
  const float META_REJECT_I = 1.6;
  const float META_REJECT_HIDE = 2.0;

  void main() {
    // 微漂(有界振荡):振幅在 aDrift,相位与闪烁同源(错峰)
    vec3 pos = position + aDrift * sin(uTime * 0.5 + aPhase * 2.0);
    // 元会话星:缓慢下坠(单调;简报 §4.2「可选缓慢下坠」);
    // 抽河期间不入河 —— 向外抛散(grok 复核:单纯淡出不可读,
    // 「旁路拒绝」需个体动画,2026-08-05 修正;normalize(position) = 远离星云中心)
    // 演出化调整(U3):外抛轨迹加强 —— 原 aFall×uExtract×2(≈0.06 单位)看不到;
    // 改专用系数 META_FLING,抽河时被径向弹飞 ≈1.4 单位,「弃置」动作可读
    float isMeta = step(0.001, aFall); // aFall>0 ⇔ 元会话星(全 shader 共用判定)
    pos.y -= aFall * uTime;
    pos += normalize(position) * isMeta * uExtract * META_FLING;

    // 抽河(拍3a):近中景星位置 lerp 向河采样点,带少量抖动避免聚成一点;
    // r = aPhase 归一化,抽取按相位错峰(0~0.4s 内依次被「勾」出)
    float r = aPhase / TWO_PI;
    float pull = aExtract * clamp((uExtract - r * 0.3) / 0.7, 0.0, 1.0);
    vec3 jitter = vec3(sin(aPhase * 7.0), cos(aPhase * 5.0), sin(aPhase * 11.0)) * 0.15;
    pos = mix(pos, uExtractTarget + jitter, pull);

    // 亮度分量(闪烁非同步 + 扫盘带点亮(拍2) + 抽河后星云整体 dim ×0.55(拍3c);
    // intensity 的声明与计算在下方弃置演出块内,只此一处,避免重复声明)
    float flick = 1.0 + aFlick * sin(TWO_PI * uTime / aPeriod + aPhase);
    float scanX = mix(SCAN_MIN, SCAN_MAX, uScanT);
    float band = uScanGlow * exp(-pow((position.x - scanX) / SCAN_WC, 2.0));
    float dim = 1.0 - 0.45 * uDim;

    // 展开(拍1):按 aPhase 错峰依次淡入散开(禁止全体同步闪)
    float reveal = smoothstep(r * 0.65, r * 0.65 + 0.35, uReveal);

    // 星→粒子转化(拍3b):被勾走的星缩小变暗、色转入 river.body 蓝;
    // 元会话不入河(aExtract=0),抽河期间边缘淡出
    float conv = aExtract * clamp((uConvert - r * 0.3) / 0.7, 0.0, 1.0);
    float remain = 1.0 - conv;
    // 元会话星:演出化调整(U3)原「抽河一开始就熄灭」(0~0.5 窗口,未飞出已消失);
    // 改为随「拒绝」脉冲淡出 —— 弹飞 + 红闪全程可见(满亮 2.1~2.73s 随 hold,
    // 2.73~3.33s 随缓衰渐隐),观众看到「弹出去 → 红光 → 熄灭」完整动作;
    // 展开/扫盘期间(uExtract≈0)星照常显示,reduced-motion(uReject=0)直接熄灭
    float metaHide = smoothstep(0.15, 0.55, uExtract) * (1.0 - clamp(uReject * META_REJECT_HIDE, 0.0, 1.0));
    float fade = 1.0 - isMeta * metaHide;

    // 元会话星弃置演出(演出化调整(U3)):抽河同帧的一次性暗红「拒绝」光闪
    // (uReject 0→1→0,只一次,不做常驻)+ 亮度脉冲 ——「这不是你的对话」有身体感;
    // 其余星(uReject 无效、isMeta=0)不受影响,颜色/亮度路径不变
    float rej = isMeta * uReject;
    vec3 col = mix(aColor, uBodyBlue, conv);
    col = mix(col, META_REJECT_COL, rej);
    // intensity 全 shader 唯一声明处(上方只备好分量;避免同作用域重复声明)
    float intensity = aBright * flick * dim + band;
    intensity = mix(intensity, META_REJECT_I, rej);

    vAlpha = reveal * remain * fade;
    vColor = col * intensity;

    // 元会话星拒绝光闪期间尺寸放大(演出化调整(U3)):2px 小点闪红肉眼不可读,
    // 峰值 ×2.8 让「闪」有身体感(只影响 isMeta 星,其余星 sizeScale 不变)
    float sizeScale = (0.15 + 0.85 * reveal) * (1.0 - 0.85 * conv) * (1.0 + rej * 1.8);
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = clamp(aSize * uPixelRatio * (300.0 / -mv.z), 1.0, 96.0) * sizeScale;
    gl_Position = projectionMatrix * mv;
  }
`

// 扫盘光带纹理:横向单高斯透明度渐变(中心亮、两侧指数衰减),
// 平面宽 3.6 → u±0.18 ↔ 世界 ±0.32,与 shader 扫描带半宽 0.35 同量级
function makeScanTexture() {
  const w = 256
  const c = document.createElement('canvas')
  c.width = w
  c.height = 16
  const ctx = c.getContext('2d')
  const img = ctx.createImageData(w, 16)
  for (let x = 0; x < w; x++) {
    const u = (x / (w - 1)) * 2 - 1
    const a = Math.exp(-Math.pow(u / 0.18, 2)) * 0.85
    for (let y = 0; y < 16; y++) {
      const i = (y * w + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255
      img.data[i + 3] = Math.round(a * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
  return new THREE.CanvasTexture(c)
}

// ---------- 星点生成 ----------
function randUnit() {
  const z = Math.random() * 2 - 1
  const a = Math.random() * Math.PI * 2
  const rr = Math.sqrt(1 - z * z)
  return [rr * Math.cos(a), rr * Math.sin(a), z]
}

// 椭球内 + 中心密度偏高的拒绝采样(边缘疏,星云有体积感)
function sampleStar() {
  for (let i = 0; i < 64; i++) {
    const x = (Math.random() * 2 - 1) * RX
    const y = (Math.random() * 2 - 1) * RY
    const z = (Math.random() * 2 - 1) * RZ
    const q = (x / RX) ** 2 + (y / RY) ** 2 + (z / RZ) ** 2
    if (q <= 1 && Math.random() < 1 - 0.72 * q) return [x, y, z]
  }
  return [(Math.random() * 2 - 1) * RX * 0.7, (Math.random() * 2 - 1) * RY * 0.7, 0]
}

// 亮星位置:近景(相机侧 z>0.15)+ 两两最小间距 0.55(12 颗内不叠星)
function sampleBright(existing) {
  for (let k = 0; k < 400; k++) {
    const x = (Math.random() * 2 - 1) * RX
    const y = (Math.random() * 2 - 1) * RY
    const z = 0.15 + Math.random() * 1.6
    const q = (x / RX) ** 2 + (y / RY) ** 2 + (z / RZ) ** 2
    if (q > 1) continue
    if (existing.every((p) => Math.hypot(p[0] - x, p[1] - y, p[2] - z) > 0.55)) return [x, y, z]
  }
  return [(Math.random() * 2 - 1) * 2.2, (Math.random() * 2 - 1) * 1.5, 0.4]
}

// ---------- 场景工厂 ----------
// river 为必传参数（main.js 引擎级创建共享河，本站只用不建不毁）
// 开场相机位导出给 main.js 的 g1 门内滑轨（滑轨终点 = 本站 enter 位，无缝衔接）
export const S2_CAM_ENTER = new THREE.Vector3(0, 0.5, 13)
export const S2_LOOK_ENTER = RIVER.getMidPoint() // 星云中心 = 河主干 t=0.5 处(简报 §4 S2)
const S2_CAM_END = new THREE.Vector3(0, 0.35, 3.5) // scrub 终点（平移单调推进，lookAt 恒星云）

export function createS2({ scene, camera, uiEl, river }) {
  const nebulaCenter = S2_LOOK_ENTER

  // ---------- 星点数据:亮星(数据即物体)+ 中景 + 远景 + 元会话星 ----------
  const stars = [] // { pos:[x,y,z], size, bright, color, phase, period, drift, flick, fall, extract }
  const brightPoses = []

  // 亮星 = STATS.stars(合成会话;mtime 越新越亮,简报 §2.5 / §4.2)
  for (const s of STATS.stars) {
    // 亮度 = 新旧:brightness = mix(0.15, 1.0, exp(-ageDays/τ)),τ=18
    // (sessions.js starBrightness 已按简报修正为新星亮、旧星暗,直接调用)
    const bright = starBrightness(s.ageDays, TAU)
    // 色相 = 新旧:新星冷白 #C8ECFF → 旧星灰蓝 #5A7A9A(饱和随龄降)
    const k = Math.max(0, Math.min(1, 1 - (bright - 0.15) / 0.85))
    const pos = sampleBright(brightPoses)
    brightPoses.push(pos)
    stars.push({
      pos,
      // 尺寸随亮度(grok 复核:原尺寸与亮度无关 → 新旧梯度只靠亮度不够跳;
      // 新星大、旧星小,2026-08-05 修正)
      size: 2.2 + 2.4 * bright,
      bright,
      color: COL.starNew.clone().lerp(COL.starOld, k),
      phase: Math.random() * Math.PI * 2,
      period: 1.8 + Math.random() * 2.7,
      drift: randUnit().map((v) => v * (0.03 + 0.03 * Math.random())), // 近景极慢漂移
      flick: 0.18, // 近景振幅 ±18%(简报 §4.2)
      fall: 0,
      extract: 1,
    })
  }

  // 中景星(25~35%:微漂)与远景尘(55~70%:几乎静)
  for (const [key, cfg] of [['mid', LAYER.mid], ['far', LAYER.far]]) {
    for (let i = 0; i < cfg.count; i++) {
      const near = key === 'mid'
      stars.push({
        pos: sampleStar(),
        size: cfg.sizeMin + Math.random() * (cfg.sizeMax - cfg.sizeMin),
        bright: cfg.brightMin + Math.random() * (cfg.brightMax - cfg.brightMin),
        color: COL[key].clone().lerp(new THREE.Color(near ? '#D3E4FA' : '#7E9CC2'), Math.random()),
        phase: Math.random() * Math.PI * 2,
        period: 1.8 + Math.random() * 2.7,
        drift: randUnit().map((v) => v * (near ? 0.06 + 0.06 * Math.random() : 0.015 + 0.02 * Math.random())),
        flick: near ? 0.13 : 0.08, // 中景介于近景/远景之间;远景 ±8%(简报 §4.2)
        fall: 0,
        extract: near ? 1 : 0, // 抽河只勾近中景星(简报 §4 S2 拍3)
      })
    }
  }

  // 元会话星(简报 §4.2):尺寸 ×0.7、饱和度 ×0.25、亮度 0.12、无闪烁、缓慢下坠;
  // 位置放星云边缘角落(弃置感)——局部 (2.2, -1.4, -0.5) 在椭球内边缘;
  // 抽河时的弹飞 + 暗红「拒绝」光闪在 shader 内完成(演出化调整(U3))
  {
    const mc = new THREE.Color('#9AB4D0')
    const hsv = mc.getHSL({})
    mc.setHSL(hsv.h, hsv.s * 0.25, hsv.l)
    stars.push({
      pos: [2.2, -1.4, -0.5],
      size: LAYER.mid.sizeMin * 0.7, // ×0.7
      bright: 0.12,
      color: mc,
      phase: Math.random() * Math.PI * 2,
      period: 3.3,
      drift: [0, 0, 0],
      flick: 0, // 无闪烁
      fall: META_FALL, // 缓慢下坠
      extract: 0, // 不入河(简报 §4 S2:弃置星不入河)
    })
  }

  // ---------- Buffer(单 Points,一个 draw call) ----------
  const n = stars.length // 11 亮 + 150 中 + 350 远 + 1 元 ≈ 512
  const aPos = new Float32Array(n * 3)
  const aSize = new Float32Array(n)
  const aBright = new Float32Array(n)
  const aColor = new Float32Array(n * 3)
  const aPhase = new Float32Array(n)
  const aPeriod = new Float32Array(n)
  const aDrift = new Float32Array(n * 3)
  const aFlick = new Float32Array(n)
  const aFall = new Float32Array(n)
  const aExtract = new Float32Array(n)
  stars.forEach((s, i) => {
    aPos[i * 3] = s.pos[0]
    aPos[i * 3 + 1] = s.pos[1]
    aPos[i * 3 + 2] = s.pos[2]
    aSize[i] = (s.size * Z14) / 300 // 换算:shader 内 300/z 还原
    aBright[i] = s.bright
    aColor[i * 3] = s.color.r
    aColor[i * 3 + 1] = s.color.g
    aColor[i * 3 + 2] = s.color.b
    aPhase[i] = s.phase
    aPeriod[i] = s.period
    aDrift[i * 3] = s.drift[0]
    aDrift[i * 3 + 1] = s.drift[1]
    aDrift[i * 3 + 2] = s.drift[2]
    aFlick[i] = s.flick
    aFall[i] = s.fall
    aExtract[i] = s.extract
  })

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(aPos, 3))
  geo.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1))
  geo.setAttribute('aBright', new THREE.BufferAttribute(aBright, 1))
  geo.setAttribute('aColor', new THREE.BufferAttribute(aColor, 3))
  geo.setAttribute('aPhase', new THREE.BufferAttribute(aPhase, 1))
  geo.setAttribute('aPeriod', new THREE.BufferAttribute(aPeriod, 1))
  geo.setAttribute('aDrift', new THREE.BufferAttribute(aDrift, 3))
  geo.setAttribute('aFlick', new THREE.BufferAttribute(aFlick, 1))
  geo.setAttribute('aFall', new THREE.BufferAttribute(aFall, 1))
  geo.setAttribute('aExtract', new THREE.BufferAttribute(aExtract, 1))
  geo.drawRange.count = n

  const uniforms = {
    uTime: { value: 0 },
    uReveal: { value: 0 },
    uScanT: { value: 0 },
    uScanGlow: { value: 0 },
    uExtract: { value: 0 },
    uExtractTarget: { value: EXTRACT_TARGET.clone() },
    uConvert: { value: 0 },
    uDim: { value: 0 },
    uReject: { value: 0 }, // 元会话星弃置演出(U3):一次性脉冲,节拍内 0→1→0
    uBodyBlue: { value: BODY_BLUE.clone() },
    uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
    uMap: { value: makeSoftTexture() },
  }

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: SOFT_POINT_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false, // 与 river.js 同理由:additive 自遮挡破坏叠白观感
    blending: THREE.AdditiveBlending,
  })

  const points = new THREE.Points(geo, mat)
  points.frustumCulled = false

  // 星云组:整体倾斜 + 定位河中点
  const group = new THREE.Group()
  group.position.copy(nebulaCenter)
  group.rotation.x = TILT
  group.scale.setScalar(0.6) // 拍1 展开:从中心胀开(0.6 → 1)
  group.add(points)

  // 扫盘光带(拍2):细长平面,additive,透明度横向渐变;
  // 是 group 子物体(随倾斜),面朝相机(局部 XY,法线 +z),沿局部 x 扫
  const scanPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(3.6, 6.6),
    new THREE.MeshBasicMaterial({
      map: makeScanTexture(),
      color: COL.scan,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    })
  )
  scanPlane.position.x = SCAN_MIN
  scanPlane.frustumCulled = false
  scanPlane.renderOrder = 2 // 光带盖在星点之上(叠加亮带感)
  group.add(scanPlane)

  scene.add(group)

  // ---------- 文案(DOM 层,uiEl;逐字锚定 PLAN §2.2 S2,不得改写删减) ----------
  const copy = document.createElement('div')
  copy.className = 's2-copy'
  copy.innerHTML = `
    <p class="s2-big">引擎走进 <code class="s2-code">~/.claude/projects/</code>,枚举你所有的历史会话。</p>
    <div class="s2-small">
      <p>一条条 JSONL 消息日志。目录为空就空跑退出;有货就按时间从新到旧排队。</p>
      <p>特殊会话会被丢掉:<code class="s2-code">/insights</code> 自己产生的元会话,不是你的对话。</p>
    </div>
    <p class="s2-note">「本演示使用合成示例数据」—— 11 颗亮星为合成会话,1 颗元会话星被弃置,其余暗星为背景氛围。</p>
  `
  uiEl.appendChild(copy)
  const copyBig = copy.querySelector('.s2-big')
  const copySmall = copy.querySelectorAll('.s2-small p')
  const copyNote = copy.querySelector('.s2-note')
  gsap.set([copyBig, ...copySmall, copyNote], { opacity: 0, y: 14 })

  // ---------- 节拍(简报 §5 错峰:同一时刻只有一个动画在「动得明显」) ----------
  // 时间基线:拍1 0~0.9s / 拍2 1.1~2.0s / 拍3 2.1~5.6s(简报 §4 S2 拍3 三段时长)
  const scan = { t: 0 } // 扫盘推进代理(驱动 uniform 与平面位置,同一时间源)
  const syncScan = () => {
    uniforms.uScanT.value = scan.t
    scanPlane.position.x = SCAN_MIN + (SCAN_MAX - SCAN_MIN) * scan.t
    scanPlane.material.opacity = uniforms.uScanGlow.value / SCAN_GLOW
    scanPlane.visible = uniforms.uScanGlow.value > 0.001
  }
  // 河宽代理:走 river.setInfoVolume(公式单一来源在 river.js)。
  // 起始 = 当前实际宽(画卷连续性:S1 已注入 54,拍3 从 54 平滑 ramp 到全量 258,
  // 不从 0 重爬 —— 2026-08-05 站界不收缩配套)
  const flow = { info: river.getInfoVolume() ?? 0 }
  let tl = null

  function runBeats() {
    tl = gsap.timeline({ defaults: { ease: 'power2.out' } })
    tl
      // 拍1 星云展开:星依次淡入散开 + 星云从中心胀开
      .to(uniforms, { uReveal: 1, duration: 0.9, ease: 'power2.out' }, 0)
      .to(group.scale, { x: 1, y: 1, z: 1, duration: 1.1, ease: 'power3.out' }, 0)
      // 拍2 扫盘:亮光带扫过星云 ≈0.9s,扫过的星依次微微点亮(shader uScanT 推进)
      .to(scan, { t: 1, duration: 0.9, ease: 'power1.inOut', onUpdate: syncScan }, 1.1)
      .to(uniforms, { uScanGlow: SCAN_GLOW, duration: 0.12, ease: 'power1.out' }, 1.1)
      .to(uniforms, { uScanGlow: 0, duration: 0.3 }, 1.9)
      // 拍3 抽河(物质转化,简报 §4 S2 拍3):0~0.4s 勾向河床 → 0.4~1.2s 星→粒子转化
      .to(uniforms, { uExtract: 1, duration: 0.4, ease: 'power1.in' }, 2.1)
      // 元会话星弃置演出(演出化调整(U3)):抽河同帧,暗红「拒绝」光闪 0→1→0(只一次,
      // 不做常驻;与弹飞轨迹同步,光闪峰值 ≈ 弹飞前段)。峰值满亮 hold + 缓衰 ——
      // 太短的闪(0.2s 内灭)观众读不到,hold 让「被弹开的那颗在拒绝」有可读的一瞬。
      // 后两段用 '>' 相对前一段末尾,时长调整不手算位置链(原 2.28/2.73 手算)
      .to(uniforms, { uReject: 1, duration: 0.18, ease: 'power2.in' }, 2.1)
      .to(uniforms, { uReject: 1, duration: 0.45 }, '>')
      .to(uniforms, { uReject: 0, duration: 0.6, ease: 'power2.out' }, '>')
      .to(uniforms, { uConvert: 1, duration: 0.8, ease: 'power2.inOut' }, 2.5)
      // → 1.2~3.5s 主流成形:河宽随已抽取量变宽(全量最宽)+ 流速切 s2 + 星云抽火花
      .to(flow, {
        info: STATS.totalInfo,
        duration: 2.3,
        ease: 'power1.inOut',
        onUpdate: () => river.setInfoVolume(flow.info),
      }, 3.3)
      .to(uniforms, { uDim: 1, duration: 1.6, ease: 'power1.inOut' }, 3.5)
      .call(() => {
        river.setFlow('s2')
        river.pulseAt(0.5, 1) // 星云中点抽出火花(简报 §4 S2)
      }, null, 3.3)
  }

  // ---------- 生命周期 ----------
  let entered = false
  let lastP = -1 // scrub p 判等（滚动静止时跳过重复写入）
  return {
    enter() {
      // 定位相机(简报 §4.2 相机缓慢不抢戏):enter 定位 → scrub 单调推进;
      // 相机与 g1 门内滑轨终点精确衔接(画卷无缝,main.js 引用 S2_CAM_ENTER)
      camera.position.copy(S2_CAM_ENTER)
      camera.lookAt(nebulaCenter)
      // 河段窗口:右缘 → 叉口 [RIVER_SPLIT,1](开场河从右缘进入 = 承接 S1 出口,
      // 画卷不断流;站界单一来源 river.js RIVER_SPLIT,原字面量 0.35 手抄)
      river.setVisibleRange(RIVER_SPLIT, 1)
      // 宽度连续(2026-08-05 画卷重构):不归零 —— S1 已注满命中会话的信息量,
      // 站界收缩会暴露「河断了」的错觉;拍3 抽河再随抽取量 ramp 到全量最宽
      // (宽度叙事:源头窄 → S1 注入 → 星云汇聚最宽 → 分流变细)
      river.setFlow('idle')
      runBeats()
      entered = true
    },

    scrub(p) {
      if (!entered || p === lastP) return // p 判等：滚动静止时跳过（timeline 每帧都调 scrub）
      lastP = p
      // 相机:平移单调推进(简报 §4.2:orbit ≤ 4°/10s 量级,用平移不用旋转),
      // easeInOutQuad 稳(简报 §5 缓动速查:相机 easeInOutQuad)
      rampCamera(camera, S2_CAM_ENTER, nebulaCenter, S2_CAM_END, nebulaCenter, easeInOutQuad(p))
      // 文案浮现(滚动 0.2~0.75,逐字锚定):大字 → 小字 → 合成标注
      scrubFade(copyBig, p, 0.2, 0.32)
      scrubFade(copySmall[0], p, 0.34, 0.47)
      scrubFade(copySmall[1], p, 0.49, 0.62)
      scrubFade(copyNote, p, 0.64, 0.75)
    },

    update(t, dt) {
      if (!entered) return
      // 星云闪烁/微漂/下坠由 shader uTime 驱动
      // 共享河每帧推进由 main.js 统一执行（引擎级资产，本站不转发）
      uniforms.uTime.value += dt
    },

    dispose() {
      entered = false
      tl?.kill()
      scanPlane.material.map.dispose()
      scanPlane.material.dispose()
      scanPlane.geometry.dispose()
      uniforms.uMap.value.dispose()
      mat.dispose()
      geo.dispose()
      scene.remove(group)
      copy.remove()
    },
  }
}

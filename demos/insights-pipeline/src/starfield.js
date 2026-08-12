// starfield.js —— 序章星场（2026-08-12：DOM 520 星 → WebGL 粒子，恒星坍缩）
//
// 为什么换引擎（主人裁决「不要这么平静，我们可是 WebGL 技术栈」）：
//   DOM 容器均匀 scale 是仿射变换 —— 520 颗星组成矩形星区，等比缩放保留矩形
//   轮廓，收缩看起来是「一张星图被缩小」而非恒星在坍缩。真坍缩 = 壳层径向
//   逐星运动、外圈先动、末段加速、运动拉丝、核心挤压发光，均匀 scale 全给不了。
//
// 结构：序章 WebGL 层（星场 + 转场光罩）—— 同一透明 renderer、同一渲染循环、
//   同一 dispose 生命周期（2026-08-12 simplify 自述校正：不是单 mesh 单 draw call）。
//   ① 星场 = THREE.Points + ShaderMaterial：每星 (TRAIL+1) 个顶点（leader + 4 个
//      拖尾点），位置/尺寸/透明度全在顶点着色器由 attribute + uniform 算出，
//      CPU 每帧只写 3 个 uniform（uE / uCenter / uT），零顶点更新 —— GPU 侧动画；
//   ② 布光光罩 = PlaneGeometry(2,2) + fragment shader（renderOrder 1 盖在星场
//      之上，uBurst=0 时 visible=false 不参与渲染），白光从月球源点径向扩散。
//
// 恒星坍缩四签名（2026-08-12 主人裁决）：
//   1. 壳层外圈先动：aDelay = 0.22×(1−距环心距离)，外圈 delay≈0 立即动，
//      内圈 delay≈0.22 最后动 —— 波纹式向心塌缩；
//   2. 角动量守恒螺旋（2026-08-12 二次裁决「还是有方框感」）：纯径向收缩 ≡
//      以环心为原点的缩放 —— 矩形星区相似缩小仍是矩形，方框轮廓必然保留。
//      真坍缩伴随自转加速（ω ∝ 1/r²），每星绕中心转过角度 ∝ 收缩深度 ×
//      初始半径（外圈转得多），旋转打破同行同列关系 → 矩形边界溶解成旋臂流；
//   3. 运动拉丝：trail 点 e_t = e_i − 0.08×idx 沿径线滞后，拉开比例 = 显隐
//      （静止重合时 alpha 0，不叠亮）；
//   4. 核心挤压发光：近中心 × 收缩深 → alpha 最高 ×1.9（坍缩核心的亮团），
//      整体深度缩放 depth = 1 − 0.55×e_i（吸入纵深感）。
//
// 契约：
//   createStarfield({ container, pausedEl }) → { setE, setCenter, setBurst, dispose }
//   - container  挂载容器（fxEl，视差层；星场 canvas 随视差微动）
//   - pausedEl   停顿真空探测元素（.paused 时冻结心跳时间，规格 §1 80ms）
//   - setE(e)    收缩程度 0~1（由序章 progress^1.8 驱动，含回退）
//   - setCenter(ox, oy)  环心在 fxEl 局部坐标（px；每帧换算后喂入）
//   - setBurst(prog, moonUV)  月球布光：扩散进度 0~1 + 光源 NDC（首次调用点亮光罩）
//   - dispose    释放 GL 资源（disposeRenderer 契约）并移除 canvas
// 固定种子 LCG（与 DOM 版同契约：每次加载一致，可截图核验）
import * as THREE from 'three'
import { makeSoftTexture, SOFT_POINT_FRAG, disposeRenderer } from './utils.js'

let _seed = 42
const rnd = () => ((_seed = (_seed * 1664525 + 1013904223) % 4294967296) / 4294967296)

// ---------- 参数（修订 ⑤ 增密定稿；改了要能说出为什么） ----------
const STAR_N = 500 // 常驻星点
const HEART_N = 20 // 心跳星（4px 呼吸灯丝，> 常驻主星，主人裁决）
const TRAIL = 4 // 每星拖尾点数（运动拉丝）
const TRAIL_STEP = 0.08 // 拖尾沿径线滞后步长（leader 后 0.08×idx 收缩程度）
// 环心近似点（delay 距离基准）：环心实际 % ≈ (0.44, 0.74)（底部中央），
// 近似 (0.5, 0.78) 的误差只影响相邻星的先动次序，视觉不可辨 —— 避免 setCenter 依赖
const CENTER_UV = { x: 0.5, y: 0.78 }
const BREATH_OMEGA = (Math.PI * 2) / 1.5 // 心跳呼吸 1.5s 周期（原 CSS 同参）
// 漩涡系数（角动量守恒自转）：外圈星满收缩时转过 ≈1.2 × (r0/1.1) rad ≈ 62°，
// 螺旋吸入感（方框溶解的关键；调大 = 旋涡更急，0 = 退回纯径向）
const SPIN = 1.2
// ---------- 流星（2026-08-13 主人裁决：重做，弃「固定斜线匀速周期循环」） ----------
// 技法参考 three-comet-trail（固定池 + 段龄渐隐到黑 + additive 叠加头部聚亮）
// 与 meteor effect spec（随机出生 3~7s 间隔、随机边缘、随机角度/速度、1~2s 寿命）：
//   尾巴 = 200 段,只存在于头部走过的路径(出生点之后的段才可见,随头生长);
//   亮度 (1-k)^2.5 幂渐隐 —— 有效亮尾 ~3 成行程,头部由高密度叠加自动聚亮
const METEOR_N = 3 // 同屏上限
const METEOR_SEG = 200 // 段距 ≈ 行程/200 ≈ 17px,与头部点径重叠成连续彗尾
const METEOR_TRAVEL_MIN = 0.9 // 行程 NDC(0.45~0.8 屏宽,长但彗尾幂渐隐后有效亮尾克制)
const METEOR_TRAVEL_MAX = 1.6
const METEOR_FIRST_MIN = 0.8 // 首条出生窗口 0.8~2.3s(进场即见,不干等)
const METEOR_FIRST_SPREAD = 1.5
const METEOR_LIFE_MIN = 0.9 // 寿命 0.9~1.6s
const METEOR_LIFE_SPREAD = 0.7
const METEOR_GAP_MIN = 2 // 死后歇 2~6s 再投(随机出生 = 不机械)
const METEOR_GAP_SPREAD = 4
const METEOR_ANGLE_MIN = 25 // 屏面角 25~55° 下行,左右随机
const METEOR_ANGLE_SPREAD = 30

// ---------- 月球布光光罩（2026-08-12 二次裁决：WebGL 全屏光罩替代 DOM 渐变层） ----------
// 主人两处裁决：① 原 0.12s 扩散太快，看不出「从月球扫出」的过程；② 全白硬切
// S1 青色无过渡。光罩 = PlaneGeometry(2,2) + fragment shader（星场 renderer 内
// 第二个 mesh，renderOrder 1 盖在星场之上）：白光以月球（uMoonUV）为源点径向
// 扩散，颜色随进度白 → 青（S1 body 青雾同族），终点 = 半透明青雾罩全屏 ——
// 层交换后 S1 从青雾中现出，色彩连续。
// 终点青 = S1 body 雾池青 rgba(56,120,116,0.2)（style.css body 渐变）亮一档的
// 光源残留感。硬编码于此（光效色未入 theme.js 单一来源，2026-08-12 simplify 备注）
const BURST_COLOR = '#38B4C8'
const BURST_FRAG = /* glsl */ `
  uniform vec2  uMoonUV;   // 月球 NDC（光源源点）
  uniform float uBurst;    // 扩散进度 0~1
  uniform float uAspect;   // 宽高比（NDC 距离按屏幕像素等比）
  uniform vec3  uColor;    // 终点色（青）
  varying vec2  vUv;
  void main() {
    vec2 p = (vUv * 2.0 - 1.0) * vec2(uAspect, 1.0);
    vec2 m = uMoonUV * vec2(uAspect, 1.0);
    float d = length(p - m);
    float R = uAspect * 1.35;           // 覆盖全屏对角线
    float r = uBurst * R;
    float light = 1.0 - smoothstep(r - 0.18, r, d); // 光已扫过区全亮，前沿柔边
    vec3 col = mix(vec3(1.0), uColor, uBurst);      // 白 → 青（色彩过渡在扩散中完成）
    float alpha = light * (0.95 - 0.25 * uBurst);   // 终点降亮：青雾让位给 S1
    gl_FragColor = vec4(col, alpha);
  }
`

// ---------- 顶点着色器（恒星坍缩全在这；fragment 复用 SOFT_POINT_FRAG） ----------
// 坐标域：aUV = 0~1（fxEl 盒左上原点），NDC = ((uv*2−1), (1−uv*2))；
// uCenter 同域 NDC —— mix 在 NDC 域做，正交相机矩阵恒等（着色器不引用矩阵）
const VERT = /* glsl */ `
  attribute vec2  aUV;      // 初始位置 0~1（CSS % 语义）
  attribute float aSize;    // 基础像素尺寸（3/4/5）
  attribute float aAlpha;   // 基础透明度（常驻 0.1~0.6；心跳 1.0 由呼吸调制）
  attribute float aDelay;   // 收缩启动延迟（外圈≈0 先动 → 内圈≈0.22 后动）
  attribute float aHeart;   // 1 = 心跳星（呼吸灯丝）
  attribute float aPhase;   // 心跳相位（错峰）
  attribute float aTrail;   // 拖尾序号 0=leader / 1~4=尾迹

  uniform float uE;         // 收缩程度 0~1（序章 progress^1.8 驱动，含回退）
  uniform vec2  uCenter;    // 环心 NDC
  uniform float uT;         // 心跳时间（秒；.paused 时 JS 冻结）
  uniform float uDPR;       // 设备像素比（钳制 2）

  varying float vAlpha;
  varying vec3  vColor;

  void main() {
    // 1. 壳层外圈先动：delay 越小越先，uE 末段急加速由进度^1.8 曲线承担
    float e_i = clamp((uE - aDelay) / max(0.001, 1.0 - aDelay), 0.0, 1.0);
    // 2. 拖尾拉丝：trail 点沿径线滞后 e_i；拉开比例 = 显隐（静止重合 alpha 0）
    float e_t = max(0.0, e_i - aTrail * ${TRAIL_STEP.toFixed(2)});
    vec2 init = vec2(aUV.x * 2.0 - 1.0, 1.0 - aUV.y * 2.0);
    // 3. 角动量守恒螺旋：先旋转再径向收缩（外圈转过角度大 = 旋臂流）
    vec2 rel = init - uCenter;
    float r0 = clamp(length(rel) / 1.1, 0.0, 1.0);
    float spin = ${SPIN.toFixed(2)} * e_t * r0;
    float c = cos(spin);
    float s = sin(spin);
    vec2 rotRel = vec2(rel.x * c - rel.y * s, rel.x * s + rel.y * c);
    vec2 pos = uCenter + rotRel * (1.0 - e_t);
    float stretch = aTrail < 0.5 ? 1.0 : clamp((e_i - e_t) / (${(TRAIL * TRAIL_STEP).toFixed(2)}), 0.0, 1.0);
    // 4. 纵深吸入：整体深度缩放 + 核心挤压发光（近中心 × 收缩深 → 亮团）
    float depth = 1.0 - 0.55 * e_i;
    float sizeScale = depth * (aTrail < 0.5 ? 1.0 : 0.55 - 0.1 * aTrail);
    float alpha = aAlpha * (aTrail < 0.5 ? 1.0 : 0.65 - 0.13 * aTrail) * stretch;
    float distToC = clamp(length(pos - uCenter) * 1.1, 0.0, 1.0);
    alpha *= 1.0 + 0.9 * e_i * (1.0 - distToC);
    // 心跳呼吸（1.5s 周期，相位错开；uT 冻结 = 80ms 真空）
    if (aHeart > 0.5) {
      float b = 0.12 + 0.63 * (0.5 + 0.5 * sin(uT * ${BREATH_OMEGA.toFixed(5)} + aPhase));
      alpha *= b;
    }
    vAlpha = alpha;
    vColor = vec3(1.0); // 白（软点纹理 + additive = DOM 版 box-shadow 辉光的 GPU 版）
    gl_PointSize = aSize * uDPR * sizeScale * (aTrail < 0.5 ? 1.0 : 0.7);
    gl_Position = vec4(pos, 0.0, 1.0); // NDC 直写：相机矩阵恒等，正交投影
  }
`

export function createStarfield({ container, pausedEl }) {
  const nStars = STAR_N + HEART_N
  const n = nStars * (TRAIL + 1)

  // ---------- 生成 attribute（LCG 固定种子；每星 (TRAIL+1) 点共享 base） ----------
  const aUV = new Float32Array(n * 2)
  const aSize = new Float32Array(n)
  const aAlpha = new Float32Array(n)
  const aDelay = new Float32Array(n)
  const aHeart = new Float32Array(n)
  const aPhase = new Float32Array(n)
  const aTrail = new Float32Array(n)
  let i = 0
  for (let s = 0; s < nStars; s++) {
    const heart = s >= STAR_N ? 1 : 0
    const uv = { x: rnd() * 0.96 + 0.02, y: rnd() * 0.84 + 0.04 }
    const size = heart ? 4 : rnd() > 0.75 ? 5 : 3 // 修订 ⑤：主 3px / 亮 5px / 心跳 4px
    const alpha = heart ? 1.0 : 0.1 + rnd() * 0.5
    const phase = rnd() * Math.PI * 2
    // 延迟 ∝ 距环心距离：外圈（dist 大）delay 小 → 先动（壳层塌缩）
    const dx = uv.x - CENTER_UV.x
    const dy = uv.y - CENTER_UV.y
    const dist = Math.min(1, Math.sqrt(dx * dx + dy * dy) / 0.75)
    const delay = 0.22 * (1 - dist)
    for (let t = 0; t <= TRAIL; t++) {
      aUV[i * 2] = uv.x
      aUV[i * 2 + 1] = uv.y
      aSize[i] = size
      aAlpha[i] = alpha
      aDelay[i] = delay
      aHeart[i] = heart
      aPhase[i] = phase
      aTrail[i] = t
      i++
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)) // 占位
  geo.setAttribute('aUV', new THREE.BufferAttribute(aUV, 2))
  geo.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1))
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(aAlpha, 1))
  geo.setAttribute('aDelay', new THREE.BufferAttribute(aDelay, 1))
  geo.setAttribute('aHeart', new THREE.BufferAttribute(aHeart, 1))
  geo.setAttribute('aPhase', new THREE.BufferAttribute(aPhase, 1))
  geo.setAttribute('aTrail', new THREE.BufferAttribute(aTrail, 1))
  geo.drawRange.count = n

  const uniforms = {
    uE: { value: 0 },
    uCenter: { value: new THREE.Vector2(CENTER_UV.x * 2 - 1, 1 - CENTER_UV.y * 2) },
    uT: { value: 0 },
    uDPR: { value: Math.min(window.devicePixelRatio, 2) },
    uMap: { value: makeSoftTexture() },
  }

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: SOFT_POINT_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false, // additive 自遮挡会叠白（river 同款纪律）
    blending: THREE.AdditiveBlending,
  })

  const mesh = new THREE.Points(geo, mat)
  mesh.frustumCulled = false

  // 月球布光光罩（第二 mesh，renderOrder 1 盖在星场之上；默认 uBurst=0 不可见）
  const burstGeo = new THREE.PlaneGeometry(2, 2)
  const burstUniforms = {
    uMoonUV: { value: new THREE.Vector2(0.6, 0.7) }, // 占位（setBurst 每帧喂）
    uBurst: { value: 0 },
    uAspect: { value: window.innerWidth / window.innerHeight },
    uColor: { value: new THREE.Color(BURST_COLOR) },
  }
  const burstMat = new THREE.ShaderMaterial({
    uniforms: burstUniforms,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position, 1.0); // PlaneGeometry(2,2) 直接 NDC
      }
    `,
    fragmentShader: BURST_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  })
  const burstMesh = new THREE.Mesh(burstGeo, burstMat)
  burstMesh.renderOrder = 1 // 星场 renderOrder 0 → 光罩后画（盖住星与收缩光团）
  burstMesh.frustumCulled = false
  burstMesh.visible = false // uBurst=0 时全屏 quad 每帧光栅化 = 纯浪费（simplify）；
  // 首次 setBurst 点亮 —— alpha=0 的 quad 无法可靠 early-out，visible 才省这段 fill

  // 正交相机（恒等矩阵）：着色器直写 NDC，相机只是 render() 的占位
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const scene = new THREE.Scene()
  scene.add(mesh)
  scene.add(burstMesh)

  // ---------- 流星（2026-08-13 主人裁决重做）：头 + 200 段随路径生长的尾巴 ----------
  // 每条流星 = 顶点池 METEOR_N×METEOR_SEG,参数走 uniform 数组(生命周期由 JS 重投,
  // 顶点零更新);出生点之后的段才可见(step(k, progress)) = 尾巴跟着头长出来,
  // 而非「整条斜线横移」;亮度 (1-k)^2.5 幂渐隐到黑 + additive 头部聚亮
  const meteorGeo = new THREE.BufferGeometry()
  const mIdx = new Float32Array(METEOR_N * METEOR_SEG)
  const mSeg = new Float32Array(METEOR_N * METEOR_SEG)
  for (let m = 0; m < METEOR_N; m++) {
    for (let k = 0; k < METEOR_SEG; k++) {
      mIdx[m * METEOR_SEG + k] = m
      mSeg[m * METEOR_SEG + k] = k
    }
  }
  meteorGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(METEOR_N * METEOR_SEG * 3), 3))
  meteorGeo.setAttribute('aIdx', new THREE.BufferAttribute(mIdx, 1))
  meteorGeo.setAttribute('aSeg', new THREE.BufferAttribute(mSeg, 1))
  meteorGeo.drawRange.count = METEOR_N * METEOR_SEG
  const meteorUniforms = {
    // uTime/uDPR/uMap 直接共享星场材质的 value 对象(同一时钟/同一纹理,
    // ShaderMaterial 按 key 绑定引用) —— 免每帧与 resize 同步赋值
    uTime: uniforms.uT,
    uDPR: uniforms.uDPR,
    uBorn: { value: new Float32Array([1e9, 1e9, 1e9]) }, // 出生时刻(1e9 = 未投;shader 负 progress clamp 0 → 不可见)
    uLife: { value: new Float32Array([0, 0, 0]) },
    uTravel: { value: new Float32Array([0, 0, 0]) }, // 总行程 NDC(速度 = travel/life)
    uOrigin: { value: new Float32Array(6) }, // 3 × vec2(盒 NDC,同星场域)
    uDir: { value: new Float32Array(6) },
    uMap: uniforms.uMap, // 软点纹理与星场共用(SOFT_POINT_FRAG 同源)
  }
  const meteorMat = new THREE.ShaderMaterial({
    uniforms: meteorUniforms,
    vertexShader: /* glsl */ `
      attribute float aIdx;
      attribute float aSeg;
      uniform float uTime;
      uniform float uDPR;
      uniform float uBorn[3];
      uniform float uLife[3];
      uniform float uTravel[3];
      uniform vec2 uOrigin[3];
      uniform vec2 uDir[3];
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        int m = int(aIdx + 0.5);
        float life = max(uLife[m], 0.001);
        float progress = clamp((uTime - uBorn[m]) / life, 0.0, 1.0);
        // 尾巴只存在于头部走过的路径:段 k 落后头部 k/200 的行程,
        // 头部未到 = 不可见(尾巴随头生长)
        float k = aSeg / ${METEOR_SEG - 1}.0;
        float segVis = step(k, progress);
        // 段龄 → 亮度:头部最亮、尾部幂渐隐到黑(three-comet-trail 技法)
        float bright = pow(1.0 - k, 2.5);
        // 生命包络:出生快亮、临终熄灭(随机寿命下速度/亮度自然各异)
        float env = smoothstep(0.0, 0.05, progress) * (1.0 - smoothstep(0.8, 1.0, progress));
        vAlpha = segVis * env * bright * 0.9;
        vColor = vec3(0.85, 0.93, 1.0); // 白热偏冷(与星场同族,不抢河青)
        float headDist = uTravel[m] * (progress - k);
        vec2 p = uOrigin[m] + uDir[m] * headDist;
        gl_PointSize = (3.0 + 10.0 * bright) * uDPR;
        gl_Position = vec4(p, 0.0, 1.0);
      }
    `,
    fragmentShader: SOFT_POINT_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  })
  const meteorMesh = new THREE.Points(meteorGeo, meteorMat)
  meteorMesh.frustumCulled = false
  scene.add(meteorMesh)
  // 生命周期:每条流星只记下次出生时刻 next(born/life 在重投时作局部量直写
  // uniform,不留镜像);死后歇 2~6s 随机重投 = 不机械;reduce 下永不出场
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const mNext = new Float32Array(METEOR_N)
  for (let m = 0; m < METEOR_N; m++) {
    mNext[m] = METEOR_FIRST_MIN + rnd() * METEOR_FIRST_SPREAD
  }
  const respawnMeteor = (m) => {
    const fromTop = rnd() < 0.7 // 上缘为主,两侧边缘偶尔
    const ox = fromTop ? rnd() * 1.8 - 0.9 : rnd() > 0.5 ? -1.02 : 1.02
    const oy = fromTop ? 1.02 : rnd() * 0.5 - 0.25
    // 屏面角 25~55° 下行(随机左右);盒 NDC 域按宽高比换算方向
    const ang = ((METEOR_ANGLE_MIN + rnd() * METEOR_ANGLE_SPREAD) * Math.PI) / 180
    const dx = (Math.cos(ang) * (rnd() > 0.5 ? 1 : -1)) / window.innerWidth
    const dy = -Math.sin(ang) / window.innerHeight
    const len = Math.hypot(dx, dy)
    const born = uniforms.uT.value
    const life = METEOR_LIFE_MIN + rnd() * METEOR_LIFE_SPREAD
    mNext[m] = born + life + METEOR_GAP_MIN + rnd() * METEOR_GAP_SPREAD
    meteorUniforms.uBorn.value[m] = born
    meteorUniforms.uLife.value[m] = life
    meteorUniforms.uTravel.value[m] = METEOR_TRAVEL_MIN + rnd() * (METEOR_TRAVEL_MAX - METEOR_TRAVEL_MIN)
    meteorUniforms.uOrigin.value[m * 2] = ox
    meteorUniforms.uOrigin.value[m * 2 + 1] = oy
    meteorUniforms.uDir.value[m * 2] = dx / len
    meteorUniforms.uDir.value[m * 2 + 1] = dy / len
  }

  // ---------- 容器与渲染器（透明全屏 canvas，随 fxEl 视差微动） ----------
  // setPixelRatio 只在 resize 里统一处理（创建行冗余，simplify 2026-08-12）
  const wrap = document.createElement('div')
  wrap.style.cssText = 'position:absolute; inset:0; pointer-events:none;'
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false })
  renderer.domElement.style.cssText = 'width:100%; height:100%; display:block;'
  wrap.appendChild(renderer.domElement)
  container.appendChild(wrap)

  const size = () => ({ w: window.innerWidth + 40, h: window.innerHeight + 40 }) // fxEl 盒
  let S = size()
  const resize = () => {
    S = size()
    uniforms.uDPR.value = Math.min(window.devicePixelRatio, 2)
    renderer.setPixelRatio(uniforms.uDPR.value)
    renderer.setSize(S.w, S.h, false) // false = 不写 CSS 尺寸（100% 由样式承担）
    burstUniforms.uAspect.value = window.innerWidth / window.innerHeight
  }
  resize()
  window.addEventListener('resize', resize)

  // ---------- 渲染循环（心跳呼吸需要持续时间推进；paused 冻结 uT） ----------
  let last = performance.now()
  renderer.setAnimationLoop(() => {
    const now = performance.now()
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    if (!pausedEl.classList.contains('paused')) {
      uniforms.uT.value += dt // 80ms 真空冻结（流星 uTime 与星场共享同一 value 对象）
      // 流星生命周期（2026-08-13）：到点重投 —— 随机边缘/角度/寿命/速度
      if (!reduceMotion) {
        for (let m = 0; m < METEOR_N; m++) {
          if (uniforms.uT.value >= mNext[m]) respawnMeteor(m)
        }
      }
    }
    renderer.render(scene, camera)
  })

  return {
    // 收缩程度（序章 progress^1.8；0 = 静止星图）
    setE(e) {
      uniforms.uE.value = e
    },
    // 环心 fxEl 局部坐标（px）→ NDC（fxEl 盒 = 视口 + 40）
    setCenter(ox, oy) {
      uniforms.uCenter.value.set((ox / S.w) * 2 - 1, 1 - (oy / S.h) * 2)
    },
    // 月球布光（2026-08-12）：prog 0~1 扩散进度；moonUV = 月球 NDC（光源源点）；
    // 首次调用点亮光罩（uBurst>0 前 visible=false 省全屏光栅化）
    setBurst(prog, moonUV) {
      burstUniforms.uBurst.value = prog
      burstUniforms.uMoonUV.value.set(moonUV.x, moonUV.y)
      burstMesh.visible = true
    },
    dispose() {
      renderer.setAnimationLoop(null)
      window.removeEventListener('resize', resize)
      geo.dispose()
      mat.dispose()
      uniforms.uMap.value.dispose()
      meteorGeo.dispose()
      meteorMat.dispose()
      burstGeo.dispose()
      burstMat.dispose()
      disposeRenderer(renderer)
    },
  }
}

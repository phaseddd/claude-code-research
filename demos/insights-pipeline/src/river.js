// river.js —— 光河粒子管线(设计简报 §3,第一幕核心资产)
//
// 单 THREE.Points + ShaderMaterial,一个 draw call(简报 §3.1 / §7.1「粒子 draw call = 1」)。
// 四层粒子(L0 芯 / L1 身 / L2 尘 / L3 火花)不是 4 个 Points,是同一 buffer 内按 aLayer 分区、
// shader 内按层调参 —— 顶点动画全部在 shader(uTime 驱动),不做 JS 逐粒子循环
// (1e4 粒子 60fps 的唯一正解,简报 §3.1)。
//
// 路径系统(简报 §6.1 空间模型):三站共享同一条连续河。
//   主干 CatmullRom 曲线:S1 源头(锚点动态)→ S2 星云中景 → S3 叉口,采样 96 点上传 uniform;
//   meta / facet 两支各 48 点,从叉口点分出(起点 = 主干末点,保证连续);
//   分叉 morph 由 uBranchOn(0→1)混合主干与分支采样,动画期平滑张开,路径数组静态无需重建。
//   uniform vec3 数组在顶点着色器内分段线性采样(每顶点 ~96 次迭代,GPU 可忽略)。
//
// 流动 = 生死(简报 §3.3.5):t' = fract(aPathT + uTime × 流速),生命周期包络基于 t'
// 计算 —— 0~8% fade-in、8~80% hold、80~100% fade-out;出生 0~12% 放大(easeOutCubic)、
// 末 15% 收缩。粒子回绕源头 = 新粒子不断出生,「数据在运转」永不静止。
//
// 参数基线(简报 §0.6:改了要能说出为什么,见各处注释):
//   粒子总数 10000 = L0 1000 / L1 6000 / L2 2700 / L3 300(简报 §3.1 四层表)
//   预分配固定全量、不用 drawRange:第一幕粒子数恒定(简报可微调条款,无动态增减需求)

import * as THREE from 'three'

// ---------- 河色(简报 §2.3 river 色阶) ----------
// 2026-08-05 参数微调(简报可调条款,注释理由):body/deep 从冷蓝转冷青 ——
// 粒子河是整屏记忆色,背景已转青相(G≥B)后河仍 210° 蓝 → 观感「蓝色数据流/国企大屏」;
// 转 ~188° teal 后与背景雾(175°)同族、meta 支(190° 白青)过渡自然,S3 双色验收不受影响
const COL = {
  ember: new THREE.Color('#E6FAF7'), // 源头点亮瞬间 HDR 峰(冷白微青)
  core: new THREE.Color('#B5EEEA'), // L0 芯核(偏白青,定义脊线)
  body: new THREE.Color('#3FB4CC'), // L1 主体(稳定冷青,原冷蓝 #4AA8FF)
  deep: new THREE.Color('#1B5560'), // L2 尘雾 / 远场(暗青,原暗蓝 #1A4A8C)
  // meta 支偏白青:与主干拉开亮度,避免右支与主河连成一片(grok 复核,2026-08-05)
  meta: new THREE.Color('#AEE4FF'), // S3 meta 支(白青,纯计算)
  facet: new THREE.Color('#F472B6'), // S3 facet 支(品红,模型判定)
}

// ---------- 路径几何(全局常量,场景模块 import 用于对齐;源头动态) ----------
// 坐标基线(世界单位,Z 负方向深入屏幕):叉口 = 主干末点 = 两支起点,保证连续。
//   S1 源头(锚点):屏幕终端底部中心逆投影,深度 z≈12
//   S2 星云中景:主干 t≈0.5 附近
//   S3 叉口:(0, 0.5, -13),meta 盒 (4.8, 0.2, -28) / facet 盒 (-4.6, 0.1, -28)
// 2026-08-05 grok 复核修正:分支原 ±2.5×10 单位,在 ~23 单位观察距离下投影只占
// 屏幕 ±6.5% —— 「双色分叉一眼可读」不成立(任何相机位都救不回绝对尺寸)。
// 分支加长到 ~15 单位、盒外移 ±4.6~4.8(展开角 ≈35°,仍在简报 §4.3 的 28~36° 区间)
const MAIN_CTRL = [
  [0, -1.1, 12], // P0 源头(占位,setSource 时替换为锚点世界坐标)
  [0.6, -0.7, 7],
  [0.4, -0.3, 0],
  [-0.3, 0.1, -7],
  [0, 0.5, -13], // 叉口
]
const META_CTRL = [
  [0, 0.5, -13], // 与主干末点一致(连续)
  [3.2, 0.35, -20],
  [4.8, 0.2, -28],
]
const FACET_CTRL = [
  [0, 0.5, -13],
  [-3.1, 0.3, -20],
  [-4.6, 0.1, -28],
]
const MAIN_PTS = 96 // uniform 数组长度(采样精度;96 段分段线性在 ~40 单位河长下 ≈0.4 单位/段)
const BRANCH_PTS = 48
export const FORK_T = 0.88 // 叉口前 12% 为色过渡带(简报 §4.3「叉口前 8~12%」)

// 路径采样对象:场景模块用 RIVER.getMidPoint() 等对齐星云 / 缓存盒(与 shader 内采样同源)
export const RIVER = {
  _main: new THREE.CatmullRomCurve3(MAIN_CTRL.map((p) => new THREE.Vector3(...p))),
  _meta: new THREE.CatmullRomCurve3(META_CTRL.map((p) => new THREE.Vector3(...p))),
  _facet: new THREE.CatmullRomCurve3(FACET_CTRL.map((p) => new THREE.Vector3(...p))),
  // S1 锚点后更新源头(重建主干曲线;源头微移只影响路径前段,中后段形态不变)
  setSource(pos) {
    this._main.points[0].copy(pos)
    this._main.updateArcLengths()
  },
  getSource() {
    return this._main.getPoint(0)
  },
  getMidPoint() {
    return this._main.getPoint(0.5)
  }, // S2 星云中心
  getForkPoint() {
    return this._main.getPoint(1)
  }, // S3 叉口
  getBranchEnd(branch) {
    return (branch === 'meta' ? this._meta : this._facet).getPoint(1)
  }, // 缓存盒位置
}

// ---------- 层配置(简报 §3.1 四层表;尺寸 = 目标屏幕 px @ z≈14,换算见 shader) ----------
// across = 横向高斯偏移缩放:芯收窄成脊线、尘扩散拉体积感(grok 复核:原三层横向
// 分布一致 → 截图只辨「一团粒子云」,三层亮度分界不可读,2026-08-05 修正);
// 亮度 1.0/0.5/0.13 拉开层次(原 0.55/0.18 被 additive 叠白吞掉)
const LAYERS = [
  { count: 1000, sizeMin: 2.8, sizeMax: 4.2, bright: 1.0, alpha: 1.0, across: 0.55 }, // L0 芯:定义脊线(窄)
  { count: 6000, sizeMin: 1.4, sizeMax: 2.4, bright: 0.5, alpha: 0.9, across: 1.0 }, // L1 身:河宽、信息量编码
  { count: 2700, sizeMin: 0.8, sizeMax: 1.6, bright: 0.13, alpha: 0.7, across: 1.25 }, // L2 尘:体积感(散、暗)
  { count: 300, sizeMin: 3.0, sizeMax: 6.0, bright: 0.35, alpha: 0.2, across: 0.6 }, // L3 火花:事件脉冲用,平时极淡
]
const TOTAL = LAYERS.reduce((a, l) => a + l.count, 0) // 10000
const GAUSS_SIGMA = 0.33 // 高斯截面 σ:±3σ≈1(简报 §3.1「offset = gauss() × 半宽」)
const EDGE_DIM = 0.35 // 边缘粒子更小更暗系数(简报 §3.1:矩形填充=程序感,高斯=流体感)
const EDGE_SLOW = 0.25 // 边缘粒子更慢:流速衰减系数(简报 §3.1「边缘粒子更慢更暗」)

// 流速(t/s):沿路径参数每秒增量。视野内河段 ≈0.3t,除以流速 = 过视野秒数
//   vS1 0.10(点亮后加速「唰」)/ vS2 0.07(从星云抽出略慢显「拽」)/ vS3 0.085(主段)
//   分叉后 0.06(分流后减速入盒)—— 简报 §3.3.1 的 1.4~1.6 等抽象速按此换算
const FLOW = { s1: 0.1, s2: 0.07, s3: 0.085, s3split: 0.06, warm: 0.07, idle: 0.045 }

// 河宽(简报 §2.1 / §3.3.3):w = wMin + k × log1p(infoVolume)
//   infoVolume = tokens/1000(sessions.js STATS 供给);源头窄由 widthEnv 包络(×0.45)承担
//   基线:S1 命中会话 70 → 1.27(×包络 0.45 → 可视 0.57) / S2 全量 196 → 1.52
//   / S3 分流后 meta 支 ≈1.07、facet 支 ≈0.57 —— 视觉差 ≥30%(简报 §7.2-2),
//   facet 河窄 = 保守的视觉事实(简报 §2.5,数据统计而来)
const W_MIN = 0.25
const W_K = 0.24

// ---------- 顶点 / 片元着色器(单 draw call 的关键:一切在 GPU) ----------

const VERT = /* glsl */ `
  attribute float aPathT;   // 沿路径参数 0~1(随机分布,流动 = t 推进回绕)
  attribute float aAcross;  // 高斯横向偏移(σ≈0.33,±1.2 钳制)
  attribute float aLayer;   // 层 ID 0~3
  attribute float aSize;    // 层内随机基尺寸(px @ z≈14)
  attribute vec3  aColor;   // 层基色 × 层亮度(CPU 已乘)
  attribute float aAlpha;   // 层透明度
  attribute float aPhase;   // 呼吸 / 脉冲相位(错峰,避免全河同步)
  attribute float aBranch;  // S3 分支 0=meta / 1=facet(CPU 按 STATS 统计分配)

  uniform float uTime;
  uniform float uFlowSpeed;
  uniform float uRiverWidth;   // 半宽(世界单位,信息量驱动)
  uniform float uWidthInjTime; // 信息量注入时刻(前锋传播起点,默认 -1e3 = 已扫完全河)
  uniform float uRiverWidthOld; // 注入瞬间旧宽快照(前锋扫过区 = 新宽,未扫区 = 旧宽)
  uniform float uForkT;        // 分叉切换点(= FORK_T,色过渡带起点)
  uniform float uBranchOn;     // 分叉 morph 0~1(简报 §4.3:0.45~0.65s easeInOutCubic)
  uniform float uMetaNarrow;   // 分支宽度窄化:meta 0.75 / facet 0.45(简报 §2.5 流量比)
  uniform float uFacetNarrow;
  uniform vec3  uColorA;       // 沿河渐变四段:ember → core → body → deep
  uniform vec3  uColorB;
  uniform vec3  uColorC;
  uniform vec3  uColorD;
  uniform vec3  uColorMeta;    // S3 双色:青(meta)/ 品红(facet)
  uniform vec3  uColorFacet;
  uniform vec3  uPathMain[96];
  uniform vec3  uPathMeta[48];
  uniform vec3  uPathFacet[48];
  uniform float uPulse;        // 事件脉冲强度(0~1,指数衰减,≈0.5s 可见窗口)
  uniform float uEventT;       // 事件点路径参数(L3 火花向事件点聚集)
  uniform vec3  uAbsorbA;      // 缓存盒吸收点 A(meta)
  uniform vec3  uAbsorbB;      // 缓存盒吸收点 B(facet)
  uniform float uAbsorbR;      // 吸收半径
  uniform float uAbsorbOn;     // 0/1 吸收开关(S3 入盒节拍后开)
  uniform float uPixelRatio;   // DPR(已钳制 2)
  uniform float uPointerBias;  // 鼠标隐藏分:整河横向微偏 ±2%(简报 §3.3.6)

  varying float vAlpha;
  varying vec3  vColor;

  // 边缘粒子更小更暗 / 更慢系数(与 JS 侧 GAUSS_SIGMA 配套;GLSL 常量须在
  // shader 内声明,JS 侧常量不会自动进入 —— 2026-08-05 编译失败修复)
  const float EDGE_DIM = 0.35;
  const float EDGE_SLOW = 0.25;

  float easeOutCubic(float x) { return 1.0 - pow(1.0 - x, 3.0); }

  vec3 sampleCurve(vec3 arr[96], float t) {
    float f = t * 95.0;
    int i = clamp(int(f), 0, 94);
    return mix(arr[i], arr[i + 1], fract(f));
  }
  vec3 sampleBranch(vec3 arr[48], float t) {
    float f = t * 47.0;
    int i = clamp(int(f), 0, 46);
    return mix(arr[i], arr[i + 1], fract(f));
  }

  void main() {
    // 流动:t 推进回绕 = 粒子生死循环;边缘粒子更慢(高斯截面流体感)
    float edge = 1.0 - EDGE_DIM * clamp(abs(aAcross), 0.0, 1.0);
    float t = fract(aPathT + uTime * uFlowSpeed * (1.0 - EDGE_SLOW * clamp(abs(aAcross), 0.0, 1.0)));
    bool inFork = uBranchOn > 0.001 && t > uForkT;

    // 位置:主干 / 分支(morph 混合,分叉动画平滑张开)
    vec3 pos = sampleCurve(uPathMain, t);
    float bt = 0.0;
    if (inFork) {
      bt = clamp((t - uForkT) / (1.0 - uForkT), 0.0, 1.0);
      vec3 bp = aBranch < 0.5 ? sampleBranch(uPathMeta, bt) : sampleBranch(uPathFacet, bt);
      pos = mix(pos, bp, uBranchOn);
    }

    // 宽度叙事:源头略窄(×0.65)→ 中段全宽 → 分叉前收窄(×0.6);分支再按支窄化
    // 2026-08-05 修正:原源头 ×0.45 + 0.15 快过渡 = 「细头胖肚」大肚子观感
    // (主人实测「中间一小段密集怪怪的」+ grok 视频复核两轮);0.65 + 0.25 缓坡,
    // 源头仍略窄(语义不破)但反差收敛
    float widthEnv = mix(0.65, 1.0, smoothstep(0.0, 0.25, t)) * mix(1.0, 0.6, smoothstep(0.7, 1.0, t));
    if (inFork) widthEnv *= aBranch < 0.5 ? uMetaNarrow : uFacetNarrow;
    // 信息量注入前锋(2026-08-05):源头先变宽、波浪顺流而下(「数据从终端流入河」的
    // 物理)。wMix = 1 - smoothstep(前锋±带, t):t 在波浪扫过区(<前锋) = 新宽,
    // 未扫区 = 旧宽。速度 0.5 t/s(全河 2s,肉眼读作「信号波」非「流速」);
    // 不钳上限:传播完 injProg ≥ 1+BAND 后 wMix 恒 1,逐字节还原注入前行为。
    // reduce 下 uTime 冻结,uWidthInjTime 保持 -1e3 默认 → wMix 恒 1(瞬达)。
    const float W_INJ_SPEED = 0.5;
    const float W_INJ_BAND = 0.06;
    float injProg = (uTime - uWidthInjTime) * W_INJ_SPEED;
    float wMix = 1.0 - smoothstep(injProg - W_INJ_BAND, injProg + W_INJ_BAND, t);
    float halfW = mix(uRiverWidthOld, uRiverWidth, wMix) * widthEnv;
    // 波浪前锋微亮(影评人三连 2026-08-05:「变宽像粒子特效,没有信息量释放感」):
    // 宽度过渡带(t≈injProg)粒子亮度 +30% —— 波浪「推过去」的能量可见
    float waveGlow = smoothstep(-W_INJ_BAND, 0.0, t - injProg) * (1.0 - smoothstep(0.0, W_INJ_BAND * 1.5, t - injProg));

    // 高斯截面偏移 + 呼吸扰动(双正弦叠加,幅度 0.04~0.08 × 河宽,频率 0.6~1.2)
    vec3 t0 = sampleCurve(uPathMain, clamp(t - 0.01, 0.0, 1.0));
    vec3 t1 = sampleCurve(uPathMain, clamp(t + 0.01, 0.0, 1.0));
    vec3 tangent = normalize(t1 - t0);
    vec3 lateral = normalize(cross(tangent, vec3(0.0, 1.0, 0.0)));
    float breath = (sin(uTime * 0.9 + aPhase) + 0.5 * sin(uTime * 1.7 + aPhase * 2.3)) * 0.02;
    pos += lateral * (aAcross * halfW + breath * uRiverWidth * sign(aAcross) * 2.0);
    pos.x += uPointerBias * uRiverWidth * 0.02; // 鼠标隐藏分(±2%,勿抢戏)

    // 生命周期:主干 0~8% fade-in / 8~70% hold / 70~88% fade-out(河末段消亡);
    // 分支段(t>0.88)按分支内进度 bt 重新走一遍(0~8% 淡入、末 15% 淡出 = 入盒前
    // 收缩)—— 修复:原全局 t 包络把分支段(t∈[0.88,1])全落在 80~100% fade-out 区,
    // 分支粒子 alpha≈0,双色支流不可见(grok 复核 5 轮定位,2026-08-05)
    float life, grow, shrink;
    if (inFork) {
      // 分支 fade-in 陡化(0~5%,叉口锐利「劈开」感,2026-08-05)
      life = smoothstep(0.0, 0.05, bt) * (1.0 - smoothstep(0.85, 1.0, bt));
      grow = 0.45 + 0.55 * easeOutCubic(min(1.0, bt / 0.12));
      shrink = 1.0 - 0.4 * smoothstep(0.85, 1.0, bt);
    } else {
      life = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.7, 0.88, t));
      grow = 0.45 + 0.55 * easeOutCubic(min(1.0, t / 0.12));
      shrink = 1.0 - 0.4 * smoothstep(0.85, 1.0, t);
    }
    vAlpha = aAlpha * life * edge;
    float sizeScale = grow * shrink * edge;
    // 分支段尺寸 ×1.35(分支在远处,透视衰减后粒子过小不可读);
    // facet 支再 ×1.4(粉点浓度低,2026-08-05 grok 复核两轮后定档)
    if (inFork) sizeScale *= 1.35 + 0.55 * aBranch;

    // 火花层:事件脉冲驱动(平时 α 0.2 极淡,脉冲时向事件点聚亮)
    if (aLayer > 2.5) {
      float evW = 1.0 / (1.0 + abs(t - uEventT) * 40.0); // 事件点附近权重
      vAlpha = vAlpha * (0.35 + evW * uPulse * 3.0);
      sizeScale *= 1.0 + uPulse * evW * 1.6;
    }

    // 颜色:沿河渐变四段(ember→core→body→deep,远端降饱和由 deep 色相承担);
    // 色过渡带 + 分支段按 aBranch 染双色(简报 §4.3「叉口前 8~12% 色过渡带」)。
    // 分支染色速率 0.88→0.94 完成(grok 复核:原 0.88→1.0 渐变过长,facet 支粒子
    // 大部分仍混主干冷蓝,品红不可见,2026-08-05 修正);facet 支再提亮 30%
    // (粒子少且窄化 0.45,不补亮则双色一眼不可读)
    vec3 c;
    if (t < 0.25) c = mix(uColorA, uColorB, t / 0.25);
    else if (t < 0.7) c = mix(uColorB, uColorC, (t - 0.25) / 0.45);
    else c = mix(uColorC, uColorD, (t - 0.7) / 0.3);
    if (uBranchOn > 0.001) {
      float k = smoothstep(uForkT, 0.94, t);
      if (k > 0.001) c = mix(c, mix(uColorMeta, uColorFacet, aBranch), k);
      // facet 支提亮 150%(逐轮上调:30→60→80→120 仍偏淡;additive 下亮度 >1 允许)
      c *= 1.0 + 1.5 * aBranch * smoothstep(uForkT, 1.0, t);
    }
    c *= 1.0 + 0.3 * waveGlow; // 波浪前锋能量(注入期短暂可见,传播完 waveGlow=0)
    vColor = c;

    // 吸收(软粒子,简报 §3.3.6):接近盒的粒子 alpha 渐隐(距离场平滑过渡 ≈0.15s),
    // 防硬穿插 —— 盒前吸入的粒子不「穿模」;加速由场景侧 setFlow('s3split') 承担
    if (uAbsorbOn > 0.5) {
      float da = distance(pos, uAbsorbA);
      float db = distance(pos, uAbsorbB);
      float d = min(da, db);
      vAlpha *= smoothstep(uAbsorbR * 0.45, uAbsorbR, d);
    }

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = clamp(aSize * uPixelRatio * (300.0 / -mv.z), 1.0, 96.0) * sizeScale;
    gl_Position = projectionMatrix * mv;
  }
`

const FRAG = /* glsl */ `
  uniform sampler2D uMap;
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    vec4 tex = texture2D(uMap, gl_PointCoord);
    gl_FragColor = vec4(vColor, vAlpha) * tex;
  }
`

// ---------- 粒子纹理:64² 径向软斑 + smoothstep 外圈(禁止硬圆点,简报 §3.1) ----------
// 中心 alpha 1.0、半径 40% 内保持高亮、外 60% 指数衰减
function makeSoftTexture() {
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

// ---------- 粒子生成 ----------
function gaussRandom() {
  // Box-Muller(CPU 一次性生成 1e4 个,开销可忽略)
  let u = 0
  let v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export function createRiver({ scene, branchShare = 0.73 } = {}) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // ---------- 粒子 buffer:预分配全量(层分区生成) ----------
  const n = TOTAL
  const aPathT = new Float32Array(n)
  const aAcross = new Float32Array(n)
  const aLayer = new Float32Array(n)
  const aSize = new Float32Array(n)
  const aColor = new Float32Array(n * 3)
  const aAlpha = new Float32Array(n)
  const aPhase = new Float32Array(n)
  const aBranch = new Float32Array(n)

  // 层基色(简报 §2.3 river 色阶):L0 core / L1 body / L2 deep / L3 ember
  const layerColor = [COL.core, COL.body, COL.deep, COL.ember]
  const z14 = 14 // 尺寸基线深度(300/z 衰减在 z=14 处还原目标 px)
  // aPathT 分布(2026-08-05 grok 复核修正):参数均匀会让分支段(t>0.88)粒子密度
  // 只有主干的 1/3(分支弧长 10 单位只占参数 0.12 区间)→ facet 支稀疏不可见。
  // 加权 58/42:分支段弧长占比 ~36%,42% 粒子略高于弧长比(分流后流量集中于
  // 两支,facet 支(30%)绝对数量 ~1260 —— grok 复核五轮后定档,仍保 meta 明显
  // 宽于 facet 的流量语义)
  const PATH_T_WEIGHT = 0.58 // [0, 0.88) 主干主要段权重
  let i = 0
  for (const [li, layer] of LAYERS.entries()) {
    for (let j = 0; j < layer.count; j++, i++) {
      aPathT[i] =
        Math.random() < PATH_T_WEIGHT ? Math.random() * FORK_T : FORK_T + Math.random() * (1 - FORK_T)
      // 横向偏移按层缩放(across):芯窄、尘散(三层亮度分界可读,2026-08-05)
      aAcross[i] = Math.max(-1.2, Math.min(1.2, gaussRandom() * GAUSS_SIGMA * layer.across))
      aLayer[i] = li
      const px = layer.sizeMin + Math.random() * (layer.sizeMax - layer.sizeMin)
      aSize[i] = (px * z14) / 300 // 换算:shader 内 300/z 还原
      aColor[i * 3] = layerColor[li].r * layer.bright
      aColor[i * 3 + 1] = layerColor[li].g * layer.bright
      aColor[i * 3 + 2] = layerColor[li].b * layer.bright
      aAlpha[i] = layer.alpha * (0.75 + 0.25 * Math.random())
      aPhase[i] = Math.random() * Math.PI * 2
      aBranch[i] = Math.random() < branchShare ? 0 : 1 // meta 73% / facet 27%(sessions STATS)
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)) // 占位:three 前缀声明需要
  geo.setAttribute('aPathT', new THREE.BufferAttribute(aPathT, 1))
  geo.setAttribute('aAcross', new THREE.BufferAttribute(aAcross, 1))
  geo.setAttribute('aLayer', new THREE.BufferAttribute(aLayer, 1))
  geo.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1))
  geo.setAttribute('aColor', new THREE.BufferAttribute(aColor, 3))
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(aAlpha, 1))
  geo.setAttribute('aPhase', new THREE.BufferAttribute(aPhase, 1))
  geo.setAttribute('aBranch', new THREE.BufferAttribute(aBranch, 1))
  geo.drawRange.count = n // 固定全量(简报可微调条款:第一幕粒子数恒定)

  // ---------- 路径 uniform(静态数组:分叉 morph 走混合,路径数组不重建) ----------
  const pathToVec = (curve, pts) => {
    const arr = []
    for (let k = 0; k < pts; k++) arr.push(curve.getPoint(k / (pts - 1)))
    return arr
  }
  const uniforms = {
    uTime: { value: 0 },
    uFlowSpeed: { value: FLOW.idle },
    // 河宽初始 = 最窄(无信息量,简报 §3.3.3 公式 W_MIN)。原 0.6 是无公式语义的
    // 遗留值,且 S1 拍4 从 0.6 瞬跳 1.21 突兀(主人实测:河先窄后突然变宽)
    uRiverWidth: { value: W_MIN },
    // 注入前锋默认态 = 从未注入(-1e3):injProg ≥ 500 → wMix 恒 1,行为与无前锋等价
    uWidthInjTime: { value: -1e3 },
    uRiverWidthOld: { value: W_MIN },
    uForkT: { value: FORK_T },
    uBranchOn: { value: 0 },
    uMetaNarrow: { value: 0.75 }, // 分流后 meta 支 75% 宽(简报 §4.3:meta 支明显宽于 facet 支)
    // facet 支 0.55(原 0.45:grok 复核品红不可见,加宽一档;仍窄于 meta 支,语义保留)
    uFacetNarrow: { value: 0.55 },
    uColorA: { value: COL.ember.clone() },
    uColorB: { value: COL.core.clone() },
    uColorC: { value: COL.body.clone() },
    uColorD: { value: COL.deep.clone() },
    uColorMeta: { value: COL.meta.clone() },
    uColorFacet: { value: COL.facet.clone() },
    uPathMain: { value: pathToVec(RIVER._main, MAIN_PTS) },
    uPathMeta: { value: pathToVec(RIVER._meta, BRANCH_PTS) },
    uPathFacet: { value: pathToVec(RIVER._facet, BRANCH_PTS) },
    uPulse: { value: 0 },
    uEventT: { value: 0 },
    uAbsorbA: { value: new THREE.Vector3(0, 0, -23) },
    uAbsorbB: { value: new THREE.Vector3(0, 0, -23) },
    uAbsorbR: { value: 1.5 },
    uAbsorbOn: { value: 0 },
    uPixelRatio: { value: 1 },
    uPointerBias: { value: 0 },
    uMap: { value: makeSoftTexture() },
  }

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    // 发光粒子标准组合(简报 §3.1:AdditiveBlending + depthWrite false);
    // 关闭 depthTest:additive 自遮挡会让近处粒子吃掉远处粒子,叠白观感被破坏
    // (参数微调,记录理由)
    depthTest: false,
    blending: THREE.AdditiveBlending,
  })

  const mesh = new THREE.Points(geo, mat)
  mesh.frustumCulled = false // 粒子全路径分布,包围盒计算无意义(位置由 shader 覆盖)
  scene.add(mesh)

  // ---------- 状态与接口 ----------
  let pulse = 0
  let biasT = 0 // 鼠标归一化 X(-1~1)
  let biasV = 0 // 平滑后的实际偏移
  const onPointerMove = (e) => {
    biasT = (e.clientX / window.innerWidth) * 2 - 1
  }
  window.addEventListener('pointermove', onPointerMove, { passive: true })

  const river = {
    mesh,
    uniforms,

    // 河宽 = 信息量(w = wMin + k × log1p(vh),简报 §3.3.3);vh 为信息量(sessions STATS 供给)
    // _infoVolume 供场景侧平滑补间起始值(S1 拍4 河亮从当前宽补到目标,2026-08-05)
    setInfoVolume(vh) {
      this._infoVolume = vh
      uniforms.uRiverWidth.value = W_MIN + W_K * Math.log1p(vh)
    },
    getInfoVolume() {
      return this._infoVolume ?? 0 // 初始无信息量(河宽 = W_MIN 最窄)
    },
    // 信息量注入(2026-08-05,S1 拍4 独用):记录注入时刻 + 旧宽快照 → shader 前锋
    // 从源头顺流传播。无参:目标宽由场景侧补间经 setInfoVolume 逐帧送达,不重复
    // 写终值。S2/S3 的持续 setInfoVolume 不调本方法,前锋永不误触发。
    // reduce 双保险:uTime 冻结时记录冻结时刻会让前锋永远停在源头(必死),故忽略
    injectInfoVolume() {
      if (reducedMotion) return
      this.uniforms.uRiverWidthOld.value = this.uniforms.uRiverWidth.value
      this.uniforms.uWidthInjTime.value = this.uniforms.uTime.value
    },

    // 流速档(简报 §3.3.1 分站值):'s1' | 's2' | 's3' | 's3split' | 'idle'
    setFlow(zone) {
      uniforms.uFlowSpeed.value = FLOW[zone] ?? FLOW.idle
    },

    // S1 源头锚点:终端底部中心逆投影(简报 §3.5),重建主干路径并刷新 uniform
    setSource(pos) {
      RIVER.setSource(pos)
      uniforms.uPathMain.value = pathToVec(RIVER._main, MAIN_PTS)
    },

    // 分叉 morph(简报 §4.3:0.45~0.65s easeInOutCubic,由场景侧驱动)
    setBranchMix(mix) {
      uniforms.uBranchOn.value = mix
    },

    // 缓存盒吸收(简报 §4.3 入盒:粒子接近盒 alpha 渐隐,防穿模;
    // 「速度 ×1.3」由场景侧 setFlow('s3split') 承担,渐隐由 shader 距离场完成)
    setAbsorbers(aPos, bPos, radius = 1.5, on = true) {
      uniforms.uAbsorbA.value.copy(aPos)
      uniforms.uAbsorbB.value.copy(bPos)
      uniforms.uAbsorbR.value = radius
      uniforms.uAbsorbOn.value = on ? 1 : 0
    },

    // 事件脉冲:L3 火花向事件点爆发(简报 §3.3.4),strength 0~1,≈0.5s 衰减
    pulseAt(pathT, strength = 1) {
      uniforms.uEventT.value = pathT
      pulse = Math.min(1, pulse + strength)
    },

    // 每帧:时间推进(流动/呼吸/生死);reduced-motion 下粒子静止(简报 §5)
    update(t, dt) {
      if (!reducedMotion) uniforms.uTime.value += dt
      pulse *= Math.exp(-3 * dt) // ≈0.5s 衰减窗口
      uniforms.uPulse.value = pulse
      biasV += (biasT - biasV) * 0.05 // 隐藏分平滑跟随(简报 §3.3.6)
      uniforms.uPointerBias.value = biasV
    },

    dispose() {
      window.removeEventListener('pointermove', onPointerMove)
      scene.remove(mesh)
      geo.dispose()
      mat.dispose()
      uniforms.uMap.value.dispose()
    },
  }
  return river
}

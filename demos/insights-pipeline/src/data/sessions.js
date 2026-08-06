// data/sessions.js —— 第一幕合成会话数据(设计简报 §2.5)
//
// 「数据编码到视觉变量」的前提:12~15 个虚构会话,围绕本知识库工作流
// (入库 / 机制分析 / 知识页打磨 / 工程实现等,元叙事),手写 meta 与 facet。
// 视觉变量全部从本文件来(可解释的视觉,不是叙事道具):
//   ageDays     → 星云亮度(简报 §4.2:brightness = mix(0.15, 1.0, exp(-ageDays/τ)))
//   tokens      → 光河宽度(w = wMin + k × log1p(infoVolume),infoVolume = tokens/1000)
//   branch      → S3 分流归属(meta = 算得出来的统计 / facet = 模型判定语义)
//   isMeta      → 元会话星(S2 弃置,不是你的对话)
//
// 分流比(简报 §2.5):meta 单次上限 200 vs facet 50,facet 保守 → 会话 token 也保守
// (合成数据的 token 分配即按此设计);两分支 token 总量 ≈ 70/30。
// ageDays 是 2026-08-05 的快照(演示以它为准,不随真实日期漂移,亮度稳定)。
//
// 措辞诚实:本文件全部为合成示例(PLAN §2.4),UI 标注「合成示例」。

export const SESSIONS = [
  {
    id: 's01',
    name: '入库:知识页 intake 落地',
    date: '2026-08-03',
    ageDays: 2,
    messages: 46,
    tools: 9,
    tokens: 30000,
    meta: { durationMin: 48, language: '中文' },
    facet: { goal: '入库', satisfaction: 'high', friction: 'low', type: '工作流' },
    branch: 'meta',
  },
  {
    id: 's02',
    name: '机制:/insights 命令全程解析',
    date: '2026-07-28',
    ageDays: 8,
    messages: 71,
    tools: 14,
    tokens: 22000,
    meta: { durationMin: 95, language: '中文' },
    facet: { goal: '机制分析', satisfaction: 'high', friction: 'medium', type: '源码解析' },
    branch: 'facet',
  },
  {
    id: 's03',
    name: '提示词:P1~P12 链解剖',
    date: '2026-07-27',
    ageDays: 9,
    messages: 58,
    tools: 8,
    tokens: 18000,
    meta: { durationMin: 72, language: '中文' },
    facet: { goal: '机制分析', satisfaction: 'high', friction: 'low', type: '源码解析' },
    branch: 'facet',
  },
  {
    id: 's04',
    name: '拆解:零大学质感十图',
    date: '2026-07-24',
    ageDays: 12,
    messages: 39,
    tools: 6,
    tokens: 14000,
    meta: { durationMin: 60, language: '中文' },
    facet: { goal: '参考解剖', satisfaction: 'medium', friction: 'medium', type: '设计研究' },
    branch: 'facet',
  },
  {
    id: 's05',
    name: '工程:M1 时间轴内核',
    date: '2026-07-25',
    ageDays: 11,
    messages: 96,
    tools: 18,
    tokens: 52000,
    meta: { durationMin: 180, language: '中文' },
    facet: { goal: '工程实现', satisfaction: 'high', friction: 'medium', type: '开发' },
    branch: 'meta',
  },
  {
    id: 's06',
    name: '工程:M2 HUD 轨道与滚动',
    date: '2026-08-01',
    ageDays: 4,
    messages: 82,
    tools: 15,
    tokens: 44000,
    meta: { durationMin: 150, language: '中文' },
    facet: { goal: '工程实现', satisfaction: 'high', friction: 'high', type: '开发' },
    branch: 'meta',
  },
  {
    id: 's07',
    name: '修复:gate 反向棘轮',
    date: '2026-08-05',
    ageDays: 0,
    messages: 34,
    tools: 7,
    tokens: 18000,
    meta: { durationMin: 55, language: '中文' },
    facet: { goal: 'bug 修复', satisfaction: 'high', friction: 'high', type: '开发' },
    branch: 'meta',
  },
  {
    id: 's08',
    name: '数据:合成数据设计',
    date: '2026-08-04',
    ageDays: 1,
    messages: 41,
    tools: 5,
    tokens: 26000,
    meta: { durationMin: 40, language: '中文' },
    facet: { goal: '内容设计', satisfaction: 'high', friction: 'low', type: '写作' },
    branch: 'meta',
  },
  {
    id: 's09',
    name: '整理:.vision 与 showcase',
    date: '2026-08-02',
    ageDays: 3,
    messages: 28,
    tools: 4,
    tokens: 20000,
    meta: { durationMin: 35, language: '中文' },
    facet: { goal: '整理', satisfaction: 'medium', friction: 'low', type: '文档' },
    branch: 'meta',
  },
  {
    id: 's10',
    name: '打磨:措辞政策与页面语言',
    date: '2026-07-30',
    ageDays: 6,
    messages: 25,
    tools: 3,
    tokens: 8000,
    meta: { durationMin: 30, language: '中文' },
    facet: { goal: '打磨', satisfaction: 'medium', friction: 'medium', type: '写作' },
    branch: 'facet',
  },
  {
    id: 's11',
    name: '验收:grok 视觉验收链路',
    date: '2026-07-31',
    ageDays: 5,
    messages: 22,
    tools: 5,
    tokens: 6000,
    meta: { durationMin: 26, language: '中文' },
    facet: { goal: '验收', satisfaction: 'medium', friction: 'high', type: '测试' },
    branch: 'facet',
  },
  {
    id: 's12',
    name: '元会话:/insights 自产',
    date: '2026-08-05',
    ageDays: 0,
    messages: 4,
    tools: 1,
    tokens: 2000,
    meta: { durationMin: 3, language: '中文' },
    facet: { goal: '—', satisfaction: '—', friction: '—', type: '元会话' },
    branch: 'meta',
    isMeta: true, // 元会话:不是你的对话,S2 弃置、不入河
  },
]

// ---------- 派生统计(视觉变量的数据源,场景模块从这里取数,不硬编码) ----------

const sum = (arr, f) => arr.reduce((a, s) => a + f(s), 0)

// 信息量(光河宽度用):infoVolume = tokens / 1000,按分支聚合
export const STATS = (() => {
  const real = SESSIONS.filter((s) => !s.isMeta) // 元会话不入任何统计(它被丢弃)
  const meta = real.filter((s) => s.branch === 'meta')
  const facet = real.filter((s) => s.branch === 'facet')
  const metaTokens = sum(meta, (s) => s.tokens)
  const facetTokens = sum(facet, (s) => s.tokens)
  return {
    count: real.length, // 亮星数(星云视觉锚点)
    metaCount: meta.length,
    facetCount: facet.length,
    totalTokens: metaTokens + facetTokens,
    metaTokens,
    facetTokens,
    metaShare: metaTokens / (metaTokens + facetTokens), // ≈0.73(S3 分流比,数据统计而来)
    facetShare: facetTokens / (metaTokens + facetTokens),
    totalInfo: (metaTokens + facetTokens) / 1000,
    metaInfo: metaTokens / 1000, // S3 meta 支河宽输入
    facetInfo: facetTokens / 1000, // S3 facet 支河宽输入
    // 星云亮星:非元会话(元会话单独弃置)
    stars: real,
  }
})()

// 星云亮度公式(简报 §4.2):brightness = mix(0.15, 1.0, exp(-ageDays/τ)),
// τ = 18 天基线 —— 新会话(age 小)亮、旧会话(age 大)暗(2026-08-05 修正:
// 初版写反成「越旧越亮」,与简报 §4.2 / §2.5「mtime 越新越亮」方向相反)
export function starBrightness(ageDays, tau = 18) {
  return 0.15 + 0.85 * Math.exp(-ageDays / tau)
}

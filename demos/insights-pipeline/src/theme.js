// 主题常量：三幕色彩段（与 style.css 的 CSS 变量同步维护，两处注释互指）
// 序章黑场 → 第一幕冷蓝（数据）→ 第二幕青紫（模型介入）→ 第三幕琥珀（报告成形）→ 尾声白场
// 本文件是 JS 侧单一来源：场景模块从这里取色，不要硬编码 hex

export const COLORS = {
  bg: '#05070d', // 黑场底色
  act1: '#3b6cf6', // 第一幕 · 冷蓝（数据）
  act2: '#8b5cf6', // 第二幕 · 青紫（模型介入）
  act3: '#f5b942', // 第三幕 · 琥珀（报告成形；与尾声白场保持区分度）
  text: '#e8ecf4',
  textDim: 'rgba(232, 236, 244, 0.55)',
  mono: '#7dd3fc', // 等宽数据色
  hold: '#7dd3fc', // 按住按钮进度环
}

export const FONTS = {
  display: "'Playfair Display', 'Times New Roman', serif", // 西文命令图形（对应 PLAN 主标题字体决策）
  body: "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  mono: "'JetBrains Mono', ui-monospace, Consolas, monospace",
}

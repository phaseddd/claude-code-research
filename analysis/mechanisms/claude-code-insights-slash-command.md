---
title: Claude Code /insights 命令的端到端流程
kind: mechanism
status: draft
updated: 2026-07-15
applies_to: claude-code / @cometix/claude-code 2.1.209
tags:
  - topic:claude-code
  - topic:slash-command
  - topic:insights
  - form:mechanism
---

# Claude Code `/insights` 命令的端到端流程

## 一句话结论

`/insights` 是 builtin 的 **`type: "prompt"`** 斜杠命令：在拼给当前会话主模型的内容之前，先在本地扫历史会话、用 **session-meta / facets 双层缓存** 与多轮 **内部** 模型调用（`querySource: "insights"`）做成 HTML 使用报告，再要求主模型 **原样** 输出一段带 `file://` 链接的固定分享话术。报告正文在 HTML，聊天窗只负责递链接并允许继续追问。

## 输入

| 输入 | 说明 |
|---|---|
| 用户动作 | 在交互会话中输入 `/insights` |
| 命令侧约束（包装层） | `requires.workspace: true`；`disableModelInvocation: true`（禁止被 Skill/Agent 等路径自动调用） |
| 本地数据 | 配置根下的 `projects/`（会话 transcript）；可选已有 `usage-data/` 缓存 |
| 本页证据 | `artifacts/2.1.209/global-prefix/node_modules/@cometix/claude-code/cli.js`（包内 `VERSION` 字面量为 `2.1.209`） |

**未做**：实际执行 `/insights`、请求线上 API、读取本机用户隐私报告内容。结论来自对该 `cli.js` 的 **全局 acorn 8.17.0 结构提取 + 锚点核对**。

各阶段 **官方提示词全文与中文对照** 见：[Claude Code /insights 内嵌提示词契约](../concepts/claude-code-insights-prompts.md)。本页只维护链路与设计取舍，提示词不双源粘贴。

---

## 过程

### 总览图

```mermaid
flowchart TD
  A["用户输入 /insights"] --> B["斜杠分发\n命中 builtin prompt 命令"]
  B --> C["progressMessage:\nanalyzing your sessions"]
  C --> D["await getPromptForCommand"]
  D --> E["generateUsageReport Osp\n扫会话 → 缓存 → 漏斗 LLM → HTML"]
  E --> F["buildInsightsResponsePrompt Nsp\n拼主会话强制话术"]
  F --> G["分发层组装消息\nshouldQuery: true"]
  G --> H["主会话模型再 query"]
  H --> I["用户可见: 固定分享句 + file://"]
  E --> J["磁盘: usage-data/report*.html\nsession-meta / facets"]
```

```text
时间线（用户感知）

  输入 /insights
       │
       │  ← 卡住一段时间（本地扫盘 + 可能多次内部 LLM）
       │     UI 进度文案: analyzing your sessions
       ▼
  聊天窗出现固定两行英文分享 + file://…
       │
       ▼
  浏览器打开 HTML 看完整报告
       │
       ▼
  （可选）在同一会话继续问「展开 friction / suggestions」
```

下文按 **L0 → L6** 展开；每段末「设计取舍」只写能被源码结构支撑的推断，不写未出现的产品口号。

---

### L0 · 斜杠识别与命令查找

用户输入以 `/` 开头时进入 slash 处理链。模块导出中可见 `processSlashCommand` / `processPromptSlashCommand` / `looksLikeCommand` 等符号（export 表约在 bundle 中部）。随后在已加载命令表中按 **name** 解析；`insights` 以 **`source: "builtin"`** 注册，不是 skill 文件、不是 plugin。

**入**：原始输入字符串。  
**出**：命令描述符（含 `type`、`getPromptForCommand`、`progressMessage` 等）。

---

### L1 · 命中命令对象：实现体 + 懒加载包装

acorn 解析到 **两个** `name: "insights"` 对象字面量：

| 字段 | 实现体（模块 default） | 懒加载包装（命令表入口） |
|---|---|---|
| `type` | `"prompt"` | `"prompt"` |
| `source` | `"builtin"` | `"builtin"` |
| `description` | `Generate a report analyzing your Claude Code sessions` | 同左 |
| `progressMessage` | `analyzing your sessions` | 同左 |
| `contentLength` | `0` | `0` |
| `disableModelInvocation` | （无此字段） | **`true`** |
| `requires` | （无） | **`{ workspace: true }`** |
| `getPromptForCommand` | async，**1** 参数，内联完整实现 | async，**2** 参数，动态加载后转发 |

包装层 `getPromptForCommand` 结构（brace 抽出）：

```text
async getPromptForCommand(e, t) {
  r = (await dynamicImport → 模块 Fsp).default
  if (r.type !== "prompt") throw Error("unreachable")
  return r.getPromptForCommand(e, t)
}
```

同一模块导出表（acorn 解析含 `generateUsageReport:` 的对象）语义名 → 实现名：

| 导出语义名 | 实现名 | 职责一句话 |
|---|---|---|
| `generateUsageReport` | `Osp` | 报告引擎入口 |
| `buildInsightsResponsePrompt` | `Nsp` | 主会话强制话术模板 |
| `aggregateData` | `Msp` | 跨会话聚合 |
| `extractToolStats` | `Dsp` | 单会话工具/语言等统计 |
| `detectMultiClauding` | `Lsp` | 多会话时间重叠 |
| `buildExportData` | `lh_` | 结构化导出形状 |
| `normalizeSessionMeta` | `Psp` | session-meta 规范化相关 |
| `default` | `ph_` | 命令实现对象 |

**设计取舍**

- **为何 `prompt` 而不是 `local`？**  
  `local` 在本地 `call` 后直接返回文本/跳过主模型；`prompt` 在 `getPromptForCommand` 之后把内容打成会话消息，并在分发路径上设 **`shouldQuery: true`**（`await e.getPromptForCommand` 调用点附近可核对）。产品形态是「报告 + 同一会话可追问」，不是一次性 dump。
- **为何包装层 `disableModelInvocation: true`？**  
  引擎会读大量历史并多次内部调模型；该标志限制 Skill/Agent 自动触发，要求用户显式输入。

---

### L2 · prompt 分发：先 await 分析，再 shouldQuery

主路径（`await e.getPromptForCommand(...)` 附近）在返回后大致会：

1. 取出 text 块，记 telemetry  
2. 处理 hooks / allowedTools / attribution 等（通用 prompt 命令逻辑）  
3. 组装 `messages`（含用户可见命令消息 + **isMeta** 内容）  
4. **`shouldQuery: true`** → 主会话模型再跑一轮  

对 `/insights`：**步骤 1 内部可能很久**（整份 `Osp`）；进度靠 `progressMessage`。主模型本轮读到的是 **已经生成好的** `Nsp` 话术（内含 insights JSON 与 `file://`），不是「请你去分析」的空指令。

```text
processPrompt 路径（简化）

  ┌─────────────────────────────────────┐
  │  await getPromptForCommand(args)    │  ← /insights 重活全在这里
  │    · Osp → HTML + insights          │
  │    · Nsp → 强制话术 text            │
  └─────────────────┬───────────────────┘
                    ▼
  包装成 messages (含 isMeta)
                    ▼
  shouldQuery: true ──► 主模型 query ──► 用户看见分享句
```

---

### L3 · `getPromptForCommand` 实现体

brace 抽出的实现逻辑：

```text
async getPromptForCommand(/* e */) {
  collectRemote = false                    // let t = !1，写死
  { insights, htmlPath, data, remoteStats }
      = await Osp({ collectRemote })

  reportUrl = `file://${htmlPath}`

  statsLine = sessions · messages · hours · commits
              （若 total_sessions_scanned > total_sessions
                则显示 “N sessions total · M analyzed”）

  summaryText = 有 at_a_glance
      ? markdown（What's working / hindering / quick wins / ambitious…）
      : "_No insights generated_"

  header = "# Claude Code Insights\n" + statsLine + 日期范围

  return [{
    type: "text",
    text: Nsp({
      insightsJson: JSON.stringify(insights, null, 2),
      reportUrl,
      htmlPath,
      facetsDir: rIo(),   // usage-data/facets
      header,
      summaryText,
    }),
  }]
}
```

**设计取舍**

- 分析必须在 `getPromptForCommand` 内完成：主模型本轮需要已存在的 `file://` 与 insights JSON。  
- **`collectRemote: false`**：本命令路径不收集远程会话；`remoteStats` 保持未赋值。其它入口是否打开远程不在本页断言。

---

### L4 · 报告引擎 `generateUsageReport`（`Osp`）

#### L4.0 路径语义

| 函数 | 源码结构 | 含义 |
|---|---|---|
| `pn()` | 配置根（被 join） | Claude 配置目录（常见形如 `~/.claude`，绝对路径随环境变） |
| `xz()` | `join(pn(), "projects")` | 历史会话目录树 |
| `znn()` | `join(pn(), "usage-data")` | 使用数据根 |
| `rIo()` | `join(znn(), "facets")` | facet 缓存 |
| `P8s()` | `join(znn(), "session-meta")` | session-meta 缓存 |

```text
pn()  （配置根）
├── projects/                 ← xz()，transcript 源
│   └── <project-key>/
│         └── <session files…>
└── usage-data/               ← znn()
    ├── session-meta/         ← P8s()，确定性统计缓存
    ├── facets/               ← rIo()，LLM 语义标签缓存
    ├── report-YYYYMMDD….html
    └── report.html
```

#### L4.1 数据漏斗总图

```mermaid
flowchart TB
  subgraph src [源]
    P["projects/** 会话文件"]
  end
  subgraph cache [缓存]
    SM["session-meta\n确定性统计"]
    FC["facets\nLLM 语义标签"]
  end
  subgraph filter [过滤]
    F1["丢弃元会话\nrecord_facets / JSON-only"]
    F2["user_message_count ≥ 2\nduration_minutes ≥ 1"]
    F3["剔除仅 warmup_minimal"]
  end
  subgraph llm [内部 LLM querySource=insights]
    C["chunk 摘要 maxTokens 500"]
    F["facet 抽取 maxTokens 4096"]
    S["7 section 并行 maxTokens 8192"]
    G["at_a_glance 二次合成"]
  end
  subgraph out [输出]
    H["report*.html mode 0600"]
    R["返回 insights + htmlPath + data"]
  end
  P --> SM
  P --> F1 --> F2
  F2 --> FC
  FC --> C --> F
  F --> F3 --> S --> G --> H --> R
  SM --> F2
```

#### L4.2 控制流分步（与 `Osp` await 序列对齐）

acorn 对 `async function Osp` 的 await 序列：

`ch_` → `Jm_` / `Promise.all` → `nIo` / `Promise.all` → `Ym_` / `Zm_` / `Promise.all` → `th_` → `$9.mkdir` → `$9.writeFile` ×2

结合函数体字面量，逐步如下。

##### （1）枚举会话 · `ch_()`

```text
ch_:
  readdir( projects 配置根 )
  每个子目录 → pMt 收集 { sessionId, path, mtime, size }
  每处理 10 个项目 → setImmediate 让出事件循环
  全部按 mtime 新 → 旧 排序后返回
```

`projects` 为空或 readdir 失败 → 返回 `[]`，后续空跑。

##### （2）session-meta 缓存 · 确定性统计

| 字面量 | 含义 |
|---|---|
| `o=50` | 每批并行检查缓存的 session 数 |
| `i=200` | 本轮最多 **新建** meta 的条数 |
| （刷新计数）`200` | 本轮最多 **刷新** 过期 meta 的条数 |

逻辑要点：

- `Jm_(sessionId)` 读缓存；若存在且 `transcript_mtime` 不落后于当前文件 mtime → **直接用缓存**，不读 transcript。  
- 无缓存 → 进「新建」队列（受 200 帽）。  
- 有缓存但过期 → 进「刷新」队列（受 200 帽）；帽外 **沿用旧缓存**（宁可旧数据，也限制单次运行成本）。

**设计取舍**：meta 从 transcript **可复算**（工具次数、token、时长等），适合强缓存；用 mtime 失效。上限 200 是完整性 vs 时延的预算帽。

##### （3）读 transcript · 规范化 · 写回 meta

| 字面量 | 含义 |
|---|---|
| `p=10` | 并行 `nIo(path)` 读日志的批大小 |

- **元会话过滤**：前几条 user 消息文本含  
  `RESPOND WITH ONLY A VALID JSON OBJECT` **或** `record_facets` → 整段 transcript 跳过（避免把 **facet 抽取自己的对话** 再当用户行为）。  
- 时间戳非法（`Wm_`）→ 跳过。  
- `M8s` / `Dsp`：从消息流抽出统计，返回对象至少包含（`M8s` 开头可见字段）  
  `session_id`、`project_path`、`start_time`、`duration_minutes`、`user_message_count`，以及 `Dsp` 侧工具计数、token、语言等（完整字段随 `Dsp` 实现扩展）。  
- `Qm_` 写 session-meta 缓存。  
- 读失败时：若仍有旧缓存则回退旧缓存。

##### （4）质量过滤

字面谓词（同时满足才保留）：

```text
keep = (user_message_count >= 2) AND (duration_minutes >= 1)
```

短试探、空会话不进后续 LLM，减少噪声对 goal/friction 分布的污染。

##### （5）facets · LLM 语义标签

| 字面量 | 含义 |
|---|---|
| `S=50` | 本轮最多 **新抽** facet 的 session 数 |
| `T=50` | 新抽并行批大小 |
| `30000` / `25000` | `Km_` 长文阈值 / 切片长度 |
| `500` | chunk 摘要 `maxOutputTokensOverride` |
| `4096` | facet 抽取 `maxOutputTokensOverride` |

```text
对每个通过质量过滤的 session:
  cached = Ym_(sessionId)
  if cached → 使用
  else if 仍握有 transcript 且 新抽名额未满:
      text = Km_(transcript)     // 可能多段 chunk 摘要 P-chunk-sum
      facet = Zm_(text, id)      // P-facet + schema，失败 → null
      if facet → Xm_ 写缓存

再过滤:
  若 facet.goal_categories 仅 warmup_minimal → 该 session 不进最终聚合
```

`$sp` 校验 facet 对象：`underlying_goal` / `outcome` / `brief_summary` 为 string；`goal_categories` / `user_satisfaction_counts` / `friction_counts` 为非 null object。提示词全文见 concept 页 **P-facet / P-facet-schema**。

**设计取舍**：facets **贵且不稳**（依赖模型），与可复算 meta 分目录；单次最多新抽 50，避免首次运行费用爆炸。

##### （6）聚合 · 报告 section · At a Glance

- **`Msp(sessions, facets)`**  
  跨会话累加工具计数、语言、token、git、满意度/摩擦分布等；调用 **`Lsp`（multi-clauding）**：把各 session 的 `user_message_timestamps` 摊平，在 **1800000 ms（30 分钟）** 窗口内检测跨 session 重叠，产出 `overlap_events` / `sessions_involved` / `user_messages_during` 一类统计。  
  并设置 `total_sessions_scanned` = 枚举阶段的总会话数 `n`。

- **`th_(aggregated, facets)`**  
  1. 并行跑 section 数组（各 `maxTokens: 8192`，经 `Isp`）：  
     `project_areas` · `interaction_style` · `what_works` · `friction_analysis` · `suggestions` · `on_the_horizon` · `fun_ending`  
  2. 把各章结果压成 bullet，再调 **P-at-a-glance** 二次合成四段总览。  

  提示词全文见 concept 页对应 P-section-* / P-at-a-glance。

```text
漏斗压缩（上下文与费用）

  原始 transcript（可能极大）
        │ Km_ / P-chunk-sum
        ▼
  分块摘要拼接
        │ Zm_ / P-facet + schema
        ▼
  单会话 JSON facet（结构化、可缓存）
        │ Msp
        ▼
  跨会话聚合统计
        │ 7 × P-section（并行）
        ▼
  报告各章 JSON
        │ P-at-a-glance
        ▼
  四段总览 + ah_ → HTML
```

##### （7）写 HTML · 返回

```text
mkdir(usage-data)
writeFile( report-<YYYYMMDDHHmmss>.html , html, { encoding: "utf-8", mode: 384 } )
writeFile( report.html , 同内容, { mode: 384 } )     // 384 = 0600

return {
  insights,      // 含 at_a_glance 与各 section
  htmlPath,      // 带时间戳的那份路径
  data,          // 聚合统计
  remoteStats,   // 本路径下为未赋值
  facets
}
```

#### L4.3 内部模型调用的公共 options

`cli.js` 中 **3** 处 `querySource: "insights"` 对象字面量（chunk / facet / section 查询）共同字段：

| 字段 | 值 |
|---|---|
| `querySource` | `"insights"` |
| `isNonInteractiveSession` | `true` |
| `hasAppendSystemPrompt` | `false` |
| `agents` | `[]` |
| `mcpTools` | `[]` |
| `model` | CallExpression：`Rsp()` / `Om_()` 均 `return sS()` |
| `sS()` | 优先 `ANTHROPIC_DEFAULT_OPUS_MODEL`，否则 Opus 路由默认（`zBe` / `opus48` 回退） |

`maxOutputTokensOverride`：字面量 **500**、**4096**、以及 section 路径上的 **MemberExpression**（取 section 的 `maxTokens`，数组内为 **8192**）。

主会话强制话术 **不在** 这三处内部调用里，而走 slash 分发后的主会话 query。

**设计取舍（L4 汇总）**

| 点 | 代码事实 | 含义（不夸大） |
|---|---|---|
| 双缓存目录 | `session-meta` / `facets` | 可复算 vs 贵且不稳 |
| 漏斗多层 LLM | chunk → facet → section → glance | 上下文窗口与费用约束下的压缩 |
| 过滤 | 元会话 / 短会话 / warmup | 教练型报告怕噪声 |
| 批与上限 | 50 / 200 / 10 / 50… | 单次运行成本帽 |
| `querySource` | 三处固定字符串 | 与普通对话请求在来源字段上分离 |
| `mode: 384` | writeFile 选项 | 本地报告权限收紧 |

---

### L5 · 主会话强制话术 · `Nsp`

签名：

```text
Nsp({
  insightsJson,  // e
  reportUrl,     // t  → file://…
  htmlPath,      // r
  facetsDir,     // n  → rIo()
  header,        // o
  summaryText,   // i
})
```

模板要求主模型：

1. 上下文中已有完整 insights JSON 与 At a Glance（用户尚未看到）；  
2. **整轮回复只能是 `<message>…</message>` 内固定英文分享句**（含 report URL），不得省略行。

全文与中文对照见 concept 页 **P-user-reply**。

**设计取舍**：重内容在 HTML；聊天窗避免刷屏。模型是否 100% 遵守 verbatim 属运行时行为，静态代码无法证明。

---

### L6 · 用户可见结果与后续

1. 主会话 `shouldQuery` 触发，模型按 P-user-reply 输出分享句。  
2. 用户打开 `file://…/report-….html`（或 `report.html`）查看 At a Glance、项目领域、摩擦、建议等。  
3. 同一会话上下文中仍有 insights JSON，用户可继续追问某一节（是否有效取决于主模型与上下文保留，非本页静态可证范围）。

```text
用户可见 vs 不可见

  可见 ── 固定分享句 + file:// URL
  可见 ── 浏览器中的 HTML 报告
  注入但默认不展示 ── insights JSON 全文（在 isMeta / 模型上下文中）
  磁盘 ── session-meta / facets 缓存（供下次加速）
```

---

## 输出

| 通道 | 内容 |
|---|---|
| 磁盘 | `usage-data/report-<时间戳>.html`、`usage-data/report.html`（`mode: 0600`）；更新后的 `session-meta/`、`facets/` |
| 当前会话（用户可见） | 固定分享话术 + `file://…` |
| 当前会话（模型上下文） | insights JSON + header/At a Glance 摘要，供追问 |

## 关键边界

| 边界 | 说明 |
|---|---|
| 版本 | 锚定 **2.1.209** Cometix 恢复包 `cli.js`；minify 名与批大小随版本会变 |
| 远程 | 本命令路径 `collectRemote === false` |
| 配置根绝对路径 | 随环境 / `CLAUDE_CONFIG_DIR` 等变化；相对子路径以源码 join 为准 |
| 未声称 | 网络上报、云端分析、或未在 `Osp` 字面量中出现的「N 天窗口」等产品文案 |
| 空数据 | 无 projects / 全被过滤时仍可能写出 HTML，summary 可为 `_No insights generated_` |
| 部分 LLM 失败 | 单次 facet/section 失败多为 null 跳过（见 `Zm_` / `Isp` catch），不必然整次中止 |
| 提示词正本 | 仅 concept 页维护全文 |

## 证据与复核方式

| 项 | 内容 |
|---|---|
| 证据文件 | `artifacts/2.1.209/global-prefix/node_modules/@cometix/claude-code/cli.js` |
| 方法 | 全局 **acorn 8.17.0** + acorn-walk：命令对象、导出表、`Osp`/`getPromptForCommand` 函数体、`querySource` options、section 数组 |
| 禁止 | 执行 `/insights`、为复核打 API |
| 可检索锚点 | `name:"insights"` · `generateUsageReport:` · `querySource:"insights"` · `user_message_count<2` · `warmup_minimal` · `mode:384` · `The user just ran /insights` · `usage-data` / `session-meta` / `facets` / `projects` · `1800000`（multi-clauding 窗口） |

`tmp/` 下若有一次性提取 JSON（gitignore），仅维护者便利，**不是**知识库正本。

## 相关页面

- [Claude Code /insights 内嵌提示词契约](../concepts/claude-code-insights-prompts.md)（**active**）—— 各 P-id 英文原文、中文对照与条款  
- [CometixSpace-claude-code 恢复流水线](../PriorKnowledge/cometix-claude-code-restore.md) —— 本页 `cli.js` 来源  
- [acorn 与 JS AST 解析工具](../PriorKnowledge/acorn-and-js-ast-parsers.md) —— 结构分析用 acorn 的依据  

## 附录 A · 符号地图（minify ↔ 语义）

| 语义 | 实现名 |
|---|---|
| generateUsageReport | `Osp` |
| buildInsightsResponsePrompt | `Nsp` |
| aggregateData | `Msp` |
| extractToolStats | `Dsp` |
| detectMultiClauding | `Lsp` |
| 枚举会话 | `ch_` |
| session-meta 读 / 写 | `Jm_` / `Qm_` |
| 读 transcript | `nIo` |
| facets 读 / 写 / 抽 | `Ym_` / `Xm_` / `Zm_` |
| 长文处理 | `Km_`（调度）+ chunk 调用（`zm_` 等） |
| section 编排 / 单章查询 | `th_` / `Isp` |
| HTML 渲染 | `ah_` |
| facet 校验 | `$sp` |
| 默认 Opus 模型辅助 | `sS` ← `Rsp` / `Om_` |
| 命令实现 / 模块命名空间 | `ph_` / `Fsp` |

## 附录 B · 常量预算表

| 常量 | 值 | 用途 |
|---|---|---|
| 会话扫描批 | 50 | meta 缓存检查并行 |
| 新建 meta 上限 | 200 | 单次重建量帽 |
| 刷新 meta 上限 | 200 | 过期重算量帽 |
| 读 transcript 批 | 10 | 磁盘/解析并行 |
| 新 facet 上限 | 50 | LLM 费用帽 |
| facet 批 | 50 | 并行抽取 |
| 长文阈值 / 块长 | 30000 / 25000 | `Km_` |
| chunk / facet / section max tokens | 500 / 4096 / 8192 | 内部调用 |
| multi-clauding 窗口 | 1800000 ms（30 min） | `Lsp` |
| HTML file mode | 384（0600） | 权限 |
| 质量：最少 user 消息 | 2 | 过滤 |
| 质量：最短时长（分） | 1 | 过滤 |

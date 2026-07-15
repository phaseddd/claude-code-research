---
title: Claude Code /insights 内嵌提示词契约
kind: concept
status: active
updated: 2026-07-16
applies_to: claude-code / @cometix/claude-code 2.1.209
tags:
  - topic:claude-code
  - topic:slash-command
  - topic:insights
  - form:concept
---

# Claude Code `/insights` 内嵌提示词契约

## 一句话解释

`/insights` 在报告引擎与主会话回复里，内嵌了多套**固定英文提示词**：它们规定内部模型如何摘要会话、抽取 facet、撰写报告各章，以及主会话模型必须如何向用户递交 `file://` 链接。本页给出 **2.1.209 `cli.js` 中的英文原文**、**中文对照**、**在链路中的位置**，以及 section / At a Glance 的**请求拼装方式**；不描述 slash 分发全流程（见机制页）。

## 配套机制

完整端到端流程与设计取舍：[Claude Code /insights 命令的端到端流程](../mechanisms/claude-code-insights-slash-command.md)。

## 证据来源与提取方法

| 项 | 内容 |
|---|---|
| 文件 | `artifacts/2.1.209/global-prefix/node_modules/@cometix/claude-code/cli.js` |
| 版本字面量 | 包内 `VERSION:"2.1.209"` |
| 方法 | 全局 acorn 8.17.0；对 template literal 做括号平衡扫描；section 数组用 acorn 解析 `name`/`maxTokens`；`Isp` / `th_` / `ld` 以函数体锚点核对 |
| 插值 | 源码为 minify 单字母参数；本页在「占位符说明」中按函数签名还原语义名，**英文原文块保持扫描结果**（含 `${e}` 等） |
| system prompt | 内部 `hct` 调用均为 `systemPrompt: ld([])`；2.1.209 中 `ld` 为恒等函数，故 **system 为空数组**，insights 专属指令均在 `userPrompt` |
| 未做 | 运行 `/insights`；未改写官方英文意图 |

下文「英文原文」抄录的是模板本体。section / At a Glance 经 `Isp` 时，实际 `userPrompt` 还会在模板后追加 `DATA:` 与动态数据（见上文「请求拼装」）。

---

## 索引：提示词在链路中的位置

| ID | 职责 | 调用附近 | tokens 相关 |
|---|---|---|---|
| P-chunk-sum | 超长**投影文本**分块摘要 | `Km_`（先 `Gm_`）→ 每块 `zm_` 类调用 | `maxOutputTokensOverride: 500` |
| P-facet | 单会话结构化 facet 指南 | `Zm_` 前缀 `Fm_` | 与 schema 拼接后 **4096** |
| P-facet-schema | facet 输出 JSON schema（与指南拼接） | `Zm_` 内模板 | 同上 |
| P-section-* | 跨会话报告七章 | `th_` → `Isp`（`eh_` 数组） | 各章 `maxTokens: 8192` |
| P-at-a-glance | 四段总览（依赖其它章摘要） | `th_` 末尾 → **同一** `Isp` | **`maxTokens: 8192`** |
| P-user-reply | 主会话强制分享话术 | `Nsp` / `getPromptForCommand` 返回值 | 走主会话模型，非内部 `querySource:"insights"` |

静态代码里 `querySource: "insights"` 有 **3** 处调用点：chunk、facet、以及 **section 与 At a Glance 共用的 `Isp`**。运行时第三处会先并行打满七章，再打一次 At a Glance。均 `isNonInteractiveSession: true`。

---

## 请求拼装 · `Isp` 与 `th_` 公共输入

七个 section 与 At a Glance 都经 `Isp(descriptor, dataString)`。`Isp` 构造的 `userPrompt` 为：

```text
${descriptor.prompt}

DATA:
${dataString}
```

`maxOutputTokensOverride` 取 `descriptor.maxTokens`（七章与 At a Glance 均为 **8192**）。`systemPrompt` 为 `ld([])`（空）。

### 七章的 `dataString`（`th_` 构造，七次相同）

```text
{ …聚合统计 JSON… }

SESSION SUMMARIES:
- <brief_summary> (<outcome>, <claude_helpfulness>)
…

FRICTION DETAILS:
- <friction_detail>
…

USER INSTRUCTIONS TO CLAUDE:
- <user_instructions_to_claude 条目>   // 或字面量 None captured
```

| 块 | 来源 | 上限 |
|---|---|---|
| 聚合 JSON | `sessions` / `analyzed` / `date_range` / `messages` / `hours` / `commits` / `top_tools` / `top_goals` / `outcomes` / `satisfaction` / `friction` / `success` / `languages` 等 | 由 `Msp` 结果序列化 |
| `SESSION SUMMARIES` | facet map 的 `brief_summary` 等 | **50** |
| `FRICTION DETAILS` | 非空 `friction_detail` | **20** |
| `USER INSTRUCTIONS TO CLAUDE` | `user_instructions_to_claude` 摊平 | **15** |

facet map 在 `Osp` 里以 **未按 warmup 过滤** 的完整 `_` 传入 `th_`（`Msp` 用的是过滤后的 `k`/`R`）。纯 `warmup_minimal` 会话仍可能出现在上述采样列表中。采样与过滤细节见机制页 L4。

### At a Glance 的 `dataString`

调用为 `Isp(atAGlanceDescriptor, "")`：模板自身已含 `SESSION DATA:` 与各章 bullet 插值，**`DATA:` 后为空**（通用包装留下的空尾缀，不是第二份数据）。

---

## P-chunk-sum · 分块摘要

### 元信息

| 项 | 内容 |
|---|---|
| 触发 | `Km_`：先 `Gm_(log)` 得到有损投影；投影长度 **> 30000** 时，按 **25000** 切片后对每片调用 |
| 拼接 | 提示词 + **投影**切片（非原始 JSONL） |
| options | `querySource: "insights"`，`maxOutputTokensOverride: 500` |

### 英文原文

```
Summarize this portion of a Claude Code session transcript. Focus on:
1. What the user asked for
2. What Claude did (tools used, files modified)
3. Any friction or issues
4. The outcome

Keep it concise - 3-5 sentences. Preserve specific details like file names, error messages, and user feedback.

TRANSCRIPT CHUNK:
```

### 中文对照

```
请摘要这段 Claude Code 会话 transcript。重点：
1. 用户要求什么
2. Claude 做了什么（用了哪些工具、改了哪些文件）
3. 有无摩擦或问题
4. 结果如何

保持简洁——3 到 5 句。保留具体细节，如文件名、错误信息、用户反馈。

TRANSCRIPT 片段：
```

### 说明

- 进模型前的文本是 `Gm_` 投影：user 条最多 500 字符、assistant 条最多 300 字符、tool 只留名称；不是磁盘上的完整 transcript。  
- `Km_` 在投影过长时才分块调用本提示词，并在拼回时加 session 元信息头（id 前缀、日期、项目、时长、分块数量）。  
- 「保留文件名/错误信息」是为了后续 friction / summary 仍有可指认细节；投影截断本身已可能丢掉后半段细节。

---

## P-facet · 单会话 facet 指南

### 元信息

| 项 | 内容 |
|---|---|
| 源码绑定 | 模板常量（minify 名 `Fm_`） |
| 使用 | `Zm_`：`userPrompt = Fm_ + Km_(log) 的输出 + schema 段`。`Km_` 先 `Gm_`：短会话为有损投影，长会话为分块摘要拼接（见 P-chunk-sum） |
| 校验 | `$sp`：必为对象，且 `underlying_goal`/`outcome`/`brief_summary` 为 string；`goal_categories`/`user_satisfaction_counts`/`friction_counts` 为非 null 对象 |

### 英文原文

```
Analyze this Claude Code session and extract structured facets.

CRITICAL GUIDELINES:

1. **goal_categories**: Count ONLY what the USER explicitly asked for.
   - DO NOT count Claude's autonomous codebase exploration
   - DO NOT count work Claude decided to do on its own
   - ONLY count when user says "can you...", "please...", "I need...", "let's..."

2. **user_satisfaction_counts**: Base ONLY on explicit user signals.
   - "Yay!", "great!", "perfect!" → happy
   - "thanks", "looks good", "that works" → satisfied
   - "ok, now let's..." (continuing without complaint) → likely_satisfied
   - "that's not right", "try again" → dissatisfied
   - "this is broken", "I give up" → frustrated

3. **friction_counts**: Be specific about what went wrong.
   - misunderstood_request: Claude interpreted incorrectly
   - wrong_approach: Right goal, wrong solution method
   - buggy_code: Code didn't work correctly
   - user_rejected_action: User said no/stop to a tool call
   - excessive_changes: Over-engineered or changed too much

4. If very short or just warmup, use warmup_minimal for goal_category

SESSION:
```

（源码中箭头为 `\u2192`，上表写为 `→`。）

### 中文对照

```
分析此 Claude Code 会话，并抽取结构化 facets。

关键准则：

1. **goal_categories（目标类别）**：只统计用户**明确提出**的请求。
   - 不要统计 Claude 自主做的代码库探索
   - 不要统计 Claude 自行决定开展的工作
   - 仅当用户说「can you…」「please…」「I need…」「let's…」之类时计数

2. **user_satisfaction_counts（用户满意度计数）**：只依据**明确的用户信号**。
   - 「Yay!」「great!」「perfect!」→ happy
   - 「thanks」「looks good」「that works」→ satisfied
   - 「ok, now let's…」（无抱怨地继续）→ likely_satisfied
   - 「that's not right」「try again」→ dissatisfied
   - 「this is broken」「I give up」→ frustrated

3. **friction_counts（摩擦计数）**：具体说明哪里出了问题。
   - misunderstood_request：Claude 理解错了请求
   - wrong_approach：目标对，方法错
   - buggy_code：代码不正确
   - user_rejected_action：用户拒绝/叫停工具调用
   - excessive_changes：改动过多或过度设计

4. 若会话很短或只是热身，goal 类别使用 warmup_minimal

SESSION：
```

### 说明

- 原文第 4 条写单数 `goal_category`，schema 字段为复数 `goal_categories`；本文保留上游原文，不替其统一。  
- 与报告引擎衔接：仅 `warmup_minimal` 的 session 会从 **`Msp` 聚合统计**（`k`/`R`）中剔除；`th_` 仍接收未过滤 facet map，故这些 facet 仍可能进入七章的 `SESSION SUMMARIES` 等采样输入。  
- 满意度/摩擦的 **key 保持英文**，便于 JSON 聚合。  
- 同文件附近有枚举数组（命令对象旁）：  
  - 满意度相关：`frustrated`, `dissatisfied`, `likely_satisfied`, `satisfied`, `happy`, `unsure`  
  - 结果相关：`not_achieved`, `partially_achieved`, `mostly_achieved`, `fully_achieved`, `unclear_from_transcript`  
  与下方 schema 中的 `outcome` 枚举一致。

---

## P-facet-schema · 输出 schema（与 P-facet 拼接）

### 元信息

摘自 `Zm_` 函数体字符串拼接（非独立 template 变量名），位于摘要结果之后、模型调用之前。

### 英文原文

```
RESPOND WITH ONLY A VALID JSON OBJECT matching this schema:
{
  "underlying_goal": "What the user fundamentally wanted to achieve",
  "goal_categories": {"category_name": count, ...},
  "outcome": "fully_achieved|mostly_achieved|partially_achieved|not_achieved|unclear_from_transcript",
  "user_satisfaction_counts": {"level": count, ...},
  "claude_helpfulness": "unhelpful|slightly_helpful|moderately_helpful|very_helpful|essential",
  "session_type": "single_task|multi_task|iterative_refinement|exploration|quick_question",
  "friction_counts": {"friction_type": count, ...},
  "friction_detail": "One sentence describing friction or empty",
  "primary_success": "none|fast_accurate_search|correct_code_edits|good_explanations|proactive_help|multi_file_changes|good_debugging",
  "brief_summary": "One sentence: what user wanted and whether they got it"
}
```

### 中文对照

```
仅用符合下列 schema 的合法 JSON 对象作答：
{
  "underlying_goal": "用户最根本想达成什么",
  "goal_categories": {"类别名": 次数, ...},
  "outcome": "fully_achieved|mostly_achieved|partially_achieved|not_achieved|unclear_from_transcript",
  "user_satisfaction_counts": {"档位": 次数, ...},
  "claude_helpfulness": "unhelpful|slightly_helpful|moderately_helpful|very_helpful|essential",
  "session_type": "single_task|multi_task|iterative_refinement|exploration|quick_question",
  "friction_counts": {"摩擦类型": 次数, ...},
  "friction_detail": "用一句话描述摩擦；没有则留空",
  "primary_success": "none|fast_accurate_search|correct_code_edits|good_explanations|proactive_help|multi_file_changes|good_debugging",
  "brief_summary": "用一句话说明用户想达成什么，以及最终是否达成"
}
```

### `$sp` 校验（源码）

通过条件（字段存在性，非枚举穷尽校验）：

- `underlying_goal`、`outcome`、`brief_summary` 为 string  
- `goal_categories`、`user_satisfaction_counts`、`friction_counts` 为 object 且非 null  

成功后附上 `session_id`。失败返回 `null`（该 session 无新 facet）。

---

## P-section-* · 七章（共用包络）

下列七节是 `eh_` 数组里各章的 **`prompt` 模板**。实际请求还经上文「请求拼装」：模板后接 `DATA:` 与同一份公共 `dataString`；`maxTokens` 均为 **8192**，并行经 `Isp`。

---

## P-section-project_areas · 工作领域

| maxTokens | 8192 |
| 并行 | 与其它 section 同批 `Isp` |

### 英文原文

```
Analyze this Claude Code usage data and identify project areas.

RESPOND WITH ONLY A VALID JSON OBJECT:
{
  "areas": [
    {"name": "Area name", "session_count": N, "description": "2-3 sentences about what was worked on and how Claude Code was used."}
  ]
}

Include 4-5 areas. Skip internal CC operations.
```

### 中文对照

```
分析这些 Claude Code 使用数据，识别项目/工作领域。

仅用合法 JSON 对象作答：
{
  "areas": [
    {"name": "领域名", "session_count": N, "description": "2–3 句：做了什么、如何使用 Claude Code"}
  ]
}

包含 4–5 个领域。跳过 Claude Code 内部操作。
```

---

## P-section-interaction_style · 交互风格

### 英文原文

```
Analyze this Claude Code usage data and describe the user's interaction style.

RESPOND WITH ONLY A VALID JSON OBJECT:
{
  "narrative": "2-3 paragraphs analyzing HOW the user interacts with Claude Code. Use second person 'you'. Describe patterns: iterate quickly vs detailed upfront specs? Interrupt often or let Claude run? Include specific examples. Use **bold** for key insights.",
  "key_pattern": "One sentence summary of most distinctive interaction style"
}
```

### 中文对照

```
分析这些 Claude Code 使用数据，描述用户的交互风格。

仅用合法 JSON 对象作答：
{
  "narrative": "2–3 段分析用户如何与 Claude Code 交互。使用第二人称 you。描述模式：快速迭代 vs 事先详细说明？经常打断还是让 Claude 跑完？包含具体例子。关键洞察用 **粗体**。",
  "key_pattern": "一句话概括最显著的交互风格"
}
```

---

## P-section-what_works · 做得好的地方

### 英文原文

```
Analyze this Claude Code usage data and identify what's working well for this user. Use second person ("you").

RESPOND WITH ONLY A VALID JSON OBJECT:
{
  "intro": "1 sentence of context",
  "impressive_workflows": [
    {"title": "Short title (3-6 words)", "description": "2-3 sentences describing the impressive workflow or approach. Use 'you' not 'the user'."}
  ]
}

Include 3 impressive workflows.
```

### 中文对照

```
分析这些 Claude Code 使用数据，找出对该用户而言效果好的部分。使用第二人称（"you"）。

仅用合法 JSON 对象作答：
{
  "intro": "1 句上下文",
  "impressive_workflows": [
    {"title": "短标题（3–6 词）", "description": "2–3 句描述出色工作流或方法。用 you，不要用 the user。"}
  ]
}

包含 3 个 impressive workflows。
```

---

## P-section-friction_analysis · 摩擦分析

### 英文原文

```
Analyze this Claude Code usage data and identify friction points for this user. Use second person ("you").

RESPOND WITH ONLY A VALID JSON OBJECT:
{
  "intro": "1 sentence summarizing friction patterns",
  "categories": [
    {"category": "Concrete category name", "description": "1-2 sentences explaining this category and what could be done differently. Use 'you' not 'the user'.", "examples": ["Specific example with consequence", "Another example"]}
  ]
}

Include 3 friction categories with 2 examples each.
```

### 中文对照

```
分析这些 Claude Code 使用数据，识别该用户的摩擦点。使用第二人称（"you"）。

仅用合法 JSON 对象作答：
{
  "intro": "1 句概括摩擦模式",
  "categories": [
    {"category": "具体类别名", "description": "1–2 句解释该类别及可如何改变。用 you，不要用 the user。", "examples": ["带后果的具体例子", "另一例"]}
  ]
}

包含 3 个摩擦类别，每类 2 个例子。
```

---

## P-section-suggestions · 改进建议（含功能参考表）

### 英文原文

```
Analyze this Claude Code usage data and suggest improvements.

## CC FEATURES REFERENCE (pick from these for features_to_try):
1. **MCP Servers**: Connect Claude to external tools, databases, and APIs via Model Context Protocol.
   - How to use: Run `claude mcp add <server-name> -- <command>`
   - Good for: database queries, Slack integration, GitHub issue lookup, connecting to internal APIs

2. **Custom Skills**: Reusable prompts you define as markdown files that run with a single /command.
   - How to use: Create `.claude/skills/commit/SKILL.md` with instructions. Then type `/commit` to run it.
   - Good for: repetitive workflows - /commit, /review, /test, /deploy, /pr, or complex multi-step workflows

3. **Hooks**: Shell commands that auto-run at specific lifecycle events.
   - How to use: Add to `.claude/settings.json` under "hooks" key.
   - Good for: auto-formatting code, running type checks, enforcing conventions

4. **Headless Mode**: Run Claude non-interactively from scripts and CI/CD.
   - How to use: `claude -p "fix lint errors" --allowedTools "Edit,Read,Bash"`
   - Good for: CI/CD integration, batch code fixes, automated reviews

5. **Task Agents**: Claude spawns focused subagents for complex exploration or parallel work.
   - How to use: Claude auto-invokes when helpful, or ask "use an agent to explore X"
   - Good for: codebase exploration, understanding complex systems

RESPOND WITH ONLY A VALID JSON OBJECT:
{
  "claude_md_additions": [
    {"addition": "A specific line or block to add to CLAUDE.md based on workflow patterns. E.g., 'Always run tests after modifying auth-related files'", "why": "1 sentence explaining why this would help based on actual sessions", "prompt_scaffold": "Instructions for where to add this in CLAUDE.md. E.g., 'Add under ## Testing section'"}
  ],
  "features_to_try": [
    {"feature": "Feature name from CC FEATURES REFERENCE above", "one_liner": "What it does", "why_for_you": "Why this would help YOU based on your sessions", "example_code": "Actual command or config to copy"}
  ],
  "usage_patterns": [
    {"title": "Short title", "suggestion": "1-2 sentence summary", "detail": "3-4 sentences explaining how this applies to YOUR work", "copyable_prompt": "A specific prompt to copy and try"}
  ]
}

IMPORTANT for claude_md_additions: PRIORITIZE instructions that appear MULTIPLE TIMES in the user data. If user told Claude the same thing in 2+ sessions (e.g., 'always run tests', 'use TypeScript'), that's a PRIME candidate - they shouldn't have to repeat themselves.

IMPORTANT for features_to_try: Pick 2-3 from the CC FEATURES REFERENCE above. Include 2-3 items for each category.
```

### 中文对照

```
分析这些 Claude Code 使用数据，提出改进建议。

## CC 功能参考（features_to_try 须从中挑选）：
1. **MCP Servers**：通过 Model Context Protocol 连接外部工具、数据库与 API。
   - 用法：运行 `claude mcp add <server-name> -- <command>`
   - 适合：数据库查询、Slack、GitHub issue、内部 API

2. **Custom Skills**：可复用的 markdown 提示，用单条 /command 运行。
   - 用法：创建 `.claude/skills/commit/SKILL.md` 写入说明，然后输入 `/commit`
   - 适合：重复工作流——/commit、/review、/test、/deploy、/pr 或复杂多步流程

3. **Hooks**：在特定生命周期事件自动跑的 shell 命令。
   - 用法：写入 `.claude/settings.json` 的 "hooks"
   - 适合：自动格式化、类型检查、约定执行

4. **Headless Mode**：在脚本与 CI/CD 中非交互运行 Claude。
   - 用法：`claude -p "fix lint errors" --allowedTools "Edit,Read,Bash"`
   - 适合：CI/CD、批量修代码、自动 review

5. **Task Agents**：Claude 拉起专注子代理做复杂探索或并行工作。
   - 用法：有益时自动调用，或要求 "use an agent to explore X"
   - 适合：代码库探索、理解复杂系统

仅用合法 JSON 对象作答：
{
  "claude_md_additions": [
    {"addition": "基于工作流模式建议写入 CLAUDE.md 的具体行/块", "why": "基于真实会话解释为何有用的一句话", "prompt_scaffold": "应加在 CLAUDE.md 何处的说明"}
  ],
  "features_to_try": [
    {"feature": "上表中的功能名", "one_liner": "做什么", "why_for_you": "为何对你有用", "example_code": "可复制的命令或配置"}
  ],
  "usage_patterns": [
    {"title": "短标题", "suggestion": "1–2 句摘要", "detail": "3–4 句如何落到你的工作", "copyable_prompt": "可复制试用的提示"}
  ]
}

对 claude_md_additions 的重要要求：优先用户在数据中**多次**出现的指示。若用户在 2+ 会话说同样的话（如 always run tests），那是首选——不应反复自己叮嘱。

对 features_to_try 的重要要求：从上表选 2–3 项。每个类别包含 2–3 条。（按原文：Pick 2-3 from the CC FEATURES REFERENCE above. Include 2-3 items for each category.）
```

### 说明

- 这是产品向「教练」输出的功能目录，不是运行时自动安装 MCP。  
- HTML 报告中的 Features to Try / Usage Patterns 等区块消费此 JSON。

---

## P-section-on_the_horizon · 前瞻机会

### 英文原文

```
Analyze this Claude Code usage data and identify future opportunities.

RESPOND WITH ONLY A VALID JSON OBJECT:
{
  "intro": "1 sentence about evolving AI-assisted development",
  "opportunities": [
    {"title": "Short title (4-8 words)", "whats_possible": "2-3 ambitious sentences about autonomous workflows", "how_to_try": "1-2 sentences mentioning relevant tooling", "copyable_prompt": "Detailed prompt to try"}
  ]
}

Include 3 opportunities. Think BIG - autonomous workflows, parallel agents, iterating against tests.
```

### 中文对照

```
分析这些 Claude Code 使用数据，识别未来机会。

仅用合法 JSON 对象作答：
{
  "intro": "1 句关于 AI 辅助开发演进",
  "opportunities": [
    {"title": "短标题（4–8 词）", "whats_possible": "2–3 句有雄心的自主工作流描述", "how_to_try": "1–2 句相关工具", "copyable_prompt": "可试用的详细提示"}
  ]
}

包含 3 个机会。Think BIG——自主工作流、并行 agent、对着测试迭代。
```

---

## P-section-fun_ending · 结尾彩蛋

### 英文原文

```
Analyze this Claude Code usage data and find a memorable moment.

RESPOND WITH ONLY A VALID JSON OBJECT:
{
  "headline": "A memorable QUALITATIVE moment from the transcripts - not a statistic. Something human, funny, or surprising.",
  "detail": "Brief context about when/where this happened"
}

Find something genuinely interesting or amusing from the session summaries.
```

### 中文对照

```
分析这些 Claude Code 使用数据，找一个难忘时刻。

仅用合法 JSON 对象作答：
{
  "headline": "来自 transcript 的定性难忘瞬间——不是统计数字。人性、有趣或意外的东西。",
  "detail": "何时/何处的简短上下文"
}

从会话摘要中找真正有趣或好笑的内容。
```

---

## P-at-a-glance · 总览四段

### 元信息

| 项 | 内容 |
|---|---|
| 调用 | `th_` 在七章 `Promise.all` 之后构造 descriptor，再 `Isp(descriptor, "")` |
| 与 section 关系 | 复用同一 `Isp` / 同一 `querySource: "insights"` 调用点；**不是**第四个静态调用点 |
| maxTokens | **8192**（descriptor 字面量；`Isp` 读 `e.maxTokens`） |
| 数据 | 模板内 `SESSION DATA:` 与各章 bullet 插值；`Isp` 追加的 `DATA:` 后为空字符串 |

### 英文原文

```
You're writing an "At a Glance" summary for a Claude Code usage insights report for Claude Code users. The goal is to help them understand their usage and improve how they can use Claude better, especially as models improve.

Use this 4-part structure:

1. **What's working** - What is the user's unique style of interacting with Claude and what are some impactful things they've done? You can include one or two details, but keep it high level since things might not be fresh in the user's memory. Don't be fluffy or overly complimentary. Also, don't focus on the tool calls they use.

2. **What's hindering you** - Split into (a) Claude's fault (misunderstandings, wrong approaches, bugs) and (b) user-side friction (not providing enough context, environment issues -- ideally more general than just one project). Be honest but constructive.

3. **Quick wins to try** - Specific Claude Code features they could try from the examples below, or a workflow technique if you think it's really compelling. (Avoid stuff like "Ask Claude to confirm before taking actions" or "Type out more context up front" which are less compelling.)

4. **Ambitious workflows for better models** - As we move to much more capable models over the next 3-6 months, what should they prepare for? What workflows that seem impossible now will become possible? Draw from the appropriate section below.

Keep each section to 2-3 not-too-long sentences. Don't overwhelm the user. Don't mention specific numerical stats or underlined_categories from the session data below. Use a coaching tone.

RESPOND WITH ONLY A VALID JSON OBJECT:
{
  "whats_working": "(refer to instructions above)",
  "whats_hindering": "(refer to instructions above)",
  "quick_wins": "(refer to instructions above)",
  "ambitious_workflows": "(refer to instructions above)"
}

SESSION DATA:
${s}

## Project Areas (what user works on)
${c}

## Big Wins (impressive accomplishments)
${u}

## Friction Categories (where things go wrong)
${d}

## Features to Try
${p}

## Usage Patterns to Adopt
${f}

## On the Horizon (ambitious workflows for better models)
${m}
```

### 占位符说明（minify → 语义）

| 原文插值 | 在 `th_` 中的含义（据拼接上下文） |
|---|---|
| `${s}` | 聚合 session 数据摘要字符串 |
| `${c}` | project_areas 条目列表 |
| `${u}` | what_works / impressive 列表 |
| `${d}` | friction 类别列表 |
| `${p}` | features_to_try 列表 |
| `${f}` | usage_patterns 列表 |
| `${m}` | on_the_horizon 列表 |

### 中文对照

```
你在为 Claude Code 用户撰写使用 insights 报告的「At a Glance」摘要。目标是帮助他们理解自己的用法，并在模型变强时用得更好。

使用四段结构：

1. **What's working** — 用户与 Claude 交互的独特风格，以及做过的有影响力的事？可含一两个细节，但保持高阶（用户记忆可能已淡）。不要空洞吹捧。也不要聚焦他们用了哪些工具调用。

2. **What's hindering you** — 拆成 (a) Claude 的问题（误解、错误方法、bug）与 (b) 用户侧摩擦（上下文不足、环境问题——最好比单项目更一般）。诚实但建设性。

3. **Quick wins to try** — 可试用的具体 Claude Code 功能（见下文例子），或真正有吸引力的工作流技巧。（避免「先让 Claude 确认再行动」「先多打字给上下文」这类较弱建议。）

4. **Ambitious workflows for better models** — 未来 3–6 个月模型能力显著提升时，他们该为哪些事做准备？哪些现在看似不可能的工作流将会成为可能？从下文相应章节取材。

每段 2–3 句，别太长。不要压垮用户。不要提下面 session 数据里的具体数字或 underlined_categories。使用教练语气。

仅用合法 JSON 对象作答：
{
  "whats_working": "（见上）",
  "whats_hindering": "（见上）",
  "quick_wins": "（见上）",
  "ambitious_workflows": "（见上）"
}

SESSION DATA:
${s}

## Project Areas（用户从事的工作）
${c}

## Big Wins（令人印象深刻的成就）
${u}

## Friction Categories（哪里容易出问题）
${d}

## Features to Try
${p}

## Usage Patterns to Adopt
${f}

## On the Horizon（面向更强模型的进阶工作流）
${m}
```

### 说明

- 输出四字段供 HTML「At a Glance」与 `getPromptForCommand` 里 markdown 摘要使用。  
- 明确禁止堆数字，与 meta 统计展示分工：数字在 HTML 图表，glance 做定性教练。  
- 经 `Isp` 时模板末尾仍会多一个空的 `DATA:` 标签（见上文「请求拼装」）。

---

## P-user-reply · 主会话强制话术

### 元信息

| 项 | 内容 |
|---|---|
| 函数 | `Nsp({ insightsJson:e, reportUrl:t, htmlPath:r, facetsDir:n, header:o, summaryText:i })` |
| 调用 | 实现体 `getPromptForCommand` 的返回 text |
| 模型 | **主会话**模型（slash 分发 `shouldQuery`），不是上述三处 `querySource:"insights"` 内部调用 |

### 英文原文（扫描结果，含 minify 插值）

```
The user just ran /insights to generate a usage report analyzing their Claude Code sessions.

Here is the full insights data:
${e}

Report URL: ${t}
HTML file: ${r}
Facets directory: ${n}

At-a-glance summary (for your context only — the user has not seen any output yet):
${o}${i}

Output the text between <message> tags verbatim as your entire response. Do not omit any line:

<message>
Your shareable insights report is ready:
${t}

Want to dig into any section or try one of the suggestions?
</message>
```

### 占位符（按 `Nsp` 签名）

| 插值 | 参数名 |
|---|---|
| `${e}` | `insightsJson` |
| `${t}` | `reportUrl`（`file://` + htmlPath；分享句中再次使用） |
| `${r}` | `htmlPath` |
| `${n}` | `facetsDir`（`rIo()` → usage-data/facets） |
| `${o}` | `header`（`# Claude Code Insights` + 统计行 + 日期） |
| `${i}` | `summaryText`（At a Glance markdown 或 `_No insights generated_`） |

### 中文对照

```
用户刚刚运行了 /insights，以生成分析其 Claude Code 会话的使用报告。

以下是完整的 insights 数据：
${insightsJson}

报告 URL：${reportUrl}
HTML 文件：${htmlPath}
Facets 目录：${facetsDir}

At-a-glance 摘要（仅供你参考——用户尚未看到任何输出）：
${header}${summaryText}

将 <message> 标签之间的文本原样作为你的完整回复输出。不要省略任何一行：

<message>
Your shareable insights report is ready:
${reportUrl}

Want to dig into any section or try one of the suggestions?
</message>
```

### 说明

- **verbatim** 约束的是用户可见输出；上下文里仍有完整 JSON，便于用户追问某一节。  
- `<message>` 内两行英文是运行时用户实际看到的固定文案，故对照块保留英文。语义为：报告已就绪（链为 `${reportUrl}`）；可追问某一节或尝试建议。

---

## 相关页面

- [Claude Code /insights 命令的端到端流程](../mechanisms/claude-code-insights-slash-command.md)  
- [CometixSpace-claude-code 恢复流水线](../PriorKnowledge/cometix-claude-code-restore.md)  
- [acorn 与 JS AST 解析工具](../PriorKnowledge/acorn-and-js-ast-parsers.md)  

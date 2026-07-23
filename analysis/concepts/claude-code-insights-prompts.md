---
title: Claude Code /insights 内嵌提示词全文
kind: concept
status: active
updated: 2026-07-21
applies_to: claude-code / @cometix/claude-code 2.1.209
tags:
  - topic:claude-code
  - topic:slash-command
  - topic:insights
  - form:concept
---

# Claude Code `/insights` 内嵌提示词：它到底对模型说了什么

`/insights` 在背地里调了好几次内部模型。每次调用时，它都会把一段固定的英文指令塞进模型的 `userPrompt`，告诉模型：你现在要做什么、怎么输出、什么格式、什么语气。

这篇文章就是把那几段英文指令**原样拿出来**，配上中文翻译，再加上逐段解读——让你知道生成那份 HTML 报告的模型，到底收到了什么样的"任务书"。

**对不想读英文原文的读者**：每段都先给中文翻译和解释，再放英文原文。你可以只看中文部分，完全不碰英文，仍然能完整理解。

**对想研究 Claude 提示词设计的人**：英文固定文本是从 2.1.209 源码中直接扫描提取的；遇到 `${e}`、`${s}` 这类 minify 插值符号时，原文区保留符号，并在旁边单独解释它们在当前调用链里的语义。每段附有提取上下文说明。

---

## 这些提示词按什么顺序执行

回顾一下 [全程解析](../mechanisms/claude-code-insights-slash-command.md) 中讲到的引擎内部流程，提示词先在三个内部环节出现，最后还有一段进入主会话：

```text
聊天记录 → 有损投影 → （太长的话：分块摘要──这里用到 P1）
     → 抽取 facet 标签 ──这里用到 P2+P3
     → 聚合统计 → 并行写七章 ──这里用到 P4 到 P10
     → 合成总览 ──这里用到 P11
     → 主会话输出分享句 ──这里用到 P12（不进内部模型，进主会话模型）
```

一共 12 段提示词，下面逐一展开。

**阅读提示**：下面每段提示词的第一小节"它是干什么的"就是中文摘要——你可以只看它，跳过英文原文，完全够用。

---

## P1 · 分块摘要

### 它是干什么的

有些聊天记录特别长。引擎先把它们压缩成"有损投影"（每条消息最多保留几百字、工具调用只留名字）。如果投影后还是超过 30000 字符，就把投影切成每片 25000 字符的块，对**每一块**调用内部模型做摘要。

这段提示词告诉模型：把这坨对话片段浓缩成 3 到 5 句话，但要保留文件名、错误信息、用户反馈这些关键细节。每片的输出上限只有 500 token——所以必须高度精炼。

所有分块的摘要最后会被拼接起来，作为下一步 facet 抽取的输入。也就是说，一个超长会话的完整聊天记录最终会被压缩成一段多片摘要拼接的文本，再送进下一步"打标签"。

### 中文译文

```
请摘要这段 Claude Code 会话记录。重点：
1. 用户要求了什么
2. Claude 做了什么（用了哪些工具、改了哪些文件）
3. 有无摩擦或问题
4. 结果如何

保持简洁——3 到 5 句。保留具体细节，如文件名、错误信息、用户反馈。

TRANSCRIPT 片段：
```

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

### 解读

这段提示词的"保留具体细节"指令很有意思。它不只是要摘要，还要**刻意保留命名实体**——文件名、错误信息。为什么？因为后面的摩擦分析（P7）需要这些细节来生成具体的改进建议。如果在分块阶段就把文件名丢掉了，后面就只剩下模糊的"有个文件改了"——这没法给出有用的反馈。

输出上限只有 500 token 意味着模型必须非常克制。对比后面的章节提示词（每章 8192 token），分块摘要是全链路的"信息瓶颈"。这说明引擎的设计哲学是：**在早期阶段做重度压缩，在后期阶段做丰富展开。**

---

## P2 · 单会话 Facet 抽取指南

### 它是干什么的

"Facet"是引擎对每个会话的**结构化语义标签**——用 JSON 描述这个会话的根本目标是什么、用户的满意度怎样、有没有遇到摩擦、属于哪种会话类型。

这段提示词告诉模型怎么从压缩后的聊天记录中提取这些标签。它的核心精神是一句话：**目标和满意度都尽量以用户明确表达的信号为准，不要把 Claude 自己的行为当成用户请求。** 比如，用户说"帮我修 bug"才算一个目标请求——Claude 自己跑去探索代码库不算。用户说"太好了！"可以记为满意；用户说"好，接下来我们……"并且没有表达抱怨，可以记为 `likely_satisfied`。如果用户什么都没说，提示词并没有授权模型自动把沉默记成满意。

最后还有一条保护规则：如果会话特别短或只是热身，目标类别直接用 `warmup_minimal`。标了这个标签的会话之后会从聚合统计中剔除，避免拉偏整体数据。

### 中文译文

```
分析这个 Claude Code 会话，并抽取结构化 facet。

关键准则：

1. **goal_categories（目标类别）**：只统计用户**明确提出**的请求。
   - 不要统计 Claude 自主做的代码库探索
   - 不要统计 Claude 自行决定开展的工作
   - 仅当用户说"can you…""please…""I need…""let's…"之类时才计数

2. **user_satisfaction_counts（用户满意度计数）**：只依据**明确的用户信号**。
   - "Yay!""great!""perfect!" → happy（非常满意）
   - "thanks""looks good""that works" → satisfied（满意）
   - "ok, now let's…"（无抱怨地继续）→ likely_satisfied（可能满意）
   - "that's not right""try again" → dissatisfied（不满意）
   - "this is broken""I give up" → frustrated（沮丧）

3. **friction_counts（摩擦计数）**：具体说明哪里出了问题。
   - misunderstood_request：Claude 理解错了请求
   - wrong_approach：目标对，方法错
   - buggy_code：代码不正确
   - user_rejected_action：用户拒绝/叫停了某个工具调用
   - excessive_changes：改动过多或过度设计

4. 若会话很短或只是热身，goal 类别使用 warmup_minimal

SESSION：
```

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

### 解读

这段提示词最值得细品的是满意度判断的精细分级。它不是简单的"满意/不满意"二分，而是从 `happy`（"Yay!"这种情绪外露的肯定）一直分到 `frustrated`（"I give up"这种明显受挫）。中间的 `likely_satisfied` 也不是给沉默用户兜底：它仍然要求一个可观察的用户信号，例如"好，接下来……"这种无抱怨的继续推进，只是这个信号比"great"或"perfect"弱。换句话说，这套分类允许模型区分强肯定、普通肯定、弱肯定和明确负面，却没有把"用户没说话"直接等同于满意。

摩擦分类也值得注意。`excessive_changes`（改动过多）被单独列为一类，说明这份分析框架不只关心代码最后有没有跑通，也关心 Claude 是否把事情做大了。`user_rejected_action`（用户叫停工具调用）则记录另一种不同的失败：它不是代码出了 bug，而是用户对 Claude **行为本身的否决**。这些分类至少能让报告把"结果错误"与"过程失控"分开讲；源码本身并不能证明这些数据之后是否还会被用于训练或产品优化。

还有一个值得原样保留的上游细节：指南最后一句写的是单数 `goal_category`，紧接着的 schema 字段却是复数 `goal_categories`。运行时提示词就是这样拼接的，本文不替它悄悄统一。它未必会让模型失败，但说明逆向提示词时不能只看意思，还要保留字段级的不一致。

---

## P3 · Facet 输出 Schema

### 它是干什么的

和 P2 拼接在一起发给模型。告诉模型输出必须是合法 JSON，每个字段是什么意思、枚举值有哪些。

### 中文译文

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

### 解读

Schema 里有几个设计细节值得注意。

`session_type` 的五个值（`single_task` / `multi_task` / `iterative_refinement` / `exploration` / `quick_question`）把 Claude Code 会话按任务结构分成了五类。仅从这份 schema 能确认的是：后续报告需要用这套分类理解会话，而不是把所有对话都视作同一种使用方式。至于这是否代表团队完整的用户研究模型，源码没有提供足够证据。

`primary_success` 是一个单选字段——只取一个值。这意味着每个会话只能有一个"主要成功类型"。但现实中一个会话可能既有 `correct_code_edits`（改对了代码）又有 `good_explanations`（解释得好）。这个设计选择背后的假设是：**一个会话只有一个最突出的亮点**。这个假设可能不总是成立，但确实让统计分析变简单了。

引擎在收到 JSON 后会做一次校验（源码中叫 `$sp`）：检查 `underlying_goal`、`outcome`、`brief_summary` 是不是字符串，`goal_categories`、`user_satisfaction_counts`、`friction_counts` 是不是非 `null` 的对象。这里检查的是字段存在性和基本类型，并没有穷尽 schema 中全部枚举值。校验失败时，这个会话本轮不会得到新的 facet；引擎选择跳过它，而不是让整份报告随一个坏 JSON 一起失败。

---

## 报告七章

以下 P4 到 P10 是 `/insights` 报告 HTML 中七个章节各自对应的提示词。它们**全部并行**发出——不是一章一章等的。每章拿到同一份聚合数据（跨会话的统计数字 + 采样的会话摘要列表），但被要求从不同角度解读这份数据。每章的输出上限均为 8192 token。

每章的请求格式都是：

```text
[章节提示词模板]

DATA:
[聚合统计 JSON + 会话摘要列表 + 摩擦详情列表 + 用户指示列表]
```

---

## P4 · 工作领域

### 它是干什么的

让模型从一堆会话中归纳出 4 到 5 个"项目领域"。比如你可能同时在用 Claude Code 写前端、修后端 bug、写文档——模型要自己从会话摘要中把这些领域识别出来并命名。输出里除了领域名称和涉及的会话数量，还要用 2 到 3 句话描述你在每个领域里具体做了什么、怎么用的 Claude Code。

### 中文译文

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

### 解读

"跳过 Claude Code 内部操作"是一条很短、边界也没有被进一步定义的指令。它至少表明：模型不应让 Claude Code 自身的内部维护活动压过用户真正从事的项目工作。但它是否要排除所有关于 CLAUDE.md、hooks 或 Claude Code 用法的正常用户任务，源码没有继续说明。更稳妥的理解是把它当成降噪原则，而不是一份已经列举完整的排除清单。

---

## P5 · 交互风格

### 它是干什么的

分析你**怎么**跟 Claude 交流，而不是你用它做了什么。你是那种会提前想好需求再一次性丢给 Claude 的人，还是喜欢边聊边改？你经常中途打断 Claude 让它换方向，还是让它跑完再说？你给 Claude 的指令是模糊的（"帮我修一下"）还是具体的（"在 src/utils/auth.ts 的 login 函数里加上 token 过期检查"）？

输出里除了叙事性分析（2–3 段，用第二人称"you"），还有一句"最显著的交互风格"概括。

### 中文译文

```
分析这些 Claude Code 使用数据，描述用户的交互风格。

仅用合法 JSON 对象作答：
{
  "narrative": "2–3 段分析用户如何与 Claude Code 交互。使用第二人称 you。描述模式：快速迭代 vs 事先详细说明？经常打断还是让 Claude 跑完？包含具体例子。关键洞察用 **粗体**。",
  "key_pattern": "一句话概括最显著的交互风格"
}
```

### 英文原文

```
Analyze this Claude Code usage data and describe the user's interaction style.

RESPOND WITH ONLY A VALID JSON OBJECT:
{
  "narrative": "2-3 paragraphs analyzing HOW the user interacts with Claude Code. Use second person 'you'. Describe patterns: iterate quickly vs detailed upfront specs? Interrupt often or let Claude run? Include specific examples. Use **bold** for key insights.",
  "key_pattern": "One sentence summary of most distinctive interaction style"
}
```

### 解读

这个章节的存在本身就传达了一个信号：在 `/insights` 的分析框架里，**交互方式本身就是值得反馈的对象**。它不是只统计你完成了什么，还试图像镜子一样呈现你如何描述任务、如何迭代、是否经常中断，以及会不会让 Claude 一直跑完。提示词要求描述模式，却没有预先判定哪种风格一定更高效；具体好坏仍要结合报告里出现的例子来判断。

---

## P6 · 做得好的地方

### 它是干什么的

从你的会话记录中找出 3 个"令人印象深刻的工作流或做法"。不是笼统地说"你擅长用 Claude 写代码"，而是要具体到可描述的模式——比如"每次遇到不熟悉的代码库，你都会先让 Claude 画架构图再开始改代码"。同样使用第二人称"you"。

### 中文译文

```
分析这些 Claude Code 使用数据，找出对该用户而言效果好的部分。使用第二人称 you。

仅用合法 JSON 对象作答：
{
  "intro": "1 句上下文",
  "impressive_workflows": [
    {"title": "短标题（3–6 词）", "description": "2–3 句描述出色工作流或方法。用 you，不要用 the user。"}
  ]
}

包含 3 个 impressive workflows。
```

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

### 解读

提示词里反复强调"用 you 不要用 the user"——这很微妙。如果用"the user"（该用户），读起来像一份冷冰冰的第三方分析报告。用"you"（你），读起来像教练在跟你一对一谈话。整份报告的定位是"你的个人使用教练"，而不是"你的数据被分析后的客观报告"。人称代词的选择是这种定位的语法层面的落实。

---

## P7 · 摩擦分析

### 它是干什么的

从会话中归纳出 3 个摩擦类别，每个类别配 2 个具体例子（带后果的那种——不是"有一次改错了文件"，而是"改错了文件导致测试挂了半小时"）。然后对每个类别给出 1 到 2 句"可以怎么做不同的"建议。

### 中文译文

```
分析这些 Claude Code 使用数据，识别该用户的摩擦点。使用第二人称 you。

仅用合法 JSON 对象作答：
{
  "intro": "1 句概括摩擦模式",
  "categories": [
    {"category": "具体类别名", "description": "1–2 句解释该类别及可如何改变。用 you，不要用 the user。", "examples": ["带后果的具体例子", "另一例"]}
  ]
}

包含 3 个摩擦类别，每类 2 个例子。
```

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

### 解读

注意它要求每个例子"带后果"（with consequence）——不只是"出了什么问题"，而是"出了这个问题导致了什么"。这是一个很有见地的要求。只说"出现过 buggy_code"是死数据；如果会话摘要确实记录了后续影响，报告就可以进一步写成"生成的代码没有通过测试，用户随后转入手工排查"。后果让摩擦**可感知**，也让改进建议更有依据；它不能凭空补出摘要里没有的耗时或损失。

---

## P8 · 改进建议

### 它是干什么的

这是全文最"产品向"的章节。它不是只分析你过去做了什么，而是给出**可以立即行动的建议**，分成三个板块：

- **CLAUDE.md 添加项**：基于你的使用模式，你应该在项目的 CLAUDE.md 里加上什么指令？比如如果你在 2 个以上的会话里反复告诉 Claude "记得跑测试"，就该把这句话写进 CLAUDE.md 而不是每次都重复。提示词特别强调：优先挑"多次出现"的用户指示——你不应该需要反复叮嘱同一件事。
- **推荐尝试的功能**：从 MCP Servers、Custom Skills、Hooks、Headless Mode、Task Agents 五个 Claude Code 特性中选 2 到 3 个，解释为什么**对你**有用，并给出可直接复制粘贴的命令或配置。
- **使用模式**：基于已有会话提炼出的可复用的工作流技巧，附上可复制的提示词模板。

### 中文译文

```
分析这些 Claude Code 使用数据，提出改进建议。

## CC 功能参考（features_to_try 须从中挑选）：
1. **MCP Servers**：通过 Model Context Protocol 连接外部工具、数据库与 API。
   用法：运行 `claude mcp add <server-name> -- <command>`
   适合：数据库查询、Slack 集成、GitHub issue 查询、连接内部 API

2. **Custom Skills**：可复用的 markdown 提示，用单条 /command 运行。
   用法：创建 `.claude/skills/commit/SKILL.md` 写入说明，然后输入 `/commit`
   适合：重复工作流——/commit、/review、/test、/deploy、/pr 或复杂多步流程

3. **Hooks**：在特定生命周期事件自动运行的 shell 命令。
   用法：写入 `.claude/settings.json` 的 "hooks" 键下
   适合：自动格式化代码、运行类型检查、执行约定

4. **Headless Mode**：在脚本与 CI/CD 中非交互运行 Claude。
   用法：`claude -p "fix lint errors" --allowedTools "Edit,Read,Bash"`
   适合：CI/CD 集成、批量修复代码、自动化 review

5. **Task Agents**：Claude 拉起专注子代理做复杂探索或并行工作。
   用法：Claude 认为有益时自动调用，或要求 "use an agent to explore X"
   适合：代码库探索、理解复杂系统

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

**对 claude_md_additions 的重要要求**：优先选择在用户数据中**多次出现**的指示。如果用户在 2 个以上会话中告诉 Claude 同样的事（比如 "always run tests""use TypeScript"），那是最佳选项——他们不应反复重复自己说过的话。

**对 features_to_try 的重要要求**：从上表选 2–3 项。每个类别包含 2–3 条。
```

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

### 解读

这一段是全链路中最"接地气"的提示词。它不再只解释你过去做了什么，而是把历史模式转成下一步行动：哪些反复说过的话值得写进 CLAUDE.md，哪些现成功能可能解决你的摩擦，哪些有效做法可以整理成以后直接复用的提示。站在产品效果上看，它确实可能起到"功能发现"和"用户激活"的作用；源码能直接证明的，则只是这份提示词被明确要求产出这些建议。

五点 CC 功能参考表（MCP、Skills、Hooks、Headless、Agents）是一份写死在这个版本提示词里的**候选功能菜单**。它能证明 `/insights` 在 2.1.209 中会从这五类功能里组织推荐，但不能单凭这一段就断言它们是整个产品唯一或完整的核心价值主张。提示词也不是在运行时自动安装某个 MCP Server：它提供菜单和用法示例，再让模型根据会话数据按需点菜。

`claude_md_additions` 的优先级规则——"如果在 2+ 会话中反复出现同一指示，优先提议写进 CLAUDE.md"——是一个非常聪明的自动化。它本质上是在帮用户做**重复沟通成本的审计**：你每对 Claude 重复一次"记得跑测试"，就是在浪费一次本该被永久化到 CLAUDE.md 的沟通成本。报告把这个事实摆到你面前，比任何笼统的"建议用 CLAUDE.md"都有说服力。

这里还藏着一处上游歧义。提示词先要求 `features_to_try` 从功能表中挑 **2–3 项**，最后一句又写着 `Include 2-3 items for each category`。`category` 可能是指三个输出数组，也可能只是措辞不严谨；源码没有替我们消歧。本文保留两句原文，不把其中任何一种解释冒充成确定规则。

---

## P9 · 前瞻机会

### 它是干什么的

把视野从"现在能做什么"拉到"模型更强之后能做什么"。有哪些工作流现在看起来不切实际，但能力提升后可能变得可行？提示词明确要求：**Think BIG**——自主工作流、并行 agent、对着测试迭代直到通过。这里本身没有给出具体时间表；后面的 At a Glance 提示词才进一步写到未来 3–6 个月。

输出 3 个机会，每个配一个可复制的提示词模板——意味着用户可以**现在就试**，只是效果可能要等更强模型才能真正体现。

### 中文译文

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

### 解读

这个章节的提示词里有一句很有味道的话：**"Include 3 opportunities. Think BIG."** 它不是让模型做预测（"你认为未来会怎样"），而是让它做**可行性想象**（"基于你目前的用法，如果你有更强的模型，你可以做什么"）。这是一个"想象力放大器"的角色——让用户看到自己当前工作模式的进化天花板。

---

## P10 · 结尾彩蛋

### 它是干什么的

在报告末尾放一个"人味"的瞬间——不是统计数据，不是效率指标，而是从会话材料中找出一个有趣、意外或有人情味的片段。它可能是一句被摘要保留下来的吐槽，也可能是一次意外顺利或格外曲折的任务。这里要注意：章节模型实际拿到的是采样后的会话摘要和公共数据串，不是重新打开全部原始 transcript；它只能从上游仍然保留下来的细节中挑选。

### 中文译文

```
分析这些 Claude Code 使用数据，找一个难忘时刻。

仅用合法 JSON 对象作答：
{
  "headline": "来自 transcript 的定性难忘瞬间——不是统计数字。人性、有趣或意外的东西。",
  "detail": "何时/何处的简短上下文"
}

从会话摘要中找真正有趣或好笑的内容。
```

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

### 解读

这个章节让整份报告在一连串统计、摩擦和建议之后，换一种更轻、更有人味的收束方式。它没有要求模型再总结一个指标，而是要求寻找定性的、好笑或意外的瞬间。我们不能仅凭源码断言设计者就是为了延长读者注意力，但从阅读效果看，它确实承担了打破分析腔、给报告留一个记忆点的作用。

它也不是让模型凭空编一个笑话，而是要求从 session summaries 中"找"。不过这种真实性受上游压缩链限制：如果某个生动细节早在有损投影、分块摘要或 facet 摘要阶段被丢掉，彩蛋章节无法从原始 transcript 把它捞回来。这里展示的是被摘要保留下来的真实痕迹，而不是对完整聊天记录的逐字检索。

---

## P11 · 总览（At a Glance）

### 它是干什么的

七章全部返回后，引擎把各章结果作为上下文，再调一次内部模型，合成一个四段式的总览。

这四段不是七章的简单摘要。它们有自己的定位：

1. **What's working** —— 高层次的亮点，不给空泛赞美
2. **What's hindering you** —— 诚实但建设性地拆解摩擦：哪些是 Claude 的锅，哪些是你侧的问题
3. **Quick wins to try** —— 马上能做的事（但要避开"先确认再行动""多打点上下文"这类没营养的建议）
4. **Ambitious workflows** —— 面向未来 3–6 个月更强模型的大胆规划

语气要求：教练式的，不要堆数字（数字在 HTML 图表里），不要太长（每段 2–3 句），不要用 `underlined_categories` 之类的冷冰冰标签。用第二人称。

### 中文译文

```
你在为 Claude Code 用户撰写使用 insights 报告的「At a Glance」摘要。目标是帮助他们理解自己的用法，并在模型变强时用得更好。

使用四段结构：

1. **What's working** — 用户与 Claude 交互的独特风格，以及他们做过的有影响力的事？可含一两个细节，但保持高阶（用户记忆可能已淡）。不要空洞吹捧。也不要聚焦他们用了哪些工具调用。

2. **What's hindering you** — 拆成 (a) Claude 的问题（误解、错误方法、bug）与 (b) 用户侧摩擦（上下文不足、环境问题——最好比单项目更一般）。诚实但建设性。

3. **Quick wins to try** — 可试用的具体 Claude Code 功能（见下文例子），或真正有吸引力的工作流技巧。（避免「先让 Claude 确认再行动」「先多打字给上下文」这类较弱建议。）

4. **Ambitious workflows for better models** — 未来 3–6 个月模型能力显著提升时，他们该为哪些事做准备？哪些现在看似不可能的工作流将会成为可能？从下文相应章节取材。

每段 2–3 句，别太长。不要压垮用户。不要提下面 session 数据里的具体数字或 underlined_categories。使用教练语气。

仅用合法 JSON 对象作答：
{
  "whats_working": "（见上文说明）",
  "whats_hindering": "（见上文说明）",
  "quick_wins": "（见上文说明）",
  "ambitious_workflows": "（见上文说明）"
}

SESSION DATA:
[session 数据摘要]

## Project Areas（用户从事的工作领域）
[P4 结果]

## Big Wins（令人印象深刻的成就）
[P6 结果]

## Friction Categories（摩擦类别）
[P7 结果]

## Features to Try
[P8 结果中的 features_to_try]

## Usage Patterns to Adopt
[P8 结果中的 usage_patterns]

## On the Horizon（面向更强模型的进阶工作流）
[P9 结果]
```

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

这里的单字母来自 minify 后的模板插值。按 `th_` 中的实参顺序还原：

| 占位符 | 运行时语义 |
|---|---|
| `${s}` | 聚合后的 session 数据摘要 |
| `${c}` | P4 `project_areas` 结果 |
| `${u}` | P6 `what_works` 结果 |
| `${d}` | P7 `friction_analysis` 结果 |
| `${p}` | P8 的 `features_to_try` |
| `${f}` | P8 的 `usage_patterns` |
| `${m}` | P9 `on_the_horizon` 结果 |

### 解读

这段提示词最有意思的是它**明确规定了什么不要做**。

> "Don't be fluffy or overly complimentary."（不要空洞吹捧）
> "Don't focus on the tool calls they use."（不要聚焦于他们用了哪些工具调用）
> "Avoid stuff like 'Ask Claude to confirm before taking actions' or 'Type out more context up front' which are less compelling."（避免没营养的建议）

这三条"不要"直接针对 AI 生成报告里很常见的退化模式：空洞吹捧、把工具列表当洞察，以及给出放到任何人身上都成立的安全建议。源码没有告诉我们这些约束来自哪一次用户研究或内部复盘，但它至少清楚展示了设计者想提前堵住哪些输出路径。

另外，总览位于七章全部返回之后才生成——这意味着**总览不是七章的同时产物，而是七章的再加工。** 它有时间上的"后见之明"——先看完所有章节，再决定什么值得在总览中呈现。这是一种"编辑"逻辑，而非"生成"逻辑。

---

## P12 · 主会话强制话术

### 它是干什么的

前面所有的提示词（P1 到 P11）都是发给**内部模型**的——它们在报告引擎里被消费，你看不到。P12 是发给**主会话模型**的——就是聊天窗里跟你对话的那位。

它不是一个"请求"。它是一个**命令**：你的输出只能是 `<message>` 标签里的那两句话，不准自己发挥。

模板把完整的 insights JSON、报告路径、facets 目录、At a Glance 摘要全部塞了进去。但用户视角下，聊天窗只出现两行英文加一个 `file://` 链接。其余信息（insights JSON 等）是给主会话模型的**上下文养料**——当你紧接着追问"摩擦分析那章再展开一下"，它通常可以从仍在上下文里的数据回答；如果后续对话很长、上下文被压缩，这份材料并不保证永久保留。

### 中文译文

```
用户刚刚运行了 /insights，以生成分析其 Claude Code 会话的使用报告。

以下是完整的 insights 数据：
[insights JSON]

报告 URL：[file:// 路径]
HTML 文件：[本地路径]
Facets 目录：[本地路径]

At-a-glance 摘要（仅供你参考——用户尚未看到任何输出）：
[报告标题 + 统计行 + At a Glance 摘要 markdown]

将 <message> 标签之间的文本原样作为你的完整回复输出。不要省略任何一行：

<message>
Your shareable insights report is ready:
[file:// 链接]

Want to dig into any section or try one of the suggestions?
</message>
```

### 英文原文

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

| 占位符 | 运行时语义 |
|---|---|
| `${e}` | `insightsJson`，完整 insights JSON |
| `${t}` | `reportUrl`，即 `file://` 链接 |
| `${r}` | `htmlPath`，本地 HTML 路径 |
| `${n}` | `facetsDir`，facet 缓存目录 |
| `${o}` | 报告 header 与统计行 |
| `${i}` | At a Glance 的 markdown 摘要 |

### 解读

这段提示词有一个很微妙的措辞：**"At-a-glance summary (for your context only — the user has not seen any output yet)"**。

"For your context only" 是告诉主会话模型：这份摘要不是我（命令）展示给用户的——它是写给你（主会话模型）看的，让你在用户追问时有话可说。但这句话同时也在向模型暗示：不要主动把摘要的内容在聊天窗里复述一遍。如果模型"太热心"地把总览四段全打出来，用户看到的就不是两行链接而是一整面墙的英文——HTML 报告的价值就被稀释了。

`<message>` 标签在这里充当一条很醒目的**输出边界**：标签外是供主会话理解的上下文，标签内是希望它逐字交给用户的内容。这不是程序层面的硬沙箱，最终仍依赖模型遵从 `verbatim` 指令；但通过把上下文材料和目标回复明确分区，模板显著降低了主模型顺手复述整份报告的可能性。

---

## 从这些提示词能看出什么

看完这 12 段提示词，有几个贯穿始终的设计思想值得拎出来：

**1. 报告不只是在分析，也在扮演教练。** 从 P5 到 P11，反复出现"用 you""教练语气""给可复制的命令""不要空洞吹捧"。这些约束让报告不满足于告诉你"过去发生了什么"，还会继续追问"接下来可以试什么"。因此它同时具有行为分析和个人教练两种面孔，后者在建议与总览章节尤其明显。

**2. 提示词同时规定了要做什么和不要做什么。** 这里有一整套防御性约束：不要把 Claude 的自主探索算成用户目标，不要堆具体数字，不要空洞吹捧，也不要用"先让 Claude 确认再行动"或"先多给上下文"这类泛化建议糊弄过去。我们不需要猜测这些约束背后的内部故事，也能看出它们在主动压制几种常见的低质量输出。

**3. 压缩链的设计。** 全链路的信息压缩非常激进：原始聊天记录（可能几十万 token）→ 有损投影（留下命名实体和结构）→ 分块摘要（每片浓缩到 500 token）→ facet JSON（每个会话浓缩为一个 JSON 对象）→ 七章报告（每章 8192 token）。每一步都在做高倍率压缩，但每一步都刻意保留了对下一步有价值的信息。这是一种"漏斗式信息精炼"的工程方法。

**4. 不同阶段使用不同的输出契约。** 分块摘要 P1 输出普通短文本；facet、七章和总览要求合法 JSON；主会话 P12 则要求逐字输出 `<message>` 中的固定文本。对需要进入聚合或 HTML 渲染的阶段，JSON 不是风格偏好，而是流水线接口。如果某一章返回无法解析的内容，对应板块就可能缺失；并行请求本身并不依赖 JSON，但后续统一消费这些结果依赖稳定结构。

**5. 本地落盘不等于纯离线分析。** 原始 JSONL 会先经过有损投影：每条消息被截断，工具参数和返回值被丢弃，过长内容还会再摘要。但提示词同时要求保留文件名、错误信息和用户反馈，facet 还要判断根本目标与摩擦。结果是：模型后端看到的不是完整 transcript，却仍可能看到足够具体的语义片段。源码能证明这条数据边界，不能证明截断最初就是以隐私保护为主要动机；对使用者而言，重要的是不要把"报告文件留在本地"误解成"会话内容完全不进入模型请求"。

---

## 附录：提取方法与源码引用

本页所有英文提示词均从 `@cometix/claude-code` 2.1.209 版本的 `cli.js` 中提取。

| 项 | 内容 |
|---|---|
| 文件 | `artifacts/2.1.209/global-prefix/node_modules/@cometix/claude-code/cli.js` |
| 版本 | 2.1.209 |
| SHA-256 | `724361250D92E0EBF10FEE99387CCD25FA29E0D463600FE06DFA02F570CC4A89` |
| 提取方法 | acorn 8.17.0 AST 解析 + template literal 括号平衡扫描；关键函数体（`Isp`、`th_`、`ld`）锚点交叉核对 |
| system prompt | 所有内部 `hct` 调用均为 `systemPrompt: ld([])`，2.1.209 中 `ld` 为恒等函数 → system 为空数组；insights 专属指令全部在 `userPrompt` |
| 插值说明 | 源码经过 minify，提示词中的 `${e}` 等为单字母占位符，本页已在译文和说明中还原了它们的语义（如 `${e}` → insights JSON） |
| 未做 | 未实际执行 `/insights`、未对 API 发送请求、未改写英文原文的语义 |

### 提示词在源码中的位置

| 提示词 | 源码中的锚点 | 调用链 |
|---|---|---|
| P1 分块摘要 | `zm_` 函数的 `userPrompt` 拼接 | `Osp` → `Km_` → `zm_` |
| P2 Facet 指南 | `Fm_` 常量 + `Zm_` 函数拼接 | `Osp` → `Zm_`（+ `Fm_`） |
| P3 Facet Schema | `Zm_` 函数体内的字符串拼接 | 同上 |
| P4–P10 七章 | `eh_` 数组中各项的 `prompt` 字段，经 `Isp` 拼装 | `Osp` → `th_` → `Isp` |
| P11 总览 | `th_` 中 `atAGlanceDescriptor` 的 `prompt` 字段，经同一 `Isp` | `th_` → `Isp` |
| P12 主会话话术 | `Nsp` 函数返回的模板字符串 | `getPromptForCommand` → `Nsp` |

三处 `querySource: "insights"` 字面量分别位于：`zm_`（分块摘要）、`Zm_`（facet 抽取）、`Isp`（章节+总览）。P12 不在这三处——它走主会话的 `shouldQuery` 路径。

---

## 交互演示

- [demos/insights-pipeline](../../demos/insights-pipeline/) — 与 mechanism 页共用：报告引擎流水线与提示词阶段的逐步演示（脚手架，实现待补）

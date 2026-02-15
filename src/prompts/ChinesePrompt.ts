import { BulletPhaseWorkExperience, PromptContext } from './types';

export function generateChinesePrompt(context: PromptContext): string {
  const {
    targetTitle,
    job,
    requiredExp,
    profile,
    earliestWorkDate,
    actualExperienceText,
    totalMonths,
    needsSupplement,
    actualYears,
    supplementYears,
    supplementSegments,
    allWorkExperiences
  } = context;

  // --- 预处理逻辑 ---

  // 1. 职级/称谓规则
  let seniorityRule = requiredExp.min <= 5
    ? '**严禁使用"高级"、"资深"、"专家"等前缀**（因岗位经验要求≤5年）。'
    : '可以使用"高级"，但需谨慎使用"资深/专家"（除非确实符合多年经验）。';
  
  let managementRule = '工作三年后可根据岗位需求添加"主管/组长"经历（带5-10人团队）。';

  // [New Constraint] Seniority Title Threshold (Graduation + 4y)
  if (context.seniorityThresholdDate) {
      seniorityRule += `\n   - **学历与资历硬性门槛**: 根据用户学历推算，**严禁**在 **${context.seniorityThresholdDate}** 之前的时间段使用"高级、资深、专家、负责人、主管"等高级职称。`;
      managementRule += `\n   - **第一份工作严禁使用管理岗**: 无论时间如何，简历列表中的**最早那一份工作经历**绝对不能是管理或高级岗位。`;
  }

  // 2. 补充经历部分的文本
  let supplementInstruction = '';
  if (needsSupplement) {
    const isJunior = (context.finalTotalYears || 0) < 2;
    const companyNamingGuide = isJunior
      ? `* 公司名：根据"${targetTitle}"风格生成真实感强的工作室名称。
        - 科技/开发: 如 "智创科技"、"云码技术"
        - 运营/电商: 如 "跨境优选工作室"、"数字营销"
        - 产品/设计: 如 "用户体验工作室"、"创新工场"
        - Web3: 如 "链上创新"、"数字资产"`
      : `* 公司名：必须使用一家符合"${targetTitle}"领域的**真实存在的、极小规模（超小众/非知名）的美国初创公司(Start-up)**名称。
        - **核心要求**：**严禁虚构，也不得使用已成名公司**（如 OpenAI, Figma, Cursor, Vercel 等已具有高知名度的严禁使用）。
        - **特征**：处于 Seed 或 A 轮极早期，员工规模通常在 10-50 人，大众知名度极低。
        - 科技/程序: 真实的冷门硅谷 Start-up (如 "Standard Metrics", "Keepic", "Pigeon (YC S21)", "Flawless AI" 等)。
        - 市场/运营: 垂直细分领域的真实初创品牌，不要任何行业头部品牌。
        - 消费/美妆: 真实的、刚起步的美国实验室品牌或小众独立 DTC。
        - 务必确保该公司在真实世界中可查（如有 Crunchbase 记录），但对普通大众甚至行业人员来说都非常陌生。`;

    const segmentsText = (supplementSegments || []).map((seg, idx) => `
    - **补充段落 ${idx + 1}**: ${seg.startDate} 至 ${seg.endDate} (${seg.years}年)
      * 结束时间若近6个月，写"至今"。
      ${companyNamingGuide}
      * 职位：符合该阶段经验的通用职称，严禁照抄目标岗位的长后缀。`).join('\n');

    supplementInstruction = `
    **必须补充工作经历**（共需补 ${supplementYears} 年）：
    - **时间限制**: 开始时间不得早于 ${earliestWorkDate}。
    - **补充片段**:
    ${segmentsText}
    - **插入规则**: 补充经历必须按时间线插入到现有经历之间，严禁简单堆砌在末尾。`;
  } else {
    supplementInstruction = '实际年限已满足，**无需补充**虚构经历。你**严禁新增**工作经历条目，输出的工作经历条数必须与用户现有工作经历条数一致。';
  }

  // 3. 所有经历的时间线列表（用于提示模型排序）
  const timelineList = (allWorkExperiences || []).map((exp, idx) => {
    if (exp.type === 'existing') {
        const orig = (profile.workExperiences || [])[exp.index!];
        if (!orig) return `    ${idx + 1}. [现有数据缺失]`;
        return `    ${idx + 1}. [现有] ${orig.company} (${orig.startDate} 至 ${orig.endDate})`;
    } else {
        return `    ${idx + 1}. [补充] (生成的公司) (${exp.startDate} 至 ${exp.endDate})`;
    }
  }).join('\n');

  // 4. 用户现有经历文本
  const existingExpText = (profile.workExperiences || []).map((exp, i) => `
    - [现有] 公司: ${exp.company} (⚠️必须保留原名) | 时间: ${exp.startDate} 至 ${exp.endDate} (⚠️必须保留)
      原始职位: ${exp.jobTitle} | 业务方向: ${exp.businessDirection}
      (参考内容: ${exp.workContent || "无"})
  `).join('\n');


  return `
你是一位顶级简历包装专家。核心原则：**一切以目标岗位为准，彻底重塑背景**。

### ⚠️ 语言原则：全中文输出
**无论原始 Job Description 或用户资料是何种语言，你必须使用简体中文生成简历中的所有字段（包括职位名称、工作描述、个人评价等）。**

### ⭐ 用户最高指令
**"${profile.aiMessage || '无'}"**
（⚠️ 若此指令与下述规则冲突，**必须无条件优先满足此指令**。）
- **强制执行协议**：
  1. 在生成任何字段前，先将 AI Message 拆解为可执行约束清单。
  2. 这些约束必须落实到最终 JSON 的相关字段（position、personalIntroduction、professionalSkills、workExperience）。
  3. 输出前必须进行一次逐条自检；只要有任一约束未满足，必须先内部重写再输出。
  4. 禁止在输出中解释执行过程，只输出 JSON。

### 👤 用户个人信息 (必须体现在简历头部)
- **姓名**: ${profile.name || '未提供'}
- **性别**: ${profile.gender || '保密'}
- **出生日期**: ${profile.birthday || '未提供'}
- **联系电话**: ${profile.phone || '未提供'}
- **电子邮箱**: ${profile.email || '未提供'}
- **微信号**: ${profile.wechat || '未提供'}
- **个人网站/作品集**: ${profile.website || '无'}

### 🚨 核心规则 (Strict Execution)
1. **职位标准化**：将"${targetTitle}"清洗为符合**国内各行各业习惯**的标准职称。
   - **长度限制**：**所有职位名称（position字段及工作经历中的职位）必须控制在 9 个字符以内**。
   - **核心要求**：必须删除括号内容、破折号、招聘术语。
   - **职能属性强制化**：**严禁使用宽泛的通用职称**。必须包含具体业务属性或职能方向。
     * ❌ "开发工程师" -> ✅ "**后端开发工程师**" / "**Android开发**"
     * ❌ "客户经理" -> ✅ "**大客户销售**" / "**理财经理**"
     * ❌ "项目经理" -> ✅ "**工程项目经理**" / "**装修项目经理**"
     * ❌ "经理" -> ✅ "**餐厅经理**" / "**仓库主管**"
   - **国内命名习惯**：严禁使用"专家"、"主任"、"首席"、"构建师"等字眼（除非AI Message要求）。
     * **中初级**：直接使用职能核心词。如"**市场营销**"、"**行政前台**"、"**会计师**"。
     * **高级/管理**：使用"**高级**"、"**负责人**"、"**经理**"、"**主管**"。
     * **行业惯称建议**：
       * **销售商务**：使用"**业务经理**"、"**销售顾问**"、"**商务拓展**"。
       * **运营市场**：使用"**市场策划**"、"**新媒体运营**"、"**内容编辑**"、"**活动执行**"。
       * **专业职能**：使用"**财务会计**"、"**行政主管**"、"**人事专员**"、"**法务风控**"。
       * **技术研发**：使用"**后端开发**"、"**前端开发**"、"**测试工程师**"、"**架构师**"。
   - **示例**：
     * "Senior Marketing Specialist (User Growth)" -> "**高级用户增长**" (6字)
     * "Head of Logistics & Supply Chain" -> "**供应链负责人**" (6字)
     * "云平台主任软件工程师（SDK)" -> "**SDK研发工程师**" (7字)
2. **背景重塑**：
   - **现有经历的公司名、起止时间必须原样保留，绝对不可修改**。
   - **职责重写**：抹除无关痕迹，完全围绕"${targetTitle}"重写职责。
   - **岗位名称保留规则（最高优先级硬性规则，必须执行）**：
     - 若用户原岗位名称与目标岗位在职能上高度接近（同一职业赛道/同一核心职能），**必须保留原岗位名**（最多做最小规范化），**不得因“职位标准化”或“命名美化”而改名**。
     - 仅当出现明显跨职能不匹配时，才允许改名并重写。
     - 示例：
       * 目标岗位为 ".NET"，原岗位为"Java工程师" → 视为同属后端工程赛道，应保留原岗位名。
       * 目标岗位为"后端开发"，原岗位为"产品经理" → 属于跨职能，应改名并重写为后端方向。
   - **工作经历中的职位名 (Position)**：
     * **强制要求**：职位名必须体现具体职能属性，且**严禁带有任何括号**，**长度严禁超过 9 个字**。
     * **去模糊化**：不得使用“职员”、“助理”、“经理”这种不带职能的称呼。
     * **示范**：
       * ❌ "助理" -> ✅ "**行政助理**" / "**销售助理**"
       * ❌ "高级经理" -> ✅ "**高级项目经理**" / "**运营副总监**"
     * 符合命名直觉：如"财务会计"、"法务专员"、"品牌公关"。
3. **职级控制**：
   - ${seniorityRule}
   - ${managementRule}

### ℹ️ 基础信息
- **目标**: ${targetTitle} (经验要求: ${job.experience}, 最低${requiredExp.min}年)
- **用户**: ${profile.name} (实际经验: ${actualExperienceText})
- **状态**: ${needsSupplement ? '需补充经历' : '年限已够'}

### 🛠️ 工作经历生成指南
${supplementInstruction}

${existingExpText 
  ? `**最终所有经历的时间线顺序（必须严格执行）：**
${timelineList}

**现有经历概览（需重写职责）：**
${existingExpText}`
  : `**用户当前无现有工作经历，请完全基于下方的时间线生成补充经历：**
${timelineList}`}

### 📝 写作要求
1. **职责描述 (Responsibilities)**：
   - **数量强制要求**：**必须（MUST）为每段工作经历生成且仅生成 8 条描述**。
   - **长度精准控制**：每条职责描述的视觉字数点数（中文计1点，英数计0.5点，标点计1点）必须精准控制在 **${Math.floor((context.maxCharPerLine || 42) * 1.85)} 到 ${Math.floor((context.maxCharPerLine || 42) * 2.15)}** 点之间。
   - **视觉效果**：确保每条职责在视觉上是饱满的两行，第二行不得短于该行的 2/3。
   - **重要性排序**：必须按重要性从高到低排列。
   - **STAR法则 + 数据化**：必须包含具体数据/百分比/量级，突出"我"的主导作用。
   - **严禁空泛形容词**：禁止使用"大幅提升"、"显著改善"等无数据支撑的词汇。
2. **个人简介 (IMPORTANT)**：
   - 表现为 "${targetTitle}" 领域的资深专业人士。
   - **写作风格**：**必须使用省略主语的第三人称叙述**。
     * ❌ 严禁出现 "我"、"本人"、"该候选人" 等主语。
     * ❌ 严禁使用 "我是拥有..." 或 "本人具备..." 的句式。
     * ✅ 正确示范："拥有5年全栈开发经验，专注于..."、"深耕金融科技领域，主导过..."。
   - **段落点数精准控制** (视觉字数点数：中文1，英数0.5，标点1)：
     - **第一段**：字数点数必须在 **${Math.floor((context.maxCharPerLine || 44) * 2.7)} 到 ${Math.floor((context.maxCharPerLine || 44) * 3.1)}** 之间。
     - **第二段**：字数点数必须在 **${Math.floor((context.maxCharPerLine || 44) * 1.3)} 到 ${Math.floor((context.maxCharPerLine || 44) * 1.7)}** 之间。
   - **内容倾向**：第一段侧重技术栈深度与行业广度，第二段侧重启发性成果、方法论或软技能。
   - **严禁使用带小数点的年限**：禁止写“拥有 5.8 年经历”，必须四舍五入为整数。
3. **技能列表 (Skills)**：
   - **核心规则**：**严禁使用 "精通"、"熟悉"、"掌握"、"了解" 等程度词**。一律只写技能名称、技术栈或核心工具名。
   - **结构强制要求**：**必须生成 4 组技能分类，且每组分类必须包含且仅包含 4 条技能点**。
   - **高度要求**：每条技能点的视觉点数必须在 **16 到 24** 点之间。
   - **针对性**：生成的技能组必须完全服务于"${targetTitle}"。
4. **排版 (Strict Quantity Control)**：
   - **加粗 (<b>)**：指定位置使用：
     - 个人介绍第一段的核心身份（1个）。
     - **每段**工作经历的第一条职责中的核心关键词（每段 1 个）。**注意：关键词必须自然嵌入句子中（如"优化了 <b>高并发</b> 场景"），严禁使用"关键词：描述"这种前缀冒号格式**。
   - **下划线 (<u>)**：剩余的 **3-4 个** 名额随机分布在核心数据或项目名称上。
   - **严禁重叠**：同一处文本不得同时加粗且加下划线。
5. **内容填充密度控制**：
   - 请在生成时严格自我审查各条 \`responsibilities\` 以及简介段落的物理长度是否符合上述要求。

### 📤 输出格式 (JSON Only)
⚠️ **CRITICAL: 请输出纯净的文本内容。严禁在输出结果中包含任何关于字数或点数的说明文字（如 "(xx点)" 或 "16-24点" 等辅助提示信息）。**
⚠️ **AI Message 硬性门槛：若 AI Message 不为空，最终 JSON 只有在其约束全部满足时才允许输出；否则必须先内部重写。**

⚠️ CRITICAL: JSON 字符串中的引号必须使用标准双引号。如果文本内部包含引号，必须进行转义。

\`\`\`json
{
  "position": "...",
  "yearsOfExperience": ${context.finalTotalYears},
  "personalIntroduction": "...",
  "professionalSkills": [
    { "title": "...", "items": ["技能1", "技能2", "技能3", "技能4"] },
    { "title": "...", "items": ["技能1", "技能2", "技能3", "技能4"] },
    { "title": "...", "items": ["技能1", "技能2", "技能3", "技能4"] },
    { "title": "...", "items": ["技能1", "技能2", "技能3", "技能4"] }
  ],
  "workExperience": [
    {
      "company": "...",
      "position": "...",
      "startDate": "...",
      "endDate": "...",
      "responsibilities": [
        "第一条核心职责...",
        "...", 
        "第八条职责..."
      ]
    }
  ]
}
\`\`\`
`;
}

export function generateChineseNonJobPrompt(context: PromptContext): string {
  const {
    targetTitle,
    job,
    requiredExp,
    profile,
    needsSupplement,
    actualExperienceText,
    supplementYears,
    supplementSegments,
    allWorkExperiences,
    earliestWorkDate,
    seniorityThresholdDate,
    maxCharPerLine,
  } = context;

  let seniorityRule = requiredExp.min <= 5
    ? '严禁使用“高级/资深/专家/负责人/主管”等高职级称谓。'
    : '可谨慎使用“高级”，仅在履历与时间线支撑时使用“资深/负责人/主管”。';

  if (seniorityThresholdDate) {
    seniorityRule += ` 且在 ${seniorityThresholdDate} 之前的经历中，严禁出现高级或管理职称。最早一段经历不得是管理岗。`;
  }

  const timelineList = (allWorkExperiences || []).map((exp, idx) => {
    if (exp.type === 'existing') {
      const orig = (profile.workExperiences || [])[exp.index!];
      if (!orig) return `${idx + 1}. [现有缺失] (${exp.startDate} 至 ${exp.endDate})`;
      return `${idx + 1}. [现有] ${orig.company} | ${orig.startDate} 至 ${orig.endDate}`;
    }
    return `${idx + 1}. [补充] (生成公司) | ${exp.startDate} 至 ${exp.endDate}`;
  }).join('\n');

  const supplementText = needsSupplement
    ? `需要补充约 ${supplementYears} 年经历。开始时间不得早于 ${earliestWorkDate}。\n补充片段：\n${(supplementSegments || []).map((seg, idx) => `- 片段${idx + 1}: ${seg.startDate} 至 ${seg.endDate}（${seg.years}年）`).join('\n')}\n补充经历必须插入时间线中，不得全部堆在末尾。`
    : '无需补充经历。输出工作经历条数必须与用户现有条数一致，严禁新增岗位。';

  const existingExpText = (profile.workExperiences || []).map((exp, idx) =>
    `- 经历${idx + 1}: 公司=${exp.company}（必须保留） | 时间=${exp.startDate} 至 ${exp.endDate}（必须保留） | 原职位=${exp.jobTitle} | 业务方向=${exp.businessDirection}`
  ).join('\n');

  return `
你是顶级中文简历顾问。当前为 Phase 1（Non-Job Bullet）：只生成非职责正文内容。

### 输出语言与优先级
- 全部字段必须为简体中文。
- 用户最高指令："${profile.aiMessage || '无'}"。若与其他规则冲突，优先满足该指令。

### 目标与背景
- 目标岗位：${targetTitle}
- JD经验要求：${job.experience}（最低 ${requiredExp.min} 年）
- 用户实际经验：${actualExperienceText}
- 职级规则：${seniorityRule}

### 时间线与补充策略
${supplementText}

最终时间线（必须严格遵循）：
${timelineList}

现有经历信息（公司名和时间不可改）：
${existingExpText || '无'}

### 生成要求（仅 Non-Job）
1. 生成完整字段：position、yearsOfExperience、personalIntroduction、professionalSkills、workExperience。
2. workExperience 每条必须包含 company、position、startDate、endDate。
3. 本阶段严禁生成职责正文：每条 responsibilities 必须是空数组 []。
4. **职位标准化（与旧版一致）**：
  - 简历抬头 position 控制在 9 字以内；workExperience.position 的 9 字限制仅适用于“补充经历”或“跨职能改写后的经历”。
  - 对“现有经历且同赛道”的岗位名，必须优先保留原文，不受 9 字限制，不得因为长度/命名美化而改名。
  - 必须去掉括号内容、破折号、招聘术语，避免宽泛通用称呼。
  - 必须体现具体职能属性（例如“后端开发”“新媒体运营”“财务会计”）。
  - 【最高优先级硬性规则】在职能高度接近时，必须保留原岗位名，仅允许最小规范化；即使与其他命名规则冲突，也不得改名。
  - 仅在明显跨职能不匹配时才允许改写岗位名。
  - 对原岗位为“Tech Lead/技术负责人/研发负责人”等技术管理称谓且与目标岗位同赛道时，必须原样保留（或仅极小规范化），禁止降级同化为目标岗通用名称。
  - 对“现有且强相关（同赛道）”经历，必须以用户原始输入为扩展基底：保留原岗位语义与业务方向，在此基础上补充更强的数据化成果与高阶职责，禁止整段改写为另一岗位叙事。
5. personalIntroduction 仅两段，必须省略主语，避免“我/本人/该候选人”；不得出现小数年限。
6. personalIntroduction 点数区间（视觉字数点数：中文1，英数0.5）：
  - 第一段：${Math.floor((maxCharPerLine || 44) * 2.7)} 到 ${Math.floor((maxCharPerLine || 44) * 3.1)}
  - 第二段：${Math.floor((maxCharPerLine || 44) * 1.3)} 到 ${Math.floor((maxCharPerLine || 44) * 1.7)}
7. professionalSkills 必须 4 组，每组 4 项；禁止“精通/熟悉/掌握/了解”等程度词，仅写技能名或工具名。
8. 非职责阶段禁止输出任何关于“点数/字数计算过程”的说明语句，只保留最终文本。
9. 输出必须是合法 JSON，不要解释文本。

### 岗位名保留执行流程（必须逐条执行）
对每一条【现有经历】先执行判定，再写入 position：
1. 判定是否与目标岗位同一职能赛道（高度接近）。
2. 若“高度接近”：输出中该条 position 必须与原职位文本保持一致（仅允许极小规范化，如空格清理，禁止语义改写）。
3. 若“明显跨职能”：才允许改写 position。
4. 输出前最终自检：逐条核对“现有经历”的 position，凡是同赛道但被改名的，必须先内部重写后再输出。

同赛道判定示例（硬性执行）：
- 目标“.NET开发工程师”，原岗位“Java Developer/Java工程师” => 同属后端赛道，必须保留原岗位名，不得改成“.NET”。
- 目标“后端开发”，原岗位“Tech Lead/技术负责人” => 包含后端职能，视为同赛道，必须保留原名或使用高度相似名称（如“后端Tech Lead”），不得降级改写为普通“后端开发”。
- 目标“后端开发”，原岗位“Golang工程师/Python后端开发” => 同赛道，必须保留原岗位名。
- 目标“后端开发”，原岗位“产品经理” => 跨赛道，允许改写。

### 输出 JSON 模板
{
  "position": "...",
  "yearsOfExperience": ${context.finalTotalYears},
  "personalIntroduction": "...",
  "professionalSkills": [
    { "title": "...", "items": ["...", "...", "...", "..."] },
    { "title": "...", "items": ["...", "...", "...", "..."] },
    { "title": "...", "items": ["...", "...", "...", "..."] },
    { "title": "...", "items": ["...", "...", "...", "..."] }
  ],
  "workExperience": [
    {
      "company": "...",
      "position": "...",
      "startDate": "...",
      "endDate": "...",
      "responsibilities": []
    }
  ]
}
`;
}

export function generateChineseJobBulletPrompt(
  context: PromptContext,
  workExperiences: BulletPhaseWorkExperience[]
): string {
  const lines = workExperiences.map((exp, idx) => `
- 经历${idx + 1}：${exp.company} | ${exp.position} | ${exp.startDate} 至 ${exp.endDate}`).join('');

  const anchors = workExperiences.map((exp, idx) => {
    const original = (context.profile.workExperiences || []).find((item: any) => {
      return String(item?.startDate || '').trim() === String(exp.startDate || '').trim()
        && String(item?.endDate || '').trim() === String(exp.endDate || '').trim()
        && String(item?.company || '').trim() === String(exp.company || '').trim();
    });

    if (!original) {
      return `- 经历${idx + 1}原始锚点：无（可能为补充经历）`;
    }

    return `- 经历${idx + 1}原始锚点：原职位=${original.jobTitle || '无'} | 业务方向=${original.businessDirection || '无'} | 原始工作内容=${original.workContent || '无'}`;
  }).join('\n');

  return `
你是一位顶级简历写作专家。当前是 Phase 2（Job Bullet）：仅生成工作经历职责正文。不得改动骨架。

### 语言与风格
- 全中文输出。
- 目标岗位：${context.targetTitle}
- 用户最高指令："${context.profile.aiMessage || '无'}"（若不为空，必须严格满足）

### 输入的工作经历（禁止改动基础信息）
以下经历的 company / position / startDate / endDate 均已定稿，严禁修改：
${lines}

### 现有经历原始输入锚点（用于“基于原输入扩展”）
${anchors}

### 生成要求（严格）
1. 按原顺序返回 workExperience，条目数量必须与输入一致。
2. 每段经历必须生成且仅生成 8 条 responsibilities。
3. 每条职责必须围绕目标岗位，按重要性排序，采用 STAR 思路并包含可量化结果。
3.1 对“现有且强相关（同赛道）”经历（例如：后端开发、Java/Golang/Python后端、Tech Lead/技术负责人）：
  - 必须以原始锚点中的职位语义、业务方向、既有工作内容为基础进行扩展；
  - 允许增强表达与补充量化结果，但禁止改写成另一职能叙事；
  - 若原始内容出现技术领导职责（架构决策、技术评审、带队推进等），扩展后必须保留对应领导属性，不得降级为纯执行岗。
4. 禁止空泛表达（如“大幅提升/显著优化”但无数字证据）。
5. 每条职责视觉字数点数（中文1，英数0.5）目标区间：${Math.floor((context.maxCharPerLine || 42) * 1.85)} ~ ${Math.floor((context.maxCharPerLine || 42) * 2.15)}。
6. 每段第 1 条职责必须含 1 处 <b> 关键词；其余条目中再选 2 条各含 1 处 <b>（每段共 3 条含加粗）。
7. 可使用少量 <u> 标记关键数据，但同一片段不得同时 <b> 与 <u>。
8. 仅在 responsibilities 写内容，严禁新增字段、改写职位或改写时间。
9. 第二行不得过短（目标为接近双行饱满），避免出现明显留白。
10. 若信息较少也必须补足 8 条高质量职责。

### 输出格式（JSON Only）
{
  "workExperience": [
    {
      "company": "...",
      "position": "...",
      "startDate": "...",
      "endDate": "...",
      "responsibilities": ["...", "...", "...", "...", "...", "...", "...", "..."]
    }
  ]
}
`;
}

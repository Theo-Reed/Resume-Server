import { PromptContext } from './types';

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

    const segmentsText = supplementSegments.map((seg, idx) => `
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
    supplementInstruction = '实际年限已满足，**无需补充**虚构经历。';
  }

  // 3. 所有经历的时间线列表（用于提示模型排序）
  const timelineList = allWorkExperiences.map((exp, idx) => {
    if (exp.type === 'existing') {
        const orig = profile.workExperiences[exp.index!];
        return `    ${idx + 1}. [现有] ${orig.company} (${orig.startDate} 至 ${orig.endDate})`;
    } else {
        return `    ${idx + 1}. [补充] (生成的公司) (${exp.startDate} 至 ${exp.endDate})`;
    }
  }).join('\n');

  // 4. 用户现有经历文本
  const existingExpText = profile.workExperiences.map((exp, i) => `
    - [现有] 公司: ${exp.company} (⚠️必须保留原名) | 时间: ${exp.startDate} 至 ${exp.endDate} (⚠️必须保留)
      原始职位: ${exp.jobTitle} | 业务方向: ${exp.businessDirection}
      (参考内容: ${exp.workContent || "无"})
  `).join('\n');


  return `
你是一位顶级简历包装专家。核心原则：**一切以目标岗位为准，彻底重塑背景**。

### ⭐ 用户最高指令
**"${profile.aiMessage || '无'}"**
（⚠️ 若此指令与下述规则冲突，**必须无条件优先满足此指令**。）

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

**最终所有经历的时间线顺序（必须严格执行）：**
${timelineList}

**现有经历概览（需重写职责）：**
${existingExpText}

### 📝 写作要求
1. **职责描述 (Responsibilities)**：
   - **数量强制要求**：**必须（MUST）为每段工作经历生成且仅生成 8 条描述**。
   - **长度精准控制**：每条职责描述的视觉字数点数（中文字符计1点，英数/标点计0.5点）必须精准控制在 **${Math.floor((context.maxCharPerLine || 42) * 1.6)} 到 ${Math.floor((context.maxCharPerLine || 42) * 1.9)}** 点之间。
   - **重要性排序**：必须按重要性从高到低排列。
   - **STAR法则 + 数据化**：必须包含具体数据/百分比/量级，突出"我"的主导作用。
   - **严禁空泛形容词**：禁止使用"大幅提升"、"显著改善"等无数据支撑的词汇。
2. **个人简介 (IMPORTANT)**：
   - 表现为 "${targetTitle}" 领域的资深专业人士。
   - **段落点数精准控制** (视觉字数点数：中文1，英数0.5)：
     - **第一段**：字数点数必须在 **${Math.floor((context.maxCharPerLine || 50) * 2.7)} 到 ${Math.floor((context.maxCharPerLine || 50) * 3.1)}** 之间。
     - **第二段**：字数点数必须在 **${Math.floor((context.maxCharPerLine || 50) * 1.3)} 到 ${Math.floor((context.maxCharPerLine || 50) * 1.7)}** 之间。
   - **内容倾向**：第一段侧重技术栈深度与行业广度，第二段侧重启发性成果、方法论或软技能。
   - **严禁使用带小数点的年限**：禁止写“拥有 5.8 年经历”，必须四舍五入为整数。
3. **技能列表 (Skills)**：
   - **结构强制要求**：**必须生成 4 组技能分类，且每组分类必须包含且仅包含 4 条技能点**。
   - **高度要求**：每条技能点的视觉点数必须在 **16 到 22** 点之间。
   - **针对性**：生成的技能组必须完全服务于"${targetTitle}"。
4. **排版 (Strict Quantity Control)**：
   - **加粗 (<b>)**：指定位置使用：
     - 个人介绍第一段的核心身份（1个）。
     - **每段**工作经历的第一条职责中的核心关键词（每段 1 个）。
   - **下划线 (<u>)**：剩余的 **3-4 个** 名额随机分布在核心数据或项目名称上。
   - **严禁重叠**：同一处文本不得同时加粗且加下划线。
5. **内容填充密度控制**：
   - 请在生成时严格自我审查各条 \`responsibilities\` 以及简介段落的物理长度是否符合上述要求。

### 📤 输出格式 (JSON Only)
⚠️ CRITICAL: JSON 字符串中的引号必须使用标准双引号。如果文本内部包含引号，必须进行转义。

\`\`\`json
{
  "position": "...",
  "yearsOfExperience": ${context.finalTotalYears},
  "personalIntroduction": "第一段 (${Math.floor((context.maxCharPerLine || 50) * 2.7)}-${Math.floor((context.maxCharPerLine || 50) * 3.1)}点)\n\n第二段 (${Math.floor((context.maxCharPerLine || 50) * 1.3)}-${Math.floor((context.maxCharPerLine || 50) * 1.7)}点)...",
  "professionalSkills": [
    { "title": "分类1", "items": ["技能1", "技能2", "技能3", "技能4" ] },
    { "title": "分类2", "items": ["技能1", "技能2", "技能3", "技能4" ] },
    { "title": "分类3", "items": ["技能1", "技能2", "技能3", "技能4" ] },
    { "title": "分类4", "items": ["技能1", "技能2", "技能3", "技能4" ] }
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

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
1. **职责描述**：
   - **数量强制要求**：**必须为每段工作经历生成 8 条极其详尽的职责描述**（无论经验多少，先生成充足素材供布局引擎筛选）。
   - **长度与排版控制**：
     - **双行原则**：每条职责的文字量力求达到 **1.5行 到 2行** 的视觉长度（**约72-96个字符**）。
     - **右侧填充**：最后一行文字**必须结束在页面右半侧**（即行尾不留大片空白），严禁最后一行只有寥寥几个字。
   - **重要性排序**：请按重要性从高到低排列。
   - **STAR法则 + 数据化**：必须包含具体数据/百分比/量级，突出"我"的主导作用。
   - **严禁空泛形容词**：禁止使用"大幅提升"、"显著改善"、"有效提高"等无数据支撑的词汇。
     * ✅ "独立主导系统重构，响应从500ms降至200ms，支撑日活30万"
     * ❌ "大幅提升系统性能，改善用户体验" (无数据)
2. **个人简介 (IMPORTANT)**：
   - 表现为 "${targetTitle}" 领域的资深专业人士。
   - **严禁使用带小数点的年限**：禁止写“拥有 5.8 年经历”，必须四舍五入为整数，如“拥有 6 年经历”或描述为“超过 5 年经历”。
3. **技能列表**：生成的技能组必须完全服务于"${targetTitle}"，可忽略用户无关的原始技能。
   - **数量强制要求**：**必须生成至少 4 组**技能分类（如：核心后端/前端/中间件/通用技能等），严禁只写 2-3 组。
4. **排版 (Strict Quantity Control)**：
   - 重点内容用 **<b>加粗</b>** (HTML标签)，仅限用于极其核心的业务结果或技术关键词。
   - 关键处用 **<u>下划线</u>**，仅限用于核心身份或核心数据。
   - **数量强制要求**：**全篇简历中（包括简介和所有经历）<b> 标签总数必须在 4-5 个以内，<u> 标签总数必须在 3-4 个以内**。严禁满篇加粗，必须宁缺毋滥。
5. **内容填充密度控制 (Line-Filling Control)**：
   - **目标要求**：每条工作职责必须具备良好的视觉填充感，严禁出现末行只有几个字的情况。
   - **字符数对照表（请严格遵守，中文字符=1，英数/标点=0.5）**：
     - **若目标为 1 行**：总计点数必须在 **28 到 42** 之间。
     - **若目标为 2 行**：总计点数必须在 **78 到 92** 之间。
   - **死亡区间（严禁进入）**：**绝对不要**生成总点数为 **48 - 65** 的内容（这会导致第一行占满，第二行只有极少量文字，产生丑陋的右侧留白）。
   - **自我审查技巧**：如果发现内容落入“死亡区间”，请通过增加“针对xx背景”、“主导并推进了xx”等修饰语来扩充长度，直到进入安全区间。
   - 请在生成时严格自我审查各条 \`responsibilities\` 的点数长度。

### 📤 输出格式 (JSON Only)
\`\`\`json
{
  "position": "标准化后的目标职位 (严禁带括号，如: SDK开发工程师)",
  "yearsOfExperience": ${context.finalTotalYears},
  "personalIntroduction": "专业人设简介...",
  "professionalSkills": [{ "title": "分类名", "items": ["技能点1", "技能点2..."] }],
  "workExperience": [
    // ⚠️ 必须严格按照上述 [最终所有经历的时间线顺序] 输出，最新的在最前。
    // 1. 现有经历：company/startDate/endDate 必须与原始数据完全一致。
    // 2. 补充经历：根据年限规则生成"xx工作室"或"美国Start-up"。
    {
      "company": "...",
      "position": "必须体现具体技术职能且严禁带括号 (如: 后端架构师)",
      "startDate": "...",
      "endDate": "...",
      "responsibilities": [
        "<b>核心成果</b>：具体描述...",
        "..."
      ]
    }
  ]
}
\`\`\`
`;
}

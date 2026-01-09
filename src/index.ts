import { ResumeGenerator } from './resumeGenerator';
import { ResumeAIService } from './resumeAIService';
import { ResumeData, GenerateFromFrontendRequest, mapFrontendRequestToResumeData, UserResumeProfile } from './types';
import { writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * 从 test_profile.json 加载并转换数据
 */
function getTestData(): ResumeData {
  const rawData = readFileSync(join(process.cwd(), 'test_profile.json'), 'utf-8');
  const payload = JSON.parse(rawData) as GenerateFromFrontendRequest;
  
  // 统一调用映射方法
  return mapFrontendRequestToResumeData(payload);
}

/**
 * 获取基础简历数据（不包含头像）
 */
function getBaseResumeData(): ResumeData {
  return {
    name: 'Finn',
    position: 'web3业务顾问',
    contact: {
      email: 'xxxx9999@gmail.com',
      wechat: 'weixinhao',
      phone: '18888888888',
    },
    yearsOfExperience: 5,
    languages: '中英双语',
    // 不设置 avatar，由调用方决定是否添加
    education: [
      {
        school: '国内某外国语大学',
        degree: '英语 本科',
        graduationDate: '2018-2022',
        description: '获得<b>全国大学生数学竞赛</b>国家三等奖，获得<u>蓝桥杯</u>国家二等奖，同时学习英语并代表学校参加市级英语作文比赛',
      },
      {
        school: '国外某理工大学',
        degree: 'MBA 硕士',
        graduationDate: '2024-2026',
        description: '在线英语授课，系统提升<b>商业分析</b>、<u>市场管理</u>和团队协作能力，强调理论与实践相结合，致力于提升职业竞争力',
      },
    ],
    personalIntroduction: `具备扎实的<b>加密资产</b>知识体系和链上运营洞察力。能够在 <b>DeFi</b>、<u>NFT</u> 和 CEX 场景中提供专业支持和风险评估。擅长将复杂的链上逻辑转化为清晰的用户指南，平衡安全性和用户体验。用数据驱动流程改进，帮助项目提升留存率和信任度。具备跨时区沟通和英语服务能力。熟悉 Web3 行业文化和治理。善于与团队协作解决问题，及时向上反馈工作进展。`,
    professionalSkills: [
      {
        title: '链上客户沟通与支持',
        items: [
          '具备<b>中英文沟通能力</b>，能够评估链上问题风险，为用户咨询和<u>资产安全</u>提供专业支持。',
          '熟练使用在线聊天、<b>工单系统</b>等多渠道与全球用户互动，及时响应用户钱包和链上交易困难。',
          '掌握完整的链上交互流程，能够识别<b>常见交易问题</b>并提供解决方案。',
        ],
      },
      {
        title: '链上故障排查与现场应急能力',
        items: [
          '能够快速追踪<b>区块链浏览器</b>（<u>Etherscan</u>、Solscan 等）查询交易流向，定位问题源头。',
          '熟悉 <b>DeFi 借贷</b>、LP 和收益聚合逻辑，协助用户判断收益风险和健康率变化。',
          '协助处理 CEX 存取款异常、<u>跨链错误</u>、遗漏等高风险事件。',
          '熟练运用<b>风险分级策略</b>，帮助用户保持稳定，确保在高链上压力下及时解决。',
        ],
      },
      {
        title: '行业场景认知与产品支持',
        items: [
          '具备<b>现货、合约、理财</b>等核心产品支持经验，能够向用户解释<u>收益机制</u>和风险边界。',
          '熟悉常见公链生态和<b>代币交互逻辑</b>，引导用户完成存取款、身份验证、风控材料提交等流程。',
          '具备实际 <u>KYC/KYB</u> 经验，了解<b>监管要求</b>和合规流程，能够识别异常行为并协助风控判断。',
        ],
      },
      {
        title: '数据分析与流程优化能力',
        items: [
          '熟练使用 <b>Excel</b> 进行数据清洗、<b>透视分析</b>，运用高级函数构建高效报表。',
          '具备脚本编写经验（<u>Python</u>、JS），熟练使用 SQL 进行数据整理，能够自动化处理工单分类、用户标签同步、数据导出等流程，显著提升客服效率。',
          '能够结合客服和链上数据（<b>工单类型</b>、交易失败率、<u>KYC 审核量</u>等）识别风险趋势，提供预警。',
          '具备 <b>AI 工具</b>辅助分析能力，参与构建 FAQ、脚本、提示词和案例模板，提升用户自助解决率。',
        ],
      },
    ],
    workExperience: [
      {
        company: 'Shelf.Network',
        position: '虚拟资产顾问',
        startDate: '2023.12',
        endDate: '2025.9',
        responsibilities: [
          '在<b>全英文环境</b>下工作，支持全球用户。',
          '独立识别并解决链上问题，如<u>钱包连接</u>、<b>Gas 优化</b>、交易失败、授权异常等。',
          '每日处理 <b>40+ 工单</b>，长期保持<b>高客户满意度</b>。',
          '通过区块链浏览器跟踪 <u>NFT 资产</u>全流程，处理高价值争议案例，制定解决方案建议，使资产索赔率降低约 30%。',
          '与 <b>KOL</b> 和行业合作伙伴互动，向他们推荐<b>核心平台服务</b>和产品解决方案，增加品牌曝光并导入高质量流量。',
          '引导用户参与平台推广计划，熟悉主流海外社交媒体平台（<u>Twitter</u>、Discord、Telegram 等）的传播机制。',
          '支持异常现货存取款问题调查（如未确认链、<b>错误标签</b>、跨链转账错误），与第三方托管机构和 CEX 团队沟通协调，确保资产快速恢复或补偿。',
          '具备基础衍生品和 <u>DeFi</u> 理解（如合约交易风险、借贷和 LP 收益逻辑），向用户提供<b>风险解释</b>和安全策略建议。',
          '负责用户 <b>KYC/KYB</b> 审核和异常识别，验证身份文件、风险标志和地址匹配。',
          '与风控团队协作完成账户限制、<b>黑名单校准</b>和可疑活动报告，确保合规要求和资产安全。',
        ],
      },
      {
        company: '广州虎牙信息科技有限公司',
        position: '东南亚电商售后',
        startDate: '2022.7',
        endDate: '2023.11',
        responsibilities: [
          '使用<b>中文和英文</b>工作。',
          '支持东南亚电商平台的店铺运营和客户服务，熟悉 <b>Shopee</b>、<u>Lazada</u> 等平台规则和流程。',
          '使用英语和当地语言沟通，处理订单查询、<b>物流跟踪</b>、退换货等售后问题，确保客户体验顺畅。',
          '监控店铺运营数据，协助优化产品列表、标题描述和<u>定价策略</u>，提高产品曝光和转化率。',
        ],
      },
    ],
    certificates: [
      {
        name: '英语六级',
        date: '2020年6月',
        score: '580分',
      },
      {
        name: '英语四级',
        date: '2019年6月',
        score: '550分',
      },
      {
        name: '全国大学生数学竞赛',
        date: '2020年',
        score: '国家三等奖',
      },
      {
        name: '蓝桥杯',
        date: '2020年',
        score: '国家二等奖',
      },
    ],
  };
}

/**
 * 生成不带头像的简历 PDF
 */
export async function generateResumeWithoutAvatar() {
  const generator = new ResumeGenerator();
  const resumeData = getBaseResumeData();
  // 不设置 avatar，将不显示头像

  try {
    console.log('开始生成不带头像的简历 PDF...');
    
    const outputPath = join(process.cwd(), 'resume-without-avatar.pdf');
    await generator.generatePDFToFile(resumeData, outputPath);
    
    console.log(`简历 PDF 已成功生成: ${outputPath}`);
    
  } catch (error) {
    console.error('生成 PDF 时出错:', error);
    process.exit(1);
  } finally {
    await generator.close();
  }
}

/**
 * 生成带头像的简历 PDF
 */
export async function generateResumeWithAvatar() {
  const generator = new ResumeGenerator();
  const resumeData = getBaseResumeData();
  // 设置头像
  resumeData.avatar = 'https://picx.zhimg.com/v2-a4e62da535956c002e84d21caae1cb6e_xl.jpg?source=32738c0c&needBackground=1';

  try {
    console.log('开始生成带头像的简历 PDF...');
    
    const outputPath = join(process.cwd(), 'resume-with-avatar.pdf');
    await generator.generatePDFToFile(resumeData, outputPath);
    
    console.log(`简历 PDF 已成功生成: ${outputPath}`);
    
  } catch (error) {
    console.error('生成 PDF 时出错:', error);
    process.exit(1);
  } finally {
    await generator.close();
  }
}

/**
 * 主入口：根据命令行参数选择生成方式
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'with-avatar') {
    await generateResumeWithAvatar();
  } else if (command === 'without-avatar') {
    await generateResumeWithoutAvatar();
  } else {
    console.log('使用方法:');
    console.log('  npm run dev:example with-avatar      # 生成带头像的简历');
    console.log('  npm run dev:example without-avatar  # 生成不带头像的简历');
    console.log('');
    console.log('默认生成带头像的简历...');
    await generateResumeWithAvatar();
  }
}

/**
 * 使用测试数据生成简历
 */
async function generateWithTestData() {
  const args = process.argv.slice(3); // 获取 test-data 之后的参数
  const index = args[0] ? parseInt(args[0]) : -1;

  const generator = new ResumeGenerator();
  const aiService = new ResumeAIService();
  
  // 1. 加载用户 profile (仅包含 UserResumeProfile)
  const profileRaw = readFileSync(join(process.cwd(), 'test_profile.json'), 'utf-8');
  const resume_profile = JSON.parse(profileRaw) as UserResumeProfile;
  
  // 2. 加载岗位数据 (从 diverse_test_jobs.json 获取)
  const diverseJobsRaw = readFileSync(join(process.cwd(), 'diverse_test_jobs.json'), 'utf-8');
  const diverseJobs = JSON.parse(diverseJobsRaw);
  
  // 如果没传索引，默认使用第一个岗位 (0)
  const jobIndex = index >= 0 ? index : 0;
  const job_data = diverseJobs[jobIndex];

  console.log(`📌 使用岗位 [${jobIndex}]: ${job_data.title_chinese}`);

  const finalPayload: GenerateFromFrontendRequest = {
    jobId: job_data._id,
    userId: "test-user-openid",
    language: "chinese", // 默认中文
    resume_profile,
    job_data
  };

  try {
    console.log('正在调用 Gemini AI 增强简历内容...');
    const resumeData = await aiService.enhance(finalPayload);
    
    const outputName = `resume-test-job-${jobIndex}.pdf`;
    console.log(`开始生成 PDF: ${outputName}...`);
    
    const outputPath = join(process.cwd(), outputName);
    await generator.generatePDFToFile(resumeData, outputPath);
    console.log(`✅ 简历 PDF 已成功生成: ${outputPath}`);
  } catch (error) {
    console.error('流程中出错:', error);
    process.exit(1);
  } finally {
    await generator.close();
  }
}

// 修改 main 函数支持 test-data 参数
async function mainWithUpdate() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'test-data') {
    await generateWithTestData();
  } else if (command === 'with-avatar') {
    await generateResumeWithAvatar();
  } else if (command === 'without-avatar') {
    await generateResumeWithoutAvatar();
  } else {
    console.log('使用方法:');
    console.log('  npm run dev:test-data               # 使用 test_profile.json 生成简历');
    console.log('  npm run dev:example with-avatar      # 生成内置示例简历');
    console.log('');
    await generateResumeWithAvatar();
  }
}

// 如果直接运行此文件，执行示例
if (require.main === module) {
  mainWithUpdate().catch(console.error);
}

// 导出供其他模块使用
export { ResumeGenerator } from './resumeGenerator';
export * from './types';

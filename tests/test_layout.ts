
import { ResumeGenerator } from '../src/resumeGenerator';
import { ResumeData } from '../src/types';
import path from 'path';

// 基础数据
const baseData: ResumeData = {
    name: "于海涛",
    position: "平台研发工程师",
    avatar: "",
    contact: {
        phone: "18741938886",
        email: "theoreed19971011@gmail.com",
        wechat: "Finn0831",
        website: "github.com/Theo-Reed"
    },
    yearsOfExperience: 5,
    education: [
        {
            school: "中国农业大学",
            degree: "硕士",
            graduationDate: "2026-06",
            description: "农业工程与信息技术"
        },
        {
            school: "大连外国语大学",
            degree: "本科",
            graduationDate: "2022-06",
            description: "网络工程"
        }
    ],
    personalIntroduction: "拥有 6 年后端架构与分布式平台研发经验，具备卓越的英文工作环境适应能力与跨国协作经验。本人曾深度参与美国硅谷 A 轮初创企业核心系统建设，能够流畅使用全英文进行技术方案评审与文档撰写，无缝对接全球化研发团队。",
    professionalSkills: [
        {
            title: "后端开发",
            items: ["精通 Go/Java 语言", "熟悉高性能中间件", "具备千万级架构设计能力", "熟悉 Docker/K8s 容器化技术"]
        },
        {
            title: "前端技术",
            items: ["熟悉 React/Vue 框架", "掌握 TypeScript/ES6+", "了解 Webpack/Vite 构建工具", "具备响应式页面开发能力"]
        },
        {
            title: "数据库",
            items: ["精通 MySQL/PostgreSQL", "熟悉 Redis/Memcached 缓存", "了解 MongoDB/Elasticsearch", "具备分库分表实战经验"]
        },
        {
            title: "工程实践",
            items: ["熟悉 Git 协同工作流", "掌握 CI/CD 自动化部署", "具备 TDD/BDD 测试意识", "熟悉 Agile/Scrum 敏捷开发"]
        }
    ],
    workExperience: [], // 将在用例中动态生成
    certificates: [
        { name: "CET-6", date: "2020" }
    ]
};

// 辅助函数：生成指定数量的职责，每条职责约 2 行
function generateResponsibilities(count: number, prefix: string = "职责"): string[] {
    const longText = "负责高性能系统的设计与实现，主导了微服务架构的拆分与重构，通过优化缓存策略与数据库索引，成功将系统吞吐量提升了 200%，并降低了 30% 的延迟。";
    return Array(count).fill(0).map((_, i) => `<b>${prefix} ${i+1}</b>：${longText}`);
}

async function runTest() {
    const generator = new ResumeGenerator();
    console.log('正在初始化生成器...');
    await generator.init();

    // === 场景 A: 完美一页 (Standard One Page) ===
    // 3份工作，适量内容，应该刚好一页
    const dataA = JSON.parse(JSON.stringify(baseData));
    dataA.workExperience = [
        {
            company: "Standard Metrics",
            position: "后端开发工程师",
            startDate: "2024-01",
            endDate: "至今",
            responsibilities: generateResponsibilities(4, "核心架构")
        },
        {
            company: "广州虎牙科技有限公司",
            position: "后端开发工程师",
            startDate: "2022-02",
            endDate: "2023-12",
            responsibilities: generateResponsibilities(4, "支付中台")
        },
        {
            company: "北京小米科技有限公司",
            position: "高级工程师",
            startDate: "2020-06",
            endDate: "2021-09",
            responsibilities: generateResponsibilities(3, "网关优化")
        }
    ];
    await generate(generator, dataA, 'test_result_A_standard.pdf', '场景A：标准一页（无需大量裁剪）');

    // === 场景 B: 小幅溢出 (Should Trim to One Page) ===
    // 增加数据量到 1.2 页左右，测试智能裁剪
    const dataB = JSON.parse(JSON.stringify(baseData));
    dataB.workExperience = [
        ...dataA.workExperience,
        {
            company: "溢出测试科技有限公司",
            position: "额外工作经历",
            startDate: "2019-01",
            endDate: "2020-05",
            responsibilities: generateResponsibilities(5, "冗余职责")
        }
    ];
    // 增加第一份工作的职责长度
    dataB.workExperience[0].responsibilities = generateResponsibilities(8, "冗余核心");
    await generate(generator, dataB, 'test_result_B_overflow.pdf', '场景B：内容溢出（测试智能裁剪至一页）');

    // === 场景 C: 孤儿标题 (Orphan Title) ===
    // 精确控制前两份工作长度，使第三份工作标题卡在页底
    const dataC = JSON.parse(JSON.stringify(baseData));
    dataC.workExperience = [
        {
            company: "填充占位公司 A",
            position: "工程师",
            startDate: "2023-01",
            endDate: "至今",
            // 调整行数以推动布局
            responsibilities: generateResponsibilities(8, "占位") 
        },
        {
            company: "填充占位公司 B",
            position: "工程师",
            startDate: "2021-01",
            endDate: "2022-12",
            responsibilities: generateResponsibilities(8, "占位")
        },
        {
            company: "被卡住的公司 C (测试对象)",
            position: "不幸的工程师",
            startDate: "2020-01",
            endDate: "2020-12",
            responsibilities: generateResponsibilities(5, "原本应该在第二页")
        }
    ];
    await generate(generator, dataC, 'test_result_C_orphan.pdf', '场景C：孤儿标题（标题在页底，内容在次页 -> 标题应被推至次页）');

    // === 场景 D: 内容过短 (Smart Stretch) ===
    // 只有一份工作，测试页面拉伸
    const dataD = JSON.parse(JSON.stringify(baseData));
    dataD.workExperience = [
        {
            company: "唯一的一家公司",
            position: "独苗工程师",
            startDate: "2024-01",
            endDate: "至今",
            responsibilities: generateResponsibilities(4, "孤独的职责")
        }
    ];
    await generate(generator, dataD, 'test_result_D_stretch.pdf', '场景D：内容过短（测试页面拉伸填充）');

    // === 场景 E: 明显的两页 (Two Pages) ===
    // 内容极其丰富，系统应放弃裁剪一页，保留两页并处理布局
    const dataE = JSON.parse(JSON.stringify(baseData));
    const longExp = {
        company: "长期服役公司",
        position: "资深架构师",
        startDate: "2020-01",
        endDate: "2024-01",
        responsibilities: generateResponsibilities(6, "长期贡献")
    };
    dataE.workExperience = [longExp, longExp, longExp, longExp, longExp]; // 5 份长工作
    await generate(generator, dataE, 'test_result_E_twopages.pdf', '场景E：明显两页（测试双页布局稳定性）');

    // === 场景 F: 资深专家三页 (Standard Three Pages) ===
    // 假设有非常丰富的工作经历 (10年以上, 5-6份工作)
    const dataF = JSON.parse(JSON.stringify(baseData));
    dataF.yearsOfExperience = 12;
    dataF.personalIntroduction = "拥有超过 12 年的分布式系统架构设计与落地经验，曾主导过多个亿级用户规模的核心系统重构。在云计算、微服务治理、高并发交易系统等领域有深厚积累。";
    dataF.workExperience = [
        {
            company: "云端架构科技有限公司",
            position: "首席架构师",
            startDate: "2021-01",
            endDate: "至今",
            responsibilities: generateResponsibilities(8, "平台规划")
        },
        {
            company: "全球支付结算中心",
            position: "资深技术专家",
            startDate: "2018-06",
            endDate: "2020-12",
            responsibilities: generateResponsibilities(7, "交易核心")
        },
        {
            company: "未来数据驱动公司",
            position: "高级研发经理",
            startDate: "2015-03",
            endDate: "2018-05",
            responsibilities: generateResponsibilities(6, "大数据平台")
        },
        {
            company: "早期创业孵化器",
            position: "全栈工程师",
            startDate: "2013-07",
            endDate: "2015-02",
            responsibilities: generateResponsibilities(5, "敏捷开发")
        },
        {
            company: "某大型互联网集团",
            position: "后端开发",
            startDate: "2011-07",
            endDate: "2013-06",
            responsibilities: generateResponsibilities(4, "基础服务")
        }
    ];
    // 增加大量技能和证书以填充空间
    dataF.professionalSkills = [
        { title: "架构设计", items: ["微服务架构", "领域驱动设计(DDD)", "Serverless", "Service Mesh"] },
        { title: "编程语言", items: ["Java", "Go", "Rust", "Python"] },
        { title: "中间件", items: ["Kafka", "RocketMQ", "RabbitMQ", "Redis"] },
        { title: "数据库", items: ["MySQL", "PostgreSQL", "MongoDB", "TiDB"] }
    ];
    
    await generate(generator, dataF, 'test_result_F_threepages.pdf', '场景F：资深专家三页（测试多页长文档布局）');

    await generator.close();
    console.log('所有测试已完成。');
    process.exit(0);
}

async function generate(generator: ResumeGenerator, data: ResumeData, filename: string, desc: string) {
    const outputPath = path.join(__dirname, filename);
    console.log(`\n--- 开始生成: ${desc} ---`);
    try {
        await generator.generatePDFToFile(data, outputPath);
        console.log(`✅ 生成成功: ${filename}`);
    } catch (e) {
        console.error(`❌ 生成失败: ${filename}`, e);
    }
}

runTest().catch(err => {
    console.error('测试运行失败:', err);
    process.exit(1);
});

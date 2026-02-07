import puppeteer, { Browser, Page } from 'puppeteer';
import { readFileSync, existsSync } from 'fs';
import { join, dirname, extname } from 'path';
import { execSync } from 'child_process';
import { ResumeData } from './types';

/**
 * 布局策略接口
 */
interface LayoutStrategy {
    targetPages: number;       // 目标页数
    skillColumns: number;      // 技能栏列数 (1, 2, 3)
    skillCategories: number;   // 技能分类数量
    skillItemsPerCat: number;  // 每个分类的技能点数
}

/**
 * 渲染配置选项
 */
export interface RenderOptions {
  jobConfig?: number[];   // Precise control per job
  strategy: LayoutStrategy; // 这一步是必须的
}

export class ResumeGenerator {
  private browser: Browser | null = null;
  private templatePath: string;

  constructor() {
    // 尝试从多个可能的位置查找模板文件
    const possiblePaths = [
      join(__dirname, 'template.html'),           // 编译后的 dist 目录
      join(__dirname, '../src/template.html'),    // 开发环境
      join(process.cwd(), 'src/template.html'),   // 项目根目录下的 src
      join(process.cwd(), 'dist/template.html'),  // 项目根目录下的 dist
    ];
    
    this.templatePath = possiblePaths.find(path => existsSync(path)) || possiblePaths[0];
  }

  /**
   * 获取布局策略
   */
  private getLayoutStrategy(jobCount: number, hasCertificates: boolean): LayoutStrategy {
      // 循环逻辑 (Cycle of 3):
      // Page Count: Base 2, increases every 3 jobs (1-3 -> 2pg, 4-6 -> 3pg, 7-9 -> 4pg)
      // Layout Style: Cycles every 3 jobs (1, 2, 3 pattern)
      
      const cycleIndex = (jobCount - 1) % 3; // 0, 1, 2
      let strategy: LayoutStrategy;

      // Determine Page Count
      // Job 1-3: 2 Pages. Job 4-6: 3 Pages.
      // Formula: 2 + floor((jobCount - 1) / 3)
      const targetPages = 2 + Math.floor((jobCount - 1) / 3);

      switch (cycleIndex) {
          case 0: // Matches Job 1, 4, 7...
              // Style: Skills 1 Col, 4 Cats, 4 Items (Certs: 3 Items)
              strategy = {
                  targetPages: targetPages,
                  skillColumns: 1,
                  skillCategories: 4,
                  skillItemsPerCat: 4
              };
              if (hasCertificates) {
                  strategy.skillItemsPerCat = 3;
              }
              break;
              
          case 1: // Matches Job 2, 5, 8...
              // Style: Skills 2 Cols, 4 Cats, 4 Items (Certs: 3 Items)
              strategy = {
                  targetPages: targetPages,
                  skillColumns: 2,
                  skillCategories: 4,
                  skillItemsPerCat: 4
              };
              if (hasCertificates) {
                   strategy.skillItemsPerCat = 3;
              }
              break;
              
          case 2: // Matches Job 3, 6, 9...
              // Style: Skills 3 Cols, 3 Cats, 4 Items (If certs exist, 3 Cats)
              strategy = {
                  targetPages: targetPages,
                  skillColumns: 3,
                  skillCategories: 3,
                  skillItemsPerCat: 4
              };
              if (hasCertificates) {
                  strategy.skillCategories = 3;
                  strategy.skillItemsPerCat = 3;
              }
              break;
              
          default:
              // Should not happen with % 3
              throw new Error('Invalid cycle index for layout strategy');
      }
      
      return strategy;
  }

  /**
   * 检查运行环境 (启动时调用)
   */
  public checkEnvironment(): void {
    if (process.platform === 'linux') {
      const path = this.detectExecutablePath();
      if (!path) {
        console.error('❌ [Environment Check] Error: Google Chrome not found at /usr/bin/google-chrome and "which google-chrome" failed.');
        console.error('                           Please install google-chrome-stable to use the resume generation service.');
      } else {
        console.log(`✅ [Environment Check] Found Google Chrome at: ${path}`);
      }
    }
  }

  /**
   * 自动探测 Chrome 路径 (仅限 Linux)
   */
  public detectExecutablePath(): string | undefined {
    if (process.platform !== 'linux') return undefined;

    // 常见路径列表
    const paths = [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/snap/bin/chromium'
    ];

    for (const p of paths) {
      if (existsSync(p)) return p;
    }

    try {
      // 尝试使用 which 命令
      const whichPath = execSync('which google-chrome || which google-chrome-stable || which chromium-browser || which chromium')
        .toString()
        .trim();
      if (whichPath && existsSync(whichPath)) return whichPath;
    } catch (e) {
      // ignore
    }

    return undefined;
  }

  /**
   * 初始化浏览器实例
   */
  async init(): Promise<void> {
    if (!this.browser) {
      const launchOptions: any = {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage', // 关键：解决 Docker 内存共享不足问题
          '--disable-gpu' // 节省资源，headless 不需要 GPU
        ],
      };

      const isLinux = process.platform === 'linux';
      const chromePath = this.detectExecutablePath();
      
      if (chromePath) {
        launchOptions.executablePath = chromePath;
      } else if (isLinux) {
        // 如果是 Linux 且没找到 Chrome，抛出更清晰的错误
        throw new Error('❌ [Browser Init] CRITICAL: Google Chrome/Chromium not found. Please install it (e.g., sudo apt-get install google-chrome-stable).');
      }

      this.browser = await puppeteer.launch(launchOptions);
    }
  }

  /**
   * 关闭浏览器实例
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * 格式化头像
   * 支持格式：
   * - data:image/...;base64,... (Base64)
   * - http:// 或 https:// (HTTP URL)
   */
  private formatAvatar(avatar?: string): string {
    if (!avatar || avatar.trim() === '') {
      return '';
    }
    
    let imageUrl = avatar.trim();
    
    // 更加鲁棒的路径处理：
    // 无论是相对路径 /public/... 或 /tests/... 还是完整 URL
    // 只要包含 /public/ 或 /tests/ 且指向本地资源，我们就尝试直接读取本地文件并转换为 Base64
    const localPattern = /\/(public|tests)\/(.*)/;
    const match = imageUrl.match(localPattern);
    
    if (match) {
        const relativePath = `${match[1]}/${match[2]}`;
        const absolutePath = join(process.cwd(), relativePath);
        if (existsSync(absolutePath)) {
            try {
                const buffer = readFileSync(absolutePath);
                const ext = extname(absolutePath).toLowerCase().replace('.', '');
                const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
                imageUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
            } catch (e) {
                console.error(`Failed to read avatar file: ${absolutePath}`, e);
            }
        }
    }
    
    // 如果已经是 data URL 格式，直接使用
    if (imageUrl.startsWith('data:')) {
        return `<img src="${imageUrl}" alt="头像" class="avatar" onerror="this.style.display='none';this.parentElement.style.display='none';" />`;
    }
    
    // 转义 URL 并添加错误处理
    return `<img src="${this.escapeHtml(imageUrl)}" alt="头像" class="avatar" onerror="this.style.display='none';this.parentElement.style.display='none';" />`;
  }

  /**
   * 格式化联系方式
   */
  private formatContactInfo(contact: ResumeData['contact'], yearsOfExperience: number, languages?: string, gender?: string, hasAvatar?: boolean): string {
    const items: string[] = [];

    const isEnglish = languages === 'english';
    
    // 如果没有照片且不是英文（中文环境），在联系方式最前面显示性别
    if (!hasAvatar && gender && !isEnglish) {
      items.push(this.escapeHtml(gender));
    }
    
    if (contact.email) {
      items.push(this.escapeHtml(contact.email));
    }
    if (contact.phone) {
      items.push(this.escapeHtml(contact.phone));
    }
    if (contact.location) {
      const locationIcon = `<svg viewBox="0 0 128 128" style="width: 12px; height: 12px; margin-right: 3px; display: inline-block; vertical-align: -1px;"><path d="m68.63 59.34-9.27-1.52s-.45 38.95-.06 43.57c0 .01 2.39 14.08 2.98 21.07.07.87.8 1.55 1.68 1.55s1.61-.67 1.69-1.55l2.99-21.07c-.02-6.35-.01-42.05-.01-42.05" style="fill:#82aec0"/><path d="M68.59 59.77s.04 5.9.04 7.37-1.31 3.83-4.7 3.83-4.64-2.31-4.64-3.73.01-7.45.01-7.45z" style="fill:#2f7889"/><path d="M35.72 32.36v1.42c.85 14.04 11.91 25.52 25.95 26.79.85.14 1.56.14 2.41.14s1.56 0 2.27-.14c14.04-1.28 25.09-12.48 25.94-26.8v-1.42C92.43 16.76 79.67 4 64.07 4S35.72 16.62 35.72 32.36" style="fill:#f44336"/><path d="M66.97 8.77c2.66 2.62 1.97 5.66.52 8.29-1.63 2.96-5.42 4.45-11.01 12.51-4.19 6.04-13.08 3.28-14.33-1.51-.96-3.68-.19-7.53 1.8-10.71C51.5 5.27 64.31 6.15 66.97 8.77" style="fill:#ff7555"/></svg>`;
      items.push(`${locationIcon}${this.escapeHtml(contact.location)}`);
    }
    // 英文简历不用微信
    if (!isEnglish && contact.wechat) {
      const wechatIcon = `<svg viewBox="0 0 48 48" style="width: 12px; height: 12px; margin-right: 3px; display: inline-block; vertical-align: -1px;"><path fill="#8BC34A" d="M18,6C9.2,6,2,12,2,19.5c0,4.3,2.3,8,6,10.5l-2,6l6.3-3.9C14,32.7,16,33,18,33c8.8,0,16-6,16-13.5C34,12,26.8,6,18,6z"/><path fill="#7CB342" d="M20,29c0-6.1,5.8-11,13-11c0.3,0,0.6,0,0.9,0c-0.1-0.7-0.3-1.4-0.5-2c-0.1,0-0.3,0-0.4,0c-8.3,0-15,5.8-15,13c0,1.4,0.3,2.7,0.7,4c0.7,0,1.4-0.1,2.1-0.2C20.3,31.6,20,30.3,20,29z"/><path fill="#CFD8DC" d="M46,29c0-6.1-5.8-11-13-11c-7.2,0-13,4.9-13,11s5.8,11,13,11c1.8,0,3.5-0.3,5-0.8l5,2.8l-1.4-4.8C44.3,35.2,46,32.3,46,29z"/><path fill="#33691E" d="M14,15c0,1.1-0.9,2-2,2s-2-0.9-2-2s0.9-2,2-2S14,13.9,14,15z M24,13c-1.1,0-2,0.9-2,2s0.9,2,2,2s2-0.9,2-2S25.1,13,24,13z"/><path fill="#546E7A" d="M30,26.5c0,0.8-0.7,1.5-1.5,1.5S27,27.3,27,26.5s0.7-1.5,1.5-1.5S30,25.7,30,26.5z M37.5,25c-0.8,0-1.5,0.7-1.5,1.5s0.7,1.5,1.5,1.5s1.5-0.7,1.5-1.5S38.3,25,37.5,25z"/></svg>`;
      items.push(`${wechatIcon}${this.escapeHtml(contact.wechat)}`);
    }
    if (contact.telegram) {
      const telegramIcon = `<svg viewBox="0 0 48 48" style="width: 12px; height: 12px; margin-right: 3px; display: inline-block; vertical-align: -1px;"><path fill="#29b6f6" d="M24 4A20 20 0 1 0 24 44A20 20 0 1 0 24 4Z"/><path fill="#fff" d="M33.95,15l-3.746,19.126c0,0-0.161,0.874-1.245,0.874c-0.576,0-0.873-0.274-0.873-0.274l-8.114-6.733 l-3.97-2.001l-5.095-1.355c0,0-0.907-0.262-0.907-1.012c0-0.625,0.933-0.923,0.933-0.923l21.316-8.468 c-0.001-0.001,0.651-0.235,1.126-0.234C33.667,14,34,14.125,34,14.5C34,14.75,33.95,15,33.95,15z"/><path fill="#b0bec5" d="M23,30.505l-3.426,3.374c0,0-0.149,0.115-0.348,0.12c-0.069,0.002-0.143-0.009-0.219-0.043 l0.964-5.965L23,30.505z"/><path fill="#cfd8dc" d="M29.897,18.196c-0.169-0.22-0.481-0.26-0.701-0.093L16,26c0,0,2.106,5.892,2.427,6.912 c0.322,1.021,0.58,1.045,0.58,1.045l0.964-5.965l9.832-9.096C30.023,18.729,30.064,18.416,29.897,18.196z"/></svg>`;
      items.push(`${telegramIcon}${this.escapeHtml(contact.telegram)}`);
    }
    if (contact.linkedin) {
      const linkedinIcon = `<svg viewBox="0 0 48 48" style="width: 12px; height: 12px; margin-right: 3px; display: inline-block; vertical-align: -1px;"><path fill="#0288D1" d="M42,37c0,2.762-2.238,5-5,5H11c-2.761,0-5-2.238-5-5V11c0-2.762,2.239-5,5-5h26c2.762,0,5,2.238,5,5V37z"/><path fill="#FFF" d="M12 19H17V36H12zM14.485 17h-.028C12.965 17 12 15.888 12 14.499 12 13.08 12.995 12 14.514 12c1.521 0 2.458 1.08 2.486 2.499C17 15.887 16.035 17 14.485 17zM36 36h-5v-9.099c0-2.198-1.225-3.698-3.192-3.698-1.501 0-2.313 1.012-2.707 1.99C24.957 25.543 25 26.511 25 27v9h-5V19h5v2.616C25.721 20.5 26.85 19 29.738 19c3.578 0 6.261 2.25 6.261 7.274L36 36 36 36z"/></svg>`;
      items.push(`${linkedinIcon}${this.escapeHtml(contact.linkedin)}`);
    }
    
    const totalYears = Math.floor(yearsOfExperience || 0);
    const yearSuffix = isEnglish ? (totalYears === 1 ? 'year exp' : 'years exp') : '年经验';
    items.push(this.escapeHtml(`${totalYears}${yearSuffix}`));

    if (contact.website) {
      // 移除协议头用于显示
      const displayWebsite = contact.website.replace(/^https?:\/\//, '');
      // 确保链接有协议头
      const href = contact.website.startsWith('http') ? contact.website : `https://${contact.website}`;
      // 使用提供的 website 图标
      const websiteIcon = `<svg viewBox="0 0 128 128" style="width: 12px; height: 12px; margin-right: 3px; display: inline-block; vertical-align: -1px;"><path d="M23.91 104.02c-6.5-6.63-6.5-17.21 0-23.84l18.74-18.74c2.04-2.04 4.72-3.57 7.52-4.33s5.74-.76 8.41-.13c2.8.76 5.48 2.17 7.65 4.21l.25.25c6.63 6.63 6.63 17.21 0 23.84l-18.74 18.74c-6.62 6.63-17.33 6.63-23.83 0m53.03-53.03c-12.36-12.36-32.63-12.36-45 0L13.33 69.73c-12.36 12.36-12.36 32.63 0 45s32.63 12.36 45 0l18.74-18.74c12.23-12.37 12.23-32.63-.13-45" style="fill:#84b0c1"/><path d="M66.86 48.48c3.36-1.69 6.57-.51 6.57-.51-6.94-5.13-14.51-6.59-21.03-6.18-.04.05-.07.1-.11.16-2.86 4.39-3.5 10.19-1.72 15.07 2.68-.66 5.46-.64 8-.03 1.04.28 1.83.55 3.39 1.28.01-.01-.54-7.05 4.9-9.79M46.76 58.46c.13-.97.19-1.95.25-2.93.28-4.22 1-8.42 2.14-12.49.08-.29.16-.6.24-.91-3.09.49-6.12 1.43-8.97 2.83-4.44 5.73-2.98 13.15 2.23 16.49 1.19-1.19 2.59-2.2 4.11-2.99" style="fill:#2f7889"/><path d="M104.09 23.98c6.5 6.63 6.5 17.21 0 23.84L85.35 66.56c-2.04 2.04-4.72 3.57-7.52 4.33s-5.74.76-8.41.13c-2.8-.76-5.48-2.17-7.65-4.21l-.25-.25c-6.63-6.63-6.63-17.21 0-23.84l18.74-18.74c6.62-6.63 17.33-6.63 23.83 0M51.06 77.01c12.36 12.36 32.63 12.36 45 0l18.61-18.74c12.36-12.36 12.36-32.63 0-45s-32.63-12.36-45 0L50.94 32.01c-12.24 12.37-12.24 32.63.12 45" style="fill:#84b0c1"/><path d="M50.45 39.42c.04-.03.08-.07.12-.1.53-.46 1.12-.9 1.81-1.02s1.5.19 1.74.85c.18.49.02 1.03-.15 1.52-2.63 7.95-4.74 18.04-2.18 26.27.25.8.49 1.83-.18 2.33-.39.3-.97.25-1.4.02-4.7-2.54-5.52-9.42-5.74-14.14-.26-5.96 1.39-11.7 5.98-15.73" style="fill:#a8e3f0"/><path d="M71.32 71.34c-.64-.08-1.32-.21-1.32-.21s-.1 4.27-3.51 7.81c-3.78 3.92-7.55 3.82-7.55 3.82 1.99 1.15 5.96 2.34 7.4 2.68l.15-.15c3.83-3.84 5.43-9 4.83-13.95M90.76 61.15l-5.33 5.33c1.33 5.94.97 12.18-1.09 17.94 2.59-.92 5.08-2.19 7.4-3.8 3.83-6.56 2.99-14.31-.98-19.47" style="fill:#2f7889"/><path d="M79.89 70.01c-.63-1.59-1.86-3.2-3.4-3.05-.96.09-2.45.99-2.35 3.74.07 2.13.88 4.21-.28 7-1.7 4.08-1.31 5.18-.9 5.83.45.71 1.28 1.03 2.05 1.02 2.03-.01 3.71-1.87 4.63-3.91 1.49-3.26 1.58-7.29.25-10.63M49.25 108.18c.64-.53 2.3-2.3 3.07-1.18-.28 3.08-2.65 5.59-5.25 7.27-3.2 2.07-6.99 3.29-10.8 3.18-3.16-.09-8.4-1.37-10.24-4.3-1.5-2.38 1.67-2.79 3.43-2.13 6.27 2.39 13.36 2.44 19.79-2.84" style="fill:#a8e3f0"/></svg>`;
      items.push(`${websiteIcon}<a href="${this.escapeHtml(href)}" target="_blank" style="color: inherit; text-decoration: underline; text-underline-offset: 2px;">${this.escapeHtml(displayWebsite)}</a>`);
    }
    
    // 使用 span 包裹每个项目，便于 CSS 控制换行和分隔符
    return items.map(item => `<span class="contact-item">${item}</span>`).join('');
  }

  /**
   * 格式化教育经历
   */
  private formatEducation(education: ResumeData['education'], languages?: string): string {
    const isEnglish = languages === 'english';
    return education
      .map((edu) => {
        if (isEnglish) {
          // 英文版：学校名和日期在一行，学位放在第二行，且不显示 description
          let html = `
            <div class="education-item">
              <div class="education-header">
                <span class="school-name">${this.escapeHtml(edu.school)}</span>
                <span class="date">${this.escapeHtml(edu.graduationDate)}</span>
              </div>
              ${edu.degree ? `<div class="education-description" style="font-weight: 500; color: #444; margin-top: -5px;">${this.escapeHtml(edu.degree)}</div>` : ''}
            </div>
          `;
          return html;
        }

        // 中文版保持原有逻辑
        let html = `
          <div class="education-item">
            <div class="education-header">
              <div>
                <span class="school-name">${this.escapeHtml(edu.school)}</span>
                ${edu.degree ? `<span class="degree">${this.escapeHtml(edu.degree)}</span>` : ''}
              </div>
              <span class="date">${this.escapeHtml(edu.graduationDate)}</span>
            </div>
        `;
        
        if (edu.description) {
          // 将换行符转换为空格，避免不必要的换行
          const description = edu.description.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
          html += `<div class="education-description">${this.formatText(description)}</div>`;
        }
        
        html += '</div>';
        return html;
      })
      .join('');
  }

  /**
   * 格式化专业技能
   */
  private formatProfessionalSkills(skills?: ResumeData['professionalSkills'], strategy?: LayoutStrategy): string {
    if (!skills || skills.length === 0 || !strategy) {
      return '';
    }
    
    // 使用策略进行裁剪
    const targetCategories = skills.slice(0, strategy.skillCategories);

    // 构造 Grid 样式
    // 注意：template.html 里的 .skills-grid 默认可能是 3 列，这里我们需要内联覆盖
    // 或者直接使用 grid-template-columns: repeat(N, 1fr)
    const gridStyle = `grid-template-columns: repeat(${strategy.skillColumns}, 1fr);`;

    let html = `<div class="skills-grid" style="${gridStyle}">`;
    
    html += targetCategories
      .map((category) => {
        let catHtml = `
          <div class="skill-category">
            <div class="skill-category-title">${this.escapeHtml(category.title)}</div>
        `;
        
        const visibleItems = category.items.slice(0, strategy.skillItemsPerCat);

        catHtml += visibleItems
          .map((item, index) => {
              return `<div class="skill-item priority-high" data-priority="${index}">${this.formatText(item)}</div>`;
          })
          .join('');
        
        catHtml += `</div>`;
        return catHtml;
      })
      .join('');
      
    html += `</div>`;
    
    return html;
  }

  /**
   * 格式化工作经历
   */
  private formatWorkExperience(workExperience: ResumeData['workExperience'], limit: number | number[] = 999): string {
    return workExperience
      .map((work, jobIndex) => {
        // Determine limit for this specific job
        let jobLimit = 999;
        if (typeof limit === 'number') {
            jobLimit = limit;
        } else if (Array.isArray(limit)) {
            jobLimit = limit[jobIndex] !== undefined ? limit[jobIndex] : 999;
        }

        let html = `
          <div class="work-item" data-job-index="${jobIndex}">
            <div class="work-header">
              <div class="company-position">
                <span class="company">${this.escapeHtml(work.company)}</span>
                <span class="work-position"> - ${this.escapeHtml(work.position)}</span>
              </div>
              <span class="work-date">${this.escapeHtml(work.startDate)} - ${this.escapeHtml(work.endDate)}</span>
            </div>
        `;
        
        if (work.responsibilities && work.responsibilities.length > 0) {
          const visibleResponsibilities = work.responsibilities.slice(0, jobLimit);
          
          html += '<div class="responsibilities">';
          // 标记前4个为高优先级，之后的为低优先级
          html += visibleResponsibilities
            .map((resp, index) => {
                const priorityClass = index < 4 ? 'priority-high' : 'priority-low';
                return `<div class="responsibility-item ${priorityClass}" data-priority="${index}" data-job-index="${jobIndex}" data-bullet-index="${index}">${this.formatText(resp)}</div>`;
            })
            .join('');
          html += '</div>';
        }
        
        html += '</div>';
        return html;
      })
      .join('');
  }

  /**
   * 格式化证书
   */
  private formatCertificates(certificates?: ResumeData['certificates']): string {
    if (!certificates || certificates.length === 0) {
      return '';
    }
    
    const items = certificates
      .map((cert) => `<div class="certificate-item">${this.escapeHtml(cert.name)}</div>`)
      .join('');

    return `<div class="certificate-container">${items}</div>`;
  }

  /**
   * 检测底部空白
   */
  private async detectBottomSpace(page: Page): Promise<Array<{ pageNum: number; bottomSpace: number }>> {
    return (await page.evaluate(`
      (function() {
        const pageHeight = 1123; // A4 高度（像素）
        const pages = [];
        
        // 获取所有内容元素
        const contentElements = Array.from(document.querySelectorAll('.section, .work-item, .education-item, .skill-category'));
        
        // 计算总页数
        const totalHeight = document.body.scrollHeight;
        const totalPages = Math.ceil(totalHeight / pageHeight);
        
        for (let pageNum = 0; pageNum < totalPages; pageNum++) {
          const pageTop = pageNum * pageHeight;
          const pageBottom = (pageNum + 1) * pageHeight;
          
          // 找到这一页的所有元素
          const elementsInPage = contentElements.filter(function(el) {
            const rect = el.getBoundingClientRect();
            return rect.top >= pageTop && rect.top < pageBottom;
          });
          
          if (elementsInPage.length === 0) {
            pages.push({ pageNum: pageNum, bottomSpace: pageHeight });
            continue;
          }
          
          // 计算这一页最后一个元素的位置
          const lastElement = elementsInPage[elementsInPage.length - 1];
          const lastElementRect = lastElement.getBoundingClientRect();
          const lastElementBottom = lastElementRect.bottom;
          
          // 计算底部空白
          const bottomSpace = Math.max(0, pageBottom - lastElementBottom);
          
          pages.push({ pageNum: pageNum, bottomSpace: bottomSpace });
        }
        
        return pages;
      })();
    `)) as Array<{ pageNum: number; bottomSpace: number }>;
  }

  /**
   * 应用智能分页 (Force Page Breaks)
   * 任何元素的标题如果出现在页面的底部危险区域 (Danger Zone)，
   * 就强制加 margin-top 把它推到下一页。
   */
  private async applySmartPageBreaks(page: Page, dangerZone: number = 100): Promise<void> {
    try {
      await page.evaluate((PAGE_HEIGHT, DANGER_ZONE) => {
        // const DANGER_ZONE = 100; // Passed as arg
        
        const items = document.querySelectorAll('.work-item, .education-item, .project-item, .section-title');
        
        items.forEach(item => {
          const rect = item.getBoundingClientRect();
          const currentTop = rect.top + window.scrollY; // Absolute Top
          
          const topInPage = currentTop % PAGE_HEIGHT;
          
          if (topInPage > (PAGE_HEIGHT - DANGER_ZONE)) {
             (item as HTMLElement).style.breakBefore = 'always';
             (item as HTMLElement).style.marginTop = '0px'; 
          }
        });
      }, this.A4_USABLE_HEIGHT, dangerZone);
      
      // 等待重新布局
      await new Promise(resolve => setTimeout(resolve, 300));
      
    } catch (error) {
       console.warn('智能分页(PageBreaks)失败:', error);
    }
  }

  /**
   * 优化内容密度 (Smart Pruning)
   * 假设输入包含了足够多的数据 (Gemini Surplus 模式)，
   * 此函数负责“修剪”低优先级的条目，直到内容刚好填满整数页。
   */
  private async optimizeContentDensity(page: Page): Promise<void> {
      try {
          await page.evaluate(`
            (function() {
                const PAGE_HEIGHT = 1123;
                const MARGIN_BOTTOM = 40; 
                
                function getContentHeight() {
                     // 考虑 @page margin 对 scrollHeight 的影响
                     // 最准确是看最后一个元素的 bottom
                     const all = document.querySelectorAll('*');
                     if (all.length === 0) return 0;
                     
                     // 简单粗暴：body scrollHeight
                     return document.body.scrollHeight;
                }

                // 1. 获取当前高度
                let currentHeight = getContentHeight();
                
                // 2. 计算目标页数 (Round)
                // 1.2 页 -> 1页 (Prune)
                // 1.8 页 -> 2页 (No Prune, or minor prune)
                let targetPages = Math.round(currentHeight / PAGE_HEIGHT);
                if (targetPages < 1) targetPages = 1;

                const targetMaxHeight = targetPages * PAGE_HEIGHT - MARGIN_BOTTOM;

                // 如果当前高度已经小于目标高度，且差距不大，说明不需要修剪，直接返回 (留给 stretch 处理)
                if (currentHeight <= targetMaxHeight) {
                    return; 
                }
                
                // 3. 开始修剪 (Pruning Loop)
                // 策略：优先删除 .priority-low 的元素
                // 顺序：从后往前删？或者均匀删？
                // 为了保持简历平衡，建议均匀删。但这里先简单实现：从整个文档的低优先级列表中，从后往前删。
                
                const lowPriorityItems = Array.from(document.querySelectorAll('.priority-low'));
                // 反转数组，从文档底部开始删 (通常看起来更自然，或者是每个工作最后一点)
                lowPriorityItems.reverse(); 

                let removeCount = 0;
                
                for (const item of lowPriorityItems) {
                    if (getContentHeight() <= targetMaxHeight) {
                        break; // 已经达标
                    }
                    
                    if (item && item.parentNode) {
                        item.parentNode.removeChild(item);
                        removeCount++;
                    }
                }
                
                // 清理可能产生的空容器 (如果某个工作的所有职责都被删了... 虽然不太可能因为有 priority-high)
                document.querySelectorAll('.responsibilities, .skill-items').forEach(container => {
                    if (container.children.length === 0) {
                        container.style.display = 'none';
                    }
                });
            })();
          `);
          
          await new Promise(r => setTimeout(r, 200));
      } catch (error) {
          console.warn('内容密度优化失败:', error);
      }
  }

  /**
   * HTML 转义
   */
  private escapeHtml(text: any): string {
    if (text === undefined || text === null) {
      return '';
    }
    const stringText = String(text);
    const map: { [key: string]: string } = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return stringText.replace(/[&<>"']/g, (m) => map[m]);
  }

  /**
   * 生成符合递减规则的工作经历点数配置列表
   * 规则: J[i] >= J[i+1], 且 3 <= J[i] <= 7
   * 返回按总点数降序排列的列表 (内容由多到少)
   */
  private generateJobConfigs(numJobs: number): number[][] {
      const configs: number[][] = [];
      const MAX_POINTS = 7;
      const MIN_POINTS = 3;

      // 回溯法生成所有组合
      function backtrack(index: number, current: number[], maxLimit: number) {
          if (index === numJobs) {
              configs.push([...current]);
              return;
          }
          // 当前点数不能超过 maxLimit (即上一份工作的点数)，且不能小于 MIN_POINTS
          for (let val = maxLimit; val >= MIN_POINTS; val--) {
              current.push(val);
              backtrack(index + 1, current, val);
              current.pop();
          }
      }

      if (numJobs === 0) return [[]];

      // 启动递归，第一段工作的上限是 MAX_POINTS
      for (let val = MAX_POINTS; val >= MIN_POINTS; val--) {
          backtrack(1, [val], val);
      }

      // 按总点数降序排序 (让 Index 0 代表最丰富的内容)
      return configs.sort((a, b) => {
          const sumA = a.reduce((sum, v) => sum + v, 0);
          const sumB = b.reduce((sum, v) => sum + v, 0);
          return sumB - sumA;
      });
  }

  /**
   * 格式化文本，支持加粗和下划线
   * 支持的格式：
   * - <b>文本</b> 表示加粗
   * - <u>文本</u> 表示下划线
   * - <b><u>文本</u></b> 表示加粗+下划线
   * 
   * @param text 原始文本
   * @returns 格式化后的 HTML
   */
  private formatText(text: string): string {
    if (!text) return '';

    // 适配 Gemini 偶尔生成的 Markdown 格式作为兜底
    text = text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
    
    // 先处理换行符，将 \n\n 转为双换行标识，\n 转为单换行标识
    // 这样可以确保 AI 返回的段落结构在模板中得以体现
    text = text.replace(/\n\n/g, '<br/><br/>');
    text = text.replace(/\n/g, '<br/>');

    // 使用占位符保护格式化标签，避免被转义
    const placeholders: { [key: string]: string } = {};
    let placeholderIndex = 0;
    
    // 生成唯一的占位符
    const getPlaceholder = (type: string) => {
      const key = `__PLACEHOLDER_${type}_${placeholderIndex++}__`;
      return key;
    };
    
    // 先处理嵌套的格式化（先处理内层，再处理外层）
    // 处理 <b><u>...</u></b> 嵌套格式
    text = text.replace(/<b><u>(.*?)<\/u><\/b>/gi, (match, content) => {
      const key = getPlaceholder('BOLD_UNDERLINE');
      placeholders[key] = `<b><u>${this.escapeHtml(content)}</u></b>`;
      return key;
    });
    
    // 处理单独的 <b> 标签
    text = text.replace(/<b>(.*?)<\/b>/gi, (match, content) => {
      const key = getPlaceholder('BOLD');
      placeholders[key] = `<b>${this.escapeHtml(content)}</b>`;
      return key;
    });
    
    // 处理单独的 <u> 标签
    text = text.replace(/<u>(.*?)<\/u>/gi, (match, content) => {
      const key = getPlaceholder('UNDERLINE');
      placeholders[key] = `<u>${this.escapeHtml(content)}</u>`;
      return key;
    });
    
    // 处理 <br> 标签 (换行)
    // 用户需求: 换行时增加小幅垂直间距，使排版不拥挤
    text = text.replace(/<br\s*\/?>/gi, (match) => {
      const key = getPlaceholder('BR');
      placeholders[key] = '<div style="height: 5px;"></div>';
      return key;
    });

    // 转义剩余的 HTML
    text = this.escapeHtml(text);
    
    // 恢复占位符（按相反顺序，确保嵌套格式正确恢复）
    const sortedKeys = Object.keys(placeholders).sort((a, b) => {
      // 先恢复嵌套的，再恢复单独的
      if (a.includes('BOLD_UNDERLINE') && !b.includes('BOLD_UNDERLINE')) return -1;
      if (!a.includes('BOLD_UNDERLINE') && b.includes('BOLD_UNDERLINE')) return 1;
      return 0;
    });
    
    sortedKeys.forEach(key => {
      text = text.replace(key, placeholders[key]);
    });
    
    return text;
  }


  /**
   * 生成 HTML 内容
   */
  private generateHTML(data: ResumeData, options?: RenderOptions & { jobConfig?: number[] }): string {
    let html = readFileSync(this.templatePath, 'utf-8');
    
    // 替换占位符
    const isEnglish = data.languages === 'english';
    html = html.replace('{{TITLE_EDUCATION}}', isEnglish ? 'Education' : '教育经历');
    html = html.replace('{{TITLE_PERSONAL_INTRO}}', isEnglish ? 'Personal Introduction' : '个人介绍');
    html = html.replace('{{TITLE_CERTIFICATES}}', isEnglish ? 'Certificates' : '证书');
    html = html.replace('{{TITLE_WORK_EXP}}', isEnglish ? 'Work Experience' : '工作经历');
    html = html.replace('{{TITLE_SKILLS}}', isEnglish ? 'Professional Skills' : '专业技能');

    html = html.replace('{{AVATAR}}', this.formatAvatar(data.avatar));
    html = html.replace('{{NAME}}', this.escapeHtml(data.name));
    html = html.replace('{{POSITION}}', this.escapeHtml(data.position));
    html = html.replace('{{CONTACT_INFO}}', this.formatContactInfo(data.contact, data.yearsOfExperience, data.languages, data.gender, !!data.avatar));
    html = html.replace('{{YEARS_OF_EXPERIENCE}}', data.yearsOfExperience.toString());
    html = html.replace('{{EDUCATION}}', this.formatEducation(data.education, data.languages));
    html = html.replace('{{PERSONAL_INTRODUCTION}}', this.formatText(data.personalIntroduction));
    // 传入 strategy
    html = html.replace('{{PROFESSIONAL_SKILLS}}', this.formatProfessionalSkills(data.professionalSkills, options?.strategy));
    
    // Support jobConfig (array)
    const workItems = options?.jobConfig;
    html = html.replace('{{WORK_EXPERIENCE}}', this.formatWorkExperience(data.workExperience, workItems));
    
    // 证书板块整体替换 (包含标题逻辑)
    html = html.replace('{{SECTION_CERTIFICATES}}', this.formatCertificateSection(data.certificates, isEnglish));
    
    return html;
  }

  /**
   * 格式化证书板块 (包含标题)
   */
  private formatCertificateSection(certificates: ResumeData['certificates'], isEnglish: boolean): string {
    if (!certificates || certificates.length === 0) {
      return '';
    }
    
    const items = certificates
      .map((cert) => `<div class="certificate-item">${this.escapeHtml(cert.name)}</div>`)
      .join('');

    const title = isEnglish ? 'Certificates' : '证书';
    const titleKey = isEnglish ? 'Certificates' : '证书'; // Fallback logic if needed, but we hardcode title here based on language

    return `
      <div class="section">
          <div class="section-title certificate-section-title">${title}</div>
          <div class="certificate-container">${items}</div>
      </div>
    `;
  }

  // A4 Standard at 96 DPI: 210mm x 297mm => 793.7px x 1122.52px
  // Usable height = 1122.52 - (40px top + 40px bottom) = 1042.52px
  // Use 1042.5 which is exactly 1122.52 - 80 (top/bottom margins)
  private readonly A4_USABLE_HEIGHT = 1042.5; 
  private readonly ORPHAN_THRESHOLD = 80; // 标题下方至少预留的空间

  /**
   * 评估当前布局质量
   * 返回: { pageCount, fillRatio, hasOrphans, details }
   */
  private async assessLayoutQuality(page: Page): Promise<{
    pageCount: number,
    fillRatio: number, // 最后一页填充率 (0-1)
    hasOrphans: boolean,
    details: string
  }> {
     return await page.evaluate((PAGE_HEIGHT) => {
        // 使用最后一个可见元素的底部来计算真实占用页数，而不是 scrollHeight
        // scrollHeight 不包含分页产生的空白
        const allItems = Array.from(document.querySelectorAll('.header, .section, .work-item, .responsibility-item, .skill-item, .certificate-item'));
        let maxBottom = 0;
        allItems.forEach(el => {
            const rect = el.getBoundingClientRect();
            const bottom = rect.bottom + window.scrollY;
            if (bottom > maxBottom) maxBottom = bottom;
        });

        const totalHeight = maxBottom;
        const pageCount = Math.ceil(totalHeight / PAGE_HEIGHT);
        
        // 计算最后一页填充率
        const lastPageHeight = totalHeight % PAGE_HEIGHT;
        const fillRatio = (lastPageHeight === 0) ? 1.0 : (lastPageHeight / PAGE_HEIGHT);
        
        let hasOrphans = false;
        let details = "";
        
        // 检查标题孤儿：标题在页面底部 80px 内 (Danger Zone)
        const headers = document.querySelectorAll('.section-title, .work-header, .education-header');
        headers.forEach((h) => {
             const rect = h.getBoundingClientRect();
             const absoluteTop = rect.top + window.scrollY; 
             
             const topInPage = absoluteTop % PAGE_HEIGHT;
             if (topInPage > (PAGE_HEIGHT - 80)) {
                 hasOrphans = true;
                 details += `Orphan Header at px ${Math.round(absoluteTop)} (Page Bottom); `;
             }
        });

        return { pageCount, fillRatio, hasOrphans, details };
     }, this.A4_USABLE_HEIGHT);
  }

  /**
   * 寻找最佳布局配置 (Page-Aware Simulation)
   * 1. 渲染全量内容 (Max Config).
   * 2. 提取每个区块(Block)的精确高度信息.
   * 3. 在内存中模拟不同 Config 下的分页效果 (无需重复渲染).
   * 4. 选出得分最高 (填充率好、由于孤儿造成的浪费少) 的配置.
   */
  private async findOptimalLayout(page: Page, data: ResumeData): Promise<string> {
      // 1. 获取基础信息
      const jobCount = data.workExperience.length;
      const hasCertificates = !!(data.certificates && data.certificates.length > 0);
      const numJobs = jobCount;

      // 2. 获取命运确定的策略
      const strategy = this.getLayoutStrategy(jobCount, hasCertificates);
      const targetPages = strategy.targetPages;

      console.log(`[Layout Strategy] Jobs: ${jobCount}, HasCerts: ${hasCertificates}, TargetPages: ${targetPages}, SkillCols: ${strategy.skillColumns}, SkillCats: ${strategy.skillCategories}, ItemsPerCat: ${strategy.skillItemsPerCat}`);

      const PAGE_HEIGHT = this.A4_USABLE_HEIGHT;

      // Step A: 渲染这个 Strategy 下的 "Max Content" (所有 job 设为 100) 以获取 Metric
      const maxConfig = new Array(numJobs).fill(100);
      const calibOps: RenderOptions = { jobConfig: maxConfig, strategy: strategy };
      const calibHtml = this.generateHTML(data, calibOps);
      await page.setContent(calibHtml, { waitUntil: 'load' }); // load to render grid
      
      // Step B: Extract Layout Blocks inline (Reusing existing extraction logic flow)
      
      // 定义 Block 结构
      interface LayoutBlock {
          type: 'static' | 'job_header' | 'job_bullet' | 'gap';
          height: number;
          jobIndex?: number;
          bulletIndex?: number;
          isOrphanable?: boolean;
          label?: string; // Debug Label
          hasDangerZoneRule?: boolean; // New: Supports Danger Zone Simulation
      }

      // 在浏览器上下文中提取 Blocks (Granular)
      const allBlocks = await page.evaluate(() => {
          const blocks: any[] = [];
          
          let currentY = 0;
          
          // Helper: Add Block relative to natural flow
          const addBlock = (el: Element, type: string, label: string, extra?: any) => {
               const rect = el.getBoundingClientRect();
               const top = rect.top + window.scrollY;
               
               // Gap Detection
               if (top > currentY && currentY > 0) {
                   const gap = top - currentY;
                   if (gap > 1) {
                       // Associate gap with the *next* element if the next element is a bullet
                       // This ensures if the bullet is pruned, the gap is also pruned.
                       const gapExtra = (extra && extra.bulletIndex !== undefined) 
                            ? { jobIndex: extra.jobIndex, bulletIndex: extra.bulletIndex } 
                            : {};
                       
                       blocks.push({ 
                           type: 'gap', 
                           height: gap, 
                           label: `Gap before ${label}`,
                           ...gapExtra
                       });
                   }
               }
               
               // Danger Zone Check: Check if this element triggers Smart Break logic
               // Selector matches ensureSmartPageBreaks: .work-item, .education-item, .project-item, .section-title
               // Note: We are adding specific elements. 
               // If type is 'job_header', its parent is .work-item.
               // If type is 'static' and matches .section-title or .education-item
               let hasDangerZoneRule = false;
               if (el.matches('.section-title') || el.matches('.education-item') || el.matches('.project-item')) {
                   hasDangerZoneRule = true;
               } 
               // Special case for Work Item: addBlock is called on work-header, but the wrapper .work-item triggers the rule.
               // Since work-header is at top of work-item, their positions are identical.
               if (type === 'job_header') {
                   hasDangerZoneRule = true; 
               }

               blocks.push({ 
                   type: type, 
                   height: rect.height, 
                   label: label, 
                   hasDangerZoneRule: hasDangerZoneRule,
                   ...extra 
               });
               
               currentY = top + rect.height;
          };
          
          // 1. Header
          const header = document.querySelector('.header');
          if (header) addBlock(header, 'static', '头部信息');

          // 2. Sections Before Work (Education, Intro)
          // We identify Work Section first
          const allSections = Array.from(document.querySelectorAll('.section')); 
          const workSectionIndex = allSections.findIndex(s => s.querySelector('.work-item'));
          
          for(let i=0; i<workSectionIndex; i++) {
              const sec = allSections[i];
              let label = '其他模块';
              // Check title
              const title = sec.querySelector('.section-title')?.textContent || '';
              if (title.includes('教育')) label = '教育经历';
              else if (title.includes('介绍') || sec.querySelector('.personal-intro')) label = '个人介绍';
              
              addBlock(sec, 'static', label);
          }
          
          // 3. Work Section Title
          if (workSectionIndex >= 0) {
              const workSec = allSections[workSectionIndex];
              const title = workSec.querySelector('.section-title');
              if (title) {
                 addBlock(title, 'static', '工作经历标题');
                 // Also check gap to first job? Handled by addBlock if flow is linear.
              }
              
              // 4. Work Items
              const workItems = Array.from(workSec.querySelectorAll('.work-item'));
              workItems.forEach((item) => {
                  const jobIdx = parseInt(item.getAttribute('data-job-index') || '0');
                  
                  const h = item.querySelector('.work-header');
                  if (h) addBlock(h, 'job_header', `工作${jobIdx+1}标题`, { jobIndex: jobIdx, isOrphanable: true });
                  
                  const bullets = Array.from(item.querySelectorAll('.responsibility-item'));
                  bullets.forEach((li) => {
                       const p = parseInt(li.getAttribute('data-priority') || '0');
                       addBlock(li, 'job_bullet', `工作${jobIdx+1}小点`, { jobIndex: jobIdx, bulletIndex: p });
                  });
              });
              
              // 5. Check if next siblings exist (Skills, Certs)
              let sibling = workSec.nextElementSibling;
              while (sibling) {
                   if (sibling.querySelector('.skill-category')) {
                       // Skills
                       const t = sibling.querySelector('.section-title');
                       if (t) addBlock(t, 'static', '专业技能标题');
                       
                       // 检测是否使用了网格布局
                       const grid = sibling.querySelector('.skills-grid');
                       if (grid) {
                           // 将整个 Skill Grid 视为一个大的静态块
                           // 优点：避免模拟器计算两列并排时的重叠高度问题
                           // 缺点：如果 Grid 很长，跨页模拟可能不精准（但通常 Skill 不会跨页）
                           addBlock(grid, 'static', '专业技能网格');
                           
                           // 也可以选择遍历子元素，但是需要处理 Grid Row 的逻辑。
                           // 简单起见，作为一个整体处理是最稳妥的（要么整体在下一页，要么整体在上一页）
                       } else {
                           const cats = Array.from(sibling.querySelectorAll('.skill-category'));
                           cats.forEach(c => addBlock(c, 'static', '专业技能模块'));
                       }
                   } else if (sibling.querySelector('.certificate-item')) {
                       // Certs
                       const t = sibling.querySelector('.section-title');
                       if (t) addBlock(t, 'static', '证书标题');
                       const items = Array.from(sibling.querySelectorAll('.certificate-item'));
                       if (items.length > 0) items.forEach(it => addBlock(it, 'static', '证书项'));
                       else addBlock(sibling, 'static', '证书(空)');
                   } else {
                       addBlock(sibling, 'static', '其他模块');
                   }
                   sibling = sibling.nextElementSibling;
              }
          }
          
          return blocks;
      }) as LayoutBlock[];
      console.log(`[Metrics] Extracted ${allBlocks.length} layout blocks.`);

      // 3. Iterative Layout Solver (The New Algorithm: Simulation-Based)
      // 计算目标: 
      // 1. 基于最大内容运行虚拟布局，计算自然页数 (Natural Pages)
      // 2. 如果自然页数只有一点点超出 (例如 1.1 页)，试图压缩回 1 页 (Smart Target)
      // 3. 确定 Target Pages 后，从 Min Config (3 bullets) 开始贪婪填充 (Greedy Fill)
      // 4. 每次填充都运行虚拟布局检查是否溢出 Target Pages
      // 5. 填充完毕后，检查 Orphan 并尝试交换解决

      // A4 Height = 1123px. 
      // Template has @page { margin: 40px 50px; }
      // So available vertical space is roughly 1123 - 40 - 40 = 1043px.
      // We use a safe value (1020px) to account for browser rendering variations and page breaks.

      // Helpers
      const allBullets = allBlocks.filter(b => b.type === 'job_bullet');

      const bulletsByJob: { [key: number]: typeof allBullets } = {};
      allBullets.forEach(b => {
          if (typeof b.jobIndex === 'number') {
            if (!bulletsByJob[b.jobIndex]) bulletsByJob[b.jobIndex] = [];
            bulletsByJob[b.jobIndex].push(b);
          }
      });
      // Sort bullets by index
      Object.keys(bulletsByJob).forEach(k => {
          bulletsByJob[parseInt(k)].sort((a,b) => (a.bulletIndex||0) - (b.bulletIndex||0));
      });

      // Step C: Simulation Logic (Reused for Strategy)
      const simulateLayout = (config: number[], dangerZone = 100) => {
          const activeBlocks = allBlocks.filter(b => {
               if (b.type === 'job_bullet' || (b.type === 'gap' && b.bulletIndex !== undefined)) {
                   // If it's a bullet OR a gap associated with a bullet
                   if (typeof b.jobIndex !== 'number') return false;
                   // Use config to decide visibility
                   return (b.bulletIndex ?? 0) < (config[b.jobIndex] ?? 0);
               }
               return true; // Static blocks (and unassociated gaps) always active
          });

          let currentY = 0;
          let pageNum = 1;
          const DANGER_ZONE = dangerZone; // Adjustable Danger Zone
          
          for (let i = 0; i < activeBlocks.length; i++) {
              const blk = activeBlocks[i];
              
              // 孤儿处理逻辑 (Unbreakable Groups):
              // 如果当前块是工作标题(job_header)，它必须与其下方的第一个小点(job_bullet)在同一页
              let blockGroupHeight = blk.height;
              if (blk.type === 'job_header' && i + 1 < activeBlocks.length) {
                  const nextBlk = activeBlocks[i+1];
                  if (nextBlk.type === 'job_bullet') {
                      blockGroupHeight += nextBlk.height;
                  }
              }

              // Danger Zone Logic (Replica of CSS enforcement)
              // If this block has a rule, and it STARTS in the danger zone, it WILL be pushed.
              if (blk.hasDangerZoneRule) {
                   const spaceRemaining = PAGE_HEIGHT - currentY;
                   if (spaceRemaining < DANGER_ZONE) {
                       // Force Break based on Danger Zone
                       pageNum++;
                       currentY = 0; // New page starts fresh
                       // Note: We ignore the gap before this block because the break consumes the space.
                       // The block adds its height to the new page.
                   }
              }

              // Standard Overflow Check
              if (currentY + blockGroupHeight > PAGE_HEIGHT) {
                  // 强制分页
                  pageNum++;
                  currentY = blk.height; 
              } else {
                  currentY += blk.height;
              }
          }
          return { pages: pageNum, lastPageHeight: currentY };
      };

      // --- DEBUG OUTPUT START ---
      // (Simplified Debug Logic)
      const staticTotal = allBlocks.filter(b=>b.type!=='job_bullet').reduce((a,b)=>a+b.height,0);
      console.log(`\n=== 布局计算报告 ===`);
      console.log(`1. 固定空间计算: ${Math.round(staticTotal)} (约占 ${Math.ceil(staticTotal/PAGE_HEIGHT)} 页)`);
      if (staticTotal > PAGE_HEIGHT) console.log(`   [警报] 固定高度超过 ${Math.ceil(staticTotal/PAGE_HEIGHT)-1} 页！`);

      // 2. Greedy Allocation based on Strategy Target
      // 初始分配：第一份工作 6 条职责，其他工作 4 条，以保证高质量呈现
      let currentConfig: number[] = new Array(numJobs).fill(0).map((_, i) => i === 0 ? 6 : 4);
      
      // 获取 AI 提供给这段经历的实际最大职责数 (通常由 AI 服务层强制为 8)
      const maxBulletsPerJob = new Array(numJobs).fill(0);
      allBlocks.forEach(b => {
          if (b.type === 'job_bullet' && typeof b.jobIndex === 'number') {
              maxBulletsPerJob[b.jobIndex] = Math.max(maxBulletsPerJob[b.jobIndex], (b.bulletIndex || 0) + 1);
          }
      });
      // 安全限制，防止初始值超过 AI 实际生成的条数
      currentConfig = currentConfig.map((v, i) => Math.min(v, maxBulletsPerJob[i]));
      
      // Check if base config already explodes
      const baseSim = simulateLayout(currentConfig);
      if (baseSim.pages > targetPages) {
          // 如果基准配置（6/4/4...）已经超页，则向下裁剪
          console.warn(`[Solver] Base config exceeds target ${targetPages}. Pruning down...`);
          let canPrune = true;
          while (canPrune) {
              canPrune = false;
              // 从最后一份工作开始往回减，直到不超页或减到 3 条为止
              for (let j = numJobs - 1; j >= 0; j--) {
                  if (currentConfig[j] > 3) {
                      currentConfig[j]--;
                      if (simulateLayout(currentConfig).pages <= targetPages) {
                          // 减完这一条就达标了
                          canPrune = false;
                          break; 
                      }
                      canPrune = true; // 还能继续试
                  }
              }
              if (currentConfig.every(v => v <= 3)) break; // 全减到 3 了还没法满足，就只能这样了
          }
      } else {
          // 如果没超页，则向上增加（贪婪模式）
          let changed = true;
          while(changed) {
              changed = false;
              for (let j = 0; j < numJobs; j++) {
                  if (currentConfig[j] < maxBulletsPerJob[j]) {
                      // Try adding
                      currentConfig[j]++;
                      const sim = simulateLayout(currentConfig);
                      if (sim.pages <= targetPages) {
                          changed = true; // Keep it
                      } else {
                          currentConfig[j]--; // Revert
                      }
                  }
              }
          }
      }

      // --- SECOND ROUND: Aggressive Filling (Relaxed Constraints) ---
      // 尝试通过放宽排版约束（如允许标题更靠近底部），进一步利用页面空间（针对 90%+ 填充率的情况）
      let finalDangerZone = 100; // Default Strict (100px)
      {
          const RELAXED_DANGER_ZONE = 60; // 从 100px 放宽到 60px
          console.log(`[Solver] Round 2: Attempting Aggressive Fill (DangerZone: ${RELAXED_DANGER_ZONE}px)...`);
          
          let changed = true;
          while(changed) {
              changed = false;
              for (let j = 0; j < numJobs; j++) {
                  if (currentConfig[j] < maxBulletsPerJob[j]) {
                      currentConfig[j]++;
                      const sim = simulateLayout(currentConfig, RELAXED_DANGER_ZONE);
                      if (sim.pages <= targetPages) {
                          changed = true; // Squeezed in!
                          finalDangerZone = RELAXED_DANGER_ZONE; // Commit to relaxed zone
                          console.log(`   -> [Round 2] Added bullet to Job ${j} (Count: ${currentConfig[j]})`);
                      } else {
                          currentConfig[j]--; // Revert
                      }
                  }
              }
          }
      }

      // Calculate Final Stats
      const finalSim = simulateLayout(currentConfig, finalDangerZone);
      const totalAvailable = targetPages * PAGE_HEIGHT;
      const totalUsed = ((finalSim.pages - 1) * PAGE_HEIGHT) + finalSim.lastPageHeight;
      const fillPercent = ((totalUsed / totalAvailable) * 100).toFixed(1);

      console.log(`3. 最佳填充方案: [${currentConfig}]`);
      console.log(`4. 总体填充率: ${fillPercent}%`);
      console.log(`=====================\n`);

      console.log(`[Solver] Initial Computed Config: [${currentConfig}] for Target Pages: ${targetPages}`);

      // D. Orphan Solver (Simplified or Removed per strict strategy)
      // Strict Strategy usually means we fill pages. 
      // Orphans might happen but changing config might violate "fill pages" goal.
      // We rely on applySmartPageBreaks for final cleanup.
      // (Orphan solving loop removed for Strategy Mode)


      // E. Render Final
      console.log(`[Solver] Final Optimized Config: [${currentConfig}]`);
      const finalOps: RenderOptions = { jobConfig: currentConfig, strategy: strategy };
      const finalHtml = this.generateHTML(data, finalOps);
      // await page.setContent(finalHtml, { waitUntil: 'load' }); // Done by caller logic steps
      
      // Inject CSS Adjustments (adjustLayoutDensity)
      // We return the content string, but we need to apply density tweaks first.
      // So we must setContent here.
      await page.setContent(finalHtml, { waitUntil: 'load' });
      // adjustLayoutDensity removed per user request
      await this.applySmartPageBreaks(page, finalDangerZone); // Final Breaks with Dynamic Danger Zone
      
      return await page.content();
  }

  // Helper to safely access array
  private getJobConfig(arr: number[], idx: number | undefined) {
      if (typeof idx === 'number' && idx >= 0 && idx < arr.length) return arr[idx];
      return 0;
  }

  /**
   * 最终布局校验 (Safety Net)
   */
  private async validateLayoutResult(page: Page): Promise<void> {
      const quality = await this.assessLayoutQuality(page);
      if (quality.hasOrphans) {
          console.warn(`[Layout Warning] Final PDF may have layout issues: ${quality.details}`);
          // 在这里您可以选择抛出错误，或者只是记录
          // throw new Error("Generated resume violates layout constraints: " + quality.details);
      }
      if (quality.fillRatio < 0.15 && quality.pageCount > 1) {
          console.warn(`[Layout Warning] Last page is too empty (${(quality.fillRatio * 100).toFixed(0)}%)`);
      }
      console.log(`[Validation Passed] Final Layout Check OK. Pages: ${quality.pageCount}`);
  }

  /**
   * 生成 PDF
   * @param data 简历数据
   * @param outputPath 输出文件路径（可选，如果不提供则返回 Buffer）
   * @returns PDF Buffer 或文件路径
   */
  async generatePDF(data: ResumeData, outputPath?: string): Promise<Buffer | string> {
    await this.init();
    
    if (!this.browser) {
      throw new Error('Browser not initialized');
    }

    const page: Page = await this.browser.newPage();
    
    // 全局样式设置，确保打印背景色等
    // Puppeteer 默认即可是 print media type，但可以通过 emulateMediaType 强制
    await page.emulateMediaType('screen'); // 使用 screen 样式便于布局计算，print 时有些 margin 行为不同

    try {
      // Step 1: 智能探测最佳布局 (Smart Probing)
      // 这会尝试 MAX / STD / MIN 三种内容密度，选出分页最完美的一种
      const finalHtml = await this.findOptimalLayout(page, data);
      if (!finalHtml) {
        throw new Error('No valid layout found (Strict Mode)');
      }      
      // Step 2: 应用选定的 HTML
      // 注意：findOptimalLayout 已经返回了调整后的完整 HTML (包含内联 style)，
      // 所以我们这里通常不需要再 run 微调，除非我们想再确保一次。
      // 但由于 bestHtml 是 page.content() 获取的，已经包含了 adjustLayoutDensity 的 CSS 修改。
      // 我们只需要 setContent 即可。
      // 注意：使用 waitUntil: 'load' 即可，避免 networkidle0 等待过久导致超时
      await page.setContent(finalHtml, { waitUntil: 'load' });
      
      // Step 3: 虽然 HTML 包含了 style，但某些 JS 动态行为可能重置
      // 所以为了保险，我们只轻量级运行一次 SmartPageBreaks 确保分页符没乱
      // adjustLayoutDensity 不需要再跑，因为 CSS margin 已经写在 style 属性里了
      // await this.applySmartPageBreaks(page); // (可选，如果之前的 evaluate 已经修改了 style 属性，这里不用再跑)
      
      // 实际上，page.content() 拿到的 HTML 里的元素 style="margin-top: xxx" 是生效的。
      // 所以理论上直接 generate PDF 即可。

      // Step 4: 最终校验 (Validation Check - User Requested)
      await this.validateLayoutResult(page);

      // 检查头像图片 (保持原有逻辑)
      if (data.avatar) {
        try {
          await page.evaluate(`
            (function() {
              return new Promise(function(resolve) {
                const img = document.querySelector('.avatar');
                if (!img) { resolve(); return; }
                const timeout = setTimeout(function() {
                  if (!img.complete || img.naturalHeight === 0) {
                    img.style.display = 'none';
                    if(img.parentElement) img.parentElement.style.display = 'none';
                  }
                  resolve();
                }, 3000); // Reduce timeout to 3s
                if (img.complete && img.naturalHeight > 0) {
                  clearTimeout(timeout); resolve();
                } else {
                  img.onload = () => { clearTimeout(timeout); resolve(); };
                  img.onerror = () => { clearTimeout(timeout); img.style.display = 'none'; resolve(); };
                }
              });
            })();
          `);
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
          console.warn('头像检查失效:', error);
        }
      }
      
      const pdfOptions = {
        format: 'A4' as const,
        printBackground: true,
      };

      if (outputPath) {
        await page.pdf({ ...pdfOptions, path: outputPath });
        return outputPath;
      } else {
        const pdfBuffer = await page.pdf(pdfOptions);
        return Buffer.from(pdfBuffer);
      }
    } finally {
      await page.close();
    }
  }

  /**
   * 生成 PDF 并保存到文件
   */
  async generatePDFToFile(data: ResumeData, outputPath: string): Promise<string> {
    return (await this.generatePDF(data, outputPath)) as string;
  }

  /**
   * 生成 PDF 并返回 Buffer
   */
  async generatePDFToBuffer(data: ResumeData): Promise<Buffer> {
    return (await this.generatePDF(data)) as Buffer;
  }
}


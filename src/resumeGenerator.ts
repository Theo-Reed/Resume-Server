import puppeteer, { Browser, Page } from 'puppeteer';
import { readFileSync, existsSync } from 'fs';
import { join, dirname, extname } from 'path';
import { ResumeData } from './types';

/**
 * 渲染配置选项
 */
export interface RenderOptions {
  maxWorkItems?: number; // 每个工作经历最多显示的条目数 (Surplus Trimming)
  maxSkillItems?: number; // 每个技能分类最多显示的条目数
  jobConfig?: number[];   // Precise control per job
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
   * 初始化浏览器实例
   */
  async init(): Promise<void> {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox', 
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage', // 关键：解决 Docker 内存共享不足问题
          '--disable-gpu' // 节省资源，headless 不需要 GPU
        ],
      });
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
    // 无论是相对路径 /public/... 还是完整 URL http://.../public/...
    // 只要包含 /public/ 且指向本地资源，我们就尝试直接读取本地文件并转换为 Base64
    // 这样可以避免 Puppeteer 在容器/内网环境下解析 localhost 或 file:// 协议的问题
    const publicPattern = /\/public\/(.*)/;
    const match = imageUrl.match(publicPattern);
    
    if (match) {
        const relativePath = `public/${match[1]}`;
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
  private formatContactInfo(contact: ResumeData['contact'], yearsOfExperience: number, languages?: string): string {
    const items: string[] = [];
    
    if (contact.email) {
      items.push(this.escapeHtml(contact.email));
    }
    if (contact.wechat) {
      items.push(this.escapeHtml(contact.wechat));
    }
    if (contact.phone) {
      items.push(this.escapeHtml(contact.phone));
    }
    
    const isEnglish = languages === 'english';
    const totalYears = Math.floor(yearsOfExperience || 0);
    const yearSuffix = isEnglish ? (totalYears === 1 ? 'year exp' : 'years exp') : '年经验';
    items.push(this.escapeHtml(`${totalYears}${yearSuffix}`));

    if (contact.website) {
      // 移除协议头用于显示
      const displayWebsite = contact.website.replace(/^https?:\/\//, '');
      // 确保链接有协议头
      const href = contact.website.startsWith('http') ? contact.website : `https://${contact.website}`;
      // 🔗 符号不进行转义，网址内容进行转义，并使用 <a> 标签包裹
      items.push(`🔗<a href="${this.escapeHtml(href)}" target="_blank" style="color: inherit; text-decoration: underline; text-underline-offset: 2px;">${this.escapeHtml(displayWebsite)}</a>`);
    }
    
    // 使用 span 包裹每个项目，便于 CSS 控制换行和分隔符
    return items.map(item => `<span class="contact-item">${item}</span>`).join('');
  }

  /**
   * 格式化教育经历
   */
  private formatEducation(education: ResumeData['education']): string {
    return education
      .map((edu) => {
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
  private formatProfessionalSkills(skills?: ResumeData['professionalSkills'], limit: number = 999): string {
    if (!skills || skills.length === 0) {
      return '';
    }
    
    return skills
      .map((category) => {
        let html = `
          <div class="skill-category">
            <div class="skill-category-title">${this.escapeHtml(category.title)}</div>
            <div class="skill-items">
        `;
        
        // 使用 limit 进行截断
        const visibleItems = category.items.slice(0, limit);

        // 标记前3个为高优先级，后面的为低优先级 (可被动态隐藏)
        html += visibleItems
          .map((item, index) => {
              const priorityClass = index < 3 ? 'priority-high' : 'priority-low';
              return `<div class="skill-item ${priorityClass}" data-priority="${index}">${this.formatText(item)}</div>`;
          })
          .join('');
        
        html += `
            </div>
          </div>
        `;
        
        return html;
      })
      .join('');
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
  private async applySmartPageBreaks(page: Page): Promise<void> {
    try {
      await page.evaluate(`
        (function() {
          const PAGE_HEIGHT = 1123;
          const DANGER_ZONE = 120; // 底部 120px 为危险区域
          
          // 获取所有可能包含标题的主要区块
          // 根据模板结构，只需要处理主要的块级元素，不需要处理单独的 section-title，
          // 因为 section-title 通常紧跟内容，推 section-title 即可。
          // 重点防止 work-item, education-item, project-item 的头部掉在底下
          const items = document.querySelectorAll('.work-item, .education-item, .project-item, .section-title');
          
          let totalShift = 0;
          
          items.forEach(item => {
            // Get original metrics
            const rect = item.getBoundingClientRect();
            // Since we haven't forced layout recalc, rect is still valid for original state
            // But we must account for previous shifts
            
            const originalTop = rect.top + window.scrollY; // Absolute Top
            const currentTop = originalTop + totalShift;   // Where it would be now
            
            const topInPage = currentTop % PAGE_HEIGHT;
            
            // Check: Danger Zone
            // Also check if we are VERY close to top (e.g. < 40px), which means we just got pushed? 
            // No, the mod logic handles that. 2246 % 1123 = 0.
            
            if (topInPage > (PAGE_HEIGHT - DANGER_ZONE)) {
               const pushDownAmount = (PAGE_HEIGHT - topInPage) + 20; // +20 margin buffer
               
               const style = window.getComputedStyle(item);
               const currentMarginTop = parseFloat(style.marginTop) || 0;
               
               item.style.marginTop = (currentMarginTop + pushDownAmount) + 'px';
               
               // Accumulate the shift for subsequent elements
               totalShift += pushDownAmount;
            }
          });
        })();
      `);
      
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
   * 动态调整密度以适配整数页 (Dynamic Layout Adjustment)
   * 替换原有的 applySmartTrimming 和 optimizePageFill
   * 目标：让内容填满整数页 (1, 2, 3...)
   */
  private async adjustLayoutDensity(page: Page): Promise<void> {
    try {
      await page.evaluate(`
        (function() {
          const PAGE_HEIGHT = 1123;
          // 由于使用了 @page margin, document.body.scrollHeight 有时不如 document.documentElement.scrollHeight 准确
          // 或者直接读取 .resume 的高度 (如果是 block container)
          const content = document.querySelector('.resume') || document.body;
          const totalHeight = content.scrollHeight;
          
          // 加上一定的上下 margin 估算 (90px) 转换为 PDF 页面视角
          // 但 Puppeteer 分页是基于 continuous stream.
          // 更好的方法是基于 PAGE_HEIGHT 的倍数
          
          const ratio = totalHeight / PAGE_HEIGHT;
          
          // 目标页数 (四舍五入)
          let targetPages = Math.round(ratio);
          if (targetPages < 1) targetPages = 1;
          
          // 目标高度需要填满 targetPages，减去底部的安全留白
          // 注意：如果有 @page margin，实际可显示区域高度减少。
          // A4 = 1123px. Margin-top=40, Margin-bottom=40 (?) 
          // 假设 @page margin = 40px top/bottom.
          // PDF height effectively allows content flow.
          
          // 我们简化逻辑：目标是将现有内容撑大(或缩前)到 targetPages * 1100 左右
          // 减去 40px 防止溢出出最后一页
          const targetHeight = (targetPages * PAGE_HEIGHT) - 50; 
          
          let diff = targetHeight - totalHeight;
          
          // 阈值检查
          if (Math.abs(diff) < 10) return; // 误差极小
          if (diff > 900) return; // 拉伸太大，放弃 (比如只有半页内容想拉成一页，太稀疏)
          if (targetPages > 1 && diff > 500) {
              // 多页情况下，如果空白太多，就不强求铺满（防止两页半变成三页满，太稀疏）
              // 但用户诉求是“最后一页到底部留白很小”
              // 所以我们还是尽量铺。
          }
          if (diff < -300) return; // 压缩太多，放弃
          
          // 权重分配：大块元素权重大，列表项权重小
          const majorSelector = '.section, .work-item, .education-item, .skill-category';
          const minorSelector = '.responsibility-item, .skill-item, .certificate-item, .contact-item';
          
          const majorItems = Array.from(document.querySelectorAll(majorSelector));
          const minorItems = Array.from(document.querySelectorAll(minorSelector));
          
          const majorWeight = 4;
          const minorWeight = 1;
          
          const totalWeight = (majorItems.length * majorWeight) + (minorItems.length * minorWeight);
          
          if (totalWeight === 0) return;
          
          const pxPerWeight = diff / totalWeight;
          
          // 限制单个权重单位的最大像素值，防止变形
          // 例如：pxPerWeight 计算出来是 20px (diff=2000, weight=100) -> Major gain 80px margin! Too much.
          // 限制：拉伸时 Major max 60px, Minor max 15px
          // 压缩时 Major max -20px, Minor max -5px
          
          let safePxPerWeight = pxPerWeight;
          if (diff > 0) {
              if (safePxPerWeight > 15) safePxPerWeight = 15; // Cap expansion
          } else {
              if (safePxPerWeight < -5) safePxPerWeight = -5; // Cap compression
          }
          
          function applyMargin(elements, weight) {
              elements.forEach(el => {
                  const style = window.getComputedStyle(el);
                  const currentMb = parseFloat(style.marginBottom) || 0;
                  const add = safePxPerWeight * weight;
                  
                  // 保护：margin 不能为负数
                  const newMb = Math.max(2, currentMb + add);
                  el.style.marginBottom = newMb + 'px';
              });
          }
          
          applyMargin(majorItems, majorWeight);
          applyMargin(minorItems, minorWeight);
          
        })();
      `);
      
      // 等待重新布局
      await new Promise(resolve => setTimeout(resolve, 300));
    } catch (error) {
      console.warn('动态布局调整失败:', error);
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
    html = html.replace('{{CONTACT_INFO}}', this.formatContactInfo(data.contact, data.yearsOfExperience, data.languages));
    html = html.replace('{{YEARS_OF_EXPERIENCE}}', data.yearsOfExperience.toString());
    html = html.replace('{{EDUCATION}}', this.formatEducation(data.education));
    html = html.replace('{{PERSONAL_INTRODUCTION}}', this.formatText(data.personalIntroduction));
    html = html.replace('{{PROFESSIONAL_SKILLS}}', this.formatProfessionalSkills(data.professionalSkills, options?.maxSkillItems));
    
    // Support either maxWorkItems (simple number) or jobConfig (array)
    // Cast to any because formatWorkExperience now supports number[] but Typescript might be confused by the conditional type
    const workItems = options?.jobConfig || options?.maxWorkItems;
    html = html.replace('{{WORK_EXPERIENCE}}', this.formatWorkExperience(data.workExperience, workItems as any));
    
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
          <div class="section-title">${title}</div>
          <div class="certificate-container">${items}</div>
      </div>
    `;
  }

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
     return await page.evaluate(() => {
        const PAGE_HEIGHT = 1123;
        // 使用 documentElement.scrollHeight 通常比 body 更准确，包含 margin
        const totalHeight = document.documentElement.scrollHeight;
        const pageCount = Math.ceil(totalHeight / PAGE_HEIGHT);
        
        // 计算最后一页填充率
        const lastPageHeight = totalHeight % PAGE_HEIGHT;
        const fillRatio = (lastPageHeight === 0) ? 1.0 : (lastPageHeight / PAGE_HEIGHT);
        
        let hasOrphans = false;
        let details = "";
        
        // 检查标题孤儿：标题在页面底部 100px 内 (Danger Zone)
        // 这些标题如果出现在页面最底端，说明下面的内容被切分由于分页到了下一页，Title 留在上一页底 -> 孤儿
        const headers = document.querySelectorAll('.section-title, .work-header, .education-header');
        headers.forEach((h) => {
             const rect = h.getBoundingClientRect();
             // 页面累积高度 + 元素相对视口高度 = 绝对高度
             // 在 puppeteer 渲染中，如果不发生滚动，rect.top 就是绝对 top。
             // 稳妥起见，假设 document flow 是从 0 开始。
             const absoluteTop = rect.top + window.scrollY; 
             
             const topInPage = absoluteTop % PAGE_HEIGHT;
             // 如果标题距离页尾 < 100px
             if (topInPage > (PAGE_HEIGHT - 100)) {
                 hasOrphans = true;
                 details += `Orphan Header at px ${Math.round(absoluteTop)} (Page Bottom); `;
             }
        });

        // 检查分割孤儿：Work Item 刚开始第一行就在页尾
        // 或者 Work Item 只有最后一行在下一页页头 (Pagination Orphans/Widows)
        // 这是一个简单的 Checks
        
        return { pageCount, fillRatio, hasOrphans, details };
     });
  }

  /**
   * 寻找最佳布局配置 (Page-Aware Simulation)
   * 1. 渲染全量内容 (Max Config).
   * 2. 提取每个区块(Block)的精确高度信息.
   * 3. 在内存中模拟不同 Config 下的分页效果 (无需重复渲染).
   * 4. 选出得分最高 (填充率好、由于孤儿造成的浪费少) 的配置.
   */
  private async findOptimalLayout(page: Page, data: ResumeData): Promise<string> {
      console.log('--- Starting Page-Aware Simulation Strategy ---');
      const numJobs = data.workExperience.length;
      
      // 1. Generate all valid configurations (Max to Min)
      const allConfigs = this.generateJobConfigs(numJobs); 
      
      if (allConfigs.length === 0) return "";

      const maxConfig = allConfigs[0];
      console.log(`[Calibration] Rendering MAX config [${maxConfig}] to extract metrics...`);

      // 2. Render Max & Extract Metrics
      // 必须渲染最大配置，这样才能拿到所有可能出现的 bullet point 的高度
      const ops: RenderOptions = { jobConfig: maxConfig, maxSkillItems: maxConfig[0] + 2 };
      const maxHtml = this.generateHTML(data, ops);
      await page.setContent(maxHtml, { waitUntil: 'load' });
      // Do NOT applySmartPageBreaks here. We want to measure the continuous flow.
      // await this.applySmartPageBreaks(page); 

      // 定义 Block 结构
      interface LayoutBlock {
          type: 'static' | 'job_header' | 'job_bullet' | 'gap';
          height: number;
          jobIndex?: number;
          bulletIndex?: number;
          isOrphanable?: boolean; // True if this block cannot be left alone at page bottom (Title)
      }

      // 在浏览器上下文中提取 Blocks
      const allBlocks = await page.evaluate(() => {
          const blocks: any[] = [];
          const workItems = Array.from(document.querySelectorAll('.work-item'));
          
          // 2.1 Static Top (Header + Education + First Section Title)
          // 测量第一个 Work Item 之前的空间
          // If no work items, this logic is flawed, but resume usually has work.
          let workStartTop = 0;
          if (workItems.length > 0) {
              const firstWork = workItems[0];
              const firstRect = firstWork.getBoundingClientRect();
              workStartTop = firstRect.top + window.scrollY;
          } else {
             // Fallback: measure until Skills or End
             // Simplified: assume 0 if no work (edge case)
          }
          
          if (workStartTop > 0) {
             blocks.push({ type: 'static', height: workStartTop }); 
          }

          // 2.2 Process Jobs
          if (workItems.length > 0) {
            workItems.forEach((item, idx) => {
                const jobIdx = parseInt(item.getAttribute('data-job-index') || '0');
                
                // Job Header (Company, Position, Date)
                const header = item.querySelector('.work-header');
                if (header) {
                    const r = header.getBoundingClientRect();
                    blocks.push({ 
                        type: 'job_header', 
                        height: r.height, 
                        jobIndex: jobIdx,
                        isOrphanable: true 
                    });
                }

                // Bullets
                const bullets = Array.from(item.querySelectorAll('.responsibility-item'));
                bullets.forEach((li, bIdx) => {
                    const r = li.getBoundingClientRect();
                    let effectiveHeight = r.height;
                    
                    // Calculate gap to next bullet if exists
                    if (bIdx < bullets.length - 1) {
                        const currentBottom = r.bottom; 
                        const nextTop = bullets[bIdx+1].getBoundingClientRect().top;
                        const gap = nextTop - currentBottom;
                        if (gap > 0) effectiveHeight += gap;
                    }
                    
                    blocks.push({
                        type: 'job_bullet',
                        height: effectiveHeight,
                        jobIndex: jobIdx,
                        bulletIndex: parseInt(li.getAttribute('data-priority') || '0')
                    });
                });

                // Gap to next item or to Bottom Section
                // We need to be careful here. 
                // The gap after LAST job connect to the Bottom Static Section.
                
                const currentRect = item.getBoundingClientRect();
                const currentBottom = currentRect.bottom + window.scrollY;
                
                let nextTop = 0;
                if (idx < workItems.length - 1) {
                    // Gap to next job
                    nextTop = workItems[idx + 1].getBoundingClientRect().top + window.scrollY;
                } else {
                    // Gap to Bottom Section (e.g. Skills Title)
                    // The Bottom Section starts right after this work item container.
                    // But we need to find the specific element.
                    // The template has Work Section -> Skills Section -> Certs.
                    // So after the last work-item, the next element is the closing of Work Section (padding?) 
                    // or the next .section (Skills).
                    // Actually, let's look for the next .section in document flow
                    const workSection = item.closest('.section');
                    if (workSection && workSection.nextElementSibling) {
                        nextTop = workSection.nextElementSibling.getBoundingClientRect().top + window.scrollY;
                    } else {
                        // End of doc?
                        nextTop = document.documentElement.scrollHeight;
                    }
                }
                
                const gap = nextTop - currentBottom;
                if (gap > 0) {
                    blocks.push({ type: 'gap', height: gap });
                }
            });
          }

          // 2.3 Static Bottom (Skills, Certificates, Footer)
          // We need to identify these blocks separately to handle pagination correctly.
          // Look for sections AFTER the work experience section.
          // In template: Work Exp is in a .section. Skills is next .section. Certs is next.
          
          let referenceElement = null;
           // Attempt to find the Work Experience Section
          const sections = Array.from(document.querySelectorAll('.section'));
          // Find the section that contains work items
          const workSection = sections.find(s => s.querySelector('.work-item'));
          
          if (workSection) {
              // Iterate over following siblings (Skills, Certs)
              let sibling = workSection.nextElementSibling;
              
              while (sibling) {
                   const rect = sibling.getBoundingClientRect();
                   const h = rect.height;
                   // Get margin top? 
                   const style = window.getComputedStyle(sibling);
                   const mt = parseFloat(style.marginTop) || 0;
                   const mb = parseFloat(style.marginBottom) || 0;
                   
                   // The Gap calculation in 2.2 already covers the gap from Last Work Item to the TOP of the next section (including margin).
                   // NO, 2.2 calculates gap from Last Job BOttom to Next Section Top. So margin is effectively included in gap.
                   // So here we just push the content height.
                   // Actually, we should push (height + marginBottom).
                   // But be careful about collapsing margins.
                   // For safety, let's use bounding box height (includes padding/border) + margin bottom.
                   
                   // Wait, 2.2 calculated gap to `sibling.top`.
                   // So we start from `sibling.top`.
                   // Height = rect.height.
                   // Then gap to next...
                   
                   blocks.push({ type: 'static', height: h, isOrphanable: true }); // Treat whole section as unbreakble for now? 
                   // Ideally spread skill-items? But user demands 4x4 fixed. So 16 items.
                   // Usually Skills section is allowed to break. 
                   // But breaking inside a skill grid is ugly.
                   // Breaking BETWEEN skill categories is fine.
                   // Since we don't control skill-bullet count (it's fixed 4x4), we treat them as static blocks.
                   // But if it's huge, we better split it.
                   
                   // Check if it's Skills section
                   if (sibling.querySelector('.skill-category')) {
                       // It's the big skills block. Split it!
                       // Remove the block used added above, and add sub-blocks
                       blocks.pop(); 
                       
                       const title = sibling.querySelector('.section-title');
                       if (title) {
                           blocks.push({ type: 'static', height: title.getBoundingClientRect().height + 20 }); // +margin
                       }
                       
                       const cats = Array.from(sibling.querySelectorAll('.skill-category'));
                       cats.forEach(cat => {
                           blocks.push({ type: 'static', height: cat.getBoundingClientRect().height });
                       });
                   } 
                   else {
                       // Keep as is (e.g. Certificate Section)
                       // Add margin bottom to height effectively?
                       // Or just ignore margin bottom at end of doc?
                   }

                   // Gap to next sibling
                   const currentBottom = rect.bottom + window.scrollY;
                   const nextSib = sibling.nextElementSibling;
                   if (nextSib) {
                       const nextTop = nextSib.getBoundingClientRect().top + window.scrollY;
                       const gap = nextTop - currentBottom;
                       if (gap > 0) blocks.push({ type: 'gap', height: gap });
                   }
                   
                   sibling = sibling.nextElementSibling;
              }
          } else {
             // Fallback if structure is different
             const lastWork = workItems[workItems.length - 1];
             if (lastWork) {
                 const lastBottom = lastWork.getBoundingClientRect().bottom + window.scrollY;
                 const totalH = document.documentElement.scrollHeight;
                 const bottomH = totalH - lastBottom;
                 if (bottomH > 0) blocks.push({ type: 'static', height: bottomH });
             }
          }

          return blocks;
      }) as LayoutBlock[];

      console.log(`[Metrics] Extracted ${allBlocks.length} layout blocks.`);

      // 3. Iterative Layout Solver (The New Algorithm)
      // 计算目标: 
      // 1. 获取所有模块的静态高度 (gap, static, headers)
      // 2. 获取所有 Bullet Points 的高度
      // 3. 计算目标页数 (Round)
      // 4. 计算需要插入多少个 Bullet 才能恰好填满目标页数
      // 5. 将这些 Bullet 分配给各个工作 (优先最新)
      // 6. 检查 Orphan，如果存在，执行 "减后补前" (Swap Strategy)

      // A. Data Preparation
      const PAGE_HEIGHT = 1123;
      const ORPHAN_THRESHOLD = 90; // Increased threshold to catch visual orphans earlier
      // Filter out bullets from blocks to get static height
      const staticBlocks = allBlocks.filter(b => b.type !== 'job_bullet');
      const staticHeight = staticBlocks.reduce((sum, b) => sum + b.height, 0);
      
      const allBullets = allBlocks.filter(b => b.type === 'job_bullet');
      // Group bullets by job
      const bulletsByJob: { [key: number]: typeof allBullets } = {};
      allBullets.forEach(b => {
          if (typeof b.jobIndex === 'number') {
            if (!bulletsByJob[b.jobIndex]) bulletsByJob[b.jobIndex] = [];
            bulletsByJob[b.jobIndex].push(b);
          }
      });
      // Sort bullets by index just in case
      Object.keys(bulletsByJob).forEach(k => {
          bulletsByJob[parseInt(k)].sort((a,b) => (a.bulletIndex||0) - (b.bulletIndex||0));
      });
      
      // B. Determine Target Pages
      const totalContentHeight = allBlocks.reduce((s, b) => s + b.height, 0);
      const exactPages = totalContentHeight / PAGE_HEIGHT;
      let targetPages = Math.round(exactPages); 
      // Special logic: If extremely close to N.5 (e.g. 1.45 - 1.55), prefer ceiling to avoid over-compression?
      // Or prefer floor to condense? User prefers "Smart One Page" ideally. 
      // Let's stick to Round: 1.4 -> 1, 1.6 -> 2.
      if (targetPages < 1) targetPages = 1;
      
      // Calculate Budget for Bullets
      // Total Available Height = Pages * 1123 - MarginBottom(approx 50)
      // Bullet Budget = Total Available - Static Height
      // Relaxed safety margin to 40 to allow slightly more content (relying on footer margin)
      const totalAvailableHeight = (targetPages * PAGE_HEIGHT) - 40; 
      let bulletHeightBudget = totalAvailableHeight - staticHeight;
      if (bulletHeightBudget < 0) bulletHeightBudget = 0; // Should not happen unless static > page
      
      // C. Allocation Strategy (Greedy Fill)
      // We need to pick bullets such that sum(height) <= bulletHeightBudget
      // Strategy: 
      // 1. Give every job at least Min Points (3)
      // 2. Then distribute remaining budget to newest jobs first
      
      // numJobs already defined at top of method
      let currentConfig = new Array(numJobs).fill(0);
      
      // C.1 Base Allocation (Min 3 or Max Available)
      for (let j = 0; j < numJobs; j++) {
          const available = bulletsByJob[j]?.length || 0;
          const min = Math.min(3, available);
          currentConfig[j] = min;
          // Deduct from budget (Estimate height)
          // We need precise height sum
      }
      
      // Function to calculate total height of a config
      const calcTotalHeight = (cfg: number[]) => {
          let h = staticHeight;
          for (let j = 0; j < numJobs; j++) {
              const count = cfg[j];
              const bullets = bulletsByJob[j] || [];
              for (let k = 0; k < count; k++) {
                  if (bullets[k]) h += bullets[k].height;
              }
          }
          return h;
      };

      // C.2 Distribute Remaining Budget
      // Priority: Job 0 > Job 1 > ... > Job N
      // Limit: Up to available bullets
      let canAdd = true;
      while (canAdd) {
          canAdd = false;
          // Try to add one bullet to each job from top to bottom
          for (let j = 0; j < numJobs; j++) {
              // Check if we can add to this job
              const currentCount = currentConfig[j];
              const maxAvailable = bulletsByJob[j]?.length || 0;
              
              if (currentCount < maxAvailable) {
                  // Check if adding this bullet fits in budget
                  const nextBullet = bulletsByJob[j][currentCount];
                  if (calcTotalHeight(currentConfig) + nextBullet.height <= totalAvailableHeight) {
                      currentConfig[j]++;
                      canAdd = true; // We added something, so loop again
                      // But maybe we should break to restart priority from Job 0? 
                      // "Distribute to newest jobs first" implies fill Job 0 THEN Job 1.
                      // Let's fill Job 0 as much as possible, then Job 1.
                      // So: break loop to restart at j=0? No, that would starve older jobs if budget is tight.
                      // Better balanced approach? Or strictly "Rich get richer"?
                      // Prompt says "Importance sorted". Job 0 is most important.
                      // Let's strictly fill Job 0, then Job 1...
                  }
              }
          }
          // The above loop round-robins. If we really want "Job 0 Full first", we should change loop.
          // Let's Stick to round robin but weighted? 
          // Actually, let's try a prioritized filling:
          // Fill Job 0 to Max, then Job 1...
      }
      
      // Restart Allocation with Strict Priority for better result matching "Standard" scenario constraints
      // Reset
      currentConfig = new Array(numJobs).fill(0);
      for (let j = 0; j < numJobs; j++) currentConfig[j] = Math.min(3, bulletsByJob[j]?.length || 0); // Base 3
      
      for (let j = 0; j < numJobs; j++) {
           const maxAvailable = bulletsByJob[j]?.length || 0;
           while (currentConfig[j] < maxAvailable) {
               const nextBullet = bulletsByJob[j][currentConfig[j]];
               if (calcTotalHeight(currentConfig) + nextBullet.height <= totalAvailableHeight) {
                   currentConfig[j]++;
               } else {
                   break; // Budget full
               }
           }
      }

      console.log(`[Solver] Initial Computed Config: [${currentConfig}] for Target Pages: ${targetPages}`);

      // D. Orphan Solver (Iterative Swap)
      // Simulate Layout -> Check Orphan -> Swap
      
      const MAX_ITERATIONS = 10;
      for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
          
          let orphanFound = false;
          const blocks = allBlocks.filter(b => {
             if (b.type === 'job_bullet') {
                 if (this.getJobConfig(currentConfig, b.jobIndex)) 
                    return (b.bulletIndex || 0) < currentConfig[b.jobIndex!];
             }
             return true;
          });
          
          // Simulation to find Orphan
          let currentY = 0;
          let pageNum = 1;
          let orphanJobIndex = -1;
          
          for (let i = 0; i < blocks.length; i++) {
              const blk = blocks[i];
              let h = blk.height;
              const spaceLeft = (PAGE_HEIGHT * pageNum) - currentY;
              
              if (h > spaceLeft) {
                  pageNum++;
                  currentY = h; 
              } else {
                  // Check Orphan Header
                  if (blk.type === 'job_header') {
                      // If Header is at bottom
                      if (spaceLeft - h < ORPHAN_THRESHOLD) {
                          // Check if next block needs break
                          let nextH = 0;
                          if (i+1 < blocks.length) nextH = blocks[i+1].height;
                          if(spaceLeft - h < nextH) {
                              // Orphan Confirmed!
                              orphanJobIndex = blk.jobIndex!;
                              orphanFound = true;
                              // Don't break loop, we need to know exactly which one. 
                              // Actually we can stop at first orphan to fix it.
                              break; 
                          }
                      }
                  }
                  currentY += h;
              }
          }
          
          if (!orphanFound) break; // Solved!
          
          console.log(`[Solver] Iteration ${iter}: Orphan detected at Job ${orphanJobIndex}. Applying Swap Strategy.`);
          
          // Strategy: "Subtract from Last (Earliest), Add to First (Newest)"
          // Ideally this pushes content down, moving the orphan header to next page.
          
          // 1. Identify Donor (Last Job with > 3 bullets)
          let donorIndex = -1;
          for (let j = numJobs - 1; j >= 0; j--) {
              if (currentConfig[j] > 3) { // Keep min 3
                  donorIndex = j;
                  break;
              }
          }
          
          // 2. Identify Receiver (First Job with room)
          // Actually, we want to add BEFORE the orphan. 
          // Adding to Job 0 is safest to push everyone down.
          let receiverIndex = -1;
          for (let j = 0; j < orphanJobIndex; j++) {
              if (currentConfig[j] < (bulletsByJob[j]?.length || 0)) {
                  receiverIndex = j;
                  break;
              }
          }
           
          // Execute Swap
          if (donorIndex !== -1 && receiverIndex !== -1) {
              currentConfig[donorIndex]--;
              currentConfig[receiverIndex]++;
              console.log(`   -> Swapped: -Job${donorIndex} / +Job${receiverIndex}. New: [${currentConfig}]`);
          } else {
              // Swap Failed (No donor or No receiver)
              // Fallback: Just Pull Up? (Remove from Predecessor of Orphan)
              // "Reduce a point on the second work experience" (assuming orphan is 2nd or 3rd)
              // Try to reduce the job immediately before the orphan
              const prevJob = orphanJobIndex - 1;
              if (prevJob >= 0 && currentConfig[prevJob] > 3) {
                   currentConfig[prevJob]--;
                   console.log(`   -> Swap Failed. Fallback: Reduced Job${prevJob} to Pull Up. New: [${currentConfig}]`);
              } else {
                   console.warn("   -> Cannot Fix Orphan. Constraints reached.");
                   break;
              }
          }
      }

      // E. Render Final
      console.log(`[Solver] Final Optimized Config: [${currentConfig}]`);
      const finalOps: RenderOptions = { jobConfig: currentConfig, maxSkillItems: currentConfig[0] + 2 };
      const finalHtml = this.generateHTML(data, finalOps);
      // await page.setContent(finalHtml, { waitUntil: 'load' }); // Done by caller logic steps
      
      // Inject CSS Adjustments (adjustLayoutDensity)
      // We return the content string, but we need to apply density tweaks first.
      // So we must setContent here.
      await page.setContent(finalHtml, { waitUntil: 'load' });
      await this.adjustLayoutDensity(page); // Final Polish
      await this.applySmartPageBreaks(page); // Final Breaks
      
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


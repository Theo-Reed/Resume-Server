import puppeteer, { Browser, Page } from 'puppeteer';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { ResumeData } from './types';

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
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
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
      items.push(contact.email);
    }
    if (contact.wechat) {
      items.push(contact.wechat);
    }
    if (contact.phone) {
      items.push(contact.phone);
    }
    items.push(`${yearsOfExperience}年经验`);
    
    return items.join(' | ');
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
  private formatProfessionalSkills(skills?: ResumeData['professionalSkills']): string {
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
        
        html += category.items
          .map((item) => `<div class="skill-item">${this.formatText(item)}</div>`)
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
  private formatWorkExperience(workExperience: ResumeData['workExperience']): string {
    return workExperience
      .map((work) => {
        let html = `
          <div class="work-item">
            <div class="work-header">
              <div class="company-position">
                <span class="company">${this.escapeHtml(work.company)}</span>
                <span class="work-position"> - ${this.escapeHtml(work.position)}</span>
              </div>
              <span class="work-date">${this.escapeHtml(work.startDate)} - ${this.escapeHtml(work.endDate)}</span>
            </div>
        `;
        
        if (work.responsibilities && work.responsibilities.length > 0) {
          html += '<div class="responsibilities">';
          html += work.responsibilities
            .map((resp) => `<div class="responsibility-item">${this.formatText(resp)}</div>`)
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
   * 检测孤儿元素（标题在上一页，内容在下一页）
   */
  private async detectOrphans(page: Page): Promise<Array<{
    element: string;
    headerPage: number;
    contentPage: number;
    moveDistance: number;
    headerHeight: number;
    firstLineHeight: number;
  }>> {
    return (await page.evaluate(`
      (function() {
        const pageHeight = 1123; // A4 高度
        const orphans = [];
        
        // 检测工作经历项
        const workItems = document.querySelectorAll('.work-item');
        
        workItems.forEach(function(item) {
          const header = item.querySelector('.work-header');
          const responsibilities = item.querySelector('.responsibilities');
          
          if (!header || !responsibilities) return;
          
          const headerRect = header.getBoundingClientRect();
          const responsibilitiesRect = responsibilities.getBoundingClientRect();
          
          // 判断：标题在上一页，内容在下一页
          const headerPage = Math.floor(headerRect.top / pageHeight);
          const contentPage = Math.floor(responsibilitiesRect.top / pageHeight);
          
          if (headerPage < contentPage) {
            // 计算需要移动的距离（让标题移到下一页）
            const nextPageTop = (headerPage + 1) * pageHeight;
            const moveDistance = responsibilitiesRect.top - nextPageTop;
            
            // 获取第一行内容的高度
            const firstLine = responsibilities.querySelector('.responsibility-item');
            const firstLineHeight = firstLine 
              ? firstLine.getBoundingClientRect().height 
              : 0;
            
            orphans.push({
              element: item.className,
              headerPage: headerPage,
              contentPage: contentPage,
              moveDistance: moveDistance,
              headerHeight: headerRect.height,
              firstLineHeight: firstLineHeight
            });
          }
        });
        
        return orphans;
      })();
    `)) as Array<{
      element: string;
      headerPage: number;
      contentPage: number;
      moveDistance: number;
      headerHeight: number;
      firstLineHeight: number;
    }>;
  }

  /**
   * 计算行高调整
   */
  private calculateLineHeightAdjustment(
    orphan: { moveDistance: number; headerHeight: number; firstLineHeight: number },
    bottomSpace: number,
    minLineHeight: number,
    maxLineHeight: number,
    currentLineHeight: number,
    estimatedLines: number
  ): { canOptimize: boolean; newLineHeight?: number; delta?: number } {
    const { moveDistance, headerHeight, firstLineHeight } = orphan;
    
    // 检查第二页底部空间是否足够容纳标题和第一行
    if (bottomSpace < (headerHeight + firstLineHeight)) {
      return { canOptimize: false };
    }
    
    // 计算需要增加的行高
    // 假设文档有 N 行，增加行高 delta，总高度增加 ≈ N * delta
    // 我们需要：N * delta >= moveDistance
    const requiredDelta = moveDistance / estimatedLines;
    const newLineHeight = currentLineHeight + requiredDelta;
    
    // 检查是否在允许范围内
    if (newLineHeight >= minLineHeight && newLineHeight <= maxLineHeight) {
      return {
        canOptimize: true,
        newLineHeight,
        delta: requiredDelta
      };
    }
    
    return { canOptimize: false };
  }

  /**
   * 应用智能分页优化
   */
  private async applySmartPagination(page: Page): Promise<void> {
    try {
      // 1. 检测孤儿元素和底部空白
      const orphans = await this.detectOrphans(page);
      
      if (orphans.length === 0) {
        return; // 没有孤儿，不需要优化
      }
      
      const bottomSpaces = await this.detectBottomSpace(page);
      
      // 2. 获取当前行高和估算行数
      const { currentLineHeight, estimatedLines } = (await page.evaluate(`
        (function() {
          const body = document.body;
          const computedStyle = window.getComputedStyle(body);
          const lineHeight = parseFloat(computedStyle.lineHeight);
          const totalHeight = document.body.scrollHeight;
          const estimatedLines = totalHeight / lineHeight;
          
          return {
            currentLineHeight: lineHeight,
            estimatedLines: estimatedLines
          };
        })();
      `)) as { currentLineHeight: number; estimatedLines: number };
      
      // 3. 对每个孤儿进行判断
      const optimizations: Array<{ newLineHeight: number; delta: number }> = [];
      const minLineHeight = 1.4;
      const maxLineHeight = 2.0;
      const bottomSpaceThreshold = 60; // 底部空白阈值（像素）
      
      for (const orphan of orphans) {
        const bottomSpace = bottomSpaces[orphan.contentPage]?.bottomSpace || 0;
        
        // 只处理底部空白大于阈值的情况
        if (bottomSpace < bottomSpaceThreshold) {
          continue;
        }
        
        const adjustment = this.calculateLineHeightAdjustment(
          orphan,
          bottomSpace,
          minLineHeight,
          maxLineHeight,
          currentLineHeight,
          estimatedLines
        );
        
        if (adjustment.canOptimize && adjustment.newLineHeight && adjustment.delta) {
          optimizations.push({
            newLineHeight: adjustment.newLineHeight,
            delta: adjustment.delta
          });
        }
      }
      
      // 4. 如果有多处可优化，取最小的 delta（保守策略，避免过度调整）
      if (optimizations.length > 0) {
        const minDelta = Math.min(...optimizations.map(o => o.delta));
        const newLineHeight = currentLineHeight + minDelta;
        
        // 确保在允许范围内
        const finalLineHeight = Math.max(minLineHeight, Math.min(maxLineHeight, newLineHeight));
        
        // 5. 应用行高调整
        await page.evaluate(`
          (function(lineHeight) {
            // 调整主要内容的行高
            const style = document.createElement('style');
            style.textContent = 'body { line-height: ' + lineHeight + ' !important; } ' +
              '.work-item, .education-item, .skill-category { line-height: ' + lineHeight + ' !important; } ' +
              '.responsibility-item, .skill-item { line-height: ' + lineHeight + ' !important; }';
            document.head.appendChild(style);
          })(${finalLineHeight});
        `);
        
        // 6. 等待重新渲染
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (error) {
      // 如果优化失败，不影响PDF生成，只记录警告
      console.warn('智能分页优化失败，继续生成PDF:', error);
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
  private generateHTML(data: ResumeData): string {
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
    html = html.replace('{{PROFESSIONAL_SKILLS}}', this.formatProfessionalSkills(data.professionalSkills));
    html = html.replace('{{WORK_EXPERIENCE}}', this.formatWorkExperience(data.workExperience));
    html = html.replace('{{CERTIFICATES}}', this.formatCertificates(data.certificates));
    
    return html;
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
    const html = this.generateHTML(data);

    try {
      await page.setContent(html, { waitUntil: 'networkidle0' });
      
      // 应用智能分页优化
      await this.applySmartPagination(page);
      
      // 检查头像图片是否可以加载，如果失败则隐藏
      if (data.avatar) {
        try {
          // 使用字符串形式的代码，在浏览器环境中执行
          await page.evaluate(`
            (function() {
              return new Promise(function(resolve) {
                const img = document.querySelector('.avatar');
                if (!img) {
                  resolve();
                  return;
                }
                
                const timeout = setTimeout(function() {
                  if (!img.complete || img.naturalHeight === 0) {
                    img.style.display = 'none';
                    const container = img.parentElement;
                    if (container) {
                      container.style.display = 'none';
                    }
                  }
                  resolve();
                }, 5000);
                
                if (img.complete && img.naturalHeight > 0) {
                  clearTimeout(timeout);
                  resolve();
                } else {
                  img.onload = function() {
                    clearTimeout(timeout);
                    resolve();
                  };
                  img.onerror = function() {
                    clearTimeout(timeout);
                    img.style.display = 'none';
                    const container = img.parentElement;
                    if (container) {
                      container.style.display = 'none';
                    }
                    resolve();
                  };
                }
              });
            })();
          `);
          
          // 等待一下，确保图片加载或错误处理完成
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          // 如果检查失败，继续生成 PDF（不显示头像）
          console.warn('头像加载检查失败，将不显示头像:', error);
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
        // 将 Uint8Array 转换为 Buffer
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


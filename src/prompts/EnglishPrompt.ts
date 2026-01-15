import { PromptContext } from './types';

export function generateEnglishPrompt(context: PromptContext): string {
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

  const experienceRequirementStr = requiredExp.max !== 999 
    ? `${requiredExp.min} years (maximum ${requiredExp.max} years)` 
    : `at least ${requiredExp.min} years`;

  return `
You are a world-class resume expert specializing in tailoring profiles for English-speaking job markets. Your core principle is: 【Tailor Everything to the Target Job】.

### 🚨 Core Instructions (Must be Strictly Followed)
1. **Target Position Lock**: The generated resume's \`position\` MUST be exactly: "${targetTitle}".
2. **Remove Irrelevant Background**: If the user's original background clashes with "${targetTitle}", you MUST 【completely remove】 irrelevant tech stacks or business domains from the responsibilities.
3. **Experience Reshaping**:
   - **⚠️ CRITICAL: Existing Company Names MUST remain unchanged** (User-provided names like "Tencent", "Xiaomi" etc. must be kept exactly as is).
   - Keep timeframes unchanged. Rewrite job titles and responsibilities based on "business direction" to highly match "${targetTitle}".
   - **SENIORITY GUIDELINES**:
     - **"Senior" / "Staff" Usage**:
       * Job Requirement: ${job.experience} (${experienceRequirementStr})
       * ${requiredExp.min <= 5 ? '**STRICTLY FORBIDDEN to use "Senior", "Lead", "Staff"** titles (as requirement is ≤ 5 years).' : 'You may consider "Senior", but be cautious with "Staff" or "Lead" unless experience > 5 years.'}
     - **Leadership Experience**:
       * After 3 years of work, consider if "Team Lead" experience is appropriate based on the job.
       * If the target job requires management (mentions "team management", "leading team", etc.), add management roles after the 3-year mark.
       * First leadership role should be small scale (5-10 people).
       * Examples: "Team Lead", "Head of XX Team", "Squad Lead".

### 1. Target Job Information
- **Position**: ${targetTitle}
- **Description**: ${job.description_english || job.description}
- **Requirement**: ${job.experience} (Min: ${requiredExp.min} years)

### 2. User Background
- **Name**: ${profile.name}
- **Original Skills (Reference)**: ${profile.skills.join(', ')}
- **AI Instruction**: ${profile.aiMessage}
- **Earliest Start Date**: ${earliestWorkDate} (Cannot be earlier than this)

### 3. Work Experience Analysis
- **Actual Experience**: ${actualExperienceText} (${totalMonths} months)
- **Required Experience**: ${job.experience} (Min ${requiredExp.min} years)
- **Needs Supplement?**: ${needsSupplement ? 'Yes' : 'No'} ${needsSupplement ? `(Needs approx. ${supplementYears} years more)` : ''}

### 4. Work Experience Supplement Rules (${needsSupplement ? 'MUST EXECUTE' : 'SKIP'})
${needsSupplement ? `
**Actual experience is insufficient. You MUST generate supplemental experience:**

**Total years to add**: ${supplementYears} years

**Specific Time Segments for Supplement (Follow Strictly):**
${supplementSegments.map((seg, idx) => `
Supplement ${idx + 1}:
- Period: ${seg.startDate} to ${seg.endDate} (${seg.years} years)
- Company Name: Generate a realistic English studio/company name fitting the "${targetTitle}" domain.
  * Tech/Dev: "Creative Tech Studio", "CloudCode Labs", "NextGen Solutions"
  * Operations/E-commerce: "Global Choice Studio", "Digital Growth Agency"
  * Product: "Product Innovation Lab", "UX Pioneer Studio"
  * Web3: "Chain Innovation Lab", "Digital Asset Studio"
  * Guideline: Sound natural, western-style, not overly "AI-generated".
- Position: Flexible based on "${targetTitle}":
  * If job title is clear ("Product Manager"), use it or variations ("Product Associate").
  * Ensure seniority matches the experience level at that time (Junior for early career).
- Content: Focus on core responsibilities of "${targetTitle}" appropriate for a ${seg.years}-year experience level.
`).join('\n')}

**⚠️ Global Timeline (Reverse Chronological - Newest First):**
${allWorkExperiences.map((exp, idx) => {
  if (exp.type === 'existing') {
    const origExp = profile.workExperiences[exp.index!];
    return `${idx + 1}. [Existing] ${origExp.company} - ${origExp.startDate} to ${origExp.endDate}`;
  } else {
    return `${idx + 1}. [Supplement] [Generate Studio Name] - ${exp.startDate} to ${exp.endDate}`;
  }
}).join('\n')}

**Supplement Rules Explanation:**
1. **Strictly follow time segments**.
2. **Company Names**: English style, realistic studio/agency names.
3. **No Overlaps**: Must fit into the gaps.
4. **Position Names**: Natural progression.
5. **Timeline Order**: Newest on top, oldest at bottom. Insert supplements correctly into the timeline.
` : 'Actual experience meets requirements. No supplement needed.'}

### 5. Existing Work Experience (Reshape based on Business Direction)
**⚠️ CRITICAL: Company names MUST remain unchanged** (keep originals like "${profile.workExperiences[0]?.company || 'Huya'}").

${profile.workExperiences.map((exp, i) => `
Experience ${i + 1}:
- Company: ${exp.company} (DO NOT CHANGE)
- Original Title: ${exp.jobTitle}
- Business Direction: ${exp.businessDirection}
- Time: ${exp.startDate} to ${exp.endDate} (DO NOT CHANGE)
`).join('\n')}

### 6. Tasks
1. **Experience Years**: Final \`yearsOfExperience\` should ${needsSupplement ? `match required ${requiredExp.min} years` : 'equal actual years'}.
2. **Sorting**: ${needsSupplement ? `Strictly follow the generated timeline (newest first). Insert supplements in correct chronological spots.` : 'Sort existing experiences reverse-chronologically.'}
3. **Titles & Seniority**:
   - Strictly follow the SENIORITY GUIDELINES defined above.
4. **Personal Introduction**: Professional summary in the style of LinkedIn "About" section. First person.
5. **Professional Skills**: 4 categories, 4 items each.
   - **Principle**: Base skills on ${targetTitle} requirements. You may IGNORE user's original skills if irrelevant.
6. **Responsibility Description (Crucial)**:
   - 4-6 bullets per role.
   - **Start with STRONG ACTION VERBS** (e.g., Spearheaded, Orchestrated, Engineered, Analyzed, Revamped). 
   - **Avoid Weak Verbs**: Avoid "Responsible for", "Helped with", "Assisted".
   - **Quantifiable Results**: MUST use numbers, percentages, metrics.
   - **STAR Method**: Situation, Task, Action, Result.
   - **Examples**:
     * ✅ "Engineered core optimization reducing latency from 500ms to 200ms (+60%), supporting 3x DAU growth."
     * ✅ "Spearheaded 0-to-1 project architecture, driven 200% user growth to 300k DAU."
     * ❌ "Responsible for system optimization." (Too weak)
   - Ensure the user sounds like a **Key Contributor**, not just a participant.
7. **Formatting**: Use <b> for key metrics, <u> for emphasis (3-4 times each).

### 7. Output Format (Pure JSON)
{
  "position": "${targetTitle}",
  "yearsOfExperience": ${needsSupplement ? requiredExp.min : actualYears},
  "personalIntroduction": "...",
  "professionalSkills": [{ "title": "Category", "items": [...] }],
  "workExperience": [
    ${needsSupplement ? `// Follow the timeline strictly
    // Example order:
${allWorkExperiences.map((exp, idx) => {
  if (exp.type === 'existing') {
    const origExp = profile.workExperiences[exp.index!];
    return `    // ${idx + 1}. [Existing] ${origExp.company}`;
  } else {
    return `    // ${idx + 1}. [Supplement] [Studio Name]`;
  }
}).join('\n')}
    // Output objects:
    { "company": "[Original Name - DO NOT CHANGE]", "position": "Tailored Title", "startDate": "...", "endDate": "...", "responsibilities": [...] },
    { "company": "[Generated Studio Name]", "position": "Generated Title", "startDate": "...", "endDate": "...", "responsibilities": [...] },
    ` : `// Reshaped existing experiences
    { "company": "[Original Name - DO NOT CHANGE]", "position": "Tailored Title", "startDate": "...", "endDate": "...", "responsibilities": [...] }`}
  ]
}

**⚠️ Key Requirements:**
- **Company names, start/end dates of EXISTING jobs must be preserved exactly.**
- Output strictly in **English**.
`;
}

import { UserResumeProfile as ResumeProfile, JobData } from "../types";

export interface ExperienceCalculationResult {
    actualYears: number;
    actualExperienceText: string;
    totalMonths: number;
    requiredExp: { min: number; max: number };
    needsSupplement: boolean;
    supplementYears: number;
    finalTotalYears: number;
    supplementSegments: Array<{ startDate: string; endDate: string; years: number }>;
    allWorkExperiences: Array<{ startDate: string; endDate: string; type: 'existing' | 'supplement'; index?: number }>;
    earliestWorkDate: string;
    seniorityThresholdDate?: string; // e.g. "2030-01" - limit for Senior/Manager titles
}

export class ExperienceCalculator {
    public static calculate(profile: ResumeProfile, job: JobData): ExperienceCalculationResult {
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;
        const nowStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;

        // 1. Analyze Education & Constraints
        let careerConstraintDate = "2000-01"; // Earliest possible work start (Prepend limit)
        let graduationDateStr = "";

        // Sort educations to find Start and Graduation
        const sortedEdus = [...(profile.educations || [])].sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
        
        if (sortedEdus.length > 0) {
            // Career Start constraint: University Start Date (first one)
            if (sortedEdus[0].startDate) careerConstraintDate = sortedEdus[0].startDate;
            
            // Graduation Date: End Date of the first completed degree (usually Bachelor)
            // Heuristic: Use the first one that has a valid end date
            if (sortedEdus[0].endDate && sortedEdus[0].endDate !== '至今') {
                graduationDateStr = sortedEdus[0].endDate;
            } else if (sortedEdus.length > 1 && sortedEdus[1].endDate && sortedEdus[1].endDate !== '至今') {
                graduationDateStr = sortedEdus[1].endDate;
            }
        } 
        
        // Fallback constraint if no education but birthday exists (e.g. 18yo)
        if (!sortedEdus.length && profile.birthday) {
             const birthYear = parseInt(profile.birthday.split('-')[0] || "2000");
             careerConstraintDate = `${birthYear + 18}-01`;
        }

        // Calculate Seniority Threshold (Grad + 4y)
        // Rule: Manager/Expert titles only allowed after this date
        let seniorityThresholdDate: string | undefined;
        if (graduationDateStr) {
            const parts = graduationDateStr.split('-');
            const y = parseInt(parts[0]) + 4;
            const m = parseInt(parts[1] || '06');
            seniorityThresholdDate = `${y}-${String(m).padStart(2, '0')}`;
        }

        // 2. Parse Existing Experiences
        const existingExps = (profile.workExperiences || []).map((exp, idx) => {
            const endVal = exp.endDate === '至今' ? nowStr : exp.endDate;
            return {
                ...exp,
                originalIndex: idx,
                startUnix: new Date((exp.startDate || '2099-01') + '-01').getTime(),
                endUnix: new Date((endVal || '1970-01') + '-01').getTime(),
                startDateNormalized: exp.startDate,
                endDateNormalized: endVal
            };
        }).sort((a, b) => a.startUnix - b.startUnix);

        // 实际年限口径：用户第一段工作开始 -> 用户最后一段工作结束（非从毕业算）
        let actualYears = 0;
        let actualExperienceText = '0年';
        let totalMonths = 0;
        if (existingExps.length > 0) {
            const firstStart = existingExps[0].startDateNormalized;
            const lastEnd = existingExps[existingExps.length - 1].endDateNormalized;
            actualYears = this.calcYears(firstStart, lastEnd);
            actualExperienceText = `${actualYears}年`;
            totalMonths = Math.floor(actualYears * 12);
        }

        const supplementSegments: Array<{ startDate: string; endDate: string; years: number }> = [];
        let finalSupplementYears = 0;

        // 3. Logic Branching
        if (existingExps.length === 0) {
            // --- Case 0: No Experience ---
            // Rule: Supplement based on job requirements, max 2 years per segment.
            const reqMin = this.parseExperienceRequirement(job.experience).min || 1; 
            
            // Calculate target Start Time
            let targetStart = new Date(nowStr + '-01');
            targetStart.setFullYear(targetStart.getFullYear() - reqMin);

            // Enforce Constraint
            const constraint = new Date(careerConstraintDate + '-01');
            if (targetStart < constraint) targetStart = constraint;

            // Generate chunks from targetStart to Now
            let cursor = new Date(targetStart);
            const nowTime = new Date(nowStr + '-01').getTime();

            // Safety loop limit
            let loopLimit = 0;
            while (cursor.getTime() < nowTime && loopLimit < 10) {
                loopLimit++;
                // Max 2 years per segment
                let end = new Date(cursor);
                end.setFullYear(end.getFullYear() + 2);
                
                // Cap at now
                if (end.getTime() > nowTime) {
                    end = new Date(nowTime);
                } 

                const sStr = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
                // Avoid overlap if making multiple? 
                // Let's assume contiguous.
                // End date is inclusive in visualization usually.
                // Next start is next month.
                
                // However, calcYears logic uses diff.
                // Let's set end date of *this segment*.
                const eStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}`;
                
                const y = this.calcYears(sStr, eStr);
                if (y > 0) {
                    supplementSegments.push({ startDate: sStr, endDate: eStr, years: y });
                }

                // Advance cursor for next segment
                cursor = new Date(end);
                // cursor.setMonth(cursor.getMonth() + 1); // If we want gap? No, continuous.
                // If continuous, next start is same as this end? No, next month.
                // If i worked until 2022-01, next job starts 2022-02.
                // But if I split one big 4y block into two 2y blocks?
                // Job A: 2020-01 to 2022-01. Job B: 2022-01 to 2024-01?
                // Overlap 1 month is fine for logic usually.
            }
        } else {
            // --- User Has Experience ---

            // 3.1 Intermediate Gaps (Rule 2.1: Gap >= 6 months)
            for (let i = 0; i < existingExps.length - 1; i++) {
                const curr = existingExps[i];
                const next = existingExps[i+1];
                
                // Gap between curr.end and next.start
                // Gap starts curr.end + 1 month
                // Gap ends next.start - 1 month
                const gapStart = new Date(curr.endUnix);
                gapStart.setMonth(gapStart.getMonth() + 1);
                
                const gapEnd = new Date(next.startUnix);
                gapEnd.setMonth(gapEnd.getMonth() - 1);

                const gapMonths = (gapEnd.getTime() - gapStart.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
                
                if (gapMonths >= 6) { // Half year
                    const sStr = `${gapStart.getFullYear()}-${String(gapStart.getMonth() + 1).padStart(2, '0')}`;
                    const eStr = `${gapEnd.getFullYear()}-${String(gapEnd.getMonth() + 1).padStart(2, '0')}`;
                    const y = this.calcYears(sStr, eStr);
                    supplementSegments.push({ startDate: sStr, endDate: eStr, years: y });
                    console.log('[ExperienceCalculator] supplement-added-middle-gap:', {
                        between: {
                            prevJob: `${curr.startDateNormalized} -> ${curr.endDateNormalized}`,
                            nextJob: `${next.startDateNormalized} -> ${next.endDateNormalized}`,
                        },
                        gapStart: sStr,
                        gapEnd: eStr,
                        gapMonths: Math.round(gapMonths * 10) / 10,
                        years: y,
                    });
                }
            }

            // 3.2 Trailing Gap (Rule 2.2: Last -> Now >= 6 months)
            const last = existingExps[existingExps.length - 1];
            // Gap starts last.end + 1 month
            const trailingStart = new Date(last.endUnix);
            trailingStart.setMonth(trailingStart.getMonth() + 1);
            
            // Gap ends Now
            const trailingEnd = new Date(nowStr + '-01');
            
            const trailingGapMonths = (trailingEnd.getTime() - trailingStart.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
            
            if (trailingGapMonths >= 6) {
                const sStr = `${trailingStart.getFullYear()}-${String(trailingStart.getMonth() + 1).padStart(2, '0')}`;
                const eStr = nowStr; 
                const y = this.calcYears(sStr, eStr);
                supplementSegments.push({ startDate: sStr, endDate: eStr, years: y });
                console.log('[ExperienceCalculator] supplement-added-trailing-gap:', {
                    lastJob: `${last.startDateNormalized} -> ${last.endDateNormalized}`,
                    gapStart: sStr,
                    gapEnd: eStr,
                    gapMonths: Math.round(trailingGapMonths * 10) / 10,
                    years: y,
                });
            }

            // 3.3 Prepend (Rule 2.3 & 2.4)
            // 按需求口径：若补完空档后，目标年限仍大于“第一段工作开始 -> 今天”的跨度，则从第一段之前补
            const firstExistingStart = new Date(existingExps[0].startUnix);
            const firstExistingStartStr = `${firstExistingStart.getFullYear()}-${String(firstExistingStart.getMonth() + 1).padStart(2, '0')}`;
            const totalSpanYears = this.calcYears(firstExistingStartStr, nowStr);

            const reqMin = this.parseExperienceRequirement(job.experience).min || 0;

            console.log('[ExperienceCalculator] prepend-check:', {
                reqMin,
                firstExistingStart: firstExistingStartStr,
                now: nowStr,
                totalSpanYears,
                threshold: reqMin > 0 ? reqMin - 0.05 : reqMin,
                willPrepend: reqMin > 0 && totalSpanYears + 0.05 < reqMin,
            });

            if (reqMin > 0 && totalSpanYears + 0.05 < reqMin) {
                // Rule 2.3: Need to prepend
                const missingYears = reqMin - totalSpanYears;
                
                // Calculate Prepend Start
                let prependStart = new Date(firstExistingStart);
                prependStart.setMonth(prependStart.getMonth() - Math.ceil(missingYears * 12));
                
                // Apply Constraint (Uni Start / 18yo)
                const constraint = new Date(careerConstraintDate + '-01');
                if (prependStart < constraint) {
                    prependStart = constraint;
                }

                // Prepend End = First Existing Start - 1 month
                const prependEnd = new Date(firstExistingStart);
                prependEnd.setMonth(prependEnd.getMonth() - 1);

                if (prependStart < prependEnd) {
                    const sStr = `${prependStart.getFullYear()}-${String(prependStart.getMonth() + 1).padStart(2, '0')}`;
                    const eStr = `${prependEnd.getFullYear()}-${String(prependEnd.getMonth() + 1).padStart(2, '0')}`;
                    const y = this.calcYears(sStr, eStr);
                    supplementSegments.push({ startDate: sStr, endDate: eStr, years: y });
                    console.log('[ExperienceCalculator] prepend-added:', {
                        start: sStr,
                        end: eStr,
                        years: y,
                        missingYears,
                    });
                } else {
                    console.log('[ExperienceCalculator] prepend-skipped-invalid-range:', {
                        prependStart: `${prependStart.getFullYear()}-${String(prependStart.getMonth() + 1).padStart(2, '0')}`,
                        prependEnd: `${prependEnd.getFullYear()}-${String(prependEnd.getMonth() + 1).padStart(2, '0')}`,
                        careerConstraintDate,
                    });
                }
            }
        }

        console.log('[ExperienceCalculator] supplement-segments-summary:', {
            count: supplementSegments.length,
            segments: supplementSegments.map(seg => ({
                start: seg.startDate,
                end: seg.endDate,
                years: seg.years,
            })),
        });

        // 4. Build Result
        const allWorkExperiences: Array<{ startDate: string; endDate: string; type: 'existing' | 'supplement'; index?: number }> = [];

        existingExps.forEach(exp => {
            allWorkExperiences.push({
                startDate: exp.startDate,
                endDate: exp.endDate,
                type: 'existing',
                index: exp.originalIndex
            });
        });
        
        supplementSegments.forEach(seg => {
            allWorkExperiences.push({
                startDate: seg.startDate,
                endDate: seg.endDate,
                type: 'supplement'
            });
        });
        
        // Sort: Newest First
        allWorkExperiences.sort((a, b) => {
            const dateA = new Date(a.startDate + '-01').getTime();
            const dateB = new Date(b.startDate + '-01').getTime();
            return dateB - dateA; // Descending
        });

        // Final Total Years Calculation: Earliest of ALL starts -> Now
        let finalEarliest = Infinity;
        allWorkExperiences.forEach(exp => {
            const d = new Date(exp.startDate + '-01').getTime();
            if (d < finalEarliest) finalEarliest = d;
        });

        let finalTotalYears = 0;
        if (finalEarliest !== Infinity) {
             const diff = now.getTime() - finalEarliest;
             finalTotalYears = Math.floor(diff / (1000 * 60 * 60 * 24 * 365) * 10) / 10;
        }

        finalSupplementYears = supplementSegments.reduce((acc, cur) => acc + cur.years, 0);

        return {
            actualYears,
            actualExperienceText,
            totalMonths,
            requiredExp: this.parseExperienceRequirement(job.experience),
            needsSupplement: supplementSegments.length > 0,
            supplementYears: finalSupplementYears,
            finalTotalYears,
            supplementSegments,
            allWorkExperiences,
            earliestWorkDate: careerConstraintDate,
            seniorityThresholdDate
        };
    }

    private static parseExperienceRequirement(req: string): { min: number; max: number } {
        if (!req || req === '经验不限' || req === '不限' || req.toLowerCase().includes('limit')) {
            return { min: 0, max: 999 };
        }
        const rangeMatch = req.match(/(\d+)\s*-\s*(\d+)/);
        if (rangeMatch) return { min: parseInt(rangeMatch[1]), max: parseInt(rangeMatch[2]) };

        const plusMatch = req.match(/(\d+)\s*(年以上|\+)/);
        if (plusMatch) return { min: parseInt(plusMatch[1]), max: 999 };

        const singleMatch = req.match(/(\d+)/);
        if (singleMatch) {
            const val = parseInt(singleMatch[1]);
            return { min: val, max: val };
        }
        return { min: 0, max: 999 };
    }

    private static calcYears(start: string, end: string): number {
        const s = new Date(start + '-01');
        const e = new Date(end + '-01');
        const diffM = (e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
        return Math.max(0, Math.round(diffM / 12 * 10) / 10);
    }
}

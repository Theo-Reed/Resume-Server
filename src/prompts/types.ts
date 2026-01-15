import { JobData, UserResumeProfile } from '../types';

export interface PromptContext {
  targetTitle: string;
  job: JobData;
  requiredExp: { min: number; max: number };
  profile: UserResumeProfile;
  earliestWorkDate: string;
  actualExperienceText: string;
  totalMonths: number;
  needsSupplement: boolean;
  actualYears: number;
  supplementYears: number;
  supplementSegments: Array<{ startDate: string; endDate: string; years: number }>;
  allWorkExperiences: Array<{ startDate: string; endDate: string; type: 'existing' | 'supplement'; index?: number }>;
}

export type SkillLibraryKind = 'skill' | 'design' | 'writing';
export type WritingStyleType = 'persona' | 'author' | 'prose';

export interface SkillLibraryItem {
  id: string;
  baseName: string;
  name: string;
  description: string;
  allowedTools?: string[];
  model?: string;
  dirPath: string;
  source: 'user' | 'project';
  enabled: boolean;
  libraryKind: SkillLibraryKind;
  writingStyleType?: WritingStyleType;
}

export interface StyleLibraryResponse {
  designStyles: SkillLibraryItem[];
  writingStyles: SkillLibraryItem[];
}

export interface SessionStyleSelection {
  designStyleSkill: string | null;
  writingStyleSkill: string | null;
}

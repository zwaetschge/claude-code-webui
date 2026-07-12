export type SkillLibraryKind = 'skill' | 'design' | 'writing';
export type WritingStyleType = 'persona' | 'author' | 'prose';

export type DesignMdScalar = string | number | boolean;

export interface DesignMdTokens {
  colors: Record<string, string>;
  typography: Record<string, Record<string, DesignMdScalar>>;
  rounded: Record<string, DesignMdScalar>;
  spacing: Record<string, DesignMdScalar>;
  components: Record<string, Record<string, DesignMdScalar>>;
  extensions: Record<string, unknown>;
}

export interface DesignMdSummary {
  name: string;
  description?: string;
  version?: string;
  tokens: DesignMdTokens;
  sections: string[];
  errors: Array<{ code: string; message: string; path?: string }>;
  warnings: Array<{ code: string; message: string; path?: string }>;
}

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
  designMd?: DesignMdSummary;
}

export interface StyleLibraryResponse {
  designStyles: SkillLibraryItem[];
  writingStyles: SkillLibraryItem[];
}

export interface SessionStyleSelection {
  designStyleSkill: string | null;
  writingStyleSkill: string | null;
}

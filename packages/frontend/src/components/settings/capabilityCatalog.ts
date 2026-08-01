export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  filePath: string;
  source: 'user' | 'project';
  enabled: boolean;
}

export interface SkillInfo {
  id: string;
  baseName: string;
  name: string;
  description: string;
  allowedTools?: string[];
  model?: string;
  dirPath: string;
  source: 'user' | 'project';
  enabled: boolean;
  libraryKind: 'skill' | 'design' | 'writing';
  entryType?: 'skill' | 'style';
  aliases?: string[];
}

export type SkillStatusFilter = 'all' | 'active' | 'on-demand';

export function filterAgents(agents: AgentInfo[] | undefined, searchQuery: string): AgentInfo[] {
  const query = searchQuery.trim().toLowerCase();
  if (!query) return agents || [];

  return (agents || []).filter((agent) =>
    [agent.name, agent.description, agent.model, ...(agent.tools || [])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(query)
  );
}

export function filterSkills(
  skills: SkillInfo[] | undefined,
  searchQuery: string,
  statusFilter: SkillStatusFilter
): SkillInfo[] {
  const query = searchQuery.trim().toLowerCase();

  return (skills || []).filter((skill) => {
    if (statusFilter === 'active' && !skill.enabled) return false;
    if (statusFilter === 'on-demand' && skill.enabled) return false;
    if (!query) return true;

    return [
      skill.name,
      skill.baseName,
      skill.description,
      skill.libraryKind,
      ...(skill.aliases || []),
    ]
      .join(' ')
      .toLowerCase()
      .includes(query);
  });
}

export function getSkillCatalogCounts(skills: SkillInfo[] | undefined) {
  return (skills || []).reduce(
    (counts, skill) => {
      if (skill.enabled) counts.activeSkillCount += 1;
      if (skill.entryType === 'style') counts.stylePresetCount += 1;
      else counts.skillPackageCount += 1;
      return counts;
    },
    {
      activeSkillCount: 0,
      skillPackageCount: 0,
      stylePresetCount: 0,
    }
  );
}

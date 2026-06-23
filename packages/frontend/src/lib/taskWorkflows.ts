export type TaskWorkflow = {
  id: string;
  title: string;
  shortTitle: string;
  description: string;
  meta: string;
  prompt: string;
};

export const TASK_WORKFLOWS: TaskWorkflow[] = [
  {
    id: 'quick-brief',
    title: 'Create a clear brief',
    shortTitle: 'Clear brief',
    description: 'Summarize text, files, links, or notes into the points that matter.',
    meta: 'summarize -> clarify -> next steps',
    prompt:
      'Create a clear brief from the material I provide. Read the text, files, links, or notes first, then summarize the essential points in plain language. Separate facts from assumptions, call out decisions, risks, open questions, and next steps, and keep the result concise enough to act on.',
  },
  {
    id: 'research-brief',
    title: 'Research a topic',
    shortTitle: 'Research brief',
    description: 'Gather context, compare sources, and return a practical answer.',
    meta: 'question -> sources -> answer',
    prompt:
      'Research the topic or question I provide and turn it into a practical brief. Start by clarifying the exact question if needed, use current external sources when the answer may have changed, compare the most relevant viewpoints or options, include source links, and finish with a direct answer, caveats, and useful next steps.',
  },
  {
    id: 'draft-message',
    title: 'Draft a message',
    shortTitle: 'Draft message',
    description: 'Write emails, replies, announcements, posts, or polished notes.',
    meta: 'intent -> tone -> final draft',
    prompt:
      'Help me draft the message I need. Ask for missing audience, goal, tone, or constraints only if they are necessary. Otherwise produce a polished version, keep it natural and specific, and include two shorter alternatives when useful: one warmer and one more direct.',
  },
  {
    id: 'plan-project',
    title: 'Plan a project',
    shortTitle: 'Project plan',
    description: 'Turn a goal into milestones, owners, timeline, and first actions.',
    meta: 'goal -> milestones -> action',
    prompt:
      'Turn the goal I describe into a realistic plan. Define the outcome, break it into milestones, identify dependencies, risks, and decisions, suggest a practical timeline, and finish with the first actions I should take. Keep the plan useful for real execution, not just a generic checklist.',
  },
  {
    id: 'creative-direction',
    title: 'Shape a creative idea',
    shortTitle: 'Creative idea',
    description: 'Develop concepts, names, outlines, campaigns, scenes, or visual directions.',
    meta: 'spark -> shape -> options',
    prompt:
      'Help shape the creative idea I provide. Explore several strong directions, explain what makes each one work, then develop the best option into a concrete outline, structure, copy, scene, campaign, name set, or visual direction depending on what I need.',
  },
  {
    id: 'decision-support',
    title: 'Compare options',
    shortTitle: 'Compare options',
    description: 'Weigh choices with criteria, tradeoffs, risks, and a recommendation.',
    meta: 'criteria -> tradeoffs -> pick',
    prompt:
      'Help me choose between the options I provide. Define the decision criteria, compare each option against those criteria, identify tradeoffs, costs, risks, and reversibility, then give a clear recommendation with the assumptions that would change it.',
  },
];

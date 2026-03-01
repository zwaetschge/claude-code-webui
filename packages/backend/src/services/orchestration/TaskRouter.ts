/**
 * TaskRouter - Intelligent task routing to appropriate CLI workers
 *
 * Routes tasks to the best suited CLI provider based on task characteristics.
 */

import type { CLIProvider } from '@claude-code-webui/shared';
import type { TaskRoutingRule, WorkerConfig } from '@claude-code-webui/shared';

// Default routing rules based on task patterns
const DEFAULT_ROUTING_RULES: TaskRoutingRule[] = [
  // Frontend/UI tasks → Gemini (good at visual/design tasks)
  {
    pattern: /\b(frontend|ui|ux|css|tailwind|react|vue|angular|svelte|html|styling|design|layout|component|responsive|animation)\b/i,
    provider: 'gemini',
    description: 'Frontend/UI development',
  },
  // Complex reasoning/algorithm tasks → Codex (OpenAI models excel at reasoning)
  {
    pattern: /\b(algorithm|optimize|performance|reasoning|complex|logic|mathematical|calculate|analyze|debug|refactor|architecture)\b/i,
    provider: 'codex',
    description: 'Complex reasoning/algorithms',
  },
  // Quick/simple tasks → GLM (fast, cost-effective)
  {
    pattern: /\b(simple|quick|trivial|rename|format|lint|typo|comment|documentation|readme|changelog)\b/i,
    provider: 'glm',
    description: 'Quick/simple tasks',
  },
  // Testing tasks → Codex (good at test generation)
  {
    pattern: /\b(test|spec|jest|vitest|mocha|pytest|unittest|e2e|integration test|coverage)\b/i,
    provider: 'codex',
    description: 'Testing tasks',
  },
  // Backend/API tasks → Codex (strong at backend logic)
  {
    pattern: /\b(api|backend|server|database|sql|graphql|rest|endpoint|middleware|authentication|authorization)\b/i,
    provider: 'codex',
    description: 'Backend/API development',
  },
  // Image/visual generation → Gemini (has image capabilities)
  {
    pattern: /\b(image|visual|diagram|chart|generate image|create image|picture)\b/i,
    provider: 'gemini',
    description: 'Visual/image tasks',
  },
];

export interface TaskAnalysis {
  task: string;
  detectedPatterns: string[];
  suggestedProvider: CLIProvider;
  confidence: number;
  reasoning: string;
}

export class TaskRouter {
  private rules: TaskRoutingRule[];
  private customRules: TaskRoutingRule[] = [];

  constructor(customRules?: TaskRoutingRule[]) {
    this.rules = [...DEFAULT_ROUTING_RULES];
    if (customRules) {
      this.customRules = customRules;
    }
  }

  /**
   * Add a custom routing rule
   */
  addRule(rule: TaskRoutingRule): void {
    this.customRules.push(rule);
  }

  /**
   * Remove a custom routing rule by description
   */
  removeRule(description: string): boolean {
    const index = this.customRules.findIndex((r) => r.description === description);
    if (index !== -1) {
      this.customRules.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Analyze a task and suggest the best provider
   */
  analyzeTask(task: string, availableProviders: CLIProvider[]): TaskAnalysis {
    const detectedPatterns: string[] = [];
    const providerScores: Record<CLIProvider, number> = {
      claude: 0,
      codex: 0,
      gemini: 0,
      glm: 0,
      kimi: 0,
      multi: 0,
    };

    // Check custom rules first (higher priority)
    for (const rule of this.customRules) {
      const pattern = typeof rule.pattern === 'string' ? new RegExp(rule.pattern, 'i') : rule.pattern;
      if (pattern.test(task)) {
        detectedPatterns.push(rule.description);
        providerScores[rule.provider] += 2; // Custom rules get higher weight
      }
    }

    // Check default rules
    for (const rule of this.rules) {
      const pattern = typeof rule.pattern === 'string' ? new RegExp(rule.pattern, 'i') : rule.pattern;
      if (pattern.test(task)) {
        detectedPatterns.push(rule.description);
        providerScores[rule.provider] += 1;
      }
    }

    // Filter to only available providers
    const availableScores = Object.entries(providerScores)
      .filter(([provider]) => availableProviders.includes(provider as CLIProvider))
      .sort((a, b) => b[1] - a[1]);

    // Default to claude if no patterns match or if it's the only option
    let suggestedProvider: CLIProvider = 'claude';
    let confidence = 0.3; // Low confidence for default
    let reasoning = 'No specific patterns detected, using default orchestrator';

    const topScore = availableScores[0];
    if (topScore && topScore[1] > 0) {
      suggestedProvider = topScore[0] as CLIProvider;
      // Calculate confidence based on score relative to max possible
      const maxScore = (this.customRules.length * 2) + this.rules.length;
      confidence = Math.min(0.95, 0.4 + (topScore[1] / maxScore) * 0.6);
      reasoning = `Task matches patterns: ${detectedPatterns.join(', ')}`;
    }

    // If Claude is available and the task seems complex/general, prefer Claude
    if (
      availableProviders.includes('claude') &&
      detectedPatterns.length === 0 &&
      task.length > 200
    ) {
      suggestedProvider = 'claude';
      confidence = 0.5;
      reasoning = 'Complex task without specific patterns, using Claude for general capability';
    }

    return {
      task,
      detectedPatterns,
      suggestedProvider,
      confidence,
      reasoning,
    };
  }

  /**
   * Route a task to the best available worker
   */
  routeTask(task: string, availableWorkers: WorkerConfig[]): CLIProvider {
    const availableProviders = availableWorkers
      .filter((w) => w.enabled)
      .map((w) => w.provider);

    // If no workers available, fall back to claude
    if (availableProviders.length === 0) {
      return 'claude';
    }

    // Check worker specializations first
    for (const worker of availableWorkers) {
      if (worker.enabled && worker.specialization) {
        const specPattern = new RegExp(`\\b${worker.specialization}\\b`, 'i');
        if (specPattern.test(task)) {
          return worker.provider;
        }
      }
    }

    // Use pattern-based routing
    const analysis = this.analyzeTask(task, availableProviders);
    return analysis.suggestedProvider;
  }

  /**
   * Get multiple routing suggestions for a task
   */
  getSuggestions(task: string, availableProviders: CLIProvider[], count: number = 3): TaskAnalysis[] {
    const suggestions: TaskAnalysis[] = [];
    const analysis = this.analyzeTask(task, availableProviders);
    suggestions.push(analysis);

    // Get alternative suggestions by excluding the top choice
    let remaining = availableProviders.filter((p) => p !== analysis.suggestedProvider);
    while (suggestions.length < count && remaining.length > 0) {
      const altAnalysis = this.analyzeTask(task, remaining);
      // Reduce confidence for alternatives
      altAnalysis.confidence *= 0.7;
      altAnalysis.reasoning = `Alternative: ${altAnalysis.reasoning}`;
      suggestions.push(altAnalysis);
      remaining = remaining.filter((p) => p !== altAnalysis.suggestedProvider);
    }

    return suggestions;
  }

  /**
   * Check if a task should be handled by the orchestrator itself
   */
  shouldOrchestratorHandle(task: string): boolean {
    // Tasks that require coordination, planning, or synthesis should stay with orchestrator
    const orchestratorPatterns = [
      /\b(plan|coordinate|organize|synthesize|summarize|overview|strategy)\b/i,
      /\b(multiple|several|various|different|across|integrate)\b/i,
      /\b(decide|choose|select|compare|evaluate options)\b/i,
    ];

    return orchestratorPatterns.some((pattern) => pattern.test(task));
  }

  /**
   * Extract subtasks from a complex task (for parallel execution)
   */
  extractSubtasks(task: string): string[] {
    // Simple heuristic: split by common task separators
    const separators = [
      /\band\s+then\b/i,
      /\bfirst\s*,?\s*.*?\bthen\b/i,
      /\b\d+\.\s*/,
      /\n-\s*/,
      /\n\*\s*/,
    ];

    // Try to find explicit subtasks
    for (const sep of separators) {
      const parts = task.split(sep).filter((p) => p.trim().length > 10);
      if (parts.length > 1) {
        return parts.map((p) => p.trim());
      }
    }

    // If no explicit structure, return original task as single subtask
    return [task];
  }
}

export const defaultTaskRouter = new TaskRouter();

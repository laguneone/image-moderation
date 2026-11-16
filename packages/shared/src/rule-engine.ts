export interface RuntimeRule { key: string; version: number; conditions: unknown; actions: unknown; applicationIds: string[] }
export interface RuleOutcome { matchedRuleKeys: string[]; triggerDeepAnalysis: boolean; requireReview: boolean }
const FIELDS = new Set(['nsfwUnsafe', 'peoplePresent', 'criticalReview', 'suspiciousText', 'sexualizedContext', 'sexualizedInteraction', 'nsfwRiskScore', 'domainMismatchScore', 'sexualSignalCount', 'confidence']);
export function evaluateRules(rules: RuntimeRule[], observations: Record<string, unknown>, applicationId: string): RuleOutcome {
  const outcome: RuleOutcome = { matchedRuleKeys: [], triggerDeepAnalysis: false, requireReview: false };
  for (const rule of rules) {
    if (rule.applicationIds.length && !rule.applicationIds.includes(applicationId)) continue;
    if (!matches(rule.conditions, observations, 0)) continue;
    outcome.matchedRuleKeys.push(`${rule.key}@${rule.version}`);
    if (isRecord(rule.actions) && rule.actions.TRIGGER_STAGE === 'deep_analysis') outcome.triggerDeepAnalysis = true;
    if (isRecord(rule.actions) && rule.actions.REQUIRE_REVIEW === true) outcome.requireReview = true;
  }
  return outcome;
}
function matches(node: unknown, observations: Record<string, unknown>, depth: number): boolean {
  if (depth > 4 || !isRecord(node)) return false;
  if (Array.isArray(node.all)) return node.all.length > 0 && node.all.length <= 20 && node.all.every((child) => matches(child, observations, depth + 1));
  if (Array.isArray(node.any)) return node.any.length > 0 && node.any.length <= 20 && node.any.some((child) => matches(child, observations, depth + 1));
  if ('not' in node) return !matches(node.not, observations, depth + 1);
  if (typeof node.field !== 'string' || !FIELDS.has(node.field)) return false;
  const actual = observations[node.field]; const expected = node.value;
  switch (node.operator) {
    case 'EXISTS': return actual !== undefined && actual !== null;
    case 'EQUALS': return primitive(actual) && primitive(expected) && actual === expected;
    case 'NOT_EQUALS': return primitive(actual) && primitive(expected) && actual !== expected;
    case 'GT': return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
    case 'LT': return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
    case 'IN': return primitive(actual) && Array.isArray(expected) && expected.length <= 50 && expected.every(primitive) && expected.includes(actual);
    case 'CONFIDENCE_GTE': return node.field === 'confidence' && typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
    default: return false;
  }
}
function primitive(value: unknown): value is string | number | boolean { return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }

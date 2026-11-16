export interface RiskInput { nsfwUnsafe: boolean; sexualSignalCount: number; peoplePresent: boolean; humanBodyPartPresent: boolean; criticalReview?: boolean }
export interface RiskOutput { nsfwRiskScore: number; domainMismatchScore: number; decision: 'ALLOW' | 'REVIEW' | 'RESTRICT' | 'CRITICAL_REVIEW'; confidence: number | null; criticalFlags: string[]; reasons: string[] }
export interface RiskConfig { allowMax: number; reviewMax: number; primaryNsfwPoints: number; metadataSignalPoints: number; peopleMismatchPoints: number; bodyPartMismatchPoints: number }

export function calculateRisk(input: RiskInput, config: RiskConfig = loadRiskConfig()): RiskOutput {
  const nsfwRiskScore = Math.min(100, input.nsfwUnsafe ? config.primaryNsfwPoints : input.sexualSignalCount > 0 ? config.metadataSignalPoints : 0);
  const domainMismatchScore = Math.min(100, (input.peoplePresent ? config.peopleMismatchPoints : 0) + (input.humanBodyPartPresent ? config.bodyPartMismatchPoints : 0));
  const decision = input.criticalReview ? 'CRITICAL_REVIEW' : nsfwRiskScore > config.reviewMax ? 'RESTRICT' : nsfwRiskScore > config.allowMax || domainMismatchScore > config.allowMax ? 'REVIEW' : 'ALLOW';
  const reasons = [
    ...(input.nsfwUnsafe ? ['Первичная проверка Nemotron выявила небезопасное содержимое.'] : []),
    ...(input.sexualSignalCount > 0 && !input.nsfwUnsafe ? ['В метаданных или имени файла обнаружены подозрительные термины.'] : []),
    ...(input.peoplePresent ? ['Обнаружены люди или человекоподобные объекты; требуется проверка соответствия тематике интерьера.'] : []),
    ...(input.humanBodyPartPresent ? ['Обнаружены отдельные части тела; требуется дополнительная проверка.'] : []),
    ...(input.criticalReview ? ['Модель обнаружила потенциально критическую категорию; обычный конвейер остановлен для специализированной проверки.'] : []),
  ];
  return { nsfwRiskScore, domainMismatchScore, decision, confidence: null, criticalFlags: input.criticalReview ? ['SPECIALIZED_SAFETY_REVIEW_REQUIRED'] : [], reasons };
}

export function loadRiskConfig(env: NodeJS.ProcessEnv = process.env): RiskConfig {
  const config = {
    allowMax: fromEnv(env.RISK_ALLOW_MAX, 29),
    reviewMax: fromEnv(env.RISK_REVIEW_MAX, 69),
    primaryNsfwPoints: fromEnv(env.RISK_PRIMARY_NSFW_POINTS, 70),
    metadataSignalPoints: fromEnv(env.RISK_METADATA_SIGNAL_POINTS, 30),
    peopleMismatchPoints: fromEnv(env.RISK_PEOPLE_MISMATCH_POINTS, 35),
    bodyPartMismatchPoints: fromEnv(env.RISK_BODY_PART_MISMATCH_POINTS, 35),
  };
  if (config.allowMax >= config.reviewMax || config.reviewMax >= 100) throw new Error('Risk score thresholds must satisfy 0 <= allowMax < reviewMax < 100.');
  return config;
}

function fromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 100) throw new Error('Risk scores and thresholds must be integers between 0 and 100.');
  return parsed;
}

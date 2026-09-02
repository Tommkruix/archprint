export const GATE_THRESHOLDS = {
  confidence: 0.9,
  exceptions: 3,
  roleConfidence: 0.8,
  roleConfidenceSuggest: 0.5,
} as const;

const Z_SCORE = 1.96;

export interface GateInput {
  roleFileCount: number;
  violatingFileCount: number;
  roleConfidence: number;
  applicable?: boolean;
}

export interface GateCondition {
  value: number;
  threshold: number;
  pass: boolean;
}

export type GenerationStatus = 'AUTO' | 'SUGGEST' | 'REJECT';

export interface GateResult {
  conditions: {
    confidence: GateCondition;
    exceptions: GateCondition;
    roleConfidence: GateCondition;
  };
  applicable: boolean;
  observedConformance: number;
  observations: number;
  passes: boolean;
  status: GenerationStatus;
}

const round = (value: number): number => Math.round(value * 10000) / 10000;

export function wilsonLowerBound(successes: number, n: number, z: number = Z_SCORE): number {
  if (n === 0) return 0;
  const p = successes / n;
  const z2 = z * z;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return (centre - margin) / (1 + z2 / n);
}

export function evaluateGate(input: GateInput): GateResult {
  const { roleFileCount, violatingFileCount, roleConfidence, applicable = true } = input;
  const conformingFileCount = roleFileCount - violatingFileCount;
  const observedConformance = roleFileCount === 0 ? 0 : conformingFileCount / roleFileCount;
  const floor = wilsonLowerBound(conformingFileCount, roleFileCount);

  const conditions = {
    confidence: {
      value: round(floor),
      threshold: GATE_THRESHOLDS.confidence,
      pass: floor >= GATE_THRESHOLDS.confidence,
    },
    exceptions: {
      value: violatingFileCount,
      threshold: GATE_THRESHOLDS.exceptions,
      pass: violatingFileCount <= GATE_THRESHOLDS.exceptions,
    },
    roleConfidence: {
      value: round(roleConfidence),
      threshold: GATE_THRESHOLDS.roleConfidence,
      pass: roleConfidence >= GATE_THRESHOLDS.roleConfidence,
    },
  };

  const passes = applicable && Object.values(conditions).every((condition) => condition.pass);
  let status: GenerationStatus;
  if (passes) {
    status = 'AUTO';
  } else if (
    applicable &&
    observedConformance >= 0.8 &&
    roleConfidence >= GATE_THRESHOLDS.roleConfidenceSuggest
  ) {
    status = 'SUGGEST';
  } else {
    status = 'REJECT';
  }

  return {
    conditions,
    applicable,
    observedConformance: round(observedConformance),
    observations: roleFileCount,
    passes,
    status,
  };
}

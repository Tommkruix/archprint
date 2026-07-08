export const GATE_THRESHOLDS = {
  ratio: 0.9,
  evidence: 20,
  exceptions: 3,
  roleConfidence: 0.8,
} as const;

export interface GateInput {
  roleFileCount: number;
  violatingFileCount: number;
  roleConfidence: number;
}

export interface GateCondition {
  value: number;
  threshold: number;
  pass: boolean;
}

export type GenerationStatus = 'AUTO' | 'SUGGEST' | 'REJECT';

export interface GateResult {
  conditions: {
    ratio: GateCondition;
    evidence: GateCondition;
    exceptions: GateCondition;
    roleConfidence: GateCondition;
  };
  passes: boolean;
  status: GenerationStatus;
}

const round = (value: number): number => Math.round(value * 10000) / 10000;

/** Auto-generate a rule only when all four conditions hold; a strong near miss becomes SUGGEST. */
export function evaluateGate(input: GateInput): GateResult {
  const { roleFileCount, violatingFileCount, roleConfidence } = input;
  const ratio = roleFileCount === 0 ? 0 : (roleFileCount - violatingFileCount) / roleFileCount;

  const conditions = {
    ratio: {
      value: round(ratio),
      threshold: GATE_THRESHOLDS.ratio,
      pass: ratio >= GATE_THRESHOLDS.ratio,
    },
    evidence: {
      value: roleFileCount,
      threshold: GATE_THRESHOLDS.evidence,
      pass: roleFileCount >= GATE_THRESHOLDS.evidence,
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

  const passes = Object.values(conditions).every((condition) => condition.pass);
  let status: GenerationStatus;
  if (passes) {
    status = 'AUTO';
  } else if (ratio >= 0.8 && conditions.evidence.pass && conditions.roleConfidence.pass) {
    status = 'SUGGEST';
  } else {
    status = 'REJECT';
  }

  return { conditions, passes, status };
}

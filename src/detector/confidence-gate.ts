export const GATE_THRESHOLDS = {
  /** Wilson lower-bound floor on the true conformance rate. */
  confidence: 0.9,
  exceptions: 3,
  roleConfidence: 0.8,
} as const;

// z = 1.96 is the two-sided 95% quantile; the resulting lower bound is a conservative one-sided 97.5%
// bound (errs toward not auto-generating). A one-sided 95% bound would use 1.645.
const Z_SCORE = 1.96;

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
    confidence: GateCondition;
    exceptions: GateCondition;
    roleConfidence: GateCondition;
  };
  /** Observed conformance rate (conforming / observations). */
  observedConformance: number;
  /** Followed + not-followed observations for this role: the confidence sample size. */
  observations: number;
  passes: boolean;
  status: GenerationStatus;
}

const round = (value: number): number => Math.round(value * 10000) / 10000;

/**
 * Wilson score lower bound on a proportion: the smallest true rate consistent with `successes`/`n` at the
 * given confidence. Fuses the observed rate and the sample size into one number, so a thin sample yields a
 * low bound even at 100% observed (5/5 is not evidence of a 90% rule; 40/40 is).
 */
export function wilsonLowerBound(successes: number, n: number, z: number = Z_SCORE): number {
  if (n === 0) return 0;
  const p = successes / n;
  const z2 = z * z;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return (centre - margin) / (1 + z2 / n);
}

/**
 * Gate a candidate rule. AUTO only when we are 95% confident the true conformance is at least 90% (Wilson
 * lower bound over the role's followed + not-followed observations), with at most a few exceptions and a
 * confidently-classified role. A pattern that looks like a rule (observed >= 80%) but lacks the evidence to
 * be confident becomes a provisional SUGGEST, so a thin repo is surfaced rather than silently rejected.
 */
export function evaluateGate(input: GateInput): GateResult {
  const { roleFileCount, violatingFileCount, roleConfidence } = input;
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

  const passes = Object.values(conditions).every((condition) => condition.pass);
  let status: GenerationStatus;
  if (passes) {
    status = 'AUTO';
  } else if (observedConformance >= 0.8 && conditions.roleConfidence.pass) {
    status = 'SUGGEST';
  } else {
    status = 'REJECT';
  }

  return {
    conditions,
    observedConformance: round(observedConformance),
    observations: roleFileCount,
    passes,
    status,
  };
}

import { describe, expect, it } from 'vitest';
import { evaluateGate, GATE_THRESHOLDS } from '../../src/detector/confidence-gate.js';

describe('evaluateGate', () => {
  it('returns AUTO only when all four conditions pass', () => {
    const r = evaluateGate({ roleFileCount: 100, violatingFileCount: 1, roleConfidence: 0.95 });
    expect(r.status).toBe('AUTO');
    expect(r.passes).toBe(true);
    expect(Object.values(r.conditions).every((c) => c.pass)).toBe(true);
  });

  it('fails on the absolute exceptions cap even when the ratio is high (large N)', () => {
    // 1000 files, 15 violations: ratio 0.985 passes, but 15 > 3 exceptions.
    const r = evaluateGate({ roleFileCount: 1000, violatingFileCount: 15, roleConfidence: 0.95 });
    expect(r.conditions.ratio.pass).toBe(true);
    expect(r.conditions.exceptions.pass).toBe(false);
    expect(r.status).toBe('SUGGEST'); // strong near-miss (ratio >= 0.8, evidence + roleConf pass)
  });

  it('REJECTs when role confidence is below threshold, regardless of a clean ratio', () => {
    const r = evaluateGate({ roleFileCount: 100, violatingFileCount: 1, roleConfidence: 0.5 });
    expect(r.conditions.roleConfidence.pass).toBe(false);
    expect(r.status).toBe('REJECT');
  });

  it('REJECTs when evidence is below the minimum file count', () => {
    const r = evaluateGate({ roleFileCount: 10, violatingFileCount: 0, roleConfidence: 0.95 });
    expect(r.conditions.evidence.pass).toBe(false);
    expect(r.status).toBe('REJECT');
  });

  it('marks a moderate ratio (0.8..0.9) with good evidence as SUGGEST, not AUTO', () => {
    // 100 files, 15 violations: ratio 0.85 (< 0.9, so not AUTO) but >= 0.8 with evidence + roleConf.
    const r = evaluateGate({ roleFileCount: 100, violatingFileCount: 15, roleConfidence: 0.95 });
    expect(r.status).toBe('SUGGEST');
  });

  it('REJECTs a low ratio outright', () => {
    const r = evaluateGate({ roleFileCount: 100, violatingFileCount: 50, roleConfidence: 0.95 });
    expect(r.status).toBe('REJECT');
  });

  it('treats an empty population as REJECT (ratio 0, no evidence)', () => {
    const r = evaluateGate({ roleFileCount: 0, violatingFileCount: 0, roleConfidence: 0 });
    expect(r.conditions.ratio.value).toBe(0);
    expect(r.status).toBe('REJECT');
  });

  it('exposes the thresholds it enforces', () => {
    expect(GATE_THRESHOLDS).toEqual({
      ratio: 0.9,
      evidence: 20,
      exceptions: 3,
      roleConfidence: 0.8,
    });
  });
});

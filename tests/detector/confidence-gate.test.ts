import { describe, expect, it } from 'vitest';
import {
  evaluateGate,
  wilsonLowerBound,
  GATE_THRESHOLDS,
} from '../../src/detector/confidence-gate.js';

describe('wilsonLowerBound', () => {
  it('is 0 for an empty sample', () => {
    expect(wilsonLowerBound(0, 0)).toBe(0);
  });

  it('rises with sample size at 100% observed (thin sample => low bound)', () => {
    // The whole point: 100% observed is weak evidence when the sample is small.
    expect(wilsonLowerBound(9, 9)).toBeLessThan(0.8);
    expect(wilsonLowerBound(22, 22)).toBeLessThan(0.9);
    expect(wilsonLowerBound(45, 45)).toBeGreaterThanOrEqual(0.9);
  });

  it('a violation lowers the bound', () => {
    expect(wilsonLowerBound(44, 45)).toBeLessThan(wilsonLowerBound(45, 45));
  });
});

describe('evaluateGate', () => {
  it('AUTO when the confidence floor clears 90% with few exceptions and a confident role', () => {
    // 100 files, 1 violation: floor well above 0.90.
    const r = evaluateGate({ roleFileCount: 100, violatingFileCount: 1, roleConfidence: 0.95 });
    expect(r.status).toBe('AUTO');
    expect(r.passes).toBe(true);
    expect(r.conditions.confidence.pass).toBe(true);
  });

  it('SUGGEST (not AUTO) when the pattern is clean but the sample is too thin to be confident', () => {
    // 9/9 conforming: observed 100% but the Wilson floor (~0.70) is below 0.90. This is the thin-repo
    // case that used to be a silent REJECT.
    const r = evaluateGate({ roleFileCount: 9, violatingFileCount: 0, roleConfidence: 0.95 });
    expect(r.conditions.confidence.pass).toBe(false);
    expect(r.observedConformance).toBe(1);
    expect(r.status).toBe('SUGGEST');
  });

  it('SUGGEST on the exceptions cap even when the floor is high (large N)', () => {
    // 1000 files, 15 violations: floor passes but 15 > 3 exceptions, so not AUTO.
    const r = evaluateGate({ roleFileCount: 1000, violatingFileCount: 15, roleConfidence: 0.95 });
    expect(r.conditions.confidence.pass).toBe(true);
    expect(r.conditions.exceptions.pass).toBe(false);
    expect(r.status).toBe('SUGGEST');
  });

  it('SUGGEST for a moderate observed rate (0.8..0.9) with a confident role', () => {
    // 100 files, 15 violations: observed 0.85 (< 0.9) but >= 0.8.
    const r = evaluateGate({ roleFileCount: 100, violatingFileCount: 15, roleConfidence: 0.95 });
    expect(r.status).toBe('SUGGEST');
  });

  it('REJECTs when the role classification is not confident, regardless of a clean ratio', () => {
    const r = evaluateGate({ roleFileCount: 100, violatingFileCount: 1, roleConfidence: 0.5 });
    expect(r.conditions.roleConfidence.pass).toBe(false);
    expect(r.status).toBe('REJECT');
  });

  it('REJECTs a low observed rate outright', () => {
    const r = evaluateGate({ roleFileCount: 100, violatingFileCount: 50, roleConfidence: 0.95 });
    expect(r.status).toBe('REJECT');
  });

  it('treats an empty population as REJECT (no observations)', () => {
    const r = evaluateGate({ roleFileCount: 0, violatingFileCount: 0, roleConfidence: 0 });
    expect(r.observedConformance).toBe(0);
    expect(r.observations).toBe(0);
    expect(r.status).toBe('REJECT');
  });

  it('exposes the thresholds it enforces', () => {
    expect(GATE_THRESHOLDS).toEqual({
      confidence: 0.9,
      exceptions: 3,
      roleConfidence: 0.8,
    });
  });
});

import { test, expect, describe } from 'vitest';
import {
  assessIndependence,
  isVerifierIndependent,
  Ownership,
  Boundary,
  IndependenceWarningCode,
  type VerifierIndependenceProfile,
} from './verifier-independence.js';

/** A maximally independent declaration: different vendors, gate-owned everything, separate boundaries. */
const independent: VerifierIndependenceProfile = {
  actorProvider: 'openai',
  actorModel: 'gpt-4o',
  verifierProvider: 'anthropic',
  verifierModel: 'claude-opus-4',
  promptOwnedBy: Ownership.Gate,
  policyOwnedBy: Ownership.Gate,
  contextConstructedBy: Ownership.Gate,
  deploymentBoundary: Boundary.Separate,
  credentialBoundary: Boundary.Separate,
};

const codes = (p: VerifierIndependenceProfile): IndependenceWarningCode[] => assessIndependence(p).map((w) => w.code);

describe('assessIndependence', () => {
  test('a fully independent declaration yields no warnings', () => {
    expect(assessIndependence(independent)).toEqual([]);
    expect(isVerifierIndependent(independent)).toBe(true);
  });

  test('identical provider + model warns SAME_MODEL (not SAME_MODEL_FAMILY)', () => {
    const c = codes({ ...independent, verifierProvider: 'openai', verifierModel: 'gpt-4o' });
    expect(c).toContain(IndependenceWarningCode.SameModel);
    expect(c).not.toContain(IndependenceWarningCode.SameModelFamily);
  });

  test('same provider, different model warns SAME_MODEL_FAMILY (inferred from provider)', () => {
    const c = codes({ ...independent, verifierProvider: 'openai', verifierModel: 'gpt-4o-mini' });
    expect(c).toContain(IndependenceWarningCode.SameModelFamily);
    expect(c).not.toContain(IndependenceWarningCode.SameModel);
  });

  test('an explicit sameModelFamily flag overrides the provider inference', () => {
    expect(codes({ ...independent, sameModelFamily: true })).toContain(IndependenceWarningCode.SameModelFamily);
    expect(codes({ ...independent, verifierProvider: 'openai', sameModelFamily: false })).not.toContain(
      IndependenceWarningCode.SameModelFamily,
    );
  });

  test('actor-owned prompt, policy, and context each warn', () => {
    expect(codes({ ...independent, promptOwnedBy: Ownership.Agent })).toContain(IndependenceWarningCode.AgentSuppliedPrompt);
    expect(codes({ ...independent, policyOwnedBy: Ownership.Agent })).toContain(IndependenceWarningCode.AgentSuppliedPolicy);
    expect(codes({ ...independent, contextConstructedBy: Ownership.Agent })).toContain(IndependenceWarningCode.AgentConstructedContext);
  });

  test('shared credential and deployment boundaries each warn', () => {
    expect(codes({ ...independent, credentialBoundary: Boundary.Shared })).toContain(IndependenceWarningCode.SharedCredentials);
    expect(codes({ ...independent, deploymentBoundary: Boundary.Shared })).toContain(IndependenceWarningCode.SharedDeployment);
  });

  test('warnings accumulate across independent risk dimensions', () => {
    const c = codes({
      ...independent,
      verifierProvider: 'openai',
      verifierModel: 'gpt-4o',
      promptOwnedBy: Ownership.Agent,
      credentialBoundary: Boundary.Shared,
    });
    expect(c).toEqual(
      expect.arrayContaining([
        IndependenceWarningCode.SameModel,
        IndependenceWarningCode.AgentSuppliedPrompt,
        IndependenceWarningCode.SharedCredentials,
      ]),
    );
    expect(isVerifierIndependent({ ...independent, promptOwnedBy: Ownership.Agent })).toBe(false);
  });
});

import { test, expect, describe } from 'vitest';
import { commitPolicy, policyBundleDigest, type PolicyManifest } from './policy-commitment.js';
import { commitEvidence, evidenceMerkleRoot, type EvidenceItem } from './evidence-commitment.js';

const manifest: PolicyManifest = {
  policyVersion: 'fintech.payments@1',
  checkerVersions: { schema: '1', reconcile: '2', 'second-opinion': '1' },
  config: { highValueThreshold: 25000, provider: 'anthropic' },
};

describe('policy commitment', () => {
  test('is a stable hex digest, order-independent', () => {
    const d = policyBundleDigest(manifest);
    expect(d).toMatch(/^[0-9a-f]{64}$/);
    const reordered: PolicyManifest = {
      config: { provider: 'anthropic', highValueThreshold: 25000 },
      checkerVersions: { reconcile: '2', schema: '1', 'second-opinion': '1' },
      policyVersion: 'fintech.payments@1',
    };
    expect(policyBundleDigest(reordered)).toBe(d);
  });

  test('changing a checker version or config changes the digest (no silent substitution)', () => {
    expect(policyBundleDigest({ ...manifest, checkerVersions: { ...manifest.checkerVersions, schema: '2' } })).not.toBe(
      policyBundleDigest(manifest),
    );
    expect(policyBundleDigest({ ...manifest, config: { ...manifest.config, highValueThreshold: 10000 } })).not.toBe(
      policyBundleDigest(manifest),
    );
  });

  test('commitPolicy returns the version plus the digest', () => {
    expect(commitPolicy(manifest)).toEqual({ policyVersion: 'fintech.payments@1', policyBundleDigest: policyBundleDigest(manifest) });
  });
});

const ev = (id: string): EvidenceItem => ({
  sourceId: id,
  sourceType: 'ledger',
  queryDigest: 'q'.repeat(64),
  responseDigest: 'r'.repeat(64),
  retrievedAt: '2026-06-21T00:00:00.000Z',
  trustLevel: 'authoritative',
  availabilityStatus: 'available',
});

describe('evidence commitment', () => {
  test('empty set has a fixed canonical root', () => {
    expect(commitEvidence([])).toEqual({ evidenceDigest: evidenceMerkleRoot([]), count: 0 });
    expect(evidenceMerkleRoot([])).toMatch(/^[0-9a-f]{64}$/);
  });

  test('the root commits to the SET — independent of gather order', () => {
    const a = evidenceMerkleRoot([ev('s1'), ev('s2'), ev('s3')]);
    const b = evidenceMerkleRoot([ev('s3'), ev('s1'), ev('s2')]);
    expect(a).toBe(b);
  });

  test('adding/altering an evidence item changes the root (substitution detected)', () => {
    const base = evidenceMerkleRoot([ev('s1'), ev('s2')]);
    expect(evidenceMerkleRoot([ev('s1'), ev('s2'), ev('s3')])).not.toBe(base);
    expect(evidenceMerkleRoot([ev('s1'), { ...ev('s2'), responseDigest: 'x'.repeat(64) }])).not.toBe(base);
  });

  test('handles an odd number of leaves', () => {
    expect(evidenceMerkleRoot([ev('s1'), ev('s2'), ev('s3')])).toMatch(/^[0-9a-f]{64}$/);
  });
});

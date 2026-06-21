import { test, expect, describe } from 'vitest';
import fc from 'fast-check';
import { Verdict } from '../core/types.js';
import { adjudicate, type AdjudicationInputs, type DeterministicSignal, type EvidenceSignal, type ModelSignal } from './adjudication.js';

const RANK: Record<Verdict, number> = { [Verdict.Allow]: 0, [Verdict.Escalate]: 1, [Verdict.Block]: 2 };

const verdictArb = fc.constantFrom(Verdict.Allow, Verdict.Block, Verdict.Escalate);
const detSignalArb: fc.Arbitrary<DeterministicSignal> = fc.record({
  name: fc.string(),
  verdict: verdictArb,
  hard: fc.boolean(),
});
const confidenceArb = fc.double({ min: 0, max: 1, noNaN: true });

// Generate raw nullable fields, then assemble a clean AdjudicationInputs with conditional spreads
// (no explicit `undefined` values) to satisfy exactOptionalPropertyTypes.
const inputsArb: fc.Arbitrary<AdjudicationInputs> = fc
  .record({
    deterministic: fc.array(detSignalArb, { maxLength: 6 }),
    requiredButUnavailable: fc.boolean(),
    evidenceReason: fc.option(fc.string(), { nil: undefined }),
    modelVerdict: fc.option(verdictArb, { nil: undefined }),
    modelConfidence: fc.option(confidenceArb, { nil: undefined }),
    threshold: fc.option(confidenceArb, { nil: undefined }),
    modelBlockVerdict: fc.option(fc.constantFrom(Verdict.Block, Verdict.Escalate), { nil: undefined }),
  })
  .map((raw): AdjudicationInputs => {
    const evidence: EvidenceSignal = {
      requiredButUnavailable: raw.requiredButUnavailable,
      ...(raw.evidenceReason !== undefined ? { reason: raw.evidenceReason } : {}),
    };
    const model: ModelSignal | undefined =
      raw.modelVerdict === undefined
        ? undefined
        : { verdict: raw.modelVerdict, ...(raw.modelConfidence !== undefined ? { confidence: raw.modelConfidence } : {}) };
    return {
      deterministic: raw.deterministic,
      evidence,
      ...(model ? { model } : {}),
      ...(raw.threshold !== undefined ? { modelConfidenceThreshold: raw.threshold } : {}),
      ...(raw.modelBlockVerdict !== undefined ? { modelBlockVerdict: raw.modelBlockVerdict } : {}),
    };
  });

const hasHardBlock = (i: AdjudicationInputs): boolean => i.deterministic.some((d) => d.hard && d.verdict === Verdict.Block);

describe('adjudicate — safety invariants (property-based)', () => {
  test('INV0: total and closed over Verdict — never throws, always one of the three verdicts', () => {
    fc.assert(
      fc.property(inputsArb, (inputs) => {
        const d = adjudicate(inputs);
        expect([Verdict.Allow, Verdict.Block, Verdict.Escalate]).toContain(d.finalVerdict);
      }),
    );
  });

  test('INV1: a hard deterministic BLOCK is absolute — no model/evidence/threshold can override it', () => {
    fc.assert(
      fc.property(inputsArb, (inputs) => {
        const withHardBlock: AdjudicationInputs = {
          ...inputs,
          deterministic: [...inputs.deterministic, { name: 'sanctions', verdict: Verdict.Block, hard: true }],
        };
        expect(adjudicate(withHardBlock).finalVerdict).toBe(Verdict.Block);
      }),
    );
  });

  test('INV2: required-but-unavailable evidence never yields ALLOW (escalates, absent any block condition)', () => {
    fc.assert(
      fc.property(inputsArb, (inputs) => {
        const i: AdjudicationInputs = { ...inputs, evidence: { requiredButUnavailable: true } };
        const d = adjudicate(i);
        expect(d.finalVerdict).not.toBe(Verdict.Allow);
        // Absent a hard block AND a model-block-under-block-policy, unavailable evidence escalates.
        const modelBlocksHard = i.model?.verdict === Verdict.Block && (i.modelBlockVerdict ?? Verdict.Block) === Verdict.Block;
        if (!hasHardBlock(i) && !modelBlocksHard) expect(d.finalVerdict).toBe(Verdict.Escalate);
      }),
    );
  });

  test('INV3: ALLOW is returned ONLY when every signal independently allows', () => {
    fc.assert(
      fc.property(inputsArb, (inputs) => {
        const d = adjudicate(inputs);
        if (d.finalVerdict !== Verdict.Allow) return;
        // No hard block, evidence available, every deterministic check allows, model (if any) allows...
        expect(hasHardBlock(inputs)).toBe(false);
        expect(inputs.evidence.requiredButUnavailable).toBe(false);
        expect(inputs.deterministic.every((s) => s.verdict === Verdict.Allow)).toBe(true);
        expect(inputs.model === undefined || inputs.model.verdict === Verdict.Allow).toBe(true);
        // ...and the model, if gated by a threshold, met it with a known confidence.
        if (inputs.model && inputs.modelConfidenceThreshold !== undefined) {
          expect(inputs.model.confidence).not.toBeUndefined();
          expect(inputs.model.confidence as number).toBeGreaterThanOrEqual(inputs.modelConfidenceThreshold);
        }
      }),
    );
  });

  test('INV4: worsening any deterministic check never makes the outcome more permissive', () => {
    const worse: Record<Verdict, Verdict> = {
      [Verdict.Allow]: Verdict.Escalate,
      [Verdict.Escalate]: Verdict.Block,
      [Verdict.Block]: Verdict.Block,
    };
    fc.assert(
      fc.property(
        inputsArb.filter((i) => i.deterministic.length > 0),
        fc.nat(),
        (inputs, rawIdx) => {
          const idx = rawIdx % inputs.deterministic.length;
          const before = adjudicate(inputs);
          const mutated = inputs.deterministic.map((s, k) => (k === idx ? { ...s, verdict: worse[s.verdict] } : s));
          const after = adjudicate({ ...inputs, deterministic: mutated });
          // Permissiveness is the inverse of RANK; a worse input must not lower the final RANK.
          expect(RANK[after.finalVerdict]).toBeGreaterThanOrEqual(RANK[before.finalVerdict]);
        },
      ),
    );
  });

  test('INV5: making evidence unavailable never makes the outcome more permissive', () => {
    fc.assert(
      fc.property(inputsArb, (inputs) => {
        const available: AdjudicationInputs = { ...inputs, evidence: { requiredButUnavailable: false } };
        const unavailable: AdjudicationInputs = { ...inputs, evidence: { requiredButUnavailable: true } };
        expect(RANK[adjudicate(unavailable).finalVerdict]).toBeGreaterThanOrEqual(RANK[adjudicate(available).finalVerdict]);
      }),
    );
  });

  test('INV6: an independent-model BLOCK (no hard block, evidence available) resolves to the configured model-block verdict', () => {
    fc.assert(
      fc.property(inputsArb, (inputs) => {
        const i: AdjudicationInputs = {
          ...inputs,
          deterministic: inputs.deterministic.map((s) => ({ ...s, hard: false })),
          evidence: { requiredButUnavailable: false },
          model: { verdict: Verdict.Block },
        };
        expect(adjudicate(i).finalVerdict).toBe(i.modelBlockVerdict ?? Verdict.Block);
      }),
    );
  });
});

describe('adjudicate — rule precedence (worked examples)', () => {
  const allow: DeterministicSignal = { name: 'schema', verdict: Verdict.Allow, hard: true };

  test('rule 1: a hard block beats a confident model ALLOW', () => {
    const d = adjudicate({
      deterministic: [{ name: 'sanctions', verdict: Verdict.Block, hard: true }],
      evidence: { requiredButUnavailable: false },
      model: { verdict: Verdict.Allow, confidence: 1 },
    });
    expect(d.finalVerdict).toBe(Verdict.Block);
    expect(d.deterministicVerdict).toBe(Verdict.Block);
    expect(d.reason).toContain('hard deterministic block');
  });

  test('rule 2: unavailable evidence escalates even with a model ALLOW', () => {
    const d = adjudicate({
      deterministic: [allow],
      evidence: { requiredButUnavailable: true, reason: 'ledger unreachable' },
      model: { verdict: Verdict.Allow, confidence: 1 },
    });
    expect(d.finalVerdict).toBe(Verdict.Escalate);
    expect(d.reason).toContain('ledger unreachable');
  });

  test('rule 3: a model BLOCK blocks by default but escalates when configured', () => {
    const baseInputs: AdjudicationInputs = {
      deterministic: [allow],
      evidence: { requiredButUnavailable: false },
      model: { verdict: Verdict.Block, confidence: 0.9 },
    };
    expect(adjudicate(baseInputs).finalVerdict).toBe(Verdict.Block);
    expect(adjudicate({ ...baseInputs, modelBlockVerdict: Verdict.Escalate }).finalVerdict).toBe(Verdict.Escalate);
  });

  test('rule 4: a model below threshold (or with unknown confidence) escalates', () => {
    expect(
      adjudicate({
        deterministic: [allow],
        evidence: { requiredButUnavailable: false },
        model: { verdict: Verdict.Allow, confidence: 0.4 },
        modelConfidenceThreshold: 0.7,
      }).finalVerdict,
    ).toBe(Verdict.Escalate);
    expect(
      adjudicate({
        deterministic: [allow],
        evidence: { requiredButUnavailable: false },
        model: { verdict: Verdict.Allow },
        modelConfidenceThreshold: 0.7,
      }).finalVerdict,
    ).toBe(Verdict.Escalate);
  });

  test('rule 5: unanimous allow yields ALLOW and records both component verdicts', () => {
    const d = adjudicate({
      deterministic: [allow, { name: 'reconcile', verdict: Verdict.Allow, hard: true }],
      evidence: { requiredButUnavailable: false },
      model: { verdict: Verdict.Allow, confidence: 0.95 },
      modelConfidenceThreshold: 0.7,
    });
    expect(d.finalVerdict).toBe(Verdict.Allow);
    expect(d.deterministicVerdict).toBe(Verdict.Allow);
    expect(d.modelVerdict).toBe(Verdict.Allow);
  });

  test('rule 6: a non-hard (advisory) block cannot force BLOCK but degrades ALLOW to ESCALATE', () => {
    const d = adjudicate({
      deterministic: [allow, { name: 'advisory-list', verdict: Verdict.Block, hard: false }],
      evidence: { requiredButUnavailable: false },
    });
    expect(d.finalVerdict).toBe(Verdict.Escalate);
    expect(d.deterministicVerdict).toBe(Verdict.Block); // aggregate still reflects the advisory block
  });
});

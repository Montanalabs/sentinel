/**
 * Built-in `healthcare.record_write` policy pack.
 *
 * Assembles the checks that gate a clinical record-write action: payload schema validation,
 * clinician sign-off for clinically-significant changes, PHI data-boundary enforcement
 * (allowed providers/regions), optional patient-existence verification against a clinical
 * connector, and an optional cross-model second opinion. Dependency-gated checks are emitted
 * only when the matching {@link PackDeps} collaborators are present. Registered into a
 * {@link PolicyRegistry} (see {@link defaultRegistry}) and resolved by the engine per action.
 */
import { Verdict } from '../core/types.js';
import { type Check, CheckTier } from '../checks/types.js';
import { CompareOp } from '../checks/condition.js';
import { SchemaCheck } from '../checks/schema.js';
import { PolicyCheck, RuleEffect, type PolicyRule } from '../checks/policy.js';
import { DataBoundaryCheck } from '../checks/boundary.js';
import { PredicateCheck } from '../checks/predicate.js';
import { SecondOpinionCheck } from '../providers/second-opinion.js';
import type { PackDeps, PolicyPack } from './registry.js';

/**
 * Tuning knobs for the {@link healthcareRecordsPack}.
 *
 * Every field is optional; omitted values fall back to the pack's defaults. `allowedProviders`
 * and `allowedRegions` drive the PHI {@link DataBoundaryCheck}; `approvers` drives the
 * clinician sign-off {@link PolicyRule}.
 */
export interface HealthcareRecordsConfig {
  /** Providers cleared to receive PHI. Default ['anthropic']. */
  allowedProviders?: string[];
  /** Regions cleared to receive PHI. Default ['US']. */
  allowedRegions?: string[];
  /** Roles that must sign off on clinically-significant changes. Default ['attending_physician']. */
  approvers?: string[];
}

const RECORD_SCHEMA = {
  type: 'object',
  required: ['patientId', 'field', 'value'],
  properties: {
    patientId: { type: 'string', minLength: 1 },
    field: { type: 'string', minLength: 1 },
    value: {},
    clinicalSignificant: { type: 'boolean' },
    ssn: { type: 'string' },
    dob: { type: 'string' },
    mrn: { type: 'string' },
  },
  additionalProperties: true,
};

/**
 * Build the `healthcare.record_write` {@link PolicyPack}: schema validation, clinician sign-off
 * for clinically-significant changes, PHI data-boundary enforcement, optional patient-existence
 * verification, and an optional cross-model second opinion.
 *
 * The patient-existence check ({@link ClinicalConnector}) and the second-opinion check
 * ({@link Provider}) are added only when {@link PackDeps.clinical} / {@link PackDeps.provider}
 * are supplied at resolve time.
 *
 * @param config - Allowed PHI providers/regions and approver roles; see
 *   {@link HealthcareRecordsConfig}.
 * @returns A pack with id `healthcare.record_write` whose `build` emits the ordered
 *   {@link Check}s.
 * @remarks The returned pack's `build` does not throw; the clinical lookup it wires in
 *   (patient existence) surfaces failure as the check's own {@link CheckResult}, not as a
 *   thrown error.
 */
export function healthcareRecordsPack(config: HealthcareRecordsConfig = {}): PolicyPack {
  const approvers = config.approvers ?? ['attending_physician'];
  return {
    id: 'healthcare.record_write',
    build(deps: PackDeps): Check[] {
      const rules: PolicyRule[] = [
        {
          id: 'clinician_signoff',
          when: { field: 'action.payload.clinicalSignificant', op: CompareOp.Eq, value: true },
          effect: RuleEffect.RequireApproval,
          approvers,
          reason: 'clinically-significant change requires clinician sign-off',
        },
      ];
      const checks: Check[] = [
        new SchemaCheck({ record_update: RECORD_SCHEMA }),
        new PolicyCheck({ id: 'healthcare.record_write', rules }),
        new DataBoundaryCheck({
          piiFields: ['action.payload.ssn', 'action.payload.dob', 'action.payload.mrn'],
          allowedProviders: config.allowedProviders ?? ['anthropic'],
          allowedRegions: config.allowedRegions ?? ['US'],
        }),
      ];
      if (deps.clinical) {
        const clinical = deps.clinical;
        checks.push(
          new PredicateCheck({
            name: 'patient-exists',
            tier: CheckTier.Slow,
            predicate: async ({ action }) => {
              const exists = await clinical.patientExists(String(action.payload['patientId']));
              if (exists === false) return { verdict: Verdict.Block, reason: 'record write for an unknown patient' };
              if (exists === undefined) return { verdict: Verdict.Escalate, reason: 'could not verify patient exists' };
              return { verdict: Verdict.Allow };
            },
          }),
        );
      }

      if (deps.provider) {
        checks.push(
          new SecondOpinionCheck({
            provider: deps.provider,
            question: () => 'Is this clinical record change consistent and safe to apply? Agree only if it is correct and appropriate.',
          }),
        );
      }
      return checks;
    },
  };
}

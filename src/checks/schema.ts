/**
 * Structural validation of action payloads (fast tier).
 *
 * Defines {@link SchemaCheck}, a fast-tier {@link Check} that validates an
 * action's payload against a JSON Schema registered per action type using Ajv.
 * It is the first line of defense in the gate: malformed payloads are BLOCKed
 * before any policy or reconciliation logic runs.
 */

import { Ajv, type ValidateFunction, type Schema } from 'ajv';
import { fullFormats } from 'ajv-formats/dist/formats.js';
import type { CheckResult } from '../core/types.js';
import { CheckOutcome, Verdict } from '../core/types.js';
import { CheckTier } from './types.js';
import type { Check, CheckInput } from './types.js';

/**
 * Validates an action's payload against a JSON Schema registered per action type.
 *
 * A fast-tier {@link Check}: action types with no registered schema pass through
 * (ALLOW); a registered schema that the payload violates yields a BLOCK with the
 * collected validation errors. Schemas are compiled once at construction.
 */
export class SchemaCheck implements Check {
  readonly name = 'schema';
  readonly tier: CheckTier = CheckTier.Fast;
  private readonly validators = new Map<string, ValidateFunction>();

  /**
   * Compile one Ajv validator per action type up front.
   *
   * @param schemas - A map from action type to its JSON {@link Schema}.
   * @throws If Ajv fails to compile any provided schema (invalid JSON Schema).
   */
  constructor(schemas: Record<string, Schema>) {
    const ajv = new Ajv({ allErrors: true, strict: false, formats: fullFormats });
    for (const [type, schema] of Object.entries(schemas)) {
      this.validators.set(type, ajv.compile(schema));
    }
  }

  /**
   * Validate the action's payload against the schema for its type.
   *
   * @param input - The proposed action and agent context; see {@link CheckInput}.
   * @returns ALLOW when no schema is registered for the action type or the
   *   payload is valid; BLOCK (with the validation errors in `reason` and
   *   `details.errors`) otherwise. See {@link CheckResult}.
   */
  async run(input: CheckInput): Promise<CheckResult> {
    const validate = this.validators.get(input.action.type);
    if (!validate) {
      return { check: this.name, outcome: CheckOutcome.Pass, verdict: Verdict.Allow, reason: 'no schema for action type' };
    }
    const ok = validate(input.action.payload);
    if (ok) return { check: this.name, outcome: CheckOutcome.Pass, verdict: Verdict.Allow };
    const errors = (validate.errors ?? []).map((e) => `${e.instancePath || '(root)'} ${e.message ?? ''}`.trim());
    return {
      check: this.name,
      outcome: CheckOutcome.Fail,
      verdict: Verdict.Block,
      reason: `payload failed schema validation: ${errors.join('; ')}`,
      details: { errors },
    };
  }
}

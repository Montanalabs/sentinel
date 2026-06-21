import { test, expect, describe } from 'vitest';
import { StaticClinicalConnector } from './static-clinical.js';

describe('StaticClinicalConnector', () => {
  const c = new StaticClinicalConnector({ patients: ['p1', 'p2'], allergies: { p1: ['penicillin'] } });
  test('patientExists', async () => {
    expect(await c.patientExists('p1')).toBe(true);
    expect(await c.patientExists('p9')).toBe(false);
  });
  test('getAllergies', async () => {
    expect(await c.getAllergies('p1')).toEqual(['penicillin']);
    expect(await c.getAllergies('p2')).toEqual([]);
  });
});

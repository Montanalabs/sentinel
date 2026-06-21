import { test, expect, describe } from 'vitest';
import { HttpFhirConnector } from './http-fhir.js';
import type { FetchLike } from './http-ledger.js';

function fhirFetch(routes: Record<string, { ok?: boolean; status?: number; body?: unknown; throws?: boolean }>): FetchLike {
  return async (url: string) => {
    const r = routes[url];
    if (!r || r.throws) throw new Error('fhir down');
    return { ok: r.ok ?? true, status: r.status ?? 200, json: async () => r.body };
  };
}

describe('HttpFhirConnector', () => {
  test('patientExists is true on 200', async () => {
    const c = new HttpFhirConnector('https://fhir.test', { fetchImpl: fhirFetch({ 'https://fhir.test/Patient/p1': { body: { id: 'p1' } } }) });
    expect(await c.patientExists('p1')).toBe(true);
  });
  test('patientExists is false on 404', async () => {
    const c = new HttpFhirConnector('https://fhir.test', { fetchImpl: fhirFetch({ 'https://fhir.test/Patient/p9': { ok: false, status: 404 } }) });
    expect(await c.patientExists('p9')).toBe(false);
  });
  test('patientExists is undefined (unknown) on network error → caller escalates', async () => {
    const c = new HttpFhirConnector('https://fhir.test', { fetchImpl: fhirFetch({ 'https://fhir.test/Patient/p1': { throws: true } }) });
    expect(await c.patientExists('p1')).toBeUndefined();
  });
  test('getAllergies reads the allergies array, fails safe to []', async () => {
    const c = new HttpFhirConnector('https://fhir.test', {
      fetchImpl: fhirFetch({ 'https://fhir.test/Patient/p1/allergies': { body: { allergies: ['penicillin', 'latex'] } } }),
    });
    expect(await c.getAllergies('p1')).toEqual(['penicillin', 'latex']);
    const broken = new HttpFhirConnector('https://fhir.test', { fetchImpl: fhirFetch({ 'https://fhir.test/Patient/p1/allergies': { throws: true } }) });
    expect(await broken.getAllergies('p1')).toEqual([]);
  });
});

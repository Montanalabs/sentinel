import { test, expect, describe } from 'vitest';
import { runWizard, type Ask } from './wizard.js';

const ask = (answers: Record<string, string>): Ask => async (label, _prompt, def) => answers[label] ?? def;

describe('runWizard', () => {
  test('builds options from answers', async () => {
    const opts = await runWizard(
      ask({ name: 'acme-gate', port: '4100', provider: 'anthropic', store: 'postgres', packs: 'fintech, healthcare', customPack: 'n', seed: 'n' }),
    );
    expect(opts).toMatchObject({
      name: 'acme-gate',
      port: 4100,
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      store: 'postgres',
      packs: ['fintech', 'healthcare'],
      customPack: false,
    });
    expect(opts.databaseUrl).toContain('postgres://');
    expect(opts.signingSeed).toBe('');
  });

  test('applies sensible defaults when answers are blank', async () => {
    const opts = await runWizard(ask({})); // everything falls back to def
    expect(opts).toMatchObject({ name: 'my-sentinel', port: 4000, provider: 'mock', store: 'postgres', packs: ['fintech'], customPack: true });
    expect(opts.databaseUrl).toBe('postgres://sentinel:sentinel@localhost:5432/sentinel'); // default store -> default db url
    expect(opts.model).toBeUndefined();          // mock provider -> no model prompt
    expect(Buffer.from(opts.signingSeed!, 'base64')).toHaveLength(32); // default 'y' -> seed generated
  });

  test('re-prompts an unknown provider and falls back to mock (never silently)', async () => {
    const opts = await runWizard(ask({ provider: 'gemini' })); // not a known provider
    expect(opts.provider).toBe('mock');
    expect(opts.model).toBeUndefined(); // mock -> no model
  });

  test('sqlite store yields a sqlite: database url', async () => {
    const opts = await runWizard(ask({ store: 'sqlite' }));
    expect(opts.store).toBe('sqlite');
    expect(opts.databaseUrl).toBe('sqlite:./sentinel.db');
  });

  test('picks the openai default model when provider is openai', async () => {
    const opts = await runWizard(ask({ provider: 'openai' }));
    expect(opts.provider).toBe('openai');
    expect(opts.model).toBe('gpt-5.5');
  });

  test('ignores unknown pack names', async () => {
    const opts = await runWizard(ask({ packs: 'fintech, bogus, healthcare' }));
    expect(opts.packs).toEqual(['fintech', 'healthcare']);
  });
});

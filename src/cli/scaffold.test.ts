import { test, expect, describe } from 'vitest';
import { scaffoldFiles, StoreKind } from './scaffold.js';

describe('scaffoldFiles', () => {
  const files = scaffoldFiles({ name: 'acme-gate' });

  test('emits config-only files that the binary/Docker image runs — no npm project', () => {
    const paths = Object.keys(files);
    expect(paths).toEqual(expect.arrayContaining(['.env', 'docker-compose.yml', 'README.md', '.gitignore']));
    // The old npm-project artifacts must NOT be generated (they depended on an unpublished package).
    expect(paths).not.toContain('package.json');
    expect(paths).not.toContain('Dockerfile');
    expect(paths).not.toContain('src/server.ts');
  });

  test('.env documents the key Sentinel variables and is gitignored', () => {
    expect(files['.env']).toContain('SENTINEL_SIDECAR_PORT');
    expect(files['.env']).toContain('SENTINEL_DATABASE_URL');
    expect(files['.env']).toContain('SENTINEL_SECOND_OPINION_PROVIDER');
    expect(files['.gitignore']).toContain('.env'); // secrets must not be committed
  });

  test('README tells the user to run the sentinel binary, not npm', () => {
    const r = files['README.md']!;
    expect(r).toContain('sentinel start');
    expect(r).not.toContain('npm install');
  });

  test('custom pack -> a no-op sentinel.config.mjs template (valid empty ES module)', () => {
    expect(files['sentinel.config.mjs']).toContain('export {}');
    expect(files['sentinel.config.mjs']).toContain('@montanalabs/sentinel');
  });

  test('docker-compose uses the published image (no local build) and has no postgres by default', () => {
    expect(files['docker-compose.yml']).toContain('image: ghcr.io/montanalabs/sentinel');
    expect(files['docker-compose.yml']).not.toContain('build:');
    expect(files['docker-compose.yml']).not.toContain('postgres');
  });

  test('docker-compose includes postgres when store=postgres', () => {
    const pg = scaffoldFiles({ name: 'acme-gate', store: StoreKind.Postgres });
    expect(pg['docker-compose.yml']).toContain('postgres');
    expect(pg['docker-compose.yml']).toContain('depends_on: [postgres]');
  });

  test('sqlite store: .env uses a sqlite: URL and .gitignore excludes the db file', () => {
    const s = scaffoldFiles({ name: 'acme-gate', store: StoreKind.Sqlite });
    expect(s['.env']).toContain('SENTINEL_DATABASE_URL=sqlite:./sentinel.db');
    expect(s['.gitignore']).toContain('*.db');
  });
});

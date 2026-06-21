import { test, expect, describe } from 'vitest';
import { scaffoldFiles, StoreKind } from './scaffold.js';

describe('scaffoldFiles', () => {
  const files = scaffoldFiles({ name: 'acme-gate' });

  test('emits the core self-host files', () => {
    const paths = Object.keys(files);
    expect(paths).toEqual(expect.arrayContaining(['.env', 'docker-compose.yml', 'Dockerfile', 'package.json', 'src/server.ts', 'src/my-pack.ts', 'README.md', '.gitignore']));
  });

  test('.env documents the key Sentinel variables', () => {
    expect(files['.env']).toContain('SENTINEL_SIDECAR_PORT');
    expect(files['.env']).toContain('SENTINEL_DATABASE_URL');
    expect(files['.env']).toContain('SENTINEL_SECOND_OPINION_PROVIDER');
  });

  test('package.json names the project and depends on sentinel', () => {
    const pkg = JSON.parse(files['package.json']!);
    expect(pkg.name).toBe('acme-gate');
    expect(pkg.dependencies).toHaveProperty('sentinel');
    expect(pkg.scripts.start).toContain('server.ts');
  });

  test('server.ts assembles a sidecar with a custom pack + connector via the public API', () => {
    const s = files['src/server.ts']!;
    expect(s).toContain("from 'sentinel'");
    expect(s).toContain('buildServer');
    expect(s).toContain('PolicyRegistry');
    expect(s).toContain('./my-pack.js');
  });

  test('my-pack.ts is a valid custom pack template', () => {
    expect(files['src/my-pack.ts']).toContain('PolicyPack');
    expect(files['src/my-pack.ts']).toContain('build(');
  });

  test('docker-compose for the default (memory/sqlite) has the sidecar, no postgres', () => {
    expect(files['docker-compose.yml']).toContain('sentinel:');
    expect(files['docker-compose.yml']).toContain('4000');
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

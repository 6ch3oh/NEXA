'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const {
  NexaEsmPublicApiLoaderError,
  createNexaEsmPublicApiLoader
} = require('../../src/electron/nexaEsmPublicApiLoader');

const createdTempRoots = [];
let fixtureSequence = 0;

function expectCode(callback, code) {
  assert.throws(
    callback,
    (error) => error instanceof NexaEsmPublicApiLoaderError && error.code === code,
    `expected ESM public API loader error code ${code}`
  );
}

async function expectRejection(callback, code) {
  await assert.rejects(
    callback,
    (error) => error instanceof NexaEsmPublicApiLoaderError && error.code === code,
    `expected ESM public API loader rejection code ${code}`
  );
}

function createFixture(t) {
  fixtureSequence += 1;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'NEXA-加载测试-消费中心-'));
  const sourceRoot = path.join(root, '消费中心测试', 'src');
  const subdirectory = path.join(sourceRoot, 'sub');
  const otherRoot = path.join(root, '其他模块', 'src');
  const marker = `__nexaEsmLoaderMarker${process.pid}_${fixtureSequence}`;
  const internalMarker = `${marker}_internal`;

  fs.mkdirSync(subdirectory, { recursive: true });
  fs.mkdirSync(otherRoot, { recursive: true });

  const entrypoint = path.join(sourceRoot, 'index.mjs');
  const internalEntrypoint = path.join(sourceRoot, 'internal.mjs');
  const subdirectoryEntrypoint = path.join(subdirectory, 'index.mjs');
  const sameBasenameEntrypoint = path.join(otherRoot, 'index.mjs');
  const failingEntrypoint = path.join(sourceRoot, 'failing.mjs');

  fs.writeFileSync(entrypoint, [
    `globalThis[${JSON.stringify(marker)}] = (globalThis[${JSON.stringify(marker)}] || 0) + 1;`,
    'export const namedValue = 42;',
    "export const unicodeValue = '消费中心';",
    "export default Object.freeze({ kind: 'fixture-public-api' });"
  ].join('\n'));
  fs.writeFileSync(internalEntrypoint, [
    `globalThis[${JSON.stringify(internalMarker)}] = true;`,
    "export const internal = 'not-public';"
  ].join('\n'));
  fs.writeFileSync(subdirectoryEntrypoint, "export const source = 'subdirectory';\n");
  fs.writeFileSync(sameBasenameEntrypoint, "export const source = 'other-module';\n");
  fs.writeFileSync(failingEntrypoint, "throw new Error('fixture evaluation failure');\n");

  createdTempRoots.push(root);
  t.after(() => {
    delete globalThis[marker];
    delete globalThis[internalMarker];
    fs.rmSync(root, { recursive: true, force: true });
    assert.equal(fs.existsSync(root), false, 'loader fixture temp root was not removed');
  });

  return {
    root,
    marker,
    internalMarker,
    entrypoint,
    internalEntrypoint,
    subdirectoryEntrypoint,
    sameBasenameEntrypoint,
    failingEntrypoint
  };
}

test.after(() => {
  for (const root of createdTempRoots) {
    assert.equal(fs.existsSync(root), false, `OS temp residue remains: ${root}`);
  }
});

test('accepts an empty allowlist and returns a frozen minimal Loader', () => {
  const loader = createNexaEsmPublicApiLoader({ allowedEntrypoints: [] });

  assert.equal(Object.isFrozen(loader), true);
  assert.deepEqual(Object.keys(loader).sort(), ['listAllowedEntrypoints', 'load']);
  assert.deepEqual(loader.listAllowedEntrypoints(), []);
});

test('fails closed for malformed Loader configuration and entrypoint values', () => {
  for (const options of [undefined, null, {}, [], { allowedEntrypoints: 'entry.mjs' }]) {
    expectCode(() => createNexaEsmPublicApiLoader(options), 'INVALID_LOADER_CONFIG');
  }
  expectCode(
    () => createNexaEsmPublicApiLoader({ allowedEntrypoints: [], discover: true }),
    'INVALID_LOADER_CONFIG'
  );

  const absoluteJs = path.join(os.tmpdir(), 'fixture.js');
  const absoluteMjs = path.join(os.tmpdir(), 'fixture.mjs');
  const invalidEntrypoints = [
    42,
    '',
    ' relative.mjs',
    'relative.mjs',
    absoluteJs,
    pathToFileURL(absoluteMjs).href,
    `${absoluteMjs}?version=1`,
    `${absoluteMjs}#public`
  ];
  for (const entrypoint of invalidEntrypoints) {
    expectCode(
      () => createNexaEsmPublicApiLoader({ allowedEntrypoints: [entrypoint] }),
      'INVALID_ENTRYPOINT'
    );
  }
});

test('rejects duplicate canonical identities including separator and case variants', () => {
  const entrypoint = path.join(os.tmpdir(), 'NEXA-loader-duplicate', 'src', 'index.mjs');
  const dotSegmentVariant = path.join(path.dirname(entrypoint), 'sub', '..', 'index.mjs');

  expectCode(
    () => createNexaEsmPublicApiLoader({
      allowedEntrypoints: [entrypoint, dotSegmentVariant]
    }),
    'INVALID_LOADER_CONFIG'
  );

  if (process.platform === 'win32') {
    expectCode(
      () => createNexaEsmPublicApiLoader({
        allowedEntrypoints: [entrypoint, entrypoint.toUpperCase()]
      }),
      'INVALID_LOADER_CONFIG'
    );
    expectCode(
      () => createNexaEsmPublicApiLoader({
        allowedEntrypoints: [entrypoint, entrypoint.replaceAll('\\', '/')]
      }),
      'INVALID_LOADER_CONFIG'
    );
  }
});

test('loads an exact Unicode Public API entrypoint as the native ESM namespace', async (t) => {
  const fixture = createFixture(t);
  const loader = createNexaEsmPublicApiLoader({
    allowedEntrypoints: [fixture.entrypoint]
  });

  const namespace = await loader.load(fixture.entrypoint);

  assert.equal(Object.prototype.toString.call(namespace), '[object Module]');
  assert.equal(namespace.namedValue, 42);
  assert.equal(namespace.unicodeValue, '消费中心');
  assert.deepEqual(namespace.default, { kind: 'fixture-public-api' });
  assert.equal(globalThis[fixture.marker], 1);
});

test('rejects sibling, subdirectory, same-basename, and prefix-related deep imports', async (t) => {
  const fixture = createFixture(t);
  const loader = createNexaEsmPublicApiLoader({
    allowedEntrypoints: [fixture.entrypoint]
  });

  for (const deniedEntrypoint of [
    fixture.internalEntrypoint,
    fixture.subdirectoryEntrypoint,
    fixture.sameBasenameEntrypoint,
    path.join(path.dirname(fixture.entrypoint), 'index-copy.mjs')
  ]) {
    await expectRejection(() => loader.load(deniedEntrypoint), 'ENTRYPOINT_NOT_ALLOWED');
  }

  assert.equal(globalThis[fixture.internalMarker], undefined);
});

test('wraps module evaluation failure and preserves the original cause', async (t) => {
  const fixture = createFixture(t);
  const loader = createNexaEsmPublicApiLoader({
    allowedEntrypoints: [fixture.failingEntrypoint]
  });

  await assert.rejects(
    () => loader.load(fixture.failingEntrypoint),
    (error) => {
      assert.equal(error instanceof NexaEsmPublicApiLoaderError, true);
      assert.equal(error.code, 'ESM_IMPORT_FAILED');
      assert.equal(error.cause instanceof Error, true);
      assert.match(error.cause.message, /fixture evaluation failure/);
      return true;
    }
  );
});

test('construction is pure and module evaluation starts only at load', async (t) => {
  const fixture = createFixture(t);
  assert.equal(globalThis[fixture.marker], undefined);

  const loader = createNexaEsmPublicApiLoader({
    allowedEntrypoints: [fixture.entrypoint]
  });
  assert.equal(globalThis[fixture.marker], undefined);

  await loader.load(fixture.entrypoint);
  assert.equal(globalThis[fixture.marker], 1);
});

test('snapshots the source allowlist and returns defensive list copies', async (t) => {
  const fixture = createFixture(t);
  const sourceAllowlist = [fixture.entrypoint];
  const loader = createNexaEsmPublicApiLoader({ allowedEntrypoints: sourceAllowlist });
  const listedEntrypoints = loader.listAllowedEntrypoints();

  sourceAllowlist[0] = fixture.internalEntrypoint;
  sourceAllowlist.push(fixture.subdirectoryEntrypoint);
  listedEntrypoints[0] = fixture.sameBasenameEntrypoint;
  listedEntrypoints.push(fixture.internalEntrypoint);

  assert.deepEqual(loader.listAllowedEntrypoints(), [path.normalize(path.resolve(fixture.entrypoint))]);
  const namespace = await loader.load(fixture.entrypoint);
  assert.equal(namespace.namedValue, 42);
  await expectRejection(() => loader.load(fixture.internalEntrypoint), 'ENTRYPOINT_NOT_ALLOWED');
});

test('production source uses only pathToFileURL plus native import with no fallback or discovery', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'electron', 'nexaEsmPublicApiLoader.js'),
    'utf8'
  );

  assert.match(source, /pathToFileURL/);
  assert.match(source, /\bimport\s*\(\s*pathToFileURL\s*\(/);
  assert.doesNotMatch(source, /require\s*\(\s*entrypoint|require\s*\(\s*allowedEntrypoint/);
  assert.doesNotMatch(source, /readdir|glob|startsWith|scan|discover|findModule|loadDirectory|resolvePackage/i);
  assert.doesNotMatch(source, /child_process|new Function|\beval\s*\(/);
});

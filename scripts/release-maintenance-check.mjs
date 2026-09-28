#!/usr/bin/env node
/**
 * Repeatable release-maintenance check for the npm publication workflow.
 *
 * This command deliberately never publishes. It verifies the local release
 * metadata, runs the release gate, packs and inspects the actual tarball,
 * installs that tarball into an isolated prefix, and (unless explicitly
 * skipped) runs the exact-version post-publication registry smoke.
 *
 * Usage:
 *   npm run release:maintenance
 *   npm run release:maintenance -- --registry-spec @needle/fabric@1.2.3
 *   npm run release:maintenance -- --skip-registry
 */

import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_PATH = join(REPO_ROOT, 'package.json');
const LOCK_PATH = join(REPO_ROOT, 'package-lock.json');
const PACKAGE_NAME = '@needle/fabric';
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function usage(exitCode = 0) {
  process.stdout.write(`Usage: npm run release:maintenance -- [options]

Options:
  --registry-spec <spec>  exact published package, e.g. @needle/fabric@1.2.3
                          (default: @needle/fabric@<package.json version>)
  --skip-registry        stop after local metadata, gate, pack, and install checks
  -h, --help             show this help

This command never runs npm publish. Run it after publication without
--skip-registry to verify the exact registry artifact.
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  let skipRegistry = false;
  let registrySpec;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') usage(0);
    if (arg === '--skip-registry') {
      skipRegistry = true;
      continue;
    }
    if (arg === '--registry-spec') {
      registrySpec = argv[++i];
      if (!registrySpec) {
        throw new Error('--registry-spec requires @needle/fabric@<exact-version>');
      }
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return { skipRegistry, registrySpec };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function log(message) {
  process.stdout.write(`[release-maintenance] ${message}\n`);
}

function run(label, command, args) {
  log(label);
  execFileSync(command, args, { cwd: REPO_ROOT, stdio: 'inherit' });
}

function validateRegistrySpec(spec, packageVersion) {
  const prefix = `${PACKAGE_NAME}@`;
  assert(spec.startsWith(prefix), `registry spec must start with ${prefix}`);
  const version = spec.slice(prefix.length);
  assert(SEMVER.test(version), `registry spec must contain an exact semver: ${spec}`);
  assert(version === packageVersion, `registry spec ${spec} does not match package.json version ${packageVersion}`);
  return version;
}

function checkMetadata() {
  const pkg = readJson(PACKAGE_PATH);
  const lock = readJson(LOCK_PATH);
  const root = lock.packages?.[''];

  assert(pkg.name === PACKAGE_NAME, `package name is ${pkg.name}, expected ${PACKAGE_NAME}`);
  assert(typeof pkg.version === 'string' && SEMVER.test(pkg.version), `package version is not an exact semver: ${pkg.version}`);
  assert(root?.name === pkg.name, 'package-lock root name does not match package.json');
  assert(root?.version === pkg.version, 'package-lock root version does not match package.json');
  assert(pkg.bin?.fabric === './dist/cli.js', 'package bin must point to ./dist/cli.js');
  assert(Array.isArray(pkg.files) && pkg.files.includes('dist'), 'package files whitelist must include dist');
  assert(pkg.publishConfig?.access === 'public', 'publishConfig.access must be public');
  assert(pkg.publishConfig?.registry === 'https://registry.npmjs.org/', 'publishConfig.registry must target npmjs.org');
  assert(pkg.scripts?.prepack === 'npm run deploy', 'prepack must rebuild the release artifacts');
  assert(pkg.scripts?.prepublishOnly === 'npm run release:check', 'prepublishOnly must run release:check');
  assert(pkg.scripts?.['release:check']?.includes('npm test'), 'release:check must run npm test');
  assert(pkg.scripts?.['release:check']?.includes('npm run build:web'), 'release:check must build the web artifacts');
  assert(pkg.scripts?.['release:check']?.includes('npm pack --dry-run'), 'release:check must inspect npm pack contents');
  assert(pkg.scripts?.['release:publish'] === 'npm publish --access public', 'release:publish must publish publicly');
  assert(pkg.scripts?.['smoke:registry-install'] === 'bash scripts/smoke-registry-install.sh', 'registry smoke script wiring is missing');

  const readme = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');
  for (const marker of [
    'npm version patch',
    'npm run release:check',
    'npm run release:publish',
    'npm run smoke:registry-install -- @needle/fabric@<version>',
    'git push origin main --follow-tags',
  ]) {
    assert(readme.includes(marker), `README release workflow is missing: ${marker}`);
  }

  log(`metadata OK: ${pkg.name}@${pkg.version}, public npm registry, lockfile synchronized`);
  return { pkg, version: pkg.version };
}

function checkTarballAndInstall(version, workdir) {
  const packDestination = join(workdir, 'pack');
  mkdirSync(packDestination);
  run('packing the release tarball', 'npm', [
    'pack',
    '--pack-destination',
    packDestination,
    '--no-audit',
    '--no-fund',
  ]);

  const tarballs = readdirSync(packDestination)
    .filter((name) => name.endsWith('.tgz'))
    .map((name) => join(packDestination, name));
  assert(tarballs.length === 1, `expected one release tarball, found ${tarballs.length}`);
  const tarball = tarballs[0];
  const listing = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean);
  const has = (path) => listing.includes(`package/${path}`);

  assert(has('package.json'), 'release tarball is missing package.json');
  assert(has('dist/cli.js'), 'release tarball is missing dist/cli.js');
  assert(has('dist/web/public/index.html'), 'release tarball is missing the web entry point');
  assert(listing.some((path) => /^package\/dist\/web\/public\/assets\/index-[^/]+\.js$/.test(path)), 'release tarball is missing the hashed web JavaScript bundle');
  assert(listing.some((path) => /^package\/dist\/web\/public\/assets\/index-[^/]+\.css$/.test(path)), 'release tarball is missing the hashed web CSS bundle');
  assert(!listing.some((path) => path.startsWith('package/src/')), 'release tarball must not ship src/');
  assert(!listing.some((path) => path.startsWith('package/tmp/')), 'release tarball must not ship tmp/');
  log(`package contents OK: ${tarball}`);

  const install = join(workdir, 'tarball-install');
  mkdirSync(install);
  writeFileSync(join(install, 'package.json'), '{"name":"fabric-release-maintenance","private":true}\n');
  run('installing the release tarball into an isolated prefix', 'npm', [
    'install',
    '--prefix',
    install,
    tarball,
    '--no-package-lock',
    '--no-audit',
    '--no-fund',
  ]);

  const bin = join(install, 'node_modules', '.bin', 'fabric');
  const installedPackage = join(install, 'node_modules', PACKAGE_NAME);
  assert(existsSync(bin) && lstatSync(bin).isSymbolicLink(), 'tarball install did not create the fabric bin symlink');
  assert(realpathSync(bin) === join(installedPackage, 'dist', 'cli.js'), 'tarball fabric bin does not resolve to dist/cli.js');
  assert(existsSync(join(installedPackage, 'dist', 'web', 'public', 'index.html')), 'tarball install is missing packaged web assets');

  const installedVersion = readJson(join(installedPackage, 'package.json')).version;
  const versionOutput = execFileSync(bin, ['--version'], { encoding: 'utf8' }).trim();
  assert(installedVersion === version && versionOutput === version, `tarball install version mismatch: ${versionOutput} / ${installedVersion}`);
  const help = execFileSync(bin, ['--help'], { encoding: 'utf8' });
  for (const command of ['tui', 'web', 'tail', 'logs']) {
    assert(new RegExp(`\\b${command}\\b`).test(help), `installed CLI help is missing ${command}`);
  }
  log(`tarball installation OK: ${versionOutput}, bin/help/web assets verified`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const { version } = checkMetadata();
  const registrySpec = options.registrySpec ?? `${PACKAGE_NAME}@${version}`;
  validateRegistrySpec(registrySpec, version);

  const workdir = mkdtempSync(join(tmpdir(), 'fabric-release-maintenance-'));
  try {
    run('running the release gate: npm run release:check', 'npm', ['run', 'release:check']);
    checkTarballAndInstall(version, workdir);
    if (options.skipRegistry) {
      log('registry smoke skipped by --skip-registry (run without it after publication)');
    } else {
      run(`running the exact post-publication registry smoke: ${registrySpec}`, 'npm', [
        'run',
        'smoke:registry-install',
        '--',
        registrySpec,
      ]);
    }
    log('PASS: release maintenance check completed; no publication was attempted');
  } finally {
    if (process.env.RELEASE_KEEP_WORKDIR === '1') {
      log(`workdir kept (RELEASE_KEEP_WORKDIR=1): ${workdir}`);
    } else {
      rmSync(workdir, { recursive: true, force: true });
    }
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[release-maintenance] FAIL: ${message}\n`);
  process.exitCode = 1;
}

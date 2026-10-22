import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export const repository = 'Guuuu233/magpie-claude-science';

// Files that the historical npm release was allowed to contain.
const publicFiles = new Set(['package.json','README.md','README.zh-CN.md','CHANGELOG.md','LICENSE','docs/operations.zh-CN.md','docs/publishing.md']);

// Exact tarball surface for the distributable tree. Keep this list explicit:
// a new source file must be reviewed here before it can reach a tarball.
export const distributionFiles = new Set([
  'package.json','README.md','README.zh-CN.md','CHANGELOG.md','LICENSE',
  'docs/operations.zh-CN.md','docs/publishing.md',
  'src/agent.js','src/bridge.js','src/cli.js','src/config.js','src/deployment.js',
  'src/files.js','src/icon.js','src/middleware.js','src/plugin-identity.js',
  'src/processes.js','src/runtime.js','src/setup.js','src/ticket.js','src/plugin.js','src/update.js',
]);

// The local runtime is the bridge alone: a relay with no sibling modules.
export const runtimeModules = ['src/bridge.js'];

const forbiddenPaths = [
  {name:'runtime state', re:/(^|\/)state\.json$/i},
  {name:'authentication directory', re:/(^|\/)auth(\/|$)/i},
  {name:'session dump', re:/(^|\/)sessions?[^/]*\.json$/i},
  {name:'database', re:/\.db(\.|$)/i},
  {name:'log', re:/\.log(\.|$)/i},
  {name:'token file', re:/\.token(\.|$)/i},
  {name:'feature flag', re:/\.enabled(\.|$)/i},
  {name:'backup', re:/\.bak(\.|$)/i},
  {name:'canary binary directory', re:/(^|\/)canary\/bin(\/|$)/i},
  {name:'TUI binary', re:/(^|\/)magpie-tui-[^/]*$/i},
  {name:'private key', re:/\.(?:pem|key)$/i},
  {name:'environment file', re:/(^|\/)\.env(\.|$)/i},
];

// Value-bearing secret patterns. `Bearer ` and `sk-` also exist in ordinary
// source as HTTP auth code; the literal audit below keeps those occurrences
// narrow instead of weakening the check for every other file.
const secretValues = [
  {name:'API-key-looking token', re:/\bsk-[A-Za-z0-9_-]{8,}\b/},
  {name:'bearer credential', re:/\bBearer[ \t]+[A-Za-z0-9._~+/=-]{16,}\b/},
  {name:'private key block', re:/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/},
];

const allowedBearerLines = [
  /authorization/,
  /replace\(\/\^Bearer \//,
];

function isText(buffer) {
  return !buffer.includes(0);
}

function auditSecrets(file, text) {
  for (const {name, re} of secretValues) {
    assert.ok(!re.test(text), `${file} contains a ${name}`);
  }
  // A bare "Bearer " is not a secret, but it must never appear in a package
  // file except the sanctioned Authorization construction in bridge.js.
  const bearerLines = text.split('\n').filter(line => line.includes('Bearer '));
  for (const line of bearerLines) {
    assert.ok(file === 'src/bridge.js' && allowedBearerLines.some(re => re.test(line)),
      `${file} contains an unexpected Bearer credential`);
  }
  assert.ok(!text.includes('sk-'), `${file} contains an sk- token prefix`);
  assert.ok(!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text), `${file} contains a private key`);
}

export function packedFiles(root = process.cwd()) {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: root, encoding: 'utf8', timeout: 120000,
    env: {...process.env, npm_config_update_notifier: 'false'},
  });
  const parsed = JSON.parse(output);
  assert.ok(Array.isArray(parsed) && parsed[0] && Array.isArray(parsed[0].files), 'npm pack --dry-run --json returned no file list');
  return {files: parsed[0].files.map(file => file.path).sort(), filename: parsed[0].filename};
}

/**
 * Validate the exact tarball surface. `root` is required for content and
 * on-disk checks; pass `{syntax:true}` to additionally parse entrypoints.
 */
export function validateDistribution(manifest, files, root, {syntax = false} = {}) {
  assert.ok(root, 'validateDistribution requires the package root');
  assert.equal(manifest.name, 'magpie-claude-science');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.private, undefined, 'Package must be public');
  assert.equal(manifest.repository?.url, `git+https://github.com/${repository}.git`);
  assert.equal(manifest.bin?.['magpie-claude-science'], 'src/cli.js');
  assert.equal(manifest.main, './src/plugin.js');
  assert.ok(manifest.files?.includes('src/*.mjs'), 'package.json files must include src/*.mjs');
  assert.ok(manifest.magpie?.agent === './src/agent.js' && manifest.magpie?.middleware === './src/middleware.js',
    'Magpie agent/middleware entrypoints changed');

  for (const hook of ['preinstall','install','postinstall','prepare','prepack','postpack','prepublish','prepublishOnly','publish','postpublish']) {
    assert.ok(!manifest.scripts?.[hook], `Forbidden lifecycle hook: ${hook}`);
  }

  const seen = new Set();
  for (const file of files) {
    assert.equal(typeof file, 'string');
    assert.ok(file && !path.isAbsolute(file) && !file.split('/').includes('..'), `Unsafe packed path: ${file}`);
    assert.ok(!seen.has(file), `Duplicate packed path: ${file}`);
    seen.add(file);
    assert.ok(distributionFiles.has(file), `Unexpected package file: ${file}`);
    for (const {name, re} of forbiddenPaths) assert.ok(!re.test(file), `Forbidden ${name} packed: ${file}`);
    const absolute = path.join(root, file);
    const stat = fs.lstatSync(absolute);
    assert.ok(!stat.isSymbolicLink(), `Packed file is a symlink: ${file}`);
    const bytes = fs.readFileSync(absolute);
    assert.ok(isText(bytes), `Binary file packed: ${file}`);
    auditSecrets(file, bytes.toString('utf8'));
  }

  for (const file of runtimeModules) assert.ok(seen.has(file), `Missing accepted runtime module: ${file}`);
  for (const file of ['package.json','README.md','README.zh-CN.md','CHANGELOG.md','LICENSE',
    'docs/operations.zh-CN.md','docs/publishing.md','src/cli.js','src/runtime.js','src/plugin.js','src/agent.js','src/middleware.js']) {
    assert.ok(seen.has(file), `Missing package file: ${file}`);
  }

  if (syntax) {
    const entrypoints = ['src/cli.js','src/runtime.js','src/plugin.js','src/bridge.js','src/deployment.js','src/agent.js','src/middleware.js',
      ...runtimeModules.filter(file => file.endsWith('.mjs'))];
    for (const file of [...new Set(entrypoints)]) {
      execFileSync(process.execPath, ['--check', path.join(root, file)], {cwd: root, stdio: 'pipe'});
    }
  }
  return true;
}

export function validatePackage(manifest, files) {
  assert.equal(manifest.name, 'magpie-claude-science');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.notEqual(manifest.private,true,'Package must be public');
  assert.equal(manifest.repository?.url, `git+https://github.com/${repository}.git`);
  assert.equal(manifest.bin?.['magpie-claude-science'],'src/cli.js');
  for (const hook of ['preinstall','install','postinstall','prepare','prepack','postpack','prepublish','prepublishOnly','publish','postpublish']) assert.ok(!manifest.scripts?.[hook], `Forbidden lifecycle hook: ${hook}`);
  for (const file of files) assert.ok(publicFiles.has(file) || /^src\/[a-zA-Z0-9_-]+\.js$/.test(file), `Unexpected package file: ${file}`);
  for (const file of ['package.json','src/cli.js','src/agent.js','src/middleware.js','README.md','README.zh-CN.md','LICENSE']) assert.ok(files.includes(file), `Missing package file: ${file}`);
}

export function validateRelease(manifest, context) {
  const mode=context.mode??'manual';
  assert.ok(['manual','automatic'].includes(mode),'Unknown release mode');
  if(mode==='manual'){
    assert.equal(context.event,'workflow_dispatch','Manual release must be dispatched');
    assert.equal(context.sourceRef??context.ref,context.ref,'Manual dispatch must run on its release tag');
    assert.equal(context.sourceSha??context.sha,context.sha,'Manual dispatch differs from release commit');
  }else{
    assert.equal(context.event,'push','Automatic release must originate from a main push');
    assert.equal(context.sourceRef,'refs/heads/main','Automatic release source must be main');
    assert.match(context.sourceSha,/^[a-f0-9]{40}$/);
    assert.equal(context.created,true,'Release Please must have created a release');
    assert.equal(context.sha,context.sourceSha,'Automatic release must use the triggering commit for truthful npm provenance; recover older tags manually');
  }
  assert.equal(context.repository,repository,'Wrong source repository');
  assert.match(manifest.version,/^\d+\.\d+\.\d+$/);
  assert.equal(context.ref,`refs/tags/v${manifest.version}`,'Release tag must match the package version');
  assert.match(context.sha,/^[a-f0-9]{40}$/);
  assert.equal(context.head,context.sha,'Checkout differs from dispatch commit');
  assert.equal(context.tagCommit,context.sha,'Tag differs from dispatch commit');
  assert.equal(context.dirty,'','Release source must be clean');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root=process.cwd();
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  const {files}=packedFiles(root);
  validateDistribution(manifest,files,root,{syntax:true});
  console.log(`PASS: release check; ${files.length} allowlisted files, accepted runtime modules present, entrypoints parse.`);
}

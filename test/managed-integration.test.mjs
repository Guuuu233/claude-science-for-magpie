import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createInstaller} from '../src/cli.js';
import {readProcessIdentity, signalOwnedDaemon} from '../src/processes.js';

const project = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 6000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (check()) return;
    await pause(40);
  }
  throw Error('Timed out waiting for managed integration cleanup');
}

test('installer and copied runtime install, upgrade and uninstall against isolated services', {timeout: 90000}, async () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'science-managed-')));
  const configRoot = path.join(home, '.config', 'magpie');
  const root = path.join(configRoot, 'claude-science-runtime');
  const stateFile = path.join(root, 'state.json');
  const originalConfig = path.join(home, '.claude-science', 'config.toml');
  const original = '# Native configuration\ndisable_telemetry = false\n';
  const children = [];
  let manager, state;
  let serviceOutput = '';
  const gateway = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/hello') res.end(JSON.stringify({name: 'magpie'}));
    else if (req.url === '/v1/models') res.end(JSON.stringify({data: [{id: 'fake/first'}, {id: 'fake/second'}]}));
    else { res.statusCode = 404; res.end('{}'); }
  });
  await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
  const gatewayURL = `http://127.0.0.1:${gateway.address().port}`;
  const env = {...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), FIXTURE_GATEWAY: gatewayURL};
  const magpie = path.join(home, 'fake-magpie');
  const science = path.join(home, 'fake-science');
  fs.mkdirSync(path.dirname(originalConfig), {recursive: true});
  fs.writeFileSync(originalConfig, original);
  fs.writeFileSync(magpie, `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
const root = path.join(process.env.HOME, '.config', 'magpie');
fs.mkdirSync(root, {recursive:true});
const file = path.join(root, 'plugins.json');
const plugins = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)).plugins : [];
const [command, action, spec, value] = process.argv.slice(2);
if (command === 'plugin') {
  let entry = plugins.find(p => p.spec === spec);
  if (action === 'add' && !entry) { entry = {spec}; plugins.push(entry); }
  if (action === 'on') entry.off = false;
  if (action === 'off') entry.off = true;
  if (action === 'options') entry.options = JSON.parse(value);
  if (action === 'rm' && entry) plugins.splice(plugins.indexOf(entry), 1);
  fs.writeFileSync(file, JSON.stringify({plugins}));
} else if (command === 'claude-science') {
  const selection = action === 'default' ? {} : {model:action, key:'magpie-claude-science', gateway:process.env.FIXTURE_GATEWAY};
  fs.writeFileSync(path.join(root, 'claude-science.json'), JSON.stringify(selection));
} else process.exit(2);
`, {mode: 0o700});
  fs.writeFileSync(science, `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
if (process.argv[2] === 'stop') process.exit(0);
const arg = name => process.argv[process.argv.indexOf(name) + 1];
const data = arg('--data-dir'), port = Number(arg('--port'));
fs.mkdirSync(data, {recursive:true});
const lock = path.join(data, 'operon.lock');
const server = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end('{"status":"healthy"}'); });
server.listen(port, '127.0.0.1', () => fs.writeFileSync(lock, JSON.stringify({pid:process.pid, port, sandbox_port:Number(arg('--sandbox-port')), version:'fixture-managed'})));
process.on('SIGTERM', () => { try { fs.unlinkSync(lock); } catch {} server.close(() => process.exit(0)); });
`, {mode: 0o700});
  const run = (binary, args, allowFailure = false) => {
    if (binary === '/bin/launchctl') {
      if (args[0] === 'bootstrap') {
        const current = JSON.parse(fs.readFileSync(stateFile));
        manager = spawn(current.node, [path.join(current.pluginSpec, 'src', 'runtime.js'), stateFile], {env, stdio: ['ignore', 'pipe', 'pipe']});
        children.push(manager);
        manager.stdout.on('data', bytes => { serviceOutput += bytes; });
        manager.stderr.on('data', bytes => { serviceOutput += bytes; });
      } else if (args[0] === 'bootout') manager?.kill('SIGTERM');
      else throw Error('Unexpected launchctl operation: ' + args[0]);
      return {status: 0, stdout: '', stderr: ''};
    }
    const result = spawnSync(binary, args, {env, encoding: 'utf8', timeout: 5000});
    if (!allowFailure && (result.error || result.status !== 0)) throw Error(result.error?.message || result.stderr || `${binary} failed`);
    return result;
  };
  const installer = createInstaller({home, project, platform: 'darwin', env, run, log: () => {}});
  try {
    state = await installer.execute({command: 'install', model: 'fake/first', gateway: gatewayURL, magpie, science, sciencePort: 0, sandboxPort: 0, bridgePort: 0});
    const status = () => JSON.parse(fs.readFileSync(state.statusFile));
    assert.equal(status().state, 'running', serviceOutput);
    assert.equal(status().pid, manager.pid);
    assert.equal(status().pluginSpec, state.pluginSpec);
    assert.equal(status().scienceVersion, 'fixture-managed');
    assert.equal(fs.readFileSync(originalConfig, 'utf8'), fs.readFileSync(state.scienceConfig, 'utf8'));
    assert.notEqual(fs.readFileSync(originalConfig, 'utf8'), original);
    const firstSciencePid = status().sciencePid;
    const firstManager = manager;
    fs.writeFileSync(path.join(state.data, 'session-fixture'), 'retained');

    state = await installer.execute({command: 'upgrade', model: 'fake/second'});
    assert.equal(status().state, 'running', serviceOutput);
    assert.equal(status().model, 'fake/second');
    assert.notEqual(manager.pid, firstManager.pid);
    assert.notEqual(status().sciencePid, firstSciencePid);
    assert.equal(readProcessIdentity(firstSciencePid), null);
    assert.equal(fs.readFileSync(path.join(state.data, 'session-fixture'), 'utf8'), 'retained');
    const finalSciencePid = status().sciencePid;

    await installer.execute({command: 'uninstall'});
    await until(() => manager.exitCode !== null || manager.signalCode !== null);
    assert.equal(status().state, 'stopped', serviceOutput);
    assert.equal(readProcessIdentity(finalSciencePid), null);
    assert.equal(fs.readFileSync(originalConfig, 'utf8'), original);
    assert.equal(JSON.parse(fs.readFileSync(stateFile)).installed, false);
    assert.deepEqual(JSON.parse(fs.readFileSync(state.pluginsFile)).plugins, []);
    assert.equal(fs.existsSync(path.join(root, 'runtime-owner.json')), false);
    assert.equal(fs.existsSync(path.join(root, 'daemon-lease.json')), false);
    assert.equal(fs.existsSync(path.join(home, 'Library', 'LaunchAgents', 'ai.magpie.claude-science.plist')), false);
  } catch (error) {
    error.message += '\nRuntime output:\n' + serviceOutput;
    throw error;
  } finally {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        try { await until(() => child.exitCode !== null || child.signalCode !== null); }
        catch { child.kill('SIGKILL'); await until(() => child.exitCode !== null || child.signalCode !== null); }
      }
    }
    try {
      const current = JSON.parse(fs.readFileSync(stateFile));
      const lease = JSON.parse(fs.readFileSync(path.join(root, 'daemon-lease.json')));
      signalOwnedDaemon(lease, current, 'SIGKILL');
    } catch {}
    gateway.closeAllConnections();
    await new Promise(resolve => gateway.close(resolve));
    fs.rmSync(home, {recursive: true, force: true});
  }
});

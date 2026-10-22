// Magpie's Bun plugin-host entrypoint. Not the Science background daemon.
// A GitHub plugin install opts in to this local-only setup, and to updating
// the local service when Magpie updates the plugin.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {activeSciencePids,scienceAppPids} from './processes.js';
import {updateNeeded,busyReason} from './update.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function localNode(env = process.env, home = os.homedir(), probe = spawnSync) {
  const candidateDirs = [
    ...(env.PATH || '').split(path.delimiter).filter(Boolean),
    '/opt/homebrew/bin', '/usr/local/bin',
    path.join(home, '.volta/bin'),
    path.join(home, '.nvm/current/bin'),
    path.join(home, '.local/share/mise/shims'),
  ];
  for (const parent of [
    path.join(home,'.nvm/versions/node'),
    path.join(home,'.asdf/installs/node'),
    path.join(home,'.local/share/mise/installs/node'),
  ]) {
    try {
      const versions = fs.readdirSync(parent, {withFileTypes:true})
        .filter(entry=>entry.isDirectory() && /^v?\d/.test(entry.name))
        .map(entry=>entry.name).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
      for (const version of versions) candidateDirs.push(path.join(parent,version,'bin'));
    } catch (error) {if (error.code!=='ENOENT') throw error;}
  }
  const names = candidateDirs.map(dir=>path.join(dir,'node'));
  for (const file of new Set(names)) {
    try {
      fs.accessSync(file, fs.constants.X_OK);
      if (!fs.statSync(file).isFile()) continue;
      const result = probe(file,['--version'],{encoding:'utf8',timeout:2500});
      const major = /^v?(\d+)\./.exec(result.stdout?.trim()||'');
      if (result.status===0 && Number(major?.[1])>=22) return file;
    } catch {}
  }
  throw Error('Node.js 22+ not found (also checked nvm/asdf/mise/Volta); install Node.js 22+ and re-enable this plugin.');
}

function launchSetup({env = process.env, home = os.homedir(), platform = process.platform, spawnProcess = spawn, nodeResolver = localNode, findScience = activeSciencePids, findApp = scienceAppPids, project = root} = {}) {
  if (env.MAGPIE_SCIENCE_DISABLE_AUTOINSTALL === '1') return {launched: false, reason: 'disabled in isolated test'};
  if (platform !== 'darwin') return {launched: false, reason: 'macOS required'};
  const stateDir = path.join(home, '.config', 'magpie', 'claude-science-runtime');
  const stateFile = path.join(stateDir, 'state.json');
  let command = 'autoinstall';
  if (fs.existsSync(stateFile)) {
    // An installation made from Magpie Plugins follows the plugin's updates,
    // but only while Science is idle; anything else is managed explicitly.
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (!updateNeeded(state, project)) return {launched: false, reason: 'existing Science state is current or managed explicitly'};
    const busy = busyReason(state, {findApp});
    if (busy) return {launched: false, retry: true, reason: 'Science update waits: ' + busy};
    command = 'autoupgrade';
  }
  const running = command === 'autoinstall' ? findScience() : [];
  if (running.length) {
    const note = 'Claude Science is running; automatic setup skipped to protect active tasks. Quit Science and re-enable the plugin.';
    fs.mkdirSync(stateDir,{recursive:true,mode:0o700});
    fs.appendFileSync(path.join(stateDir,'autoinstall.log'),note+'\n',{mode:0o600});
    return {launched:false,reason:note};
  }
  let node;
  try {
    node = nodeResolver(env,home);
  } catch (error) {
    fs.mkdirSync(stateDir,{recursive:true,mode:0o700});
    fs.appendFileSync(path.join(stateDir,'autoinstall.log'),String(error.message)+'\n',{mode:0o600});
    throw error;
  }
  fs.mkdirSync(stateDir, {recursive: true, mode: 0o700});
  const marker = path.join(stateDir, 'autoinstall-started.json');
  // Host startup can happen more than once when the plugin options change.
  // Avoid launching competing installers while waiting for the real state
  // and lock to be initialized. Failed starts are eligible to retry later.
  if (fs.existsSync(marker)) {
    const age = Date.now() - fs.statSync(marker).mtimeMs;
    if (age < 60000) return {launched: false, reason: 'installer started recently'};
    fs.unlinkSync(marker);
  }
  try {
    fs.writeFileSync(marker, JSON.stringify({startedAt: new Date().toISOString()}) + '\n', {flag: 'wx', mode: 0o600});
  } catch (error) {
    if (error.code === 'EEXIST') return {launched: false, reason: 'another installer starting'};
    throw error;
  }
  const logFile = path.join(stateDir, 'autoinstall.log');
  try {
    const log = fs.openSync(logFile, 'a', 0o600);
    try {
      const child = spawnProcess(node, [path.join(project, 'src', 'cli.js'), command], {
        cwd: project, env: {...env, HOME: home}, detached: true,
        stdio: ['ignore', log, log],
      });
      child.unref?.();
      return {launched: true, reason: command === 'autoupgrade' ? 'update started' : 'installation started'};
    } finally {
      fs.closeSync(log);
    }
  } catch (error) {
    fs.unlinkSync(marker);
    throw error;
  }
}

// Magpie discovers this entry from package.json's main field. Export one
// plugin function only: importing the background daemon directly used to
// make Magpie call runRuntime() with plugin input and fail on missing state.
const RETRY_MS = 5 * 60 * 1000;
export const ScienceSetupPlugin = async ({client} = {}) => {
  const attempt = () => {
    try {
      const result = launchSetup();
      if (result.launched) client?.app?.log?.({service: 'claude-science', level: 'info', message: result.reason === 'update started' ? 'Local Science service is updating; it is back in about a minute.' : 'Local Science setup started; reopen Science after completion.'});
      else if (result.reason.includes('Science is running')) client?.app?.log?.({service:'claude-science',level:'warn',message:result.reason});
      return result.retry === true;
    } catch (error) {
      client?.app?.log?.({service: 'claude-science', level: 'error', message: 'Automatic Science setup unavailable: ' + String(error.message).slice(0, 180)});
      return false;
    }
  };
  // A pending update is tried again while this host runs, never mid-task.
  if (attempt()) {
    const timer = setInterval(() => { if (!attempt()) clearInterval(timer); }, RETRY_MS);
    timer.unref?.();
  }
  return {};
};

// Non-function export is not invoked as a second plugin by Magpie's loader.
export const _internal = {launchSetup, localNode};

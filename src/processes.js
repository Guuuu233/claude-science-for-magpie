import {spawnSync} from 'node:child_process';
import fs from 'node:fs';

// Only exact Science executable names count: the plugin installer itself
// runs under node with "magpie-claude-science" in argv and must not match.
// Use comm rather than argv to avoid scanning or logging user conversations.
function pidsNamed(names, run) {
  const result = run('/bin/ps', ['-axo', 'pid=,comm='], {encoding:'utf8',timeout:2500});
  if (result.error || result.status !== 0 || typeof result.stdout !== 'string' || !result.stdout.trim())
    throw Error('Cannot inspect running Science processes; automatic setup refused');
  const pids = [];
  for (const line of result.stdout.split('\n')) {
    const found = line.match(/^\s*(\d+)\s+(.*?)\s*$/);
    if (!found) continue;
    if (names.includes(found[2].split('/').at(-1))) pids.push(Number(found[1]));
  }
  return pids;
}
export function activeSciencePids(run = spawnSync) {
  return pidsNamed(['ClaudeScience', 'claude-science'], run);
}
// The Science window only: the managed daemon (claude-science) runs while
// the integration is installed, so it alone does not mean someone is working.
export function scienceAppPids(run = spawnSync) {
  return pidsNamed(['ClaudeScience'], run);
}

// PID alone is not ownership: include the kernel's start time and full argv.
export function readProcessIdentity(pid) {
  if(!Number.isSafeInteger(pid)||pid<=1)return null;
  const result=spawnSync('/bin/ps',['-ww','-p',String(pid),'-o','lstart=','-o','command='],{encoding:'utf8',timeout:2000});
  return result.status===0&&result.stdout.trim()?result.stdout.trim():null;
}
function argument(identity,flag,value){
  if(typeof value!=='string'||!value||/[\r\n\0]/.test(value))return false;
  return (identity+' ').includes(` ${flag} ${value} `);
}
export function ownsDaemon(lease,state){
  return Boolean(lease&&lease.data===state.data&&lease.config===state.scienceConfig&&
    typeof lease.identity==='string'&&lease.identity===readProcessIdentity(lease.pid)&&
    argument(lease.identity,'--data-dir',state.data)&&argument(lease.identity,'--config',state.scienceConfig));
}
export function signalOwnedDaemon(lease,state,signal='SIGTERM'){
  if(!['SIGTERM','SIGKILL'].includes(signal))throw Error('Unsupported daemon signal');
  if(!ownsDaemon(lease,state))return false;
  try{process.kill(lease.pid,signal);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}
}

export function acquireRuntimeOwner(file,owner){
  // A separate short-lived exclusive lock serializes stale-record recovery.
  // An interrupted recovery is left for explicit inspection, never guessed away.
  let fd;
  try{fd=fs.openSync(file+'.recovery','wx',0o600);}
  catch(e){if(e.code==='EEXIST')throw Error('Another startup or interrupted recovery owns '+file+'.recovery');throw e;}
  try{
    fs.writeFileSync(fd,JSON.stringify(owner));
    let current;
    try{if(fs.lstatSync(file).isSymbolicLink())throw Error('Refusing symlink owner record');current=JSON.parse(fs.readFileSync(file,'utf8'));}
    catch(e){if(e.code!=='ENOENT')throw e;}
    if(current&&current.identity===readProcessIdentity(current.pid))throw Error('Another Science integration service owns this profile');
    if(current)fs.unlinkSync(file);
    fs.writeFileSync(file,JSON.stringify(owner),{flag:'wx',mode:0o600});
  }finally{fs.closeSync(fd);fs.unlinkSync(file+'.recovery');}
}

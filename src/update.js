// When Magpie updates this plugin, the local service still runs its own
// staged copy. These checks decide whether that copy is behind, and whether
// Science is quiet enough to replace it without cutting into someone's work.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isSciencePlugin} from './plugin-identity.js';
import {scienceAppPids} from './processes.js';

export const QUIET_MS=10*60*1000;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const readJSON=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}};

// The plugin's own code as a deployment manifest records it; the copied
// Node executable and dependencies are not part of the comparison.
function sourceManifest(project){
  const out={};
  const walk=(dir,rel)=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const r=path.join(rel,e.name);if(e.isDirectory())walk(path.join(dir,e.name),r);else if(e.isFile())out[r]=hash(fs.readFileSync(path.join(dir,e.name)));}};
  walk(path.join(project,'src'),'src');
  out['package.json']=hash(fs.readFileSync(path.join(project,'package.json')));
  return out;
}

// Only an installation that came from Magpie Plugins (GitHub or npm) follows
// the plugin; one set up from a local checkout is left to its owner.
export function updateNeeded(state,project){
  if(!state?.installed||!state.deployment||!isSciencePlugin(state.registrySpec))return false;
  if(path.resolve(project)===state.deployment.path)return false;
  const manifest=readJSON(path.join(state.deployment.path,'manifest.json'));
  if(!manifest)return false;
  const deployed=Object.fromEntries(Object.entries(manifest).filter(([name])=>name.startsWith('src/')||name==='package.json'));
  const current=sourceManifest(project);
  return [...new Set([...Object.keys(deployed),...Object.keys(current)])].some(name=>deployed[name]!==current[name]);
}

// Why an update must wait, or null when Science is idle: its window is
// closed, no request is open, and none ran in the last ten minutes (a task
// between two model calls is still running its tools).
export function busyReason(state,{now=Date.now(),findApp=scienceAppPids}={}){
  if(findApp().length)return 'Claude Science is open';
  const status=readJSON(state.statusFile);
  if(status&&now-Date.parse(status.at)<30000&&status.bridge?.inFlight>0)return 'a Science request is in progress';
  let last=Date.parse(status?.bridge?.lastActivityAt||'')||0;
  try{last=Math.max(last,fs.statSync(path.join(path.dirname(state.statusFile),'bridge.log')).mtimeMs);}catch{}
  if(now-last<QUIET_MS)return 'Science was active in the last 10 minutes';
  return null;
}

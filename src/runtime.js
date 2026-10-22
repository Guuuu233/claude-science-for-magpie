import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {enabledSciencePlugins} from './plugin-identity.js';
import {createBridge,validateConfig} from './bridge.js';
import {managedWrite,restoreAll} from './files.js';
import {readProcessIdentity,ownsDaemon,signalOwnedDaemon,acquireRuntimeOwner} from './processes.js';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function readJSON(file){
  try{if(fs.lstatSync(file).isSymbolicLink())throw Error('Refusing a symlink runtime record');return JSON.parse(fs.readFileSync(file,'utf8'));}
  catch(e){if(e.code==='ENOENT')return null;throw e;}
}
function atomicJSON(file,value){
  const tmp=file+'.'+randomBytes(6).toString('hex')+'.tmp';
  try{fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(tmp,file);}finally{try{fs.unlinkSync(tmp);}catch(e){if(e.code!=='ENOENT')throw e;}}
}
function stamp(file){const s=fs.statSync(file,{bigint:true});return [s.dev,s.ino,s.size,s.mtimeNs].join(':');}

export async function runRuntime(state,{pollMs=2000,startTimeoutMs=600000,stopTimeoutMs=8000,backoffMs=10000}={}){
  const pluginSpec=state.pluginSpec||state.project;
  const root=path.dirname(state.statusFile), leaseFile=path.join(root,'daemon-lease.json'), ownerFile=path.join(root,'runtime-owner.json');
  const owner={pid:process.pid,identity:readProcessIdentity(process.pid)};
  if(!owner.identity)throw Error('Cannot establish runtime process identity');
  let child=null,lease=null,stopping=false,timer=null,inFlight=null,initializing=null,shuttingDown=null,retryAt=0,lastError='';
  let binaryStamp=null,scienceVersion=null,active=false,activePluginSpec=null;
  function status(value){atomicJSON(state.statusFile,{at:new Date().toISOString(),...owner,pluginSpec,activePluginSpec,...value});}
  function selected(){
    const c=readJSON(state.agentConfig),p=readJSON(state.pluginsFile);
    const entries=enabledSciencePlugins(p,[pluginSpec,state.project]);
    const entry=entries.find(x=>x.spec===pluginSpec)||entries[0];
    activePluginSpec=entry?.spec||null;
    if(state.installed===false||!entry||entry.off)throw Error('Science is disconnected in Magpie');
    // Magpie 0.1.1285 writes native Science metadata (url/pid/port)
    // to agentConfig, so use the explicitly enabled plugin's own options.
    const pluginConfig=entry.options||{};
    const legacyConfig=c?.key==='magpie-claude-science'?c:{};
    return validateConfig({
      ...legacyConfig,
      model:pluginConfig.model||legacyConfig.model||state.model,
      ...(pluginConfig.claude||state.claude?{claude:pluginConfig.claude||state.claude}:{}),
      gateway:state.gatewayOverride?state.gateway:pluginConfig.gateway||legacyConfig.gateway||state.gateway,
      key:legacyConfig.key||'magpie-claude-science',
      token:state.token
    });
  }
  function restore(){
    const result=restoreAll(state.configJournal);active=false;
    if(result.conflicts.length)throw Error('Science configuration has user edits; automatic restoration refused. Run doctor.');
  }
  function removeLease(){try{fs.unlinkSync(leaseFile);}catch(e){if(e.code!=='ENOENT')throw e;}lease=null;}
  async function stopLease(record){
    if(!ownsDaemon(record,state))return;
    signalOwnedDaemon(record,state);const deadline=Date.now()+stopTimeoutMs;
    while(Date.now()<deadline&&ownsDaemon(record,state))await sleep(40);
    if(ownsDaemon(record,state)){
      signalOwnedDaemon(record,state,'SIGKILL');
      for(let i=0;i<25&&ownsDaemon(record,state);i++)await sleep(40);
      if(ownsDaemon(record,state))throw Error('Owned Science daemon did not stop');
    }
  }
  async function stopChild(){
    const proc=child;child=null;
    if(lease)await stopLease(lease);
    // A ChildProcess handle is used only before the daemon lease is established.
    else if(proc&&proc.exitCode===null&&proc.signalCode===null){proc.kill('SIGTERM');await sleep(100);if(proc.exitCode===null&&proc.signalCode===null)proc.kill('SIGKILL');}
    removeLease();scienceVersion=null;binaryStamp=null;
  }
  async function waitReady(proc){
    const deadline=Date.now()+startTimeoutMs;
    while(Date.now()<deadline&&!stopping){
      if(proc.exitCode!==null||proc.signalCode!==null)throw Error('Science exited before becoming ready');
      const lock=readJSON(path.join(state.data,'operon.lock'));
      if(lock?.pid===proc.pid&&lock.port===state.sciencePort&&(!state.sandboxPort||lock.sandbox_port===state.sandboxPort)){
        try{
          const response=await fetch(`http://127.0.0.1:${state.sciencePort}/health`,{signal:AbortSignal.timeout(750)});
          const body=await response.json();
          if(response.ok&&body.status==='healthy'){
            const identity=readProcessIdentity(proc.pid);
            const candidate={pid:proc.pid,identity,data:state.data,config:state.scienceConfig};
            if(ownsDaemon(candidate,state))return {candidate,version:lock.version};
          }
        }catch{}
      }
      await sleep(60);
    }
    throw Error(stopping?'Startup cancelled':'Science readiness timed out; no owned healthy daemon');
  }
  async function startChild(){
    binaryStamp=stamp(state.binary);
    const fingerprint=createHash('sha256').update(fs.readFileSync(state.binary)).digest('hex');
    const log=fs.openSync(state.scienceLog,'a',0o600);
    const args=['serve','--config',state.scienceConfig,'--data-dir',state.data,'--port',String(state.sciencePort),'--no-browser','--no-auto-update'];
    if(state.sandboxPort)args.push('--sandbox-port',String(state.sandboxPort));
    const proc=spawn(state.binary,args,{env:{...process.env,ANTHROPIC_BASE_URL:`http://127.0.0.1:${state.bridgePort}`,ANTHROPIC_API_KEY:'',ANTHROPIC_AUTH_TOKEN:'',NO_PROXY:'127.0.0.1,localhost,::1',no_proxy:'127.0.0.1,localhost,::1'},stdio:['ignore',log,log]});
    fs.closeSync(log);child=proc;
    let spawnError=null;
    proc.on('error',e=>{spawnError=e;});
    proc.on('exit',()=>{
      if(child===proc&&active){try{restore();}catch(e){status({state:'error',error:e.message});}}
    });
    await new Promise((resolve,reject)=>{proc.once('spawn',resolve);proc.once('error',reject);});
    lease={pid:proc.pid,identity:readProcessIdentity(proc.pid),data:state.data,config:state.scienceConfig,fingerprint};
    if(!ownsDaemon(lease,state))throw Error('Cannot establish Science daemon ownership');
    atomicJSON(leaseFile,lease);
    status({state:'starting',sciencePid:proc.pid});
    const ready=await waitReady(proc);
    if(spawnError||stopping||proc.exitCode!==null||proc.signalCode!==null)throw Error('Science startup was interrupted');
    lease={...ready.candidate,fingerprint};atomicJSON(leaseFile,lease);scienceVersion=ready.version;
    // Keep the original App's configuration intact until its daemon is verified.
    managedWrite(state.originalConfig,fs.readFileSync(state.scienceConfig),state.configJournal);active=true;
  }
  async function tick(){
    if(stopping)return;
    let c;try{c=selected();}catch{
      await stopChild();restore();status({state:'disconnected'});return;
    }
    if(child&&child.exitCode===null&&child.signalCode===null){
      let changed=true;try{changed=stamp(state.binary)!==binaryStamp;}catch{}
      status({state:'running',sciencePid:child.pid,scienceIdentity:lease?.identity,scienceVersion,model:c.model,bridgePort:state.bridgePort,sciencePort:state.sciencePort,bridge:bridge.activity(),restartRequired:changed,
        ...(changed?{notice:'Science executable changed. Finish current tasks and restart the integration.'}:{})});return;
    }
    if(child){await stopChild();restore();}
    if(Date.now()<retryAt)return;
    const hello=await fetch(c.gateway+'/api/hello',{signal:AbortSignal.timeout(2500)}).then(r=>r.json());
    if(stopping)return;if(hello.name!=='magpie')throw Error('The configured gateway is not Magpie');
    await startChild();
  }
  const bridge=createBridge(selected);
  async function shutdown(){
    if(shuttingDown)return shuttingDown;
    stopping=true;clearTimeout(timer);
    shuttingDown=(async()=>{
      if(initializing)await initializing.catch(()=>{});
      if(inFlight)await inFlight;
      let error;
      try{await stopChild();restore();}catch(e){error=e.message;}
      bridge.closeAllConnections();if(bridge.listening)await new Promise(r=>bridge.close(r));
      const current=readJSON(ownerFile);if(current?.pid===owner.pid&&current.identity===owner.identity)fs.unlinkSync(ownerFile);
      status({state:error?'error':'stopped',...(error?{error}:{})});
      process.off('SIGTERM',onSignal);process.off('SIGINT',onSignal);
    })();return shuttingDown;
  }
  function onSignal(){shutdown().then(()=>{process.exitCode=0;},()=>{process.exitCode=1;});}
  async function loop(){
    inFlight=(async()=>{
      try{await tick();lastError='';}
      catch(e){
        retryAt=Date.now()+backoffMs;
        if(lastError!==e.message){console.error(e.message);lastError=e.message;}
        let restoreError;try{await stopChild();restore();}catch(x){restoreError=x.message;}
        status({state:'error',error:e.message,...(restoreError?{restoreError}:{})});
      }
    })();await inFlight;inFlight=null;
    if(!stopping)timer=setTimeout(loop,pollMs);
  }
  acquireRuntimeOwner(ownerFile,owner);
  process.on('SIGTERM',onSignal);process.on('SIGINT',onSignal);
  initializing=(async()=>{
    const old=readJSON(leaseFile);if(old)await stopLease(old);removeLease();restore();
    if(stopping)return;
    await new Promise((resolve,reject)=>{bridge.once('error',reject);bridge.listen(state.bridgePort,'127.0.0.1',resolve);});
    if(stopping)return;
    bridge.on('error',e=>{console.error('Bridge failed:',e.code);shutdown();});
    console.log('Science integration service ready');loop();
  })();
  try{await initializing;}catch(e){initializing=null;await shutdown();throw e;}
  initializing=null;
  return {shutdown};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  try{await runRuntime(readJSON(process.argv[2]));}catch(e){console.error(e.message);process.exitCode=1;}
}

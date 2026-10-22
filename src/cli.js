#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createInterface} from 'node:readline/promises';
import {enabledSciencePlugins} from './plugin-identity.js';
import {makeTicket} from './ticket.js';
import {adoptManaged,managedWrite,restoreAll} from './files.js';
import {activeSciencePids,scienceAppPids} from './processes.js';
import {updateNeeded,busyReason} from './update.js';
import {scienceConfig,checkOriginalConfig,launchPlist,label} from './setup.js';
import {parseArgs,help,resolveGateway,selectModel,discoverBinary,reservePorts} from './config.js';
import {stageDeployment,verifyDeployment,validateNodeLibraries} from './deployment.js';
const sourceProject=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read=file=>{try{return fs.readFileSync(file,'utf8');}catch(e){if(e.code==='ENOENT')return '';throw e;}};
const json=file=>JSON.parse(read(file)||'null');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function defaultRun(bin,args,allowFailure=false){const r=spawnSync(bin,args,{encoding:'utf8',timeout:45000,env:{...process.env,MAGPIE_NO_STATS:'1'}});if(!allowFailure&&(r.status!==0||r.error))throw Error(`${path.basename(bin)} ${args[0]} failed: ${r.error?.message||r.stderr?.trim()||r.stdout?.trim()}`);return r;}

export function createInstaller(deps={}) {
  const home=deps.home||os.homedir(), project=deps.project||sourceProject,env=deps.env||process.env;
  const root=path.join(home,'.config','magpie','claude-science-runtime'),configRoot=path.dirname(root);
  const stateFile=path.join(root,'state.json'),privateJournal=path.join(root,'private-journal.json'),installJournal=path.join(root,'install-journal.json');
  const plist=path.join(home,'Library','LaunchAgents',label+'.plist'),domain=`gui/${process.getuid?.()??0}`;
  const run=deps.run||defaultRun,fetcher=deps.fetch||fetch,log=deps.log||console.log;
  const findScience=deps.findScience||activeSciencePids,findApp=deps.findApp||scienceAppPids;
  const save=(file,content)=>managedWrite(file,content,privateJournal);
  const ownedManager=state=>{const status=json(state.statusFile);if(!status?.pid)return false;const command=run('/bin/ps',['-p',String(status.pid),'-o','command='],true).stdout||'';return command.includes(path.join(state.pluginSpec||state.project,'src','runtime.js'))&&command.includes(stateFile);};
  const stop=deps.stopService|| (async state=>{
    run('/bin/launchctl',['bootout',domain+'/'+label],true);
    for(let i=0;i<150;i++){if(!ownedManager(state))return;await sleep(100);}
    throw Error('Managed service did not stop; leaving files intact. Inspect doctor before retrying.');
  });
  const healthy=deps.waitHealthy|| (async state=>{
    for(let i=0;i<840;i++){
      const status=json(state.statusFile);
      if(status?.state==='running'&&(status.pluginSpec===(state.pluginSpec||state.project)||!state.deployment&&status.pluginSpec===undefined)&&ownedManager(state)){
        try{if((await fetcher(`http://127.0.0.1:${state.sciencePort}/health`,{signal:AbortSignal.timeout(700)})).ok)return;}catch{}
      }
      await sleep(750);
    }
    throw Error('Managed Science startup failed (including possible port collision). Run doctor and inspect service.log.');
  });
  const choose=deps.choose||(process.stdin.isTTY&&process.stdout.isTTY?async ids=>{const rl=createInterface({input:process.stdin,output:process.stdout});try{ids.forEach((id,i)=>log(`${i+1}. ${id}`));const answer=await rl.question('Select model number or catalog ID: ');return ids[Number(answer)-1]||answer.trim();}finally{rl.close();}}:undefined);
  function select(state,autoSource){
    const spec=autoSource||state.pluginSpec||state.project, file=state.pluginsFile;
    const registry=json(file)||{plugins:[]};
    if(!Array.isArray(registry.plugins))throw Error('Invalid Magpie plugin registry');
    // The Magpie 0.1.1285 CLI regularly times out after 45 s. Updating
    // the same local registry transactionally lets the bridge start without
    // blocking on that unrelated native command. Journal permits rollback.
    let entry=registry.plugins.find(x=>x.spec===spec);
    if(!entry){entry={spec};registry.plugins.push(entry);}
    entry.off=false;
    entry.options={...entry.options,agent:'claude-science',model:state.model,gateway:state.gateway};
    if(state.claude)entry.options.claude=state.claude;else delete entry.options.claude;
    // Disable other Science plugins in the same transactional registry write:
    // calling the Magpie CLI here would edit plugins.json outside the managed
    // journal and turn a normal upgrade into a false drift conflict.
    for(const other of registry.plugins){
      if(other.spec!==spec&&other.options&&other.options.agent==='claude-science')other.off=true;
    }
    save(file,JSON.stringify(registry,null,2)+'\n');
  }
  function launch(state){const serviceLog=path.join(root,'service.log');if(!fs.existsSync(serviceLog))save(serviceLog,'');managedWrite(plist,launchPlist({node:state.node,script:path.join(state.pluginSpec||state.project,'src','runtime.js'),state:stateFile,log:serviceLog}),installJournal);run('/bin/launchctl',['bootstrap',domain,plist]);}
  async function install(options,previous){
    if(options.command==='install'&&previous&&previous.installed!==false)throw Error('Already prepared. Use upgrade, restart, or uninstall.');
    if(options.command!=='install'&&!previous)throw Error('Not installed. Use install first.');
    if(options.auto&&findScience().length)throw Error('Claude Science is running. Quit Science and re-enable the Magpie plugin before automatic setup. No process was stopped.');
    const gatewayOverride=options.gateway!==undefined||previous?.gatewayOverride===true;
    const claude=options.claude??previous?.claude;
    if(claude!==undefined&&!/^[-\w.]+(\/[-\w.]+)*$/.test(claude))throw Error('Invalid --claude provider: '+claude);
    const gateway=resolveGateway({gateway:options.gateway||(previous?.gatewayOverride?previous.gateway:undefined),settings:json(path.join(configRoot,'settings.json'))||{}});
    const response=await fetcher(gateway+'/api/hello',{signal:AbortSignal.timeout(3000)});if(!response.ok||(await response.json()).name!=='magpie')throw Error('Start Magpie before installing');
    const catalog=await fetcher(gateway+'/v1/models',{signal:AbortSignal.timeout(5000)});if(!catalog.ok)throw Error('Cannot read Magpie model catalog');
    const previousModel=json(previous?.agentConfig||path.join(configRoot,'claude-science.json'))?.model||previous?.model;
    const catalogModels=(await catalog.json()).data||[];
    const chooseModel=options.auto?async ids=>ids.find(id=>/claude-tui\/claude-opus/.test(id))||ids.find(id=>id.includes('claude-tui/'))||ids[0]:choose;
    const model=await selectModel({models:catalogModels,requested:options.model,previous:previousModel,choose:chooseModel});
    const magpie=options.auto?undefined:options.whenIdle?previous?.magpie:discoverBinary('magpie',{explicit:options.magpie||previous?.magpie,env,home});
    const binary=discoverBinary('science',{explicit:options.science||previous?.binary,env,home});
    const registry=options.auto?json(path.join(configRoot,'plugins.json')):null;
    const installedSource=options.auto?enabledSciencePlugins(registry).find(x=>/^(?:github:)?Guuuu233\/(?:claude-science-for-magpie|magpie-claude-science)(?:#.*)?$/.test(x.spec)||/^https:\/\/github.com\/Guuuu233\/(?:claude-science-for-magpie|magpie-claude-science)(?:\.git)?(?:#.*)?$/.test(x.spec)):undefined;
    if(options.auto&&!installedSource)throw Error('Install this community fork through Magpie Plugins before automatic setup');
    if(options.auto&&enabledSciencePlugins(registry).some(x=>x.spec!==installedSource.spec&&x.options?.agent==='claude-science'))
      throw Error('Another Science integration is already enabled; refusing automatic replacement');
    let deployment;
    if(options.command==='rollback'){deployment=previous.previousDeployment;if(!deployment)throw Error('No previous deployment available');verifyDeployment(deployment);}
    else deployment=stageDeployment({project,root,node:deps.node||process.execPath});
    // Inspect the actual copied executable (including rollback targets), before stopping any service.
    // Injected service runners use fake binaries and test library validation separately.
    if(!deps.run){const inspected=run('/usr/bin/otool',['-L',deployment.node]);validateNodeLibraries(inspected.stdout);}
    const oldState=read(stateFile),oldScience=previous?read(previous.scienceConfig):'',oldPlist=read(plist);
    const originalDir=path.join(home,'.claude-science'),originalConfig=path.join(originalDir,'config.toml');
    const baseline=previous&&previous.installed!==false?read(path.join(root,'original-config.txt')):read(originalConfig);
    checkOriginalConfig(baseline,originalDir);
    const registryBefore=json(path.join(configRoot,'plugins.json'));
    const enabledBefore=enabledSciencePlugins(registryBefore,[previous?.pluginSpec,previous?.project]);
    // Magpie rewrites plugins.json itself (plugin updates, other plugins).
    // While the entry this install came from is still enabled, keep it and
    // accept the registry as it is now; a replaced entry is still drift.
    const keptSource=!installedSource&&enabledSciencePlugins(registryBefore).find(x=>x.spec===previous?.registrySpec);
    if(keptSource)adoptManaged(path.join(configRoot,'plugins.json'),privateJournal);
    if(options.whenIdle&&!options.whenIdle())throw Error('Science became busy; update postponed. No process was stopped.');
    if(previous)await stop(previous);
    let reserved,switched=false;
    try{
      reserved=await reservePorts(options,previous||undefined);
      if(options.auto&&findScience().length)
        throw Error('Claude Science started while preparing setup. Quit Science and re-enable the Magpie plugin; no process was stopped.');
      // Runtime and launchd require an actual, checksummed filesystem path.
      // The Magpie-facing installedSource spec remains in plugins.json only.
        const state={...(previous||{}),installed:true,project:deployment.path,pluginSpec:deployment.path,
          registrySpec:installedSource?.spec||previous?.registrySpec||deployment.path,node:deployment.node,deployment,
        previousDeployment:previous?.deployment&&previous.deployment.id!==deployment.id?previous.deployment:previous?.previousDeployment,
        magpie,binary,model,gateway,gatewayOverride,...(claude?{claude}:{}),originalDir,originalConfig,
        agentConfig:path.join(configRoot,'claude-science.json'),pluginsFile:path.join(configRoot,'plugins.json'),
        scienceConfig:path.join(root,'science.toml'),configJournal:path.join(root,'config-journal.json'),statusFile:path.join(root,'status.json'),scienceLog:path.join(root,'science.log'),
        data:previous?.data||path.join(root,'data'),auth:previous?.auth||path.join(root,'auth'),token:previous?.token||randomBytes(32).toString('hex'),...reserved.ports};
      if(!previous||previous.installed===false)save(path.join(root,'original-config.txt'),baseline);
      if(!previous){const t=makeTicket(undefined,state.token);save(path.join(state.auth,'encryption.key'),Object.entries(t.keys).map(([k,v])=>`${k}=${v}`).join('\n')+'\n');save(path.join(state.auth,'.oauth-tokens',t.account+'.enc'),t.encrypted);}
      // science.toml is also the user's Science config (e.g. [sandbox], [memory]):
      // rebuild from it so their additions survive upgrade and rollback.
      const userScience=previous&&previous.installed!==false?oldScience:'';
      if(userScience)adoptManaged(state.scienceConfig,privateJournal);
      save(state.scienceConfig,scienceConfig(userScience||baseline,{data:state.data,auth:state.auth,port:state.sciencePort,sandboxPort:state.sandboxPort}));
      save(stateFile,JSON.stringify(state,null,2));switched=true;
      select(state,installedSource?.spec||keptSource?.spec);
      // Do not issue a stop command on behalf of an unattended plugin
      // activation, even if a Science process starts between preflights.
      if(!previous&&!options.auto)run(binary,['stop','--data-dir',originalDir]);
      await reserved.release();reserved=null;
      launch(state);await healthy(state);
      log(`${options.command==='rollback'?'Rolled back':previous?'Upgraded':'Installed'}. Model: ${model}. Open the original Claude Science app.`);
      return state;
    }catch(error){
      await reserved?.release();
      if(switched){const failed=json(stateFile);await stop(failed);const restored=restoreAll(failed.configJournal);if(restored.conflicts.length)throw new Error(error.message+'; user config edits preserved: '+restored.conflicts.join(', '));/* Registry restored from privateJournal on rollback. */}
      if(previous){
        if(switched)save(stateFile,oldState);
        if(read(previous.scienceConfig)!==oldScience)save(previous.scienceConfig,oldScience);
        if(oldPlist&&read(plist)!==oldPlist)managedWrite(plist,oldPlist,installJournal);
        const recovered={...previous,magpie:previous.magpie||magpie,model:previousModel,gateway:previous.gateway||gateway,node:previous.node||deps.node||process.execPath};
        if(previous.installed!==false){
          // Restore the user's actual source instead of resurrecting a removed checkout.
          if(registryBefore){
            save(previous.pluginsFile||path.join(configRoot,'plugins.json'),JSON.stringify(registryBefore,null,2)+'\n');
          }else select(recovered);
          launch(recovered);if(!registryBefore||enabledBefore.length)await healthy(recovered);
        }else{run(magpie,['claude-science','default'],true);restoreAll(installJournal);}
      }else if(switched){restoreAll(installJournal);restoreAll(privateJournal);}
      throw error;
    }
  }
  async function execute(options){
    if(options.command==='help'){log(help);return;}
    if(options.command==='doctor'){
      const state=json(stateFile);if(!state){log('Local Science is not initialized. Install/enable the GitHub community fork from Magpie Plugins for automatic setup; alternatively install this fork from its GitHub Release.');return;}
      log(`Runtime: ${state.pluginSpec||state.project}\nModel: ${json(state.agentConfig)?.model||state.model||'(disconnected)'}\nGateway: ${state.gateway||'legacy'}\nService: ${read(state.statusFile)||'(no status)'}\nPrivate logs: ${root}`);
      if(state.deployment){try{verifyDeployment(state.deployment);log('Deployment checksums: OK');}catch(e){log(e.message);}}
      return;
    }
    if((deps.platform||process.platform)!=='darwin')throw Error('The managed desktop service currently supports macOS only');
    if(env.XDG_CONFIG_HOME&&path.resolve(env.XDG_CONFIG_HOME)!==path.join(home,'.config'))throw Error('Custom XDG_CONFIG_HOME is not supported');
    // Reject symlink components before creating the lock; journaling starts only while locked.
    for(let current=root;;current=path.dirname(current)){
      try{if(fs.lstatSync(current).isSymbolicLink())throw Error('Refusing symlink: '+current);}catch(e){if(e.code!=='ENOENT')throw e;}
      if(path.dirname(current)===current)break;
    }
    fs.mkdirSync(root,{recursive:true,mode:0o700});
    const lock=path.join(root,'install.lock');let fd;
    try{fd=fs.openSync(lock,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw Error('Another installer operation or interrupted operation owns install.lock. Inspect before removing the lock; no process will be killed.');throw e;}
    try{
      fs.writeFileSync(fd,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));
      managedWrite(path.join(root,'owner.json'),'{"application":"magpie-claude-science"}\n',privateJournal);
      const state=json(stateFile);
      if(options.command==='autoinstall'){
        if(state?.installed){log('Science integration already installed; leaving existing user configuration unchanged.');return;}
        return await install({...options,auto:true,command:'install'},state);
      }
      if(options.command==='autoupgrade'){
        if(!updateNeeded(state,project)){log('Science integration is up to date.');return;}
        const busy=busyReason(state,{findApp});if(busy){log('Science update postponed: '+busy);return;}
        return await install({command:'upgrade',whenIdle:()=>!busyReason(state,{findApp})},state);
      }
      if(['install','upgrade','rollback'].includes(options.command))return await install(options,state);
      if(!state){log('Not installed.');return;}
      if(options.command==='restart'){if(state.deployment)verifyDeployment(state.deployment);await stop(state);launch({...state,node:state.node||process.execPath});await healthy(state);log('Restarted.');return;}
      if(options.command==='uninstall'){
        await stop(state);const restored=restoreAll(state.configJournal),pl=restoreAll(installJournal);
        if(restored.conflicts.length||pl.conflicts.length)throw Error('User edits preserved; resolve restore conflicts in journals before removing integration.');
        const magpie=discoverBinary('magpie',{explicit:options.magpie||state.magpie,env,home});run(magpie,['claude-science','default']);run(magpie,['plugin','rm',state.registrySpec||state.pluginSpec||state.project]);
        save(stateFile,JSON.stringify({...state,installed:false},null,2));log('Uninstalled. Sessions and authentication retained at '+state.data);return;
      }
      throw Error('Unknown command: '+options.command);
    }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
  }
  return {execute,stateFile};
}
export async function main(args=process.argv.slice(2),deps){return createInstaller(deps).execute(parseArgs(args));}
if(process.argv[1]&&fs.realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
  try{await main();}catch(error){console.error(error.message);process.exitCode=1;}
}

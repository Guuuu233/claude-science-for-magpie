import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
process.env.MAGPIE_SCIENCE_BRIDGE_LOG='/dev/null';
const {updateNeeded,busyReason,QUIET_MS}=await import('../src/update.js');
const {_internal}=await import('../src/plugin.js');
const {createInstaller}=await import('../src/cli.js');
const {createBridge}=await import('../src/bridge.js');

const github='github:Guuuu233/claude-science-for-magpie';
function tmp(t,name){const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),name)));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function source(home){
  const dir=path.join(home,'source');fs.mkdirSync(path.join(dir,'src'),{recursive:true});
  fs.writeFileSync(path.join(dir,'src','runtime.js'),'//one');fs.writeFileSync(path.join(dir,'package.json'),'{"type":"module","dependencies":{}}');
  return dir;
}
function installer(home,project,extra={}){
  const binary=path.join(home,'fake-bin');fs.writeFileSync(binary,'fake',{mode:0o700});
  return createInstaller({home,project,platform:'darwin',env:{SCIENCE_BIN:binary},node:binary,run:()=>({status:0,stdout:'',stderr:''}),findScience:()=>[],findApp:()=>[],
    fetch:async url=>({ok:true,json:async()=>url.endsWith('/api/hello')?{name:'magpie'}:{data:[{id:'claude-tui/claude-opus-5-5'}]}}),
    stopService:async()=>{},waitHealthy:async()=>{},log:()=>{},...extra});
}
// A Magpie Plugins install whose service has been quiet for an hour.
async function marketplaceInstall(home,project,extra){
  const registry=path.join(home,'.config/magpie/plugins.json');
  fs.mkdirSync(path.dirname(registry),{recursive:true});
  fs.writeFileSync(registry,JSON.stringify({plugins:[{spec:github}]}));
  const cli=installer(home,project,extra);
  const state=await cli.execute({command:'autoinstall'});
  const quiet=new Date(Date.now()-QUIET_MS-3600000);
  fs.writeFileSync(path.join(path.dirname(state.statusFile),'bridge.log'),'');
  fs.utimesSync(path.join(path.dirname(state.statusFile),'bridge.log'),quiet,quiet);
  return {cli,state,registry};
}

test('only a Magpie Plugins install whose own code changed needs an update',async t=>{
  const home=tmp(t,'science-update-needed-'),project=source(home);
  const {state}=await marketplaceInstall(home,project);
  assert.equal(updateNeeded(state,project),false,'same code');
  assert.equal(updateNeeded(state,state.deployment.path),false,'the staged copy itself');
  fs.appendFileSync(path.join(project,'src','runtime.js'),'//two');
  assert.equal(updateNeeded(state,project),true);
  fs.writeFileSync(path.join(project,'src','added.js'),'//new');
  assert.equal(updateNeeded({...state,registrySpec:'github:Guuuu233/magpie-claude-science'},project),true,'an install from before the rename still follows the plugin');
  assert.equal(updateNeeded({...state,registrySpec:state.deployment.path},project),false,'a local-checkout install is managed by its owner');
  assert.equal(updateNeeded({...state,installed:false},project),false);
});

test('an update waits while Science is open, a request runs, or it was just active',t=>{
  const home=tmp(t,'science-busy-'),statusFile=path.join(home,'status.json'),log=path.join(home,'bridge.log');
  const state={statusFile},now=Date.now(),old=new Date(now-QUIET_MS-1000);
  fs.writeFileSync(log,'');fs.utimesSync(log,old,old);
  assert.equal(busyReason(state,{now,findApp:()=>[]}),null);
  assert.match(busyReason(state,{now,findApp:()=>[96667]}),/open/);
  fs.writeFileSync(statusFile,JSON.stringify({at:new Date(now).toISOString(),state:'running',bridge:{inFlight:1,lastActivityAt:old.toISOString()}}));
  assert.match(busyReason(state,{now,findApp:()=>[]}),/in progress/);
  fs.writeFileSync(statusFile,JSON.stringify({at:new Date(now).toISOString(),state:'running',bridge:{inFlight:0,lastActivityAt:new Date(now-60000).toISOString()}}));
  assert.match(busyReason(state,{now,findApp:()=>[]}),/last 10 minutes/);
  fs.writeFileSync(statusFile,JSON.stringify({at:new Date(now).toISOString(),state:'running',bridge:{inFlight:0,lastActivityAt:old.toISOString()}}));
  fs.utimesSync(log,new Date(now-1000),new Date(now-1000));
  assert.match(busyReason(state,{now,findApp:()=>[]}),/last 10 minutes/,'a service from before 0.2.2 is judged by its bridge log');
});

test('the plugin starts the update only when idle, and asks to be retried when busy',async t=>{
  const home=tmp(t,'science-plugin-update-'),project=source(home);
  await marketplaceInstall(home,project);
  fs.appendFileSync(path.join(project,'src','runtime.js'),'//two');
  const spawned=[];
  const options={home,project,platform:'darwin',env:{PATH:'/usr/bin',HOME:home},nodeResolver:()=>'/fixture/node',
    findScience:()=>[56209],spawnProcess:(binary,args,config)=>{spawned.push({args,config});return {unref(){}};}};
  const busy=_internal.launchSetup({...options,findApp:()=>[96667]});
  assert.deepEqual([busy.launched,busy.retry],[false,true]);
  assert.match(busy.reason,/Science is open/);
  assert.equal(spawned.length,0);
  const idle=_internal.launchSetup({...options,findApp:()=>[]});
  assert.equal(idle.launched,true,'the managed daemon alone does not block an update');
  assert.deepEqual(spawned[0].args,[path.join(project,'src','cli.js'),'autoupgrade']);
  assert.equal(spawned[0].config.cwd,project);
});

test('autoupgrade replaces the service, keeps the GitHub entry, Magpie edits, and user Science settings',async t=>{
  const home=tmp(t,'science-autoupgrade-'),project=source(home);
  let app=[];
  const {cli,state,registry}=await marketplaceInstall(home,project,{findApp:()=>app});
  fs.appendFileSync(state.scienceConfig,'\n[sandbox]\ndisabled = true\n');
  // Magpie itself rewrites the registry when it updates or adds plugins.
  const edited=JSON.parse(fs.readFileSync(registry,'utf8'));edited.plugins.push({spec:'some-other-plugin'});
  fs.writeFileSync(registry,JSON.stringify(edited,null,2));
  fs.appendFileSync(path.join(project,'src','runtime.js'),'//two');
  app=[96667];
  assert.equal(await cli.execute({command:'autoupgrade'}),undefined,'postponed while Science is open');
  assert.equal(JSON.parse(fs.readFileSync(cli.stateFile,'utf8')).deployment.id,state.deployment.id);
  app=[];
  const upgraded=await cli.execute({command:'autoupgrade'});
  assert.notEqual(upgraded.deployment.id,state.deployment.id);
  assert.equal(upgraded.registrySpec,github);
  assert.equal(upgraded.previousDeployment.id,state.deployment.id);
  const plugins=JSON.parse(fs.readFileSync(registry,'utf8')).plugins;
  assert.deepEqual(plugins.map(p=>p.spec),[github,'some-other-plugin']);
  assert.equal(plugins[0].off,false);
  assert.equal(plugins[0].options.model,'claude-tui/claude-opus-5-5');
  assert.match(fs.readFileSync(upgraded.scienceConfig,'utf8'),/\[sandbox\]\ndisabled = true/);
  assert.equal(await cli.execute({command:'autoupgrade'}),undefined,'nothing left to update');
});

test('autoupgrade stops nothing when Science turns busy just before the switch',async t=>{
  const home=tmp(t,'science-autoupgrade-race-'),project=source(home);
  let checks=0,stopped=false;
  const {cli,state}=await marketplaceInstall(home,project,{findApp:()=>++checks>1?[96667]:[],stopService:async()=>{stopped=true;}});
  fs.appendFileSync(path.join(project,'src','runtime.js'),'//two');
  checks=0;
  await assert.rejects(cli.execute({command:'autoupgrade'}),/became busy/);
  assert.equal(stopped,false);
  assert.equal(JSON.parse(fs.readFileSync(cli.stateFile,'utf8')).deployment.id,state.deployment.id);
});

test('the bridge reports requests in flight and when it was last used',async t=>{
  let release;
  const upstream=http.createServer((req,res)=>{release=()=>{res.writeHead(200,{'content-type':'application/json'});res.end('{"type":"message","content":[]}');};});
  await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
  const cfg={model:'codex/gpt-6-luna',gateway:`http://127.0.0.1:${upstream.address().port}`,key:'k',token:'local'};
  const server=createBridge(()=>cfg);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>{server.close();upstream.close();});
  assert.deepEqual(server.activity(),{inFlight:0,lastActivityAt:null});
  const pending=fetch(`http://127.0.0.1:${server.address().port}/v1/messages`,{method:'POST',headers:{authorization:'Bearer local'},body:JSON.stringify({model:'codex/gpt-6-luna',messages:[]})});
  while(!release)await new Promise(r=>setTimeout(r,10));
  assert.equal(server.activity().inFlight,1);
  release();await (await pending).text();
  while(server.activity().inFlight)await new Promise(r=>setTimeout(r,10));
  assert.ok(Date.parse(server.activity().lastActivityAt)>0);
});

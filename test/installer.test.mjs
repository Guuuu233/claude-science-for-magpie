import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawnSync} from 'node:child_process';
const project=path.resolve('.');
test('doctor explains the missing setup after a marketplace-only installation without writing files', async () => {
  const {createInstaller}=await import('../src/cli.js');
  const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'science-first-run-')));
  try {
    const registry=path.join(home,'.config/magpie/plugins.json');
    fs.mkdirSync(path.dirname(registry),{recursive:true});
    fs.writeFileSync(registry,JSON.stringify({plugins:[{spec:'magpie-claude-science@latest'}]}));
    const before=fs.readFileSync(registry,'utf8'),output=[];
    await createInstaller({home,log:line=>output.push(line)}).execute({command:'doctor'});
    assert.match(output.join('\n'),/GitHub community fork from Magpie Plugins/);
    assert.match(output.join('\n'),/Magpie/);
    assert.equal(fs.readFileSync(registry,'utf8'),before);
    assert.deepEqual(fs.readdirSync(path.dirname(registry)),['plugins.json']);
  } finally {fs.rmSync(home,{recursive:true,force:true});}
});
test('--help does not create a profile and succeeds cross-platform',()=>{const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'science-help-')));try{const r=spawnSync(process.execPath,['src/cli.js','--help'],{env:{...process.env,HOME:home},encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/--model/);assert.deepEqual(fs.readdirSync(home),[]);}finally{fs.rmSync(home,{recursive:true,force:true});}});
test('Magpie marketplace autoinstall preserves GitHub plugin identity and local runtime path',async()=>{
  const {createInstaller}=await import('../src/cli.js');
  const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'science-market-')));
  try{
    const registry=path.join(home,'.config/magpie/plugins.json');
    fs.mkdirSync(path.dirname(registry),{recursive:true});
    const spec='github:Guuuu233/magpie-claude-science#v0.2.1';
    fs.writeFileSync(registry,JSON.stringify({plugins:[{spec}]}));
    const binary=path.join(home,'fake-bin');fs.writeFileSync(binary,'fake',{mode:0o700});
    const calls=[];
    const installer=createInstaller({home,platform:'darwin',node:binary,run:(bin,args)=>{calls.push([bin,...args]);return {status:0,stdout:'',stderr:''};},findScience:()=>[],fetch:async url=>({ok:true,json:async()=>url.endsWith('/api/hello')?{name:'magpie'}:{data:[{id:'group/example'},{id:'claude-tui/claude-opus-5-5'}]}}),stopService:async()=>{},waitHealthy:async()=>{},log:()=>{},env:{SCIENCE_BIN:binary}});
    const state=await installer.execute({command:'autoinstall'});
    assert.equal(state.model,'claude-tui/claude-opus-5-5');
    assert.ok(path.isAbsolute(state.pluginSpec));
    assert.match(state.pluginSpec,/releases\/[a-f0-9]{64}$/);
    assert.equal(state.project,state.pluginSpec);
    assert.equal(state.registrySpec,spec);
    const entries=JSON.parse(fs.readFileSync(registry)).plugins;
    assert.equal(entries.length,1);
    assert.equal(entries[0].spec,spec);
    assert.equal(entries[0].options.model,'claude-tui/claude-opus-5-5');
    assert.equal(calls.some(([,cmd])=>cmd==='stop'),false,'autoinstall must never stop original Science');
    const second=await installer.execute({command:'autoinstall'});
    assert.equal(second,undefined);
    assert.deepEqual(JSON.parse(fs.readFileSync(registry)).plugins,entries);
    await installer.execute({command:'uninstall',magpie:binary});
    assert.ok(calls.some(([bin,...args])=>bin===binary&&args.join(' ')==='plugin rm '+spec),'uninstall must remove the GitHub registry spec rather than a staged filesystem path');
  }finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('autoinstall accepts the renamed repository',async()=>{
  const {createInstaller}=await import('../src/cli.js');
  const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'science-renamed-')));
  try{
    const registry=path.join(home,'.config/magpie/plugins.json');
    fs.mkdirSync(path.dirname(registry),{recursive:true});
    const spec='github:Guuuu233/claude-science-for-magpie';
    fs.writeFileSync(registry,JSON.stringify({plugins:[{spec}]}));
    const binary=path.join(home,'fake-bin');fs.writeFileSync(binary,'fake',{mode:0o700});
    const installer=createInstaller({home,platform:'darwin',node:binary,run:()=>({status:0,stdout:'',stderr:''}),findScience:()=>[],fetch:async url=>({ok:true,json:async()=>url.endsWith('/api/hello')?{name:'magpie'}:{data:[{id:'claude-tui/claude-opus-5-5'}]}}),stopService:async()=>{},waitHealthy:async()=>{},log:()=>{},env:{SCIENCE_BIN:binary}});
    const state=await installer.execute({command:'autoinstall'});
    assert.equal(state.registrySpec,spec);
    assert.equal(JSON.parse(fs.readFileSync(registry)).plugins[0].options.agent,'claude-science');
  }finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('automatic installer refuses to replace a different active Science plugin',async()=>{
  const {createInstaller}=await import('../src/cli.js');
  const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'science-market-conflict-')));
  try{
    const registry=path.join(home,'.config/magpie/plugins.json');
    fs.mkdirSync(path.dirname(registry),{recursive:true});
    fs.writeFileSync(registry,JSON.stringify({plugins:[{spec:'github:Guuuu233/magpie-claude-science'},{spec:'github:shiyang1026/magpie-claude-science',options:{agent:'claude-science'}}]}));
    const before=fs.readFileSync(registry,'utf8');
    const binary=path.join(home,'fake-bin');fs.writeFileSync(binary,'fake',{mode:0o700});
    const cli=createInstaller({home,platform:'darwin',env:{SCIENCE_BIN:binary},findScience:()=>[],fetch:async url=>({ok:true,json:async()=>url.endsWith('/api/hello')?{name:'magpie'}:{data:[{id:'claude-tui/claude-opus-5-5'}]}})});
    await assert.rejects(cli.execute({command:'autoinstall'}),/Another Science integration/);
    assert.equal(fs.readFileSync(registry,'utf8'),before);
    assert.ok(!fs.existsSync(cli.stateFile));
  }finally{fs.rmSync(home,{recursive:true,force:true});}
});

test('CLI unattended install independently refuses a live Science before any writes',async()=>{
  const {createInstaller}=await import('../src/cli.js');
  const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'science-busy-cli-')));
  try {
    const calls=[];
    const cli=createInstaller({home,platform:'darwin',env:{},findScience:()=>[96667],
      run:(binary,args)=>{calls.push([binary,...args]);return {status:0,stdout:''};},
      fetch:async()=>{throw Error('must not connect to gateway');}});
    await assert.rejects(cli.execute({command:'autoinstall'}),/Quit Science and re-enable/);
    assert.equal(calls.length,0);
    assert.equal(fs.existsSync(cli.stateFile),false);
    assert.equal(fs.existsSync(path.join(home,'.config/magpie/claude-science-runtime/data')),false);
  }finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('install uses stable release; failed upgrade restores previous selection and state',async()=>{const {createInstaller}=await import('../src/cli.js');assert.equal(typeof createInstaller,'function');const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'science-install-')));const calls=[];let fail=false;const binary=path.join(home,'fake-bin');fs.writeFileSync(binary,'fake',{mode:0o700});const env={PATH:home};const installer=createInstaller({home,project,platform:'darwin',env,node:binary,run:(bin,args)=>{calls.push([bin,...args]);return {status:args[0]==='print'?1:0,stdout:'',stderr:''};},fetch:async url=>({ok:true,json:async()=>url.endsWith('/api/hello')?{name:'magpie'}:{data:[{id:'first'},{id:'second'}]}}),waitHealthy:async()=>{if(fail){fail=false;throw Error('startup failed');}},stopService:async()=>{calls.push(['stop']);},log:()=>{}});try{await installer.execute({command:'install',model:'second',gateway:'http://localhost:4567',magpie:binary,science:binary});const stateFile=path.join(home,'.config/magpie/claude-science-runtime/state.json'),before=fs.readFileSync(stateFile,'utf8'),s=JSON.parse(before);assert.match(s.pluginSpec,/releases\/[a-f0-9]{64}$/);assert.ok(s.node.startsWith(s.pluginSpec));assert.equal(s.model,'second');assert.equal(s.gatewayOverride,true);assert.equal(s.gateway,'http://127.0.0.1:4567');const pluginRegistry=()=>JSON.parse(fs.readFileSync(path.join(home,'.config/magpie/plugins.json'),'utf8')).plugins;assert.ok(pluginRegistry().some(entry=>entry.spec===s.pluginSpec&&entry.options?.model==='second'));fail=true;await assert.rejects(installer.execute({command:'upgrade',model:'first',magpie:binary,science:binary}),/startup failed/);assert.equal(fs.readFileSync(stateFile,'utf8'),before);assert.ok(pluginRegistry().some(entry=>entry.spec===s.pluginSpec&&!entry.off));assert.ok(!fs.existsSync(path.join(home,'.config/magpie/claude-science-runtime/install.lock')));}finally{fs.rmSync(home,{recursive:true,force:true});}});
test('npm-style symlink entry executes help',()=>{const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'science-symlink-')));try{const link=path.join(dir,'cli');fs.symlinkSync(path.join(project,'src','cli.js'),link);const r=spawnSync(process.execPath,[link,'--help'],{encoding:'utf8'});assert.equal(r.status,0);assert.match(r.stdout,/Usage:/);}finally{fs.rmSync(dir,{recursive:true,force:true});}});
test('lock excludes mutations before touching managed journals',async()=>{const {createInstaller}=await import('../src/cli.js');const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'science-lock-')));try{const root=path.join(home,'.config/magpie/claude-science-runtime');fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,'install.lock'),'existing');const cli=createInstaller({home,platform:'darwin',env:{}});await assert.rejects(cli.execute({command:'uninstall'}),/install.lock/);assert.deepEqual(fs.readdirSync(root),['install.lock']);}finally{fs.rmSync(home,{recursive:true,force:true});}});
test('upgrade and rollback retain sessions, and reinstall preserves authentication',async()=>{const {createInstaller}=await import('../src/cli.js');const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'science-rollback-')));try{const source=path.join(home,'source');fs.mkdirSync(path.join(source,'src'),{recursive:true});fs.writeFileSync(path.join(source,'src','runtime.js'),'//one');fs.writeFileSync(path.join(source,'package.json'),'{"type":"module","dependencies":{}}');const binary=path.join(home,'bin');fs.writeFileSync(binary,'fake',{mode:0o700});const installer=createInstaller({home,project:source,platform:'darwin',env:{},node:binary,run:()=>({status:0,stdout:'',stderr:''}),fetch:async url=>({ok:true,json:async()=>url.endsWith('hello')?{name:'magpie'}:{data:[{id:'a'}]}}),stopService:async()=>{},waitHealthy:async()=>{},log:()=>{}});const options={magpie:binary,science:binary,model:'a'};const first=await installer.execute({...options,command:'install'});const encryption=fs.readFileSync(path.join(first.auth,'encryption.key'),'utf8');fs.mkdirSync(first.data,{recursive:true});fs.writeFileSync(path.join(first.data,'session'),'keep');fs.appendFileSync(path.join(source,'src','runtime.js'),'//two');const second=await installer.execute({...options,command:'upgrade'});assert.notEqual(first.deployment.id,second.deployment.id);const restored=await installer.execute({...options,command:'rollback'});assert.equal(restored.deployment.id,first.deployment.id);assert.equal(fs.readFileSync(path.join(first.data,'session'),'utf8'),'keep');await installer.execute({...options,command:'uninstall'});fs.mkdirSync(path.dirname(first.originalConfig),{recursive:true});fs.writeFileSync(first.originalConfig,'user_setting = "preserve-after-uninstall"\n');await installer.execute({...options,command:'install'});assert.match(fs.readFileSync(first.scienceConfig,'utf8'),/preserve-after-uninstall/);assert.match(fs.readFileSync(path.join(path.dirname(installer.stateFile),'original-config.txt'),'utf8'),/preserve-after-uninstall/);assert.equal(fs.readFileSync(path.join(first.auth,'encryption.key'),'utf8'),encryption);}finally{fs.rmSync(home,{recursive:true,force:true});}});
test('state drift during upgrade preserves user edits and restores old Science configuration',async()=>{const {createInstaller}=await import('../src/cli.js');const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'science-drift-')));try{const source=path.join(home,'source');fs.mkdirSync(path.join(source,'src'),{recursive:true});fs.writeFileSync(path.join(source,'src','runtime.js'),'//runtime');fs.writeFileSync(path.join(source,'package.json'),'{"dependencies":{}}');const binary=path.join(home,'bin');fs.writeFileSync(binary,'fake',{mode:0o700});const cli=createInstaller({home,project:source,node:binary,platform:'darwin',env:{},run:()=>({status:0}),fetch:async url=>({ok:true,json:async()=>url.endsWith('hello')?{name:'magpie'}:{data:[{id:'a'}]}}),stopService:async()=>{},waitHealthy:async()=>{},log:()=>{}});const options={magpie:binary,science:binary,model:'a'};const state=await cli.execute({...options,command:'install'}),before=fs.readFileSync(state.scienceConfig,'utf8');fs.writeFileSync(cli.stateFile,JSON.stringify({...state,userNote:'preserve'}));await assert.rejects(cli.execute({...options,command:'upgrade',sciencePort:0}),/drift/);assert.equal(JSON.parse(fs.readFileSync(cli.stateFile)).userNote,'preserve');assert.equal(fs.readFileSync(state.scienceConfig,'utf8'),before);}finally{fs.rmSync(home,{recursive:true,force:true});}});
test('upgrade fails closed when the managed plugin registry changed outside the installer',async()=>{
 const {createInstaller}=await import('../src/cli.js');
 const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'science-source-')));
 try{
  const source=path.join(home,'source');fs.mkdirSync(path.join(source,'src'),{recursive:true});
  fs.writeFileSync(path.join(source,'src/runtime.js'),'//one');fs.writeFileSync(path.join(source,'package.json'),'{"dependencies":{}}');
  const binary=path.join(home,'bin');fs.writeFileSync(binary,'fake',{mode:0o700});
  const registryFile=path.join(home,'.config/magpie/plugins.json');
  const cli=createInstaller({home,project:source,node:binary,platform:'darwin',env:{},
   run:()=>({status:0,stdout:'',stderr:''}),
   fetch:async url=>({ok:true,json:async()=>url.endsWith('hello')?{name:'magpie'}:{data:[{id:'a'}]}}),
   stopService:async()=>{},waitHealthy:async()=>{},log:()=>{}});
  const options={magpie:binary,science:binary,model:'a'};
  const first=await cli.execute({...options,command:'install'});
  const github='https://github.com/shiyang1026/magpie-claude-science';
  // Simulate another process replacing the registry while the installer owns
  // the managed-file journal. The upgrade must refuse to overwrite it.
  fs.writeFileSync(registryFile,JSON.stringify({plugins:[{spec:github}]}));
  fs.appendFileSync(path.join(source,'src/runtime.js'),'//two');
  await assert.rejects(cli.execute({...options,command:'upgrade'}),/drift/);
  assert.equal(JSON.parse(fs.readFileSync(cli.stateFile,'utf8')).pluginSpec,first.pluginSpec);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('upgrade and rollback keep settings the user added to the managed Science config',async()=>{
  const {createInstaller}=await import('../src/cli.js');
  const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'science-user-config-')));
  try{
    const source=path.join(home,'source');fs.mkdirSync(path.join(source,'src'),{recursive:true});
    fs.writeFileSync(path.join(source,'src','runtime.js'),'//one');fs.writeFileSync(path.join(source,'package.json'),'{"type":"module","dependencies":{}}');
    const binary=path.join(home,'bin');fs.writeFileSync(binary,'fake',{mode:0o700});
    const installer=createInstaller({home,project:source,platform:'darwin',env:{},node:binary,run:()=>({status:0,stdout:'',stderr:''}),
      fetch:async url=>({ok:true,json:async()=>url.endsWith('hello')?{name:'magpie'}:{data:[{id:'a'}]}}),stopService:async()=>{},waitHealthy:async()=>{},log:()=>{}});
    const options={magpie:binary,science:binary,model:'a'};
    const first=await installer.execute({...options,command:'install'});
    fs.appendFileSync(first.scienceConfig,'\n[sandbox]\ndisabled = true\nskip_approvals = true\n\n[memory]\nenabled = true\n');
    fs.appendFileSync(path.join(source,'src','runtime.js'),'//two');
    for(const command of ['upgrade','rollback']){
      await installer.execute({...options,command});
      const text=fs.readFileSync(first.scienceConfig,'utf8');
      assert.match(text,/\[sandbox\]\s*\ndisabled = true\s*\nskip_approvals = true/,command);
      assert.match(text,/\[memory\]\s*\nenabled = true/,command);
      assert.match(text,new RegExp('port = '+first.sciencePort),command);
    }
  }finally{fs.rmSync(home,{recursive:true,force:true});}
});

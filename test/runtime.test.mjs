import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fixture,until,pause} from './runtime-fixture.mjs';
import {readProcessIdentity} from '../src/processes.js';

test('healthy owned daemon is required before redirect; disconnect restores original config',async()=>{
 const f=await fixture();try{
  f.start();await until(()=>f.status().state==='running');
  assert.equal(f.status().pluginSpec,f.state.pluginSpec);
  assert.ok(f.status().identity);
  const pid=f.status().sciencePid;
  assert.equal(fs.readFileSync(f.state.originalConfig,'utf8'),'data_dir="managed"\n');
  const lock=JSON.parse(fs.readFileSync(path.join(f.state.data,'operon.lock')));assert.equal(lock.sandbox_port,f.state.sandboxPort);
  fs.writeFileSync(f.state.agentConfig,'{}');await until(()=>f.status().state==='disconnected');
  assert.equal(fs.readFileSync(f.state.originalConfig,'utf8'),'# ORIGINAL\n');assert.equal(readProcessIdentity(pid),null);
 }finally{await f.cleanup();}
});

test('missing binary never redirects the native app',async()=>{
 const f=await fixture({missing:true});try{f.start();await until(()=>f.status().state==='error');assert.equal(fs.readFileSync(f.state.originalConfig,'utf8'),'# ORIGINAL\n');}finally{await f.cleanup();}
});

test('a healthy HTTP endpoint without the child-owned lock is not readiness',async()=>{
 const f=await fixture({noLock:true});try{f.start();await until(()=>f.status().state==='error');assert.equal(fs.readFileSync(f.state.originalConfig,'utf8'),'# ORIGINAL\n');}finally{await f.cleanup();}
});

test('a conflicting listener is not adopted and remains alive',async()=>{
 const f=await fixture();const foreign=http.createServer((q,r)=>r.end('{"status":"healthy"}'));await new Promise(r=>foreign.listen(f.state.sciencePort,'127.0.0.1',r));
 try{f.start();await until(()=>f.status().state==='error');assert.equal(fs.readFileSync(f.state.originalConfig,'utf8'),'# ORIGINAL\n');assert.equal((await fetch(`http://127.0.0.1:${f.state.sciencePort}/health`)).status,200);}
 finally{foreign.closeAllConnections();await new Promise(r=>foreign.close(r));await f.cleanup();}
});

test('after manager SIGKILL, restart reaps only its recorded orphan and recovers',async()=>{
 const f=await fixture();try{
  const first=f.start();await until(()=>f.status().state==='running');const old=f.status().sciencePid;
  await f.stop(first,'SIGKILL');assert.ok(readProcessIdentity(old));
  const second=f.start();await until(()=>f.status().pid===second.pid&&f.status().state==='running');
  assert.notEqual(f.status().sciencePid,old);assert.equal(readProcessIdentity(old),null);
  await f.stop(second);assert.equal(fs.readFileSync(f.state.originalConfig,'utf8'),'# ORIGINAL\n');
 }finally{await f.cleanup();}
});

test('disabled plugin after a crash restores redirect and stops the owned orphan',async()=>{
 const f=await fixture();try{
  const p=f.start();await until(()=>f.status().state==='running');const old=f.status().sciencePid;await f.stop(p,'SIGKILL');
  fs.writeFileSync(f.state.pluginsFile,JSON.stringify({plugins:[{spec:f.state.pluginSpec,off:true}]}));
  const q=f.start();await until(()=>f.status().pid===q.pid&&f.status().state==='disconnected');
  assert.equal(fs.readFileSync(f.state.originalConfig,'utf8'),'# ORIGINAL\n');assert.equal(readProcessIdentity(old),null);
 }finally{await f.cleanup();}
});

test('Science update is detected without interrupting a running task',async()=>{
 const f=await fixture();try{
  f.start();await until(()=>f.status().state==='running');const pid=f.status().sciencePid;
  fs.appendFileSync(f.state.binary,'\n// updated fixture\n');await until(()=>f.status().restartRequired===true);
  assert.equal(f.status().sciencePid,pid);assert.ok(readProcessIdentity(pid));
 }finally{await f.cleanup();}
});

test('shutdown during orphan recovery does not open a bridge after releasing ownership',async()=>{
 const f=await fixture();try{
  fs.writeFileSync(f.state.binary,fs.readFileSync(f.state.binary,'utf8').replace("process.on('SIGTERM',()=>{","process.on('SIGTERM',()=>{});process.on('never',()=>{"));
  const first=f.start();await until(()=>f.status().state==='running');await f.stop(first,'SIGKILL');
  const second=f.start();await until(()=>{try{return JSON.parse(fs.readFileSync(path.join(f.root,'runtime-owner.json'))).pid===second.pid;}catch{return false;}});
  await pause(150);second.kill('SIGTERM');
  await until(()=>second.exitCode!==null||second.signalCode!==null,3000);
  assert.equal(second.signalCode,null);assert.equal(second.exitCode,0);
  assert.equal(fs.existsSync(path.join(f.root,'runtime-owner.json')),false);
  await assert.rejects(fetch(`http://127.0.0.1:${f.state.bridgePort}/v1/models`,{signal:AbortSignal.timeout(300)}));
  assert.equal(fs.readFileSync(f.state.originalConfig,'utf8'),'# ORIGINAL\n');
 }finally{await f.cleanup();}
});

test('changing installation source to the official GitHub package keeps Science connected',async()=>{
 const f=await fixture();try{
  f.start();await until(()=>f.status().state==='running');const pid=f.status().sciencePid;
  const spec='https://github.com/shiyang1026/magpie-claude-science';
  fs.writeFileSync(f.state.pluginsFile,JSON.stringify({plugins:[{spec}]}));
  await until(()=>f.status().activePluginSpec===spec&&f.status().state==='running');
  assert.equal(f.status().sciencePid,pid);
  assert.equal(fs.readFileSync(f.state.originalConfig,'utf8'),'data_dir="managed"\n');
  fs.writeFileSync(f.state.pluginsFile,JSON.stringify({plugins:[{spec,off:true}]}));
  await until(()=>f.status().state==='disconnected');assert.equal(fs.readFileSync(f.state.originalConfig,'utf8'),'# ORIGINAL\n');
 }finally{await f.cleanup();}
});

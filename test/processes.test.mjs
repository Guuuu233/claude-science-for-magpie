import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const api=await import('../src/processes.js').catch(()=>({}));

test('process identity includes start time and argv, and rejects invalid PIDs',()=>{
 assert.equal(typeof api.readProcessIdentity,'function');
 assert.match(api.readProcessIdentity(process.pid),/node/);
 for(const pid of [-1,0,1,'123',NaN])assert.equal(api.readProcessIdentity(pid),null);
});

test('runtime recovery lock prevents deleting a replacement owner',()=>{
 assert.equal(typeof api.acquireRuntimeOwner,'function');
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'science-owner-'));
 const file=path.join(root,'runtime-owner.json');
 try{
  fs.writeFileSync(file,JSON.stringify({pid:99999999,identity:'stale'}));
  fs.writeFileSync(file+'.recovery','another recovery operation');
  assert.throws(()=>api.acquireRuntimeOwner(file,{pid:process.pid,identity:api.readProcessIdentity(process.pid)}),/recovery|startup/i);
  assert.equal(JSON.parse(fs.readFileSync(file)).identity,'stale');
  fs.unlinkSync(file+'.recovery');
  const owner={pid:process.pid,identity:api.readProcessIdentity(process.pid)};
  api.acquireRuntimeOwner(file,owner);
  assert.throws(()=>api.acquireRuntimeOwner(file,{pid:12345,identity:'competitor'}),/owns|Another/);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)),owner);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('daemon signalling requires matching recorded identity and owned data/config',async()=>{
 assert.equal(typeof api.signalOwnedDaemon,'function');
 const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)','--','serve','--data-dir','/test-owned-data','--config','/test-owned-config'],{stdio:'ignore'});
 await once(child,'spawn');
 const state={data:'/test-owned-data',scienceConfig:'/test-owned-config'};
 const lease={pid:child.pid,identity:api.readProcessIdentity(child.pid),data:state.data,config:state.scienceConfig};
 try{
  assert.equal(api.signalOwnedDaemon({...lease,identity:'a stale identity'},state),false);
  assert.equal(api.signalOwnedDaemon({...lease,data:'/another-profile'},state),false);
  assert.ok(api.readProcessIdentity(child.pid));
  const done=once(child,'exit');assert.equal(api.signalOwnedDaemon(lease,state),true);await done;
 }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
});

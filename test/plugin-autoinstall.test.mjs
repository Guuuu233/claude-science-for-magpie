import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {_internal} from '../src/plugin.js';

test('Magpie plugin entry exports only one callable setup hook', async () => {
  const exports = await import('../src/plugin.js');
  assert.deepEqual(Object.entries(exports).filter(([, value]) => typeof value === 'function').map(([key]) => key), ['ScienceSetupPlugin']);
  assert.equal(typeof exports.ScienceSetupPlugin, 'function');
});

test('one-click Magpie setup starts at most one installer, not one per host init', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'science-plugin-install-'));
  t.after(() => fs.rmSync(home, {recursive:true, force:true}));
  const spawned = [];
  const options = {
    home, platform:'darwin', env:{PATH:'/usr/bin', HOME:home},
    nodeResolver: () => '/fixture/node',
    findScience: () => [],
    spawnProcess(binary, args, config) {
      spawned.push({binary,args,config});
      return {unref() {}};
    },
  };
  assert.equal(_internal.launchSetup(options).launched, true);
  assert.equal(_internal.launchSetup(options).launched, false);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].binary, '/fixture/node');
  assert.equal(spawned[0].args.at(-1), 'autoinstall');
  assert.equal(spawned[0].config.detached, true);
  const state = path.join(home,'.config/magpie/claude-science-runtime/state.json');
  fs.writeFileSync(state, JSON.stringify({installed:true}));
  assert.match(_internal.launchSetup(options).reason, /existing Science state/);
  assert.equal(spawned.length, 1);
});

test('automatic setup is disabled on non-macOS and respects test opt-out', t => {
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'science-disabled-'));
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  assert.equal(_internal.launchSetup({home,platform:'linux'}).launched, false);
  assert.equal(_internal.launchSetup({home,platform:'darwin',env:{MAGPIE_SCIENCE_DISABLE_AUTOINSTALL:'1'}}).launched, false);
  assert.equal(fs.existsSync(path.join(home,'.config/magpie/claude-science-runtime')),false);
});

test('running Science prevents unattended setup before Node selection or process spawning', t => {
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'science-busy-'));
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  let resolved=false,spawned=false;
  const result=_internal.launchSetup({
    home,platform:'darwin',findScience:()=>[1775,96667],
    nodeResolver:()=>{resolved=true;return '/fake/node';},
    spawnProcess:()=>{spawned=true;throw Error('must not spawn');},
  });
  assert.equal(result.launched,false);
  assert.match(result.reason,/Quit Science and re-enable/);
  assert.equal(resolved,false);
  assert.equal(spawned,false);
  assert.match(fs.readFileSync(path.join(home,'.config/magpie/claude-science-runtime/autoinstall.log'),'utf8'),/protect active tasks/);
  assert.equal(fs.existsSync(path.join(home,'.config/magpie/claude-science-runtime/state.json')),false);
});

test('Node resolver ignores old Node and locates nvm Node 22+ under short desktop PATH', t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'science-node-probe-'));
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const old=path.join(home,'old-bin');fs.mkdirSync(old);
  fs.writeFileSync(path.join(old,'node'),'old',{mode:0o755});
  const modern=path.join(home,'.nvm/versions/node/v22.12.0/bin');
  fs.mkdirSync(modern,{recursive:true});
  fs.writeFileSync(path.join(modern,'node'),'new',{mode:0o755});
  const probes=[];
  const found=_internal.localNode({PATH:old},home,(file,args)=>{
    probes.push(file);
    return {status:0,stdout:file.includes('/v22.12.0/')?'v22.12.0\n':'v20.17.0\n'};
  });
  assert.equal(found,path.join(modern,'node'));
  assert.ok(probes.includes(path.join(old,'node')));
  assert.throws(()=>_internal.localNode({PATH:old},home,()=>({status:0,stdout:'v20.2.0'})),/Node.js 22\+/);
});

test('missing compatible Node writes a safe diagnostic and never launches setup',t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'science-no-node-'));
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  assert.throws(()=>_internal.launchSetup({
    home,platform:'darwin',findScience:()=>[],
    nodeResolver:()=>{throw Error('Node.js 22+ not found');},
    spawnProcess:()=>{throw Error('should not run');},
  }),/Node.js 22\+ not found/);
  const dir=path.join(home,'.config/magpie/claude-science-runtime');
  assert.equal(fs.existsSync(path.join(dir,'autoinstall-started.json')),false);
  assert.match(fs.readFileSync(path.join(dir,'autoinstall.log'),'utf8'),/Node.js 22\+ not found/);
});

import {test} from 'node:test';import assert from 'node:assert/strict';import {parse} from 'smol-toml';
const api=await import('../src/setup.js').catch(()=>({}));
test('Science config redirects only owned state and keeps existing user settings',()=>{
  assert.equal(typeof api.scienceConfig,'function');
  const s=api.scienceConfig('default_python_version="3.12"\n[network]\nproxy="http://127.0.0.1:1234"\n[paths]\nconda_home="/existing/conda"\n',{data:'/private/data',auth:'/private/auth',port:18980});
  const v=parse(s);assert.equal(v.data_dir,'/private/data');assert.equal(v.paths.auth_dir,'/private/auth');assert.equal(v.paths.conda_home,'/existing/conda');assert.equal(v.network.proxy,'http://127.0.0.1:1234');assert.equal(v.default_python_version,'3.12');assert.equal(v.port,18980);
});
test('macOS service executes exact node path without a shell and escapes XML',()=>{
  assert.equal(typeof api.launchPlist,'function');
  const xml=api.launchPlist({node:'/node',script:'/a & b/runtime.js',state:'/state',log:'/log'});
  assert.ok(xml.includes('/a &amp; b/runtime.js'));assert.ok(xml.includes('<key>KeepAlive</key>'));assert.ok(!xml.includes('/bin/sh'));
});
test('configuration refuses relocated Science installations until explicitly handled',()=>{
  assert.equal(typeof api.checkOriginalConfig,'function');
  assert.throws(()=>api.checkOriginalConfig('data_dir="/different"','/home/.claude-science'),/relocat/i);
  assert.doesNotThrow(()=>api.checkOriginalConfig('','/home/.claude-science'));
});

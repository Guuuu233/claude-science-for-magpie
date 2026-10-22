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
test('cache keep-warm pings are off unless the user chose otherwise',()=>{
  const off=parse(api.scienceConfig('',{data:'/d',auth:'/a',port:1}));
  assert.equal(off.cache_keepalive.enabled,false);
  const kept=parse(api.scienceConfig('[cache_keepalive]\nenabled=true\ninterval_s=200\n',{data:'/d',auth:'/a',port:1}));
  assert.deepEqual({...kept.cache_keepalive},{enabled:true,interval_s:200});
  const tuned=parse(api.scienceConfig('[cache_keepalive]\ninterval_s=200\n',{data:'/d',auth:'/a',port:1}));
  assert.deepEqual({...tuned.cache_keepalive},{interval_s:200,enabled:false});
});

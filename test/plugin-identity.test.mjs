import test from 'node:test';import assert from 'node:assert/strict';
const api=await import('../src/plugin-identity.js').catch(()=>({}));
test('official npm and GitHub installation forms refer to the same integration',()=>{
 assert.equal(typeof api.isSciencePlugin,'function');
 for(const spec of ['magpie-claude-science','magpie-claude-science@0.1.0','magpie-claude-science@latest','magpie-claude-science@^0.1.0','https://github.com/shiyang1026/magpie-claude-science','https://github.com/Guuuu233/magpie-claude-science','https://github.com/Guuuu233/magpie-claude-science.git#main','https://github.com/shiyang1026/magpie-claude-science.git#main','git+https://github.com/shiyang1026/magpie-claude-science.git','github:shiyang1026/magpie-claude-science#v0.1.0','shiyang1026/magpie-claude-science',
  'claude-science-for-magpie','claude-science-for-magpie@0.2.4','github:Guuuu233/claude-science-for-magpie','Guuuu233/claude-science-for-magpie#v0.2.4','https://github.com/Guuuu233/claude-science-for-magpie','git+https://github.com/Guuuu233/claude-science-for-magpie.git'])assert.equal(api.isSciencePlugin(spec),true,spec);
});
test('unknown repositories, lookalikes and arbitrary local paths do not activate the service',()=>{
 assert.equal(typeof api.isSciencePlugin,'function');
 for(const spec of [null,'','magpie-claude-science-extra','@someone/magpie-claude-science','https://github.com/other/magpie-claude-science','https://github.com.evil/shiyang1026/magpie-claude-science','https://user:pass@github.com/shiyang1026/magpie-claude-science','/tmp/magpie-claude-science','github:other/claude-science-for-magpie','claude-science-for-magpie-extra','https://github.com/shiyang1026/claude-science-for-magpie'])assert.equal(api.isSciencePlugin(spec),false,String(spec));
 assert.equal(api.isSciencePlugin('/owned/release',['/owned/release']),true);
});
test('enabled sources survive removal or disabling of the old checkout entry',()=>{
 assert.equal(typeof api.enabledSciencePlugins,'function');
 const github='https://github.com/shiyang1026/magpie-claude-science';
 assert.deepEqual(api.enabledSciencePlugins({plugins:[{spec:'/old',off:true},{spec:github}]},['/old']),[{spec:github}]);
 assert.deepEqual(api.enabledSciencePlugins({plugins:[{spec:github,off:true}]}),[]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRelease, validatePackage } from '../scripts/release-check.mjs';
const manifest = { name: 'claude-science-for-magpie', version: '0.1.0', repository: { url: 'git+https://github.com/Guuuu233/claude-science-for-magpie.git' }, bin: { 'claude-science-for-magpie': 'src/cli.js' } };
const context = { event: 'workflow_dispatch', repository: 'Guuuu233/claude-science-for-magpie', ref: 'refs/tags/v0.1.0', sha: 'a'.repeat(40), head: 'a'.repeat(40), tagCommit: 'a'.repeat(40), dirty: '' };
test('release accepts only manually selected matching tag and checkout', () => {
 assert.doesNotThrow(() => validateRelease(manifest, context));
 for (const change of [{event:'push'}, {repository:'other/fork'}, {ref:'refs/heads/main'}, {ref:'refs/tags/v0.2.0'}, {head:'b'.repeat(40)}, {tagCommit:'b'.repeat(40)}, {dirty:' M src/cli.js'}]) assert.throws(() => validateRelease(manifest, {...context,...change}));
});
test('automatic release requires the exact main push commit for truthful provenance',()=>{
 const auto={...context,mode:'automatic',event:'push',sourceRef:'refs/heads/main',sourceSha:context.sha,created:true};
 assert.doesNotThrow(()=>validateRelease(manifest,auto));
 for(const change of [{event:'pull_request'},{sourceRef:'refs/heads/feature'},{created:false},{sourceSha:'b'.repeat(40)},{sourceSha:'bad'},{tagCommit:'c'.repeat(40)},{mode:'unknown'}])assert.throws(()=>validateRelease(manifest,{...auto,...change}));
});
test('manual dispatch cannot substitute a different source commit',()=>{
 assert.throws(()=>validateRelease(manifest,{...context,sourceSha:'b'.repeat(40),sourceRef:context.ref}));
});
test('package rejects private publication, incorrect source, lifecycle scripts and leaked files', () => {
 const files = ['package.json','src/cli.js','src/agent.js','src/middleware.js','README.md','README.zh-CN.md','LICENSE'];
 assert.doesNotThrow(() => validatePackage(manifest,files));
 for (const bad of [{private:true}, {repository:{url:'https://github.com/other/fork'}}, {scripts:{postinstall:'node src/cli.js install'}}]) assert.throws(() => validatePackage({...manifest,...bad},files));
 for (const file of ['work/auth.json','test/private.mjs','docs/local/release-plan.md','docs/plan.md','src/.env','src/token.json']) assert.throws(() => validatePackage(manifest,[...files,file]));
 assert.throws(() => validatePackage(manifest, files.filter(f=>f!=='src/cli.js')));
});

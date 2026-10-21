import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
const api=await import('../scripts/publish-package.mjs').catch(()=>({}));
const manifest={name:'magpie-claude-science',version:'0.1.0'};
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'npm-publish-'));const tarball=path.join(root,'release.tgz');fs.writeFileSync(tarball,'verified artifact');return{root,tarball,meta:{...manifest,dist:{integrity:'sha512-'+createHash('sha512').update('verified artifact').digest('base64')}}};}
const response=metadata=>metadata?{status:200,ok:true,json:async()=>metadata}:{status:404,ok:false};
test('already published identical artifact is a no-op',async()=>{
 assert.equal(typeof api.publishPackage,'function');const f=fixture();let calls=0;
 try{const result=await api.publishPackage({...f,manifest,fetchImpl:async()=>response(f.meta),runPublish:()=>calls++});assert.equal(result.alreadyPublished,true);assert.equal(calls,0);}finally{fs.rmSync(f.root,{recursive:true});}
});
test('a published version with a different artifact is rejected before publication',async()=>{
 assert.equal(typeof api.publishPackage,'function');const f=fixture();let called=false;
 try{await assert.rejects(api.publishPackage({...f,manifest,fetchImpl:async()=>response({...f.meta,dist:{integrity:'different'}}),runPublish:()=>{called=true;}}),/integrity/);assert.equal(called,false);}finally{fs.rmSync(f.root,{recursive:true});}
});
test('publish waits for public registry visibility and verifies exact tarball',async()=>{
 assert.equal(typeof api.publishPackage,'function');const f=fixture();let calls=0,fetches=0;
 try{const result=await api.publishPackage({...f,manifest,fetchImpl:async()=>response(++fetches<3?null:f.meta),runPublish:()=>calls++,sleep:async()=>{},polls:4});assert.equal(result.alreadyPublished,false);assert.equal(calls,1);assert.equal(fetches,3);}finally{fs.rmSync(f.root,{recursive:true});}
});
test('processing timeout fails instead of claiming package availability',async()=>{
 assert.equal(typeof api.publishPackage,'function');const f=fixture();
 try{await assert.rejects(api.publishPackage({...f,manifest,fetchImpl:async()=>response(null),runPublish:()=>{},sleep:async()=>{},polls:2}),/not yet visible/);}finally{fs.rmSync(f.root,{recursive:true});}
});
test('registry outage is not interpreted as an available package name',async()=>{
 assert.equal(typeof api.publishPackage,'function');const f=fixture();let called=false;
 try{await assert.rejects(api.publishPackage({...f,manifest,fetchImpl:async()=>({status:503,ok:false}),runPublish:()=>{called=true;}}),/503/);assert.equal(called,false);}finally{fs.rmSync(f.root,{recursive:true});}
});

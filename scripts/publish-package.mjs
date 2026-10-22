import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export async function publishPackage({tarball,manifest,fetchImpl=fetch,
  runPublish=file=>execFileSync('npm',['publish',file,'--access','public','--provenance','--ignore-scripts','--registry=https://registry.npmjs.org'],{stdio:'inherit',timeout:120000}),
  sleep=ms=>new Promise(r=>setTimeout(r,ms)),polls=30,intervalMs=10000}){
  assert.equal(manifest.name,'claude-science-for-magpie');
  assert.match(manifest.version,/^\d+\.\d+\.\d+$/);
  const file=path.resolve(tarball);
  const expected='sha512-'+createHash('sha512').update(fs.readFileSync(file)).digest('base64');
  const url=`https://registry.npmjs.org/${manifest.name}/${manifest.version}`;
  async function metadata(){
    const response=await fetchImpl(url,{cache:'no-store',headers:{accept:'application/json'},signal:AbortSignal.timeout(10000),redirect:'error'});
    if(response.status===404)return null;
    if(!response.ok)throw Error(`Registry check failed: HTTP ${response.status}`);
    return response.json();
  }
  function verify(value){
    assert.equal(value.name,manifest.name);assert.equal(value.version,manifest.version);
    assert.equal(value.dist?.integrity,expected,'Published artifact integrity differs from the verified tarball');
  }
  const existing=await metadata();
  if(existing){verify(existing);return {alreadyPublished:true};}
  await runPublish(file);
  for(let i=0;i<polls;i++){
    await sleep(intervalMs);
    const value=await metadata();
    if(value){verify(value);return {alreadyPublished:false};}
  }
  throw Error('npm accepted the upload but the version is not yet visible. Wait for registry processing and rerun; do not change the existing version.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{
    const result=await publishPackage({tarball:process.argv[2],manifest:JSON.parse(fs.readFileSync('package.json','utf8'))});
    console.log(result.alreadyPublished?'Exact artifact already published; no upload needed.':'Published version is publicly available and its artifact integrity matches.');
  }catch(e){console.error(e.message);process.exitCode=1;}
}

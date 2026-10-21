import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

// Offline integration check. It never contacts Magpie, Claude, or a network
// service: a fake HOME, a copied package tree, and (if available) the local
// smol-toml dependency are enough to exercise the real deployment path.
const sourceRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const lab=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'magpie-integration-')));
const home=path.join(lab,'home');
fs.mkdirSync(home,{recursive:true});
process.env.HOME=home;
process.env.USERPROFILE=home;

let packageRoot=sourceRoot;
if(process.env.PACKAGE_DIR){
  packageRoot=fs.realpathSync(path.resolve(process.env.PACKAGE_DIR));
}else if(process.env.PACKAGE_TARBALL){
  const extracted=path.join(lab,'extracted');
  fs.mkdirSync(extracted);
  execFileSync('tar',['-xzf',path.resolve(process.env.PACKAGE_TARBALL),'-C',extracted],{stdio:'pipe'});
  packageRoot=fs.realpathSync(path.join(extracted,'package'));
}
const manifest=JSON.parse(fs.readFileSync(path.join(packageRoot,'package.json'),'utf8'));

function copyTree(from,to){
  fs.mkdirSync(to,{recursive:true});
  for(const entry of fs.readdirSync(from,{withFileTypes:true})){
    const source=path.join(from,entry.name),target=path.join(to,entry.name);
    if(entry.isDirectory())copyTree(source,target);
    else if(entry.isFile())fs.copyFileSync(source,target);
    else throw Error('Unsupported integration fixture entry: '+source);
  }
}

const app=path.join(lab,'app');
fs.mkdirSync(app);
fs.copyFileSync(path.join(packageRoot,'package.json'),path.join(app,'package.json'));
copyTree(path.join(packageRoot,'src'),path.join(app,'src'));

// stageDeployment resolves production dependencies from the project tree.
// Use the real smol-toml when the checkout has one; otherwise synthesize the
// minimal package metadata the deployment copier verifies.
const localDependency=path.join(sourceRoot,'node_modules','smol-toml');
const appDependency=path.join(app,'node_modules','smol-toml');
if(fs.existsSync(localDependency))copyTree(localDependency,appDependency);
else{
  fs.mkdirSync(appDependency,{recursive:true});
  fs.writeFileSync(path.join(appDependency,'package.json'),JSON.stringify({name:'smol-toml',version:'1.9.1',type:'module',main:'index.js'})+'\n');
  fs.writeFileSync(path.join(appDependency,'index.js'),'export const parse=()=>({});\n');
}

const {stageDeployment,verifyDeployment}=await import(pathToFileURL(path.join(packageRoot,'src','deployment.js')).href);
const {createBridge}=await import(pathToFileURL(path.join(packageRoot,'src','bridge.js')).href);
assert.equal(typeof createBridge,'function','src/bridge.js must export createBridge');

const root=path.join(home,'.config','magpie','claude-science-runtime');
const release=stageDeployment({project:app,root,node:process.execPath});
assert.equal(verifyDeployment(release),true,'verifyDeployment must accept the staged release');
assert.equal(release.node,path.join(release.path,'bin','node'),'deployment node must be the owned copy');

const staged=fs.readdirSync(path.join(release.path,'src')).sort();
const js=staged.filter(file=>file.endsWith('.js'));
const mjs=staged.filter(file=>file.endsWith('.mjs'));
// The runtime is the bridge alone.
const runtime=['bridge.js'];
assert.equal(staged.length,13,`expected 13 staged src files, got ${staged.length}: ${staged.join(', ')}`);
assert.equal(js.length,13,`expected 13 staged .js files, got ${js.length}`);
assert.equal(mjs.length,0,`expected no .mjs files, got ${mjs.length}`);
for(const file of runtime)assert.ok(staged.includes(file),'missing runtime module after staging: '+file);
for(const file of mjs)assert.ok(staged.includes(file),'missing .mjs after staging: '+file);

function walk(dir){
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
    const file=path.join(dir,entry.name);
    return entry.isDirectory()?walk(file):[file];
  });
}
const deployedFiles=walk(release.path);
assert.ok(!deployedFiles.some(file=>/\.bak/i.test(file)),'deployment must not contain .bak files');
assert.equal(JSON.parse(fs.readFileSync(path.join(release.path,'package.json'),'utf8')).version,manifest.version);

// Re-import the deployed bridge, not just the source copy, so its imports
// resolve from the immutable release directory.
const deployedBridge=pathToFileURL(path.join(release.path,'src','bridge.js')).href;
const deployed=await import(deployedBridge);
assert.equal(typeof deployed.createBridge,'function','deployed src/bridge.js must import and export createBridge');

fs.rmSync(lab,{recursive:true,force:true});
console.log(`PASS: integration; ${staged.length} staged src files (${js.length} .js + ${mjs.length} .mjs), ${runtime.length} runtime modules, no .bak, verifyDeployment=true, bridge imports resolve.`);

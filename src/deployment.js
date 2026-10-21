import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash,randomBytes} from 'node:crypto';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function safePath(file){let p=path.resolve(file);for(;;){try{if(fs.lstatSync(p).isSymbolicLink())throw Error('Refusing symlink: '+p);}catch(e){if(e.code!=='ENOENT')throw e;}const parent=path.dirname(p);if(parent===p)break;p=parent;}}
function files(dir,prefix=''){safePath(dir);return fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e=>{const rel=path.join(prefix,e.name);if(e.isSymbolicLink())throw Error('Refusing symlink: '+rel);if(e.isDirectory())return files(path.join(dir,e.name),rel);if(!e.isFile())throw Error('Unsupported deployment entry: '+rel);return [rel];});}
export function verifyDeployment(deployment){
  if(!deployment||!path.isAbsolute(deployment.path)||deployment.node!==path.join(deployment.path,'bin','node'))throw Error('Deployment executable must be the owned Node copy');
  safePath(deployment.path);const manifest=JSON.parse(fs.readFileSync(path.join(deployment.path,'manifest.json'),'utf8'));
  if(hash(JSON.stringify(manifest))!==deployment.id)throw Error('Deployment manifest checksum mismatch');
  const actual=files(deployment.path).filter(x=>x!=='manifest.json');
  if(actual.length!==Object.keys(manifest).length)throw Error('Deployment file checksum mismatch');
  for(const rel of actual)if(manifest[rel]!==hash(fs.readFileSync(path.join(deployment.path,rel))))throw Error('Deployment checksum mismatch: '+rel);
  return true;
}
function dependencyRoot(project,dependency) {
  const require=createRequire(path.join(project,'package.json'));
  // Node resolves package exports and npm's ancestor node_modules layout. Package metadata
  // need not itself be exported; walk from the resolved entry and verify the package name.
  const entry=require.resolve(dependency);
  safePath(entry);
  for(let directory=path.dirname(entry);;directory=path.dirname(directory)) {
    const metadata=path.join(directory,'package.json');
    if(fs.existsSync(metadata)) {
      safePath(metadata);
      if(JSON.parse(fs.readFileSync(metadata,'utf8')).name===dependency) {
        // resolve() canonicalizes symlinks. Inspect its original node_modules path too.
        const candidate=(require.resolve.paths(dependency)||[]).map(base=>path.join(base,dependency)).find(file=>fs.existsSync(file)&&fs.realpathSync(file)===directory);
        if(!candidate)throw Error('Cannot verify dependency package root: '+dependency);
        safePath(candidate);
        return directory;
      }
    }
    if(path.dirname(directory)===directory)break;
  }
  throw Error('Cannot verify dependency package metadata: '+dependency);
}
export function stageDeployment({project,root,node=process.execPath}){
  safePath(project);safePath(root);
  const entries=new Map();
  const add=(source,prefix)=>{safePath(source);for(const rel of files(source))entries.set(path.join(prefix,rel),fs.readFileSync(path.join(source,rel)));};
  add(path.join(project,'src'),'src');
  safePath(path.join(project,'package.json'));
  const pkg=fs.readFileSync(path.join(project,'package.json'));entries.set('package.json',pkg);
  const dependencies=Object.keys(JSON.parse(pkg).dependencies||{});
  // Explicit production dependency set: fail closed when package requirements change.
  if(dependencies.some(x=>x!=='smol-toml'))throw Error('Unsupported production dependency; update the deployment copier');
  for(const dependency of dependencies)add(dependencyRoot(project,dependency),path.join('node_modules',dependency));
  entries.set('bin/node',fs.readFileSync(fs.realpathSync(node)));
  const manifest=Object.fromEntries([...entries].sort(([a],[b])=>a.localeCompare(b)).map(([name,bytes])=>[name,hash(bytes)]));
  const id=hash(JSON.stringify(manifest)),release=path.join(root,'releases',id);
  const result={id,path:release,node:path.join(release,'bin','node')};
  if(fs.existsSync(release)){verifyDeployment(result);return result;}
  fs.mkdirSync(path.dirname(release),{recursive:true,mode:0o700});
  const staging=release+'.stage-'+randomBytes(8).toString('hex');fs.mkdirSync(staging,{mode:0o700});
  try{for(const [name,bytes] of entries){const target=path.join(staging,name);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});fs.writeFileSync(target,bytes,{mode:name==='bin/node'?0o700:0o600,flag:'wx'});}fs.writeFileSync(path.join(staging,'manifest.json'),JSON.stringify(manifest),{mode:0o600});fs.renameSync(staging,release);}catch(error){fs.rmSync(staging,{recursive:true,force:true});throw error;}
  verifyDeployment(result);return result;
}

// otool output lists the Mach-O executable first, followed by linked library paths.
export function validateNodeLibraries(output) {
  const libraries=String(output||'').split('\n').filter(line=>/^\s+\S/.test(line)).map(line=>line.trim().split(' (')[0]);
  if(!libraries.length)throw Error('Cannot inspect Node shared libraries; install an official Node 22/24 distribution');
  for(const library of libraries){
    if(!library.startsWith('/usr/lib/')&&!library.startsWith('/System/Library/'))throw Error('Node depends on '+library+'; install an official Node 22/24 distribution before deploying a standalone runtime');
  }
  return true;
}

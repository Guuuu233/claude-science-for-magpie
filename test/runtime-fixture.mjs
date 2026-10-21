import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {signalOwnedDaemon} from '../src/processes.js';
export const pause=ms=>new Promise(r=>setTimeout(r,ms));
export async function until(check, timeout=10000){const deadline=Date.now()+timeout;while(Date.now()<deadline){if(await check())return;await pause(50);}throw Error('Timed out waiting for lifecycle condition');}
export async function fixture({missing=false,noLock=false}={}){
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'science-life-'));
 const upstream=http.createServer((q,r)=>{r.setHeader('content-type','application/json');r.end('{"name":"magpie"}');});
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const reservations=[];for(let i=0;i<3;i++){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));reservations.push(s);}
 const [bridgePort,sciencePort,sandboxPort]=reservations.map(s=>s.address().port);
 await Promise.all(reservations.map(s=>new Promise(r=>s.close(r))));
 const state={project:root,pluginSpec:path.join(root,'release'),agentConfig:path.join(root,'agent.json'),pluginsFile:path.join(root,'plugins.json'),originalConfig:path.join(root,'original.toml'),scienceConfig:path.join(root,'managed.toml'),configJournal:path.join(root,'journal.json'),statusFile:path.join(root,'status.json'),scienceLog:path.join(root,'science.log'),binary:path.join(root,'fake-science'),data:path.join(root,'data'),token:'test-local',bridgePort,sciencePort,sandboxPort};
 fs.mkdirSync(state.data);fs.writeFileSync(state.originalConfig,'# ORIGINAL\n');fs.writeFileSync(state.scienceConfig,'data_dir="managed"\n');
 const selection={model:'fake/luna',key:'magpie-claude-science',gateway:`http://127.0.0.1:${upstream.address().port}`};
 fs.writeFileSync(state.agentConfig,JSON.stringify(selection));fs.writeFileSync(state.pluginsFile,JSON.stringify({plugins:[{spec:state.pluginSpec}]}));
 if(!missing)fs.writeFileSync(state.binary,`#!${process.execPath}
const fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const arg=n=>process.argv[process.argv.indexOf(n)+1],data=arg('--data-dir'),port=Number(arg('--port'));
const server=http.createServer((q,r)=>{r.setHeader('content-type','application/json');r.end(JSON.stringify({status:'healthy',service:'gateway'}));});
server.listen(port,'127.0.0.1',()=>{if(!${noLock})fs.writeFileSync(path.join(data,'operon.lock'),JSON.stringify({pid:process.pid,port,sandbox_port:Number(arg('--sandbox-port')),version:'fixture-1'}));});
process.on('SIGTERM',()=>{try{fs.unlinkSync(path.join(data,'operon.lock'));}catch{}server.close(()=>process.exit(0));});
`,{mode:0o700});
 const file=path.join(root,'state.json');fs.writeFileSync(file,JSON.stringify(state));
 const runner=path.join(root,'manager.mjs');
 fs.writeFileSync(runner,`import fs from 'node:fs'; import {runRuntime} from ${JSON.stringify(pathToFileURL(path.resolve('src/runtime.js')).href)}; await runRuntime(JSON.parse(fs.readFileSync(process.argv[2])),{pollMs:80,startTimeoutMs:1200,stopTimeoutMs:1200,backoffMs:500});`);
 const children=[];
 const status=()=>{try{return JSON.parse(fs.readFileSync(state.statusFile));}catch{return {};}};
 const start=()=>{const p=spawn(process.execPath,[runner,file],{stdio:'ignore'});children.push(p);return p;};
 const stop=async(p,signal='SIGTERM')=>{if(p.exitCode!==null||p.signalCode!==null)return;const done=once(p,'exit');p.kill(signal);const timer=setTimeout(()=>p.kill('SIGKILL'),4000);try{await done;}finally{clearTimeout(timer);}};
 const cleanup=async()=>{for(const p of children)await stop(p);try{const lease=JSON.parse(fs.readFileSync(path.join(root,'daemon-lease.json')));signalOwnedDaemon(lease,state,'SIGKILL');}catch{}upstream.closeAllConnections();await new Promise(r=>upstream.close(r));fs.rmSync(root,{recursive:true,force:true});};
 return {root,state,file,start,stop,status,cleanup,selection};
}

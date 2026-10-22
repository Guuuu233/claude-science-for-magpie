import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
const logDir=fs.mkdtempSync(path.join(os.tmpdir(),'science-shape-'));
process.env.MAGPIE_SCIENCE_BRIDGE_LOG=path.join(logDir,'bridge.log');
const {requestShape,compareShapes,textDiff,createBridge}=await import('../src/bridge.js');

const tool=(name,d='desc')=>({name,description:d,input_schema:{type:'object',properties:{}}});
const base={
  system:[{type:'text',text:'You are Science. Now: 2026-10-22T17:30:05Z.',cache_control:{type:'ephemeral'}}],
  tools:[tool('python'),tool('bash')],
  thinking:{type:'adaptive'},output_config:{effort:'high'},
  messages:[{role:'user',content:'PRIVATE question'}],
};
const next=(b,extra)=>({...b,messages:[...b.messages,
  {role:'assistant',content:[{type:'tool_use',id:'t1',name:'python',input:{}}]},
  {role:'user',content:[{type:'tool_result',tool_use_id:'t1',content:'PRIVATE result',cache_control:{type:'ephemeral'}}]}],...extra});

test('a plain continuation differs from its previous request in nothing the runtime compares',()=>{
  const first=compareShapes(undefined,requestShape(base));
  assert.equal(first.first,true);
  // cache_control moving to the newest message is not a change
  const moved={...base,messages:[{role:'user',content:[{type:'text',text:'PRIVATE question',cache_control:{type:'ephemeral'}}]}]};
  const plainBase={...base,messages:[{role:'user',content:[{type:'text',text:'PRIVATE question'}]}]};
  const out=compareShapes(requestShape(plainBase),requestShape(next(moved)));
  assert.deepEqual(Object.keys(out).sort(),['msgs','sys','sysLen','tools']);
});

test('each change the runtime would rebuild for is named, without content',()=>{
  const prev=requestShape(base);
  const clock=compareShapes(prev,requestShape(next(base,{system:[{type:'text',text:'You are Science. Now: 2026-10-22T17:31:28Z.'}]})));
  assert.deepEqual(clock.sysDiff,{at:37,was:4,now:4,clockLike:true});
  const words=compareShapes(prev,requestShape(next(base,{system:'You are Science. Now: 2026-10-22T17:30:05Z. Memory: likes R.'})));
  assert.equal(words.sysDiff.clockLike,false);
  const tools=compareShapes(prev,requestShape(next(base,{tools:[tool('python','new'),tool('read_skill')]})));
  assert.deepEqual(tools.toolsDiff,{added:['read_skill'],removed:['bash'],changed:['python']});
  assert.equal(compareShapes(prev,requestShape(next(base,{tool_choice:{type:'any'}}))).toolChoiceChanged,true);
  assert.equal(compareShapes(prev,requestShape(next(base,{output_config:{effort:'max'}}))).thinkingChanged,true);
  const edited=compareShapes(prev,requestShape(next(base,{messages:[{role:'user',content:'PRIVATE questio'}]})));
  assert.equal(edited.historyDiff.at,0);
  assert.equal(edited.historyDiff.role,'user');
  for(const out of [clock,words,tools,edited])assert.doesNotMatch(JSON.stringify(out),/PRIVATE|Science|Memory|python.*desc/);
});

test('textDiff reports the changed span only',()=>{
  assert.equal(textDiff('same','same'),null);
  assert.deepEqual(textDiff('abc 12:00 xyz','abc 12:05:01 xyz'),{at:8,was:1,now:4,clockLike:true});
});

test('the bridge logs each conversation request against its previous one',async t=>{
  const upstream=http.createServer((req,res)=>{req.resume();req.on('end',()=>{res.writeHead(200,{'content-type':'application/json'});res.end('{"type":"message","content":[]}');});});
  await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
  const server=createBridge(()=>({model:'codex/gpt-6-luna',gateway:`http://127.0.0.1:${upstream.address().port}`,key:'k',token:'local'}));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>{server.close();upstream.close();fs.rmSync(logDir,{recursive:true,force:true});});
  const FRAME='7133cf97b33d444c91010589a074dff9';
  const metadata={user_id:JSON.stringify({session_id:FRAME,frame_id:FRAME})};
  const send=b=>fetch(`http://127.0.0.1:${server.address().port}/v1/messages`,{method:'POST',headers:{authorization:'Bearer local'},body:JSON.stringify({model:'codex/gpt-6-luna',metadata,...b})}).then(r=>r.text());
  await send(base);
  await send(next(base,{system:'You are Science. Now: 2026-10-22T17:31:28Z.'}));
  const lines=fs.readFileSync(process.env.MAGPIE_SCIENCE_BRIDGE_LOG,'utf8').trim().split('\n').map(l=>JSON.parse(l.slice(l.indexOf(' ')+1)));
  assert.equal(lines[0].shape.first,true);
  assert.equal(lines[1].shape.sysDiff.clockLike,true);
  assert.equal(lines[1].shape.historyDiff,undefined);
  assert.doesNotMatch(fs.readFileSync(process.env.MAGPIE_SCIENCE_BRIDGE_LOG,'utf8'),/PRIVATE|You are Science/);
});

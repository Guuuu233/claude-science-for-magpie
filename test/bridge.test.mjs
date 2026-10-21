import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
process.env.MAGPIE_SCIENCE_BRIDGE_LOG='/dev/null';
const {createBridge, validateConfig, buildCatalog, upstreamModel}=await import('../src/bridge.js');

const config={model:'codex/gpt-6-luna',gateway:'http://127.0.0.1:3425',key:'magpie-claude-science',token:'test-local-only'};
const FRAME='7133cf97b33d444c91010589a074dff9';
const meta={user_id:JSON.stringify({session_id:FRAME,frame_id:FRAME})};
const magpieModels=[
  {id:'gtt-claude/claude-tui/claude-opus-5-5',display_name:'Claude Opus 5.5',max_input_tokens:1000000,max_output_tokens:128000},
  {id:'gtt-claude/claude-tui/claude-haiku-4-5-20251001',display_name:'Claude Haiku 4.5'},
  {id:'ntt-claude/claude-tui/claude-opus-5-5',display_name:'claude-opus-5-5'},
  {id:'deepseek/deepseek-flash',display_name:'DeepSeek Flash',magpie_label:'DeepSeek Flash · deepseek',max_input_tokens:1048576,max_output_tokens:384000},
];

test('only loopback Magpie endpoints and real upstream model ids are accepted',()=>{
  assert.doesNotThrow(()=>validateConfig(config));
  assert.doesNotThrow(()=>validateConfig({...config,claude:'gtt-claude/claude-tui-canary'}));
  for(const gateway of ['https://example.com','http://127.0.0.1.evil:3425','http://u:p@127.0.0.1:3425','file:///tmp/a'])assert.throws(()=>validateConfig({...config,gateway}));
  for(const model of ['','claude-science/a','bad\nmodel'])assert.throws(()=>validateConfig({...config,model}));
  for(const claude of ['','a b','x/../y?'])assert.throws(()=>validateConfig({...config,claude}));
});

test('the catalog is all of Magpie, Claude TUI models under their Claude names',()=>{
  const cat=buildCatalog(magpieModels,config);
  const ids=cat.data.map(m=>m.id);
  assert.deepEqual(ids,['claude-opus-5-5','claude-haiku-4-5-20251001','ntt-claude/claude-tui/claude-opus-5-5','deepseek/deepseek-flash']);
  assert.equal(cat.data[0].max_input_tokens,1000000);
  assert.equal(cat.data[0].max_tokens,128000);
  assert.match(cat.data[0].display_name,/TUI/);
  assert.equal(cat.data[3].display_name,'DeepSeek Flash · deepseek');
  assert.ok(buildCatalog([],config).data.length>0,'an unreachable catalog still offers a Claude model');
});

test('Claude names run on the configured Claude TUI provider, other ids unchanged',()=>{
  assert.equal(upstreamModel('claude-opus-5-5',config),'gtt-claude/claude-tui/claude-opus-5-5');
  assert.equal(upstreamModel('claude-haiku-4-5-20251001',{...config,claude:'gtt-claude/claude-tui-canary'}),'gtt-claude/claude-tui-canary/claude-haiku-4-5-20251001');
  assert.equal(upstreamModel('deepseek/deepseek-flash',config),'deepseek/deepseek-flash');
  assert.equal(upstreamModel('claude-magpie-8635646829',config),'claude-magpie-8635646829','Magpie aliases pass through');
});

async function harness(handler){
  const seen=[];
  const upstream=http.createServer(async(req,res)=>{
    const chunks=[];for await(const c of req)chunks.push(c);
    const body=chunks.length?JSON.parse(Buffer.concat(chunks)):null;
    seen.push({url:req.url,method:req.method,body,headers:req.headers});
    if(req.url==='/v1/models'){
      assert.equal(req.headers.authorization,undefined,'the catalog is read under real ids, without the key');res.setHeader('content-type','application/json');res.end(JSON.stringify({data:magpieModels}));return;}
    await handler(req,res,body);
  });
  await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
  const cfg={...config,gateway:`http://127.0.0.1:${upstream.address().port}`};
  const server=createBridge(()=>cfg);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  const close=async()=>{server.closeAllConnections();upstream.closeAllConnections();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>upstream.close(r))]);};
  return {seen,base,close,headers:{'authorization':'Bearer test-local-only','content-type':'application/json'}};
}

test('relays streaming and counting with the conversation identity, nothing else changed',async()=>{
  const h=await harness(async(req,res,body)=>{
    if(req.url.includes('count_tokens')){res.setHeader('content-type','application/json');res.end('{"input_tokens":12}');return;}
    res.setHeader('content-type','text/event-stream');
    res.write('event: message_start\ndata: '+JSON.stringify({type:'message_start',message:{model:body.model}})+'\n\n');
    res.end('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"OK"}}\n\n');
  });
  try{
    assert.equal((await fetch(h.base+'/v1/models')).status,401);
    assert.equal((await fetch(h.base+'/arbitrary',{headers:h.headers})).status,404);
    const listed=await (await fetch(h.base+'/v1/models',{headers:h.headers})).json();
    assert.equal(listed.data[0].id,'claude-opus-5-5');
    assert.equal((await fetch(h.base+'/v1/models/deepseek%2Fdeepseek-flash',{headers:h.headers})).status,200);
    const body={model:'claude-opus-5-5',stream:true,metadata:meta,messages:[{role:'user',content:'hello'}],tools:[{name:'calculate',input_schema:{type:'object'}}]};
    const res=await fetch(h.base+'/v1/messages',{method:'POST',headers:{...h.headers,'anthropic-beta':'b1'},body:JSON.stringify(body)});
    assert.equal(res.status,200);const txt=await res.text();
    assert.ok(txt.includes('"model":"claude-opus-5-5"'),'the model name Science asked for comes back');assert.ok(txt.includes('OK'));
    const sent=h.seen.find(s=>s.url==='/v1/messages');
    assert.equal(sent.body.model,'gtt-claude/claude-tui/claude-opus-5-5');
    assert.deepEqual(sent.body.tools,body.tools);assert.deepEqual(sent.body.messages,body.messages);assert.deepEqual(sent.body.metadata,body.metadata);
    assert.equal(sent.headers.authorization,'Bearer magpie-claude-science');
    assert.equal(sent.headers['x-session-id'],'science-7133cf97-b33d-444c-9101-0589a074dff9');
    assert.equal(sent.headers['anthropic-beta'],'b1');
    const counted=await fetch(h.base+'/v1/messages/count_tokens',{method:'POST',headers:h.headers,body:JSON.stringify({model:'deepseek/deepseek-flash',messages:body.messages})});
    assert.deepEqual(await counted.json(),{input_tokens:12});
    assert.equal(h.seen.at(-1).body.model,'deepseek/deepseek-flash');
    assert.equal(h.seen.at(-1).headers['x-session-id'],undefined,'a request without a frame carries no conversation id');
    const fork={...body,stream:false,tool_choice:{type:'none'}};
    await (await fetch(h.base+'/v1/messages',{method:'POST',headers:h.headers,body:JSON.stringify(fork)})).text();
    assert.equal(h.seen.at(-1).headers['x-session-id'],undefined,'a helper fork carries no conversation id');
  }finally{await h.close();}
});

test('upstream errors reach Science as they are, once: status, headers and body',async()=>{
  let calls=0;
  const h=await harness(async(req,res)=>{
    calls++;
    res.writeHead(429,{'content-type':'application/json','retry-after':'3600','x-should-retry':'false'});
    res.end('{"type":"error","error":{"type":"rate_limit_error","message":"usage limit reached"}}');
  });
  try{
    const res=await fetch(h.base+'/v1/messages',{method:'POST',headers:h.headers,body:JSON.stringify({model:'claude-opus-5-5',messages:[{role:'user',content:'x'}]})});
    assert.equal(res.status,429);
    assert.equal(res.headers.get('retry-after'),'3600');
    assert.equal(res.headers.get('x-should-retry'),'false');
    assert.equal((await res.json()).error.type,'rate_limit_error');
    assert.equal(calls,1,'the bridge never retries');
  }finally{await h.close();}
});

test('a client that goes away cancels the upstream request',async()=>{
  let upstreamClosed;const closed=new Promise(r=>{upstreamClosed=r;});
  const h=await harness(async(req,res)=>{
    res.writeHead(200,{'content-type':'text/event-stream'});
    res.write('event: ping\ndata: {"type":"ping"}\n\n');
    res.on('close',()=>upstreamClosed(true));
  });
  try{
    const ctl=new AbortController();
    const res=await fetch(h.base+'/v1/messages',{method:'POST',headers:h.headers,signal:ctl.signal,body:JSON.stringify({model:'claude-opus-5-5',stream:true,messages:[{role:'user',content:'x'}]})});
    const reader=res.body.getReader();await reader.read();
    ctl.abort();
    assert.equal(await Promise.race([closed,new Promise(r=>setTimeout(()=>r(false),3000))]),true,'upstream request still open after the client left');
  }finally{await h.close();}
});

test('an unreachable Magpie is a clear 502, not a hang',async()=>{
  const cfg={...config,gateway:'http://127.0.0.1:9'};
  const server=createBridge(()=>cfg);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{
    const res=await fetch(`http://127.0.0.1:${server.address().port}/v1/messages`,{method:'POST',headers:{'authorization':'Bearer test-local-only','content-type':'application/json'},body:JSON.stringify({model:'claude-opus-5-5',messages:[]})});
    assert.equal(res.status,502);
    assert.match((await res.json()).error.message,/could not reach Magpie/);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

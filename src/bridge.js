import http from 'node:http';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';

// The bridge is Claude Science's Anthropic endpoint. It relays every request
// to Magpie and every answer back, unchanged except for the model name:
// no retries, no caches, no queues — Science and the Claude TUI runtime own
// those. It adds the conversation's identity (x-session-id), which the
// Claude TUI runtime needs to keep one native session per Science frame.

export const DEFAULT_CLAUDE='claude-tui';
export function validateConfig(c) {
  const u=new URL(c.gateway);
  if(!['http:','https:'].includes(u.protocol)||!['127.0.0.1','[::1]'].includes(u.hostname)||u.username||u.password||u.search||u.hash||!['','/'].includes(u.pathname)) throw Error('Gateway must be a literal loopback origin');
  if(typeof c.model!=='string'||!/^[-\w.]+\/[-\w./:]+$/.test(c.model)||c.model.startsWith('claude-science/')) throw Error('Invalid upstream model');
  if(c.claude!==undefined&&(typeof c.claude!=='string'||!/^[-\w.]+(\/[-\w.]+)*$/.test(c.claude))) throw Error('Invalid Claude provider');
  if(typeof c.key!=='string'||!/^[\x21-\x7e]+$/.test(c.key))throw Error('Invalid gateway key');
  if(typeof c.token!=='string'||!c.token)throw Error('Local token required');
  return c;
}

// Magpie answers Anthropic clients with claude-magpie-* aliases of its own
// models; those are Magpie's names, not Claude's, and pass through as is.
const CLAUDE_ID=/^claude-(?!magpie-|x-)[a-z0-9][-a-z0-9.]*$/;
const TUI_CLAUDE=/(?:^|\/)claude-tui(?:-[a-z0-9]+)?\/(claude-[a-z0-9][-a-z0-9.]*)$/;
// Science lists only ids starting with "claude-" whose name is not a bare
// slug. Every other Magpie model is offered under a stable alias,
// claude-x-<slug>-<hash>, and named so Science keeps it.
const ALIAS='claude-x-';
export function aliasOf(id){
  const slug=id.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48);
  return ALIAS+slug+'-'+createHash('sha256').update(id).digest('hex').slice(0,6);
}
function shownName(name,id){
  return /^[\p{Extended_Pictographic}\p{Emoji_Presentation}]/u.test(name)||/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(name)?name+' · '+id.split('/')[0]:name;
}
// Science's own model names (its defaults, its helpers) are Claude names:
// they run on the Claude TUI provider of the same name. An alias runs on the
// Magpie model it names (ids: Magpie's catalog); other ids are unchanged.
export function upstreamModel(id,c,ids=[]){
  if(CLAUDE_ID.test(id))return (c.claude||DEFAULT_CLAUDE)+'/'+id;
  if(id.startsWith(ALIAS))return ids.find(x=>aliasOf(x)===id)||null;
  return id;
}
// Science learns a model's limits from this list; Claude TUI models appear
// under their bare Claude names first, then the rest of Magpie's catalog.
export function buildCatalog(models,c){
  const seen=new Set(),claude=[],other=[],own=(c.claude||DEFAULT_CLAUDE)+'/';
  const entry=(id,m,name)=>({id,type:'model',display_name:name,created_at:'2026-01-01T00:00:00Z',
    max_input_tokens:m.max_input_tokens||m.context_window||200000,max_tokens:m.max_output_tokens||m.max_tokens||32000});
  for(const m of models||[]){
    if(!m||typeof m.id!=='string')continue;
    const name=m.display_name||m.name||m.id;
    const tui=m.id.match(TUI_CLAUDE);
    if(tui&&!seen.has(tui[1])){seen.add(tui[1]);claude.push(entry(tui[1],m,name.includes('TUI')?name:name+' · Claude TUI'));}
    if(!CLAUDE_ID.test(m.id)&&!m.id.startsWith(own))other.push(entry(m.id.startsWith('claude-')?m.id:aliasOf(m.id),m,shownName(m.magpie_label||name,m.id)));
  }
  const data=[...claude,...other];
  if(!data.length)data.push(entry('claude-opus-5-5',{},'Claude Opus 5.5 · Claude TUI'));
  return {data,has_more:false,first_id:data[0].id,last_id:data.at(-1).id};
}

const LOG=process.env.MAGPIE_SCIENCE_BRIDGE_LOG||process.env.HOME+'/.config/magpie/claude-science-runtime/bridge.log';
const log=entry=>{try{fs.appendFileSync(LOG,new Date().toISOString()+' '+JSON.stringify(entry)+'\n',{mode:0o600});}catch{}};
function json(res,status,value){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));}
function error(res,status,message){json(res,status,{type:'error',error:{type:status===401?'authentication_error':status>=500?'api_error':'invalid_request_error',message}});}
function same(a,b){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
function restore(line,model){
  if(!line.startsWith('data:'))return line;
  try{const obj=JSON.parse(line.slice(5));if(obj.type==='message_start'&&obj.message)obj.message.model=model;return 'data: '+JSON.stringify(obj);}catch{return line;}
}

// Science (0.1.60) puts the executing frame in metadata.user_id:
// {"session_id":"<session>[:<frame24>][:<lane>]","frame_id":"<32 hex>"}.
// The frame's own agent carries no lane token (a child frame's agent is
// "<root>:<child24>"); every other caller adds one (mem, sniff, ...).
// Forks of the agent's view (memory extraction, compaction folds) use the
// agent lane with tools disabled.
const LANE_TOKEN=/^[a-z0-9_]{1,32}$/;
export function scienceLane(body){
  let meta;try{meta=JSON.parse(body&&body.metadata&&body.metadata.user_id);}catch{return null;}
  const hex=meta&&meta.frame_id;
  if(typeof hex!=='string'||!/^[0-9a-f]{32}$/.test(hex))return null;
  const frame=hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
  const parts=String(meta.session_id||'').toLowerCase().split(':');
  const isAgent=p=>(p.length===1&&p[0].replace(/-/g,'')===hex)||(p.length===2&&p[1]===hex.slice(0,24));
  if(isAgent(parts)){
    const fork=!!(body.tool_choice&&body.tool_choice.type==='none');
    return {frame,kind:fork?'fork':'main',lane:fork?'fork':'agent'};
  }
  const last=parts[parts.length-1];
  const lane=parts.length>1&&isAgent(parts.slice(0,-1))&&LANE_TOKEN.test(last)?last:'unknown';
  return {frame,kind:'aux',lane};
}
// The Claude TUI runtime keeps one native session per conversation id. A
// frame's own agent is that conversation; every helper call (memory
// extraction and compaction forks, sniff, keepalive pings, ...) and a
// request without a frame carry no id, so they run stateless beside it.
export function sessionLabel(body){
  const lane=scienceLane(body);
  return lane&&lane.kind==='main'?'science-'+lane.frame:null;
}

const PASS_HEADERS=['content-type','retry-after','x-should-retry','request-id','anthropic-ratelimit-unified-reset','anthropic-ratelimit-unified-status'];

export function createBridge(readConfig) {
  let cached=null;
  async function models(c){
    if(cached&&cached.gateway===c.gateway&&Date.now()-cached.at<60000)return cached.models;
    // Unauthenticated, Magpie lists its models under their own ids.
    const r=await fetch(c.gateway.replace(/\/$/,'')+'/v1/models',{signal:AbortSignal.timeout(5000)});
    if(!r.ok)throw Error('Magpie model catalog unavailable: '+r.status);
    const list=(await r.json()).data||[];
    cached={gateway:c.gateway,at:Date.now(),models:list};
    return list;
  }
  async function catalog(c){
    try{return buildCatalog(await models(c),c);}catch(e){log({catalogError:String(e.message||e)});return buildCatalog([],c);}
  }
  return http.createServer(async(req,res)=>{
    const startedAt=Date.now();
    const abort=new AbortController();
    res.on('close',()=>{if(!res.writableEnded)abort.abort();});
    let entry=null;
    try{
      const c=validateConfig(readConfig());
      const token=(req.headers.authorization||'').replace(/^Bearer /,'')||req.headers['x-api-key']||'';
      if(!same(String(token),c.token))return error(res,401,'Local Science token required');
      const url=new URL(req.url,'http://localhost');
      if(req.method==='GET'&&url.pathname==='/v1/models')return json(res,200,await catalog(c));
      if(req.method==='GET'&&url.pathname.startsWith('/v1/models/')){
        const id=decodeURIComponent(url.pathname.slice(11));
        const model=(await catalog(c)).data.find(m=>m.id===id);
        return model?json(res,200,model):error(res,404,'Unknown model');
      }
      if(req.method!=='POST'||!['/v1/messages','/v1/messages/count_tokens'].includes(url.pathname))return error(res,404,'Unsupported Science endpoint');
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>32*1024*1024)return error(res,413,'Request exceeds 32 MiB');chunks.push(chunk);}
      let body;try{body=JSON.parse(Buffer.concat(chunks));}catch{return error(res,400,'Invalid JSON');}
      if(!body||typeof body!=='object'||typeof body.model!=='string'||!/^[-\w.]+(\/[-\w./:]+)?$/.test(body.model))return error(res,400,'Invalid model');
      const asked=body.model;
      let ids=[];
      if(asked.startsWith('claude-x-'))try{ids=(await models(c)).map(m=>m.id);}catch(e){return error(res,503,String(e.message||e));}
      body.model=upstreamModel(asked,c,ids);
      if(!body.model)return error(res,404,'Unknown model: '+asked);
      const session=sessionLabel(body);
      entry={session,model:asked,target:body.model,endpoint:url.pathname,stream:body.stream===true};
      const headers={'content-type':'application/json','authorization':`Bearer ${c.key}`,'anthropic-version':req.headers['anthropic-version']||'2023-06-01',
        'user-agent':'magpie-claude-science/0.2','x-magpie-client':'science',...(session?{'x-session-id':session}:{})};
      if(req.headers['anthropic-beta'])headers['anthropic-beta']=req.headers['anthropic-beta'];
      const upstream=await fetch(c.gateway.replace(/\/$/,'')+url.pathname,{method:'POST',headers,body:JSON.stringify(body),signal:abort.signal,redirect:'error'});
      const out={'cache-control':'no-store'};
      for(const h of PASS_HEADERS){const v=upstream.headers.get(h);if(v)out[h]=v;}
      res.writeHead(upstream.status,out);
      const sse=(upstream.headers.get('content-type')||'').includes('text/event-stream');
      if(sse&&upstream.body){
        const decoder=new TextDecoder();let pending='';
        for await(const chunk of upstream.body){
          pending+=decoder.decode(chunk,{stream:true});let i;
          while((i=pending.indexOf('\n'))>=0){
            const line=pending.slice(0,i);pending=pending.slice(i+1);
            if(!res.write(restore(line,asked)+'\n'))await new Promise(r=>{res.once('drain',r);res.once('close',r);});
          }
        }
        pending+=decoder.decode();
        res.end(pending?restore(pending,asked):undefined);
      }else{
        const text=await upstream.text();
        let outText=text;
        if(upstream.ok){try{const v=JSON.parse(text);if(v&&v.type==='message')v.model=asked;outText=JSON.stringify(v);}catch{}}
        res.end(outText);
      }
      log({...entry,status:upstream.status,ms:Date.now()-startedAt});
    }catch(e){
      const gone=abort.signal.aborted;
      log({...entry,error:gone?'client_disconnect':String(e&&e.message||e),ms:Date.now()-startedAt});
      if(!res.headersSent&&!res.destroyed)error(res,502,'Science bridge could not reach Magpie: '+String(e&&e.message||e));
      else if(!res.destroyed)res.destroy();
    }
  });
}

require('dotenv').config();
const express=require('express'),cors=require('cors'),{authenticator}=require('otplib'),fs=require('fs'),path=require('path'),WebSocket=require('ws');
const e=express();e.use(cors());e.use(express.json({limit:'8mb'}));
const {PORT=8787,APP_KEY,ANGEL_API_KEY,ANGEL_CLIENT_CODE,ANGEL_PIN,ANGEL_TOTP_SECRET,ANTHROPIC_API_KEY,MODEL='claude-haiku-4-5-20251001',BRAVE_API_KEY}=process.env;
let angelRuntime={apiKey:ANGEL_API_KEY||'',clientCode:ANGEL_CLIENT_CODE||'',mpin:ANGEL_PIN||'',totpSecret:ANGEL_TOTP_SECRET||''};
const A='https://apiconnect.angelone.in',WSURL='wss://smartapisocket.angelone.in/smart-stream';
const NSE_MCP_URL=process.env.NSE_MCP_URL||'https://mcp.nseindia.in/cmmkt/mcp';
let mcp={sessionId:null,protocolVersion:null,tools:[],connected:false,lastError:null,nextId:1};
const IDX={'NIFTY 50':['NSE','99926000'],'BANKNIFTY':['NSE','99926009'],'FINNIFTY':['NSE','99926037'],'MIDCPNIFTY':['NSE','99926074'],'SENSEX':['BSE','99919000']};
let sess=null,master=null,liveSocket=null,liveConnecting=false,liveWanted={},liveClients=new Set(),liveLast={};
e.use('/api',(q,s,n)=>{const key=q.get('x-app-key')||q.query.appKey;if(APP_KEY&&key!==APP_KEY)return s.status(401).json({error:'unauthorized'});n()});
const hd=x=>({'Accept':'application/json','Content-Type':'application/json','X-UserType':'USER','X-SourceID':'WEB','X-ClientLocalIP':'127.0.0.1','X-ClientPublicIP':'127.0.0.1','X-MACAddress':'00:00:00:00:00:00','X-PrivateKey':angelRuntime.apiKey,...x});
async function login(){const c=angelRuntime;if(!c.apiKey||!c.clientCode||!c.mpin)throw Error('Angel One credentials not configured');const totp=c.totpSecret?authenticator.generate(c.totpSecret):c.totp;if(!totp)throw Error('Current TOTP required');const h=hd({'X-PrivateKey':c.apiKey});let r=await fetch(A+'/rest/auth/angelbroking/user/v1/loginByMpin',{method:'POST',headers:h,body:JSON.stringify({clientcode:c.clientCode,password:c.mpin,totp})});let txt=await r.text();let j;try{j=JSON.parse(txt)}catch{throw Error('Angel login returned non-JSON response: '+txt.slice(0,180))}if(!j.status)throw Error(j.message||'Angel MPIN login failed');sess={jwt:j.data.jwtToken,feed:j.data.feedToken,t:Date.now()};return sess}
async function ensureSession(){if(!sess||Date.now()-sess.t>4*3600000)return login();return sess}
async function quote(t){await ensureSession();let r=await fetch(A+'/rest/secure/angelbroking/market/v1/quote/',{method:'POST',headers:hd({Authorization:'Bearer '+sess.jwt}),body:JSON.stringify({mode:'FULL',exchangeTokens:t})}),j=await r.json();if(!j.status){await login();r=await fetch(A+'/rest/secure/angelbroking/market/v1/quote/',{method:'POST',headers:hd({Authorization:'Bearer '+sess.jwt}),body:JSON.stringify({mode:'FULL',exchangeTokens:t})});j=await r.json()}if(!j.status)throw Error(j.message||'quote failed');return j.data?.fetched||[]}
function em(s){let m=/^(\\d{1,2})([A-Z]{3})(\\d{4})$/.exec(s||'');return m?Date.UTC(+m[3],['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'].indexOf(m[2]),+m[1]):0}
async function sm(){if(master)return master;const f=path.join(__dirname,'tokens-cache.json');try{let c=JSON.parse(fs.readFileSync(f));if(c.d===new Date().toISOString().slice(0,10))return master=c.m}catch{}const r=await fetch('https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json');if(!r.ok)throw Error('Scrip master failed');const a=await r.json(),eq={},op=[];for(const x of a){if(x.exch_seg==='NSE'&&x.symbol===x.name+'-EQ')eq[x.name]=x.token;if((x.exch_seg==='NFO'||x.exch_seg==='BFO')&&x.instrumenttype==='OPTIDX')op.push(x)}master={eq,op};try{fs.writeFileSync(f,JSON.stringify({d:new Date().toISOString().slice(0,10),m:master}))}catch{}return master}

function sendLive(obj){const data='data: '+JSON.stringify(obj)+'\\n\\n';for(const res of liveClients)try{res.write(data)}catch{}}
function parseTick(raw){const b=Buffer.from(raw);if(b.length<51)return null;const mode=b.readUInt8(0),ex=b.readUInt8(1),token=b.subarray(2,27).toString('utf8').replace(/\\0/g,'');const ltp=Number(b.readBigInt64LE(43))/100;const out={token,exchangeType:ex,mode,ltp,ts:b.length>=43?Number(b.readBigInt64LE(35)):Date.now()};if(mode>=2&&b.length>=139)out.oi=Number(b.readBigInt64LE(131));return out}
function sendSubscriptions(){if(!liveSocket||liveSocket.readyState!==WebSocket.OPEN)return;const groups={};for(const [key,v] of Object.entries(liveWanted)){if(!v.tokens.length)continue;const k=v.ex;groups[k]??=[];groups[k].push(...v.tokens)}for(const [ex,tokens] of Object.entries(groups)){for(let i=0;i<tokens.length;i+=1000)liveSocket.send(JSON.stringify({correlationID:'algodesk01',action:1,params:{mode:String(liveWanted[ex]?.mode||1),tokenList:[{exchangeType:Number(ex),tokens:tokens.slice(i,i+1000)}]}}))}}
async function ensureLive(){if(liveSocket&&liveSocket.readyState===WebSocket.OPEN)return;if(liveConnecting)return;liveConnecting=true;try{await ensureSession();liveSocket=new WebSocket(WSURL,{headers:{Authorization:'Bearer '+sess.jwt,'x-api-key':angelRuntime.apiKey,'x-client-code':angelRuntime.clientCode,'x-feed-token':sess.feed}});liveSocket.on('open',()=>{liveConnecting=false;sendSubscriptions();sendLive({type:'status',live:true,time:new Date().toISOString()})});liveSocket.on('message',m=>{if(typeof m==='string'){if(m==='pong')return;return}const t=parseTick(m);if(!t)return;liveLast[t.token]=t;sendLive({type:'tick',...t})});liveSocket.on('error',err=>sendLive({type:'status',live:false,error:err.message}));liveSocket.on('close',()=>{liveSocket=null;liveConnecting=false;sendLive({type:'status',live:false});setTimeout(()=>ensureLive().catch(()=>{}),5000)})}catch(x){liveConnecting=false;sendLive({type:'status',live:false,error:x.message})}}
setInterval(()=>{if(liveSocket?.readyState===WebSocket.OPEN)liveSocket.send('ping')},30000);
function want(ex,tokens,mode){const key=String(ex);liveWanted[key]??={ex,mode,tokens:[]};liveWanted[key].mode=mode;liveWanted[key].tokens=[...new Set([...liveWanted[key].tokens,...tokens.map(String)])];if(liveSocket?.readyState===WebSocket.OPEN)liveSocket.send(JSON.stringify({correlationID:'algodesk01',action:1,params:{mode,tokenList:[{exchangeType:ex,tokens:tokens.map(String)}]}}));ensureLive().catch(()=>{})}
for(const [n,[ex,t]] of Object.entries(IDX))want(ex==='NSE'?1:3,[t],1);


function mcpParseResponse(text,contentType){
  if(contentType&&contentType.includes('text/event-stream')){
    const events=text.split(/\n\n+/).map(x=>x.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trim()).join('\n')).filter(Boolean);
    for(let i=events.length-1;i>=0;i--)try{return JSON.parse(events[i])}catch{}
    throw Error('NSE MCP returned an unreadable SSE response');
  }
  try{return JSON.parse(text)}catch{throw Error('NSE MCP returned non-JSON response: '+text.slice(0,240))}
}
async function mcpPost(payload,{sessionId=null,protocolVersion=null,modern=false}={}){
  const h={'content-type':'application/json','accept':'application/json, text/event-stream'};
  if(sessionId)h['Mcp-Session-Id']=sessionId;
  if(protocolVersion)h['MCP-Protocol-Version']=protocolVersion;
  if(modern){
    h['Mcp-Method']=payload.method;
    if(payload.params?.name)h['Mcp-Name']=payload.params.name;
  }
  const r=await fetch(NSE_MCP_URL,{method:'POST',headers:h,body:JSON.stringify(payload)});
  const text=await r.text();
  const data=text.trim()?mcpParseResponse(text,r.headers.get('content-type')||''):{};
  if(!r.ok)throw Error(data?.error?.message||('NSE MCP HTTP '+r.status));
  return {data,headers:r.headers};
}
async function mcpConnect(){
  mcp={sessionId:null,protocolVersion:null,tools:[],connected:false,lastError:null,nextId:mcp.nextId||1};
  const id=mcp.nextId++;
  const init=await mcpPost({jsonrpc:'2.0',id,method:'initialize',params:{
    protocolVersion:'2025-11-25',
    capabilities:{},
    clientInfo:{name:'AlgoDesk Pro',version:'1.0.0'}
  }});
  const result=init.data?.result;
  if(!result)throw Error(init.data?.error?.message||'NSE MCP initialize failed');
  mcp.sessionId=init.headers.get('mcp-session-id')||null;
  mcp.protocolVersion=result.protocolVersion||'2025-11-25';
  await mcpPost({jsonrpc:'2.0',method:'notifications/initialized',params:{}},{sessionId:mcp.sessionId,protocolVersion:mcp.protocolVersion});
  const listed=await mcpPost({jsonrpc:'2.0',id:mcp.nextId++,method:'tools/list',params:{}},{sessionId:mcp.sessionId,protocolVersion:mcp.protocolVersion});
  mcp.tools=listed.data?.result?.tools||[];
  mcp.connected=true;
  mcp.lastError=null;
  return mcp;
}
async function mcpEnsure(){
  if(mcp.connected&&mcp.sessionId)return mcp;
  return mcpConnect();
}
e.get('/api/nse-mcp/status',(q,s)=>s.json({url:NSE_MCP_URL,connected:mcp.connected,protocolVersion:mcp.protocolVersion,tools:mcp.tools,lastError:mcp.lastError}));
e.post('/api/nse-mcp/connect',async(q,s)=>{try{s.json({ok:true,...await mcpConnect()})}catch(x){mcp.connected=false;mcp.lastError=x.message;s.status(502).json({ok:false,url:NSE_MCP_URL,error:x.message})}});
e.post('/api/nse-mcp/tools',async(q,s)=>{try{await mcpEnsure();const r=await mcpPost({jsonrpc:'2.0',id:mcp.nextId++,method:'tools/list',params:{}},{sessionId:mcp.sessionId,protocolVersion:mcp.protocolVersion});mcp.tools=r.data?.result?.tools||[];s.json({ok:true,tools:mcp.tools})}catch(x){mcp.lastError=x.message;s.status(502).json({ok:false,error:x.message})}});
e.post('/api/nse-mcp/call',async(q,s)=>{try{await mcpEnsure();const name=String(q.body?.name||'');if(!name)throw Error('Tool name is required');const args=q.body?.arguments&&typeof q.body.arguments==='object'?q.body.arguments:{};const r=await mcpPost({jsonrpc:'2.0',id:mcp.nextId++,method:'tools/call',params:{name,arguments:args}},{sessionId:mcp.sessionId,protocolVersion:mcp.protocolVersion});s.json({ok:true,result:r.data?.result||r.data})}catch(x){mcp.lastError=x.message;s.status(502).json({ok:false,error:x.message})}});

e.post('/api/angel/login',async(q,s)=>{try{const b=q.body||{};if(!b.clientCode||!b.mpin||!b.totp)throw Error('Client ID, MPIN and current TOTP are required');if(b.apiKey)angelRuntime.apiKey=String(b.apiKey);angelRuntime.clientCode=String(b.clientCode);angelRuntime.mpin=String(b.mpin);angelRuntime.totp=String(b.totp);angelRuntime.totpSecret='';sess=null;await login();await ensureLive();s.json({ok:true,connected:true,websocket:!!(liveSocket&&liveSocket.readyState===WebSocket.OPEN),message:'Angel One SmartAPI session established'})}catch(x){s.status(502).json({ok:false,error:x.message})}});
e.get('/api/angel/status',(q,s)=>s.json({configured:!!(angelRuntime.apiKey&&angelRuntime.clientCode&&angelRuntime.mpin),session:!!sess,websocket:!!(liveSocket&&liveSocket.readyState===WebSocket.OPEN),clientCode:angelRuntime.clientCode?angelRuntime.clientCode.slice(0,3)+'***':''}));
e.post('/api/historical',async(q,s)=>{try{await ensureSession();const b=q.body||{};if(!b.exchange||!b.symboltoken||!b.interval||!b.fromdate||!b.todate)throw Error('exchange, symboltoken, interval, fromdate and todate are required');const r=await fetch(A+'/rest/secure/angelbroking/historical/v1/getCandleData',{method:'POST',headers:hd({'Authorization':'Bearer '+sess.jwt}),body:JSON.stringify({exchange:b.exchange,symboltoken:String(b.symboltoken),interval:b.interval,fromdate:b.fromdate,todate:b.todate})});const j=await r.json();if(!j.status)throw Error(j.message||'Historical candle request failed');s.json({ok:true,data:j.data})}catch(x){s.status(502).json({ok:false,error:x.message})}});
e.get('/api/nse-check',async(q,s)=>{try{const r=await fetch('https://www.nseindia.com',{headers:{'User-Agent':'Mozilla/5.0','Accept':'text/html,application/xhtml+xml'}});const text=await r.text();s.json({ok:r.ok,status:r.status,message:r.ok?'web server reachable; real-time market feed is not implied':'NSE server returned HTTP '+r.status})}catch(x){s.status(502).json({ok:false,status:0,message:x.message})}});
e.get('/api/health',(q,s)=>s.json({ok:true,angel:!!(angelRuntime.apiKey&&angelRuntime.clientCode&&angelRuntime.mpin),websocket:!!liveSocket&&liveSocket.readyState===WebSocket.OPEN,ai:!!ANTHROPIC_API_KEY,search:!!BRAVE_API_KEY}));
e.get('/api/live',(q,s)=>{s.setHeader('Content-Type','text/event-stream');s.setHeader('Cache-Control','no-cache');s.setHeader('Connection','keep-alive');s.flushHeaders?.();liveClients.add(s);s.write('data: '+JSON.stringify({type:'status',live:!!liveSocket&&liveSocket.readyState===WebSocket.OPEN,time:new Date().toISOString()})+'\\n\\n');Object.values(liveLast).slice(-200).forEach(t=>s.write('data: '+JSON.stringify({type:'tick',...t})+'\\n\\n'));q.on('close',()=>liveClients.delete(s));ensureLive().catch(()=>{})});
e.get('/api/quotes',async(q,s)=>{try{let t={NSE:Object.values(IDX).filter(x=>x[0]==='NSE').map(x=>x[1]),BSE:[IDX.SENSEX[1]]};let m=await sm();t.NSE=t.NSE.concat(Object.values(m.eq).slice(0,20));let f=await quote(t),b={};f.forEach(x=>b[x.symbolToken||x.token]=x);s.json({live:true,indices:Object.entries(IDX).map(([n,x])=>({n,p:+(b[x[1]]?.ltp||0),chg:+(b[x[1]]?.percentChange||0),token:x[1]})),stocks:Object.entries(m.eq).slice(0,20).map(([n,t])=>({s:n,p:+(b[t]?.ltp||0),chg:+(b[t]?.percentChange||0),oiChg:null,token:t})),time:new Date().toISOString()})}catch(x){s.status(502).json({live:false,error:x.message})}});
e.get('/api/option-chain',async(q,s)=>{try{let name=(q.query.index||'NIFTY').toUpperCase().replace('NIFTY 50','NIFTY'),m=await sm(),a=m.op.filter(x=>x.name===name&&em(x.expiry)>=Date.now()).sort((x,y)=>em(x.expiry)-em(y.expiry)),exp=a[0]?.expiry,cs=a.filter(x=>x.expiry===exp);if(!cs.length)throw Error('contracts not found');let spotTok=(IDX[name==='NIFTY'?'NIFTY 50':name]||IDX['NIFTY 50'])[1],spotEx=(name==='SENSEX'?'BSE':'NSE'),sp=(await quote({[spotEx]:[spotTok]}))[0]?.ltp||0;cs=cs.map(x=>({...x,d:Math.abs(+x.strike-sp)})).sort((x,y)=>x.d-y.d).slice(0,24);let byEx={};cs.forEach(x=>(byEx[x.exch_seg]??=[]).push(x.token));for(const [ex,t] of Object.entries(byEx))want(ex==='NFO'?2:4,t,3);let qs=[];for(const [ex,t] of Object.entries(byEx))for(let i=0;i<t.length;i+=45)qs.push(...await quote({[ex]:t.slice(i,i+45)}));let b={};qs.forEach(x=>b[x.symbolToken||x.token]=x);let rows=[];for(const x of cs){let r=rows.find(z=>z.strike==+x.strike);if(!r)rows.push(r={strike:+x.strike,ce:null,pe:null});r[x.symbol.endsWith('CE')?'ce':'pe']={ltp:+(b[x.token]?.ltp||0),oi:+(b[x.token]?.opnInterest||b[x.token]?.openInterest||0),symbol:x.symbol,token:x.token}}rows.sort((a,b)=>a.strike-b.strike);let co=rows.reduce((n,r)=>n+(r.ce?.oi||0),0),po=rows.reduce((n,r)=>n+(r.pe?.oi||0),0);s.json({live:true,index:name,expiry:exp,atm:+sp,pcr:po/Math.max(1,co),rows})}catch(x){s.status(502).json({live:false,error:x.message})}});
async function ai(txt){if(!ANTHROPIC_API_KEY)throw Error('AI key missing');let r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'content-type':'application/json','x-api-key':ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:MODEL,max_tokens:600,messages:[{role:'user',content:'सिर्फ दिए data पर सरल Hindi में जवाब दो। कोई data/news मत गढ़ो। Buy/Sell/order instruction या profit guarantee नहीं। 120 शब्द के अंदर पाँच headings: क्या हो रहा है:, पॉज़िटिव ✅:, नेगेटिव ❌:, दिक्कत / रिस्क ⚠️:, अब क्या देखें 👀:\n\n'+txt}]})}),j=await r.json();if(!r.ok)throw Error(j.error?.message||'AI failed');return j.content?.map(x=>x.text||'').join('')}
e.post('/api/ai',async(q,s)=>{try{s.json({text:await ai(JSON.stringify(q.body||{}))})}catch(x){s.status(502).json({error:x.message})}});
e.get('/api/search',async(q,s)=>{try{if(!BRAVE_API_KEY)throw Error('Search key missing');let z=await fetch('https://api.search.brave.com/res/v1/web/search?count=8&q='+encodeURIComponent(q.query||''),{headers:{'X-Subscription-Token':BRAVE_API_KEY,Accept:'application/json'}}),j=await z.json();s.json({results:(j.web?.results||[]).map(x=>({title:x.title,url:x.url,desc:x.description||''}))})}catch(x){s.status(502).json({error:x.message})}});
e.listen(PORT,()=>console.log('AlgoDesk Pro server '+PORT));

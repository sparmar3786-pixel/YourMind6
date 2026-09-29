require('dotenv').config();
const express=require('express'),cors=require('cors'),dns=require('dns').promises,net=require('net'),http=require('http');
const {WebSocketServer,WebSocket}=require('ws');
const {authenticator}=require('otplib');
const {classifyOI,calcPCR,findSupportResistance,expectedValue,isVerifiedSignal}=require('./lib/analytics');

const PORT=Number(process.env.PORT||8787);
const {ANTHROPIC_API_KEY,BRAVE_API_KEY,APP_KEY,ANGEL_API_KEY,ANGEL_CLIENT_CODE,ANGEL_PIN,ANGEL_TOTP_SECRET,MODEL='claude-haiku-4-5-20251001'}=process.env;
const app=express();app.set('trust proxy',1);app.use(cors());app.use(express.json({limit:'8mb'}));

const hits=new Map(),heavyHits=new Map();
function limiter(store,max){return(req,res,next)=>{const now=Date.now(),key=req.ip,list=(store.get(key)||[]).filter(t=>now-t<60000);list.push(now);store.set(key,list);if(list.length>max)return res.status(429).json({error:'bahut zyada requests, thodi der baad try karo'});next()}}
app.use('/api',(req,res,next)=>{if(APP_KEY&&req.get('x-app-key')!==APP_KEY)return res.status(401).json({error:'unauthorized'});next()},limiter(hits,120));
const heavy=limiter(heavyHits,15);

app.get('/api/health',(_req,res)=>res.json({ok:true,build:'algodesk-fresh',readOnly:true,ai:!!ANTHROPIC_API_KEY,search:!!BRAVE_API_KEY,angel:!!(ANGEL_API_KEY&&ANGEL_CLIENT_CODE&&ANGEL_PIN&&ANGEL_TOTP_SECRET),signalRule:{minWinRatePct:80,minTrades:100}}));

async function claude(messages,images=[],max_tokens=700){
 if(!ANTHROPIC_API_KEY)throw new Error('ANTHROPIC_API_KEY set nahi hai');
 const normalized=messages.map(m=>({role:m.role,content:m.content}));
 if(images.length){const last=normalized[normalized.length-1];last.content=[...images.map(i=>({type:'image',source:{type:'base64',media_type:i.media_type,data:i.data}})),{type:'text',text:String(last.content)}]}
 const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'content-type':'application/json','x-api-key':ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:MODEL,max_tokens,messages:normalized})});
 const j=await r.json();if(!r.ok)throw new Error(j?.error?.message||'Anthropic HTTP '+r.status);
 return{text:(j.content||[]).filter(x=>x.type==='text').map(x=>x.text).join(''),truncated:j.stop_reason==='max_tokens'};
}
app.post('/api/ai',heavy,async(req,res)=>{try{const{messages,images=[]}=req.body||{};if(!Array.isArray(messages)||!messages.length||messages.length>12)return res.status(400).json({error:'messages galat'});if(messages[0].role!=='user'||messages[messages.length-1].role!=='user')return res.status(400).json({error:'message roles galat'});for(const m of messages)if(!['user','assistant'].includes(m.role)||typeof m.content!=='string'||!m.content||m.content.length>20000)return res.status(400).json({error:'message galat'});if(!Array.isArray(images)||images.length>3||images.some(i=>!['image/jpeg','image/png','image/webp'].includes(i.media_type)||typeof i.data!=='string'||i.data.length>6000000))return res.status(400).json({error:'image galat'});res.json(await claude(messages,images))}catch(e){res.status(502).json({error:e.message})}});

async function braveSearch(q,count=8){if(!BRAVE_API_KEY)throw new Error('BRAVE_API_KEY set nahi hai');const r=await fetch('https://api.search.brave.com/res/v1/web/search?count='+count+'&q='+encodeURIComponent(q),{headers:{'X-Subscription-Token':BRAVE_API_KEY,accept:'application/json'}}),j=await r.json();if(!r.ok)throw new Error('Search HTTP '+r.status);return(j?.web?.results||[]).map(x=>({title:x.title,url:x.url,desc:String(x.description||'').replace(/<[^>]+>/g,'')}))}
app.get('/api/search',heavy,async(req,res)=>{try{const q=String(req.query.q||'').trim().slice(0,200);if(!q)return res.status(400).json({error:'q khaali hai'});res.json({results:await braveSearch(q)})}catch(e){res.status(502).json({error:e.message})}});

function privateIp(ip){if(net.isIPv4(ip)){const[a,b]=ip.split('.').map(Number);return a===0||a===10||a===127||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127)}const s=ip.toLowerCase();return s==='::1'||s==='::'||s.startsWith('fc')||s.startsWith('fd')||s.startsWith('fe80')||s.startsWith('::ffff:')}
async function fetchSafe(url,depth=0){const u=new URL(url);if(!['http:','https:'].includes(u.protocol))throw new Error('sirf http/https link chalega');const addrs=await dns.lookup(u.hostname,{all:true});if(addrs.some(a=>privateIp(a.address)))throw new Error('ye address allowed nahi');const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),8000);try{const r=await fetch(u,{signal:ctl.signal,redirect:'manual',headers:{'user-agent':'AlgoDeskBot/1.0',accept:'text/html,text/plain;q=0.9'}});if(r.status>=300&&r.status<400&&r.headers.get('location')){if(depth>=3)throw new Error('bahut redirects');return fetchSafe(new URL(r.headers.get('location'),u).href,depth+1)}if(!r.ok)throw new Error('HTTP '+r.status);return Buffer.from(await r.arrayBuffer()).subarray(0,1500000).toString('utf8')}finally{clearTimeout(timer)}}
const textOf=h=>h.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/\s+/g,' ').trim().slice(0,5000);
const WEB_RULES='सिर्फ दिए गए public page data के आधार पर सरल हिंदी में जवाब दो। कोई खबर या आंकड़ा मत गढ़ो। पुराना/अधूरा data साफ कहो। मुनाफे की गारंटी या buy/sell instruction मत दो। 150 शब्दों के भीतर पाँच headings रखो: क्या हो रहा है:, पॉज़िटिव:, नेगेटिव:, दिक्कत / रिस्क:, अब क्या देखें:';
app.post('/api/webask',heavy,async(req,res)=>{try{const q=String(req.body?.q||'').trim().slice(0,200),url=String(req.body?.url||'').trim();if(!q&&!url)return res.status(400).json({error:'q ya url do'});let pages;if(url)pages=[{url,text:textOf(await fetchSafe(url))}];else{const rs=await braveSearch(q,5),got=await Promise.allSettled(rs.slice(0,3).map(async r=>({url:r.url,text:textOf(await fetchSafe(r.url))})));pages=got.filter(x=>x.status==='fulfilled').map(x=>x.value);if(!pages.length)pages=rs.slice(0,3).map(r=>({url:r.url,text:r.title+'. '+r.desc}))}if(!pages.length)return res.status(404).json({error:'कोई पेज नहीं मिला'});const ctx=pages.map((p,i)=>'[पेज '+(i+1)+'] '+p.url+'\n'+p.text).join('\n\n');const out=await claude([{role:'user',content:WEB_RULES+'\n\nसवाल: '+(q||'इस page का data समझाओ')+'\n\n'+ctx}],[],800);res.json({text:out.text,sources:pages.map(p=>p.url)})}catch(e){res.status(502).json({error:e.message})}});

const ANGEL='https://apiconnect.angelone.in',IDX_TOK={'NIFTY 50':['NSE','99926000','NIFTY'],BANKNIFTY:['NSE','99926009','BANKNIFTY'],FINNIFTY:['NSE','99926037','FINNIFTY'],MIDCPNIFTY:['NSE','99926074','MIDCPNIFTY'],SENSEX:['BSE','99919000','SENSEX']},STOCKS=['RELIANCE','HDFCBANK','SBIN','TATAMOTORS','INFY','ICICIBANK','TCS','BAJFINANCE','ITC','LT'];
let session=null,master=null,cache=null,chainCache=new Map(),lastOI=new Map();
const h=extra=>({'Content-Type':'application/json',Accept:'application/json','X-UserType':'USER','X-SourceID':'WEB','X-ClientLocalIP':'127.0.0.1','X-ClientPublicIP':'127.0.0.1','X-MACAddress':'00:00:00:00:00:00','X-PrivateKey':ANGEL_API_KEY,...extra});
let keeperTimer=null;
async function startSessionKeeper(){
 if(keeperTimer||!session)return;
 keeperTimer=setInterval(async()=>{
   if(!session)return;
   try{
     const r=await fetch(ANGEL+'/rest/secure/angelbroking/user/v1/getProfile',{method:'GET',headers:h({Authorization:'Bearer '+session.jwt})});
     if(!r.ok)throw new Error('profile HTTP '+r.status);
   }catch(_e){
     try{await angelLogin()}catch(__e){}
   }
 },240000);
}
async function angelLogin(){if(!(ANGEL_API_KEY&&ANGEL_CLIENT_CODE&&ANGEL_PIN&&ANGEL_TOTP_SECRET))throw new Error('Angel One env set nahi hain');const r=await fetch(ANGEL+'/rest/auth/angelbroking/user/v1/loginByPassword',{method:'POST',headers:h(),body:JSON.stringify({clientcode:ANGEL_CLIENT_CODE,password:ANGEL_PIN,totp:authenticator.generate(ANGEL_TOTP_SECRET)})}),j=await r.json();if(!j.status)throw new Error('Angel login: '+(j.message||r.status));session={jwt:j.data.jwtToken,feed:j.data.feedToken,at:Date.now()};startSessionKeeper()}
async function loadMaster(){if(master)return master;const r=await fetch('https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json');if(!r.ok)throw new Error('ScripMaster HTTP '+r.status);const rows=await r.json(),eq={};for(const x of rows)if(x.exch_seg==='NSE'&&STOCKS.includes(x.name)&&x.symbol===x.name+'-EQ')eq[x.name]=x.token;return master={rows,eq}}
async function angelQuote(tokens){const call=()=>fetch(ANGEL+'/rest/secure/angelbroking/market/v1/quote/',{method:'POST',headers:h({Authorization:'Bearer '+session.jwt}),body:JSON.stringify({mode:'FULL',exchangeTokens:tokens})}).then(r=>r.json());if(!session||Date.now()-session.at>21600000)await angelLogin();let j=await call();if(!j.status){await angelLogin();j=await call()}if(!j.status)throw new Error('Angel quote: '+(j.message||'fail'));return j.data?.fetched||[]}
function num(v){const n=Number(v);return Number.isFinite(n)?n:null}
function optionStrike(v){const n=num(v);if(n==null)return null;return Math.abs(n)>=100000?n/100:n}
function parseExpiry(v){const s=String(v||'').trim().toUpperCase();const m=s.match(/^(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{4})$/);if(!m)return null;const months={JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11};return new Date(Date.UTC(Number(m[3]),months[m[2]],Number(m[1]),23,59,59))}
function oiDelta(key,oi){const n=num(oi);if(n==null)return null;const prev=lastOI.get(key);lastOI.set(key,n);return prev==null||prev===0?null:((n-prev)/Math.abs(prev))*100}
function refLevels(ltp){const p=num(ltp);if(p==null||p<=0)return null;return {entry:p,stopLoss:Number((p*.85).toFixed(2)),target:Number((p*1.3).toFixed(2)),exitRule:'Target / Stop-loss / 15:15',verified:false,disclaimer:'Indicative reference levels only; not backtested/verified signal.'}}
async function getQuotes(){if(cache&&Date.now()-cache.ts<1500)return cache;const m=await loadMaster(),ex={NSE:[],BSE:[]};Object.values(IDX_TOK).forEach(([e,t])=>ex[e].push(t));STOCKS.forEach(s=>{if(m.eq[s])ex.NSE.push(m.eq[s])});const rows=await angelQuote(ex),by={};rows.forEach(r=>by[(r.exchange||'')+':'+(r.symbolToken||'')]=r);const indices=Object.entries(IDX_TOK).map(([n,[e,t]])=>{const r=by[e+':'+t];return r?{n,p:num(r.ltp),chg:num(r.percentChange)}:null}).filter(Boolean);const stocks=STOCKS.map(s=>{const r=by['NSE:'+m.eq[s]];if(!r)return null;return{s,p:num(r.ltp),chg:num(r.percentChange),oiChg:oiDelta('EQ:'+s,r.openInterest)}}).filter(Boolean);return cache={indices,stocks,ts:Date.now(),note:'OI change is calculated from the first successful snapshot after this backend starts.'}}
app.get('/api/quotes',async(_req,res)=>{try{res.json(await getQuotes())}catch(e){res.status(503).json({error:e.message})}});
async function getOptionChain(indexName){
 const meta=IDX_TOK[indexName];if(!meta)throw new Error('index unsupported');
 const m=await loadMaster(),exchange=meta[0],name=meta[2],optExchange=exchange==='NSE'?'NFO':'BFO';
 const spotRows=await angelQuote({[exchange]:[meta[1]]}),spot=num(spotRows[0]?.ltp);if(spot==null)throw new Error('index LTP nahi mila');
 const opts=m.rows.filter(x=>x.exch_seg===optExchange&&String(x.name||'').toUpperCase()===name&&['CE','PE'].includes(String(x.instrumenttype||'').toUpperCase())&&parseExpiry(x.expiry)?.getTime()>=Date.now());
 if(!opts.length)throw new Error('option contracts nahi mile');
 const expiries=[...new Map(opts.map(x=>[String(x.expiry),parseExpiry(x.expiry)])).entries()].sort((a,b)=>a[1]-b[1]),expiry=expiries[0][0];
 const exp=opts.filter(x=>String(x.expiry)===expiry).map(x=>({...x,strike:optionStrike(x.strike),side:String(x.instrumenttype).toUpperCase()})).filter(x=>x.strike!=null);
 const strikes=[...new Set(exp.map(x=>x.strike))].sort((a,b)=>a-b),nearest=strikes.map((s)=>({s,d:Math.abs(s-spot)})).sort((a,b)=>a.d-b.d).slice(0,21).sort((a,b)=>a.s-b.s).map(x=>x.s);
 const byStrike=new Map();exp.filter(x=>nearest.includes(x.strike)).forEach(x=>{if(!byStrike.has(x.strike))byStrike.set(x.strike,{});byStrike.get(x.strike)[x.side.toLowerCase()]=x});
 const tokens=[];for(const pair of byStrike.values()){if(pair.ce)tokens.push(pair.ce.token);if(pair.pe)tokens.push(pair.pe.token)}
 const fetched=await angelQuote({[optExchange]:tokens.slice(0,50)}),qmap=new Map(fetched.map(r=>[String(r.symbolToken),r]));
 const rows=[...byStrike.entries()].map(([strike,pair])=>{const ce=pair.ce,pe=pair.pe,qce=ce&&qmap.get(String(ce.token)),qpe=pe&&qmap.get(String(pe.token));return {strike,moneyness:Math.abs(strike-spot)<1e-9?'ATM':(strike<spot?'Below Spot':'Above Spot'),ce:ce?{token:ce.token,symbol:ce.symbol,ltp:num(qce?.ltp),oi:num(qce?.openInterest),oiChgPct:oiDelta('OPT:'+ce.token,qce?.openInterest),volume:num(qce?.tradeVolume),referenceLevels:refLevels(qce?.ltp)}:null,pe:pe?{token:pe.token,symbol:pe.symbol,ltp:num(qpe?.ltp),oi:num(qpe?.openInterest),oiChgPct:oiDelta('OPT:'+pe.token,qpe?.openInterest),volume:num(qpe?.tradeVolume),referenceLevels:refLevels(qpe?.ltp)}:null}});
 const calcRows=rows.map(r=>({strike:r.strike,callOI:r.ce?.oi||0,putOI:r.pe?.oi||0})),pcr=calcPCR(calcRows),sr=findSupportResistance(calcRows),atm=rows.reduce((a,r)=>Math.abs(r.strike-spot)<Math.abs(a.strike-spot)?r:a,rows[0]);
 return {index:indexName,exchange,optExchange,spot,expiry,atmStrike:atm?.strike||null,pcr,support:sr.support,resistance:sr.resistance,rows,note:'Option chain assembled from Angel One Scrip Master + SmartAPI market quotes. Levels are reference-only until a historical backtest verifies them.'};
}
app.get('/api/option-chain',heavy,async(req,res)=>{try{const indexName=String(req.query.index||'NIFTY 50'),key=indexName+'|'+Math.floor(Date.now()/5000);if(chainCache.has(key))return res.json(chainCache.get(key));const data=await getOptionChain(indexName);chainCache.set(key,data);for(const k of [...chainCache.keys()])if(k.startsWith(indexName+'|')&&k!==key)chainCache.delete(k);res.json(data)}catch(e){res.status(503).json({error:e.message})}});


// Angel One WebSocket 2.0 shared live feed.
// Closing the AI sheet in the APK never touches this connection.
const streamClients=new Set();
const streamMeta=new Map();
let angelStream=null,angelStreamRetry=null,angelHeartbeat=null,angelStreamConnecting=false;

function wsSend(ws,obj){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(obj))}
function broadcast(obj){for(const ws of streamClients)wsSend(ws,obj)}
function parseAngelTick(data){
 const b=Buffer.isBuffer(data)?data:Buffer.from(data);
 if(b.length<51)return null;
 const token=b.subarray(2,27).toString('utf8').replace(/\\0/g,'').trim();
 const exchangeType=b.readInt8(1);
 const ltp=b.readInt32LE(43)/100;
 const ts=b.readBigInt64LE(35);
 return {token,exchangeType,ltp,exchangeTs:Number(ts)};
}
function exchangeTypeFor(seg){
 return seg==='NSE'?1:seg==='NFO'?2:seg==='BSE'?3:seg==='BFO'?4:5;
}
function scheduleAngelStream(){
 if(angelStreamRetry)return;
 angelStreamRetry=setTimeout(()=>{angelStreamRetry=null;ensureAngelStream().catch(()=>{})},5000);
}
async function subscribeAngel(tokensByExchange){
 if(!angelStream||angelStream.readyState!==WebSocket.OPEN)return;
 const tokenList=Object.entries(tokensByExchange).filter(([,tokens])=>tokens?.length).map(([exchangeType,tokens])=>({exchangeType:Number(exchangeType),tokens:[...new Set(tokens.map(String))].slice(0,1000)}));
 if(!tokenList.length)return;
 angelStream.send(JSON.stringify({correlationID:'ALGODESK01',action:1,params:{mode:1,tokenList}}));
}
async function ensureAngelStream(){
 if(angelStreamConnecting||(angelStream&&[WebSocket.OPEN,WebSocket.CONNECTING].includes(angelStream.readyState)))return;
 angelStreamConnecting=true;
 try{
   if(!session||Date.now()-session.at>21600000)await angelLogin();
   const url='wss://smartapisocket.angelone.in/smart-stream?clientCode='+encodeURIComponent(ANGEL_CLIENT_CODE)+'&feedToken='+encodeURIComponent(session.feed)+'&apiKey='+encodeURIComponent(ANGEL_API_KEY);
   const ws=new WebSocket(url);
   angelStream=ws;
   ws.on('open',async()=>{
     angelStreamConnecting=false;
     if(angelHeartbeat)clearInterval(angelHeartbeat);
     angelHeartbeat=setInterval(()=>{if(ws.readyState===WebSocket.OPEN)ws.send('ping')},25000);
     try{
       const m=await loadMaster();
       const nse=Object.values(IDX_TOK).filter(x=>x[0]==='NSE').map(x=>x[1]).concat(Object.values(m.eq));
       const bse=Object.values(IDX_TOK).filter(x=>x[0]==='BSE').map(x=>x[1]);
       for(const [n,[e,t]] of Object.entries(IDX_TOK))streamMeta.set(String(t),{kind:'index',name:n});
       for(const [n,t] of Object.entries(m.eq))streamMeta.set(String(t),{kind:'stock',name:n});
       await subscribeAngel({1:nse,3:bse});
       broadcast({type:'stream',state:'connected',source:'Angel One WebSocket 2.0'});
     }catch(e){broadcast({type:'stream',state:'error',message:e.message})}
   });
   ws.on('message',(data)=>{
     if(typeof data==='string'||Buffer.isBuffer(data)&&data.toString()==='pong')return;
     const tick=parseAngelTick(data);
     if(!tick||tick.ltp==null)return;
     const meta=streamMeta.get(tick.token)||{};
     broadcast({type:'tick',...tick,meta});
   });
   ws.on('error',e=>broadcast({type:'stream',state:'error',message:String(e.message||e)}));
   ws.on('close',()=>{
     angelStreamConnecting=false;
     if(angelHeartbeat){clearInterval(angelHeartbeat);angelHeartbeat=null}
     if(angelStream===ws)angelStream=null;
     broadcast({type:'stream',state:'reconnecting'});
     scheduleAngelStream();
   });
 }catch(e){
   angelStreamConnecting=false;
   broadcast({type:'stream',state:'error',message:e.message});
   scheduleAngelStream();
 }
}
async function subscribeIndexOptions(indexName){
 const meta=IDX_TOK[indexName];if(!meta)return;
 const m=await loadMaster(),exchange=meta[0]==='NSE'?'NFO':'BFO',name=meta[2];
 const opts=m.rows.filter(x=>x.exch_seg===exchange&&String(x.name||'').toUpperCase()===name&&['CE','PE'].includes(String(x.instrumenttype||'').toUpperCase())&&parseExpiry(x.expiry)?.getTime()>=Date.now());
 if(!opts.length)return;
 const expiries=[...new Map(opts.map(x=>[String(x.expiry),parseExpiry(x.expiry)])).entries()].sort((a,b)=>a[1]-b[1]),expiry=expiries[0][0];
 const exp=opts.filter(x=>String(x.expiry)===expiry).map(x=>({...x,strike:optionStrike(x.strike),side:String(x.instrumenttype).toUpperCase()})).filter(x=>x.strike!=null);
 const spot=(await angelQuote({[meta[0]]:[meta[1]]}))[0]?.ltp;
 const strikes=[...new Set(exp.map(x=>x.strike))].sort((a,b)=>a-b).sort((a,b)=>Math.abs(a-spot)-Math.abs(b-spot)).slice(0,21);
 const selected=exp.filter(x=>strikes.includes(x.strike));
 selected.forEach(x=>streamMeta.set(String(x.token),{kind:'option',index:indexName,side:x.side,strike:x.strike,symbol:x.symbol,token:x.token}));
 await subscribeAngel({[exchangeTypeFor(exchange)]:selected.map(x=>x.token)});
 broadcast({type:'stream',state:'options-subscribed',index:indexName,count:selected.length});
}
const server=http.createServer(app);
const wss=new WebSocketServer({server,path:'/api/stream'});
wss.on('connection',async(ws,req)=>{
 const u=new URL(req.url,'http://localhost');
 const key=u.searchParams.get('appKey')||'';
 if(APP_KEY&&key!==APP_KEY){ws.close(1008,'unauthorized');return}
 streamClients.add(ws);
 wsSend(ws,{type:'stream',state:'connecting',source:'Angel One WebSocket 2.0'});
 try{await ensureAngelStream()}catch(_e){}
 ws.on('message',async raw=>{
   try{
     const msg=JSON.parse(String(raw));
     if(msg?.action==='subscribeIndex'&&IDX_TOK[msg.index])await subscribeIndexOptions(msg.index);
   }catch(_e){}
 });
 ws.on('close',()=>streamClients.delete(ws));
});
server.listen(PORT,()=>console.log('AlgoDesk fresh server listening on '+PORT));


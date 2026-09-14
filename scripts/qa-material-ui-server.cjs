// Isolated UI fixture: every API request is handled here; no account, provider,
// generation or publishing endpoint is forwarded to the Next server.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const output = path.join(process.cwd(), 'output', 'playwright', 'materials-2026-09-07');
fs.mkdirSync(output, { recursive: true });
const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'materials-ui-'));
const items = Array.from({ length: 11 }, (_, n) => ({productId:`fixture-${n}`, revision:'a'.repeat(64), title:`쇼핑 테스트 소재 ${n+1}`, productName:`검증 상품 ${n+1}`, connectKind:'SHOPPING', status:'READY', ready:n<10, blockers:n<10?[]:['필수 상품 근거 확인 필요'], score:n<10?100:80, imageCount:3, approvedAt:n<10?'2026-09-07T00:00:00Z':null}));
items.push({...items[0], productId:'fixture-travel', title:'여행 테스트 소재', productName:'검증 여행상품', connectKind:'TRAVEL'});
let jobs=[]; const writes=[];
const server = http.createServer(async (request,response) => {
 const url = new URL(request.url,'http://localhost');
 if(url.pathname.startsWith('/api/')) {
  const chunks=[];for await(const chunk of request)chunks.push(chunk);
  const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):{};
  let data={};let status=200;let success=true;
  if(request.method!=='GET') {writes.push({path:url.pathname,body});fs.writeFileSync(path.join(output,'requests.json'),JSON.stringify(writes,null,2));}
  if(url.pathname==='/api/admin-session') data={required:false,authenticated:true};
  else if(url.pathname==='/api/remote-agent') data={configured:true,deviceId:'fixture',siteUrl:'http://127.0.0.1:43138'};
  else if(url.pathname==='/api/remote-agent/poll') data={idle:true};
  else if(url.pathname==='/api/materials') data=url.searchParams.has('jobId')?jobs.find(j=>j.jobId===url.searchParams.get('jobId')): {materials:items.filter(i=>!url.searchParams.get('connectKind')||i.connectKind.toLowerCase()===url.searchParams.get('connectKind')),jobs};
  else if(['/api/materials/publish','/api/materials/prepare'].includes(url.pathname)) {
   const publish=url.pathname.endsWith('/publish');
   if(publish&&(!body.materials?.length||body.materials.some(s=>!items.find(i=>i.productId===s.productId&&i.revision===s.revision&&i.ready)))) {status=409;success=false;data=null;}
   else {
    const job={jobId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',kind:publish?'publish':'prepare',status:'running',startedAt:new Date().toISOString(),items:(publish?body.materials:body.productIds.map(id=>({productId:id}))).map(i=>({...i,status:publish?'publishing':'preparing',stage:publish?'선택 소재 발행·결과 확인':'원고·이미지 준비'}))};
    jobs=[job,...jobs];data=job;status=202;
   }
  }
  else if(url.pathname==='/api/brandlinks') data=items.map(i=>({id:i.productId,url:'https://example.invalid/fixture',productName:i.productName,status:i.status,connectKind:i.connectKind,draftPrepared:true,draftApproved:i.ready,draftTitle:i.title,createdAt:'2026-09-07T00:00:00Z',scheduledPublishAt:null}));
  else if(url.pathname==='/api/topic-tasks') data=[];
  else if(url.pathname==='/api/brandlinks/selection-options') data={promotions:[],categories:[],captureRequired:false};
  else if(url.pathname==='/api/blog/categories') data={categories:[],defaultCategoryNo:null};
  else if(url.pathname==='/api/settings') data={draftCreationMode:'codex',browserDraftAutomationEnabled:false};
  else if(url.pathname==='/api/history') data={items:[],pagination:{page:1,limit:10,total:0,totalPages:0}};
  else if(url.pathname==='/api/system/update-readiness') data={ready:true,pending:false};
  else if(url.pathname==='/api/session') data={naver:{loggedIn:false},chatgpt:{loggedIn:false}};
  else if(url.pathname==='/api/qa/reset') {jobs=[];data={};}
  else {success=false;status=404;}
  response.writeHead(status,{'content-type':'application/json'});response.end(JSON.stringify({success,data,error:success?undefined:'격리된 UI fixture: 지원하지 않는 요청'}));return;
 }
 if(request.method!=='GET') {response.writeHead(405);response.end();return;}
 const proxy=http.request({hostname:'127.0.0.1',port:43139,path:request.url,method:'GET',headers:{...request.headers,host:'127.0.0.1:43139'}}, upstream=>{response.writeHead(upstream.statusCode,upstream.headers);upstream.pipe(response);});
 proxy.on('error',()=>{response.writeHead(503);response.end('Starting fixture');});proxy.end();
});
const child=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','-H','127.0.0.1','-p','43139'],{windowsHide:true,stdio:'inherit',env:{...process.env,DESKTOP_USER_DATA:isolated,DATABASE_URL:`file:${path.join(isolated,'fixture.db').replaceAll('\\','/')}`,OPENAI_API_KEY:'',REMOTE_DEVICE_TOKEN:'',REMOTE_DEVICE_ID:'',REMOTE_SITE_URL:'http://127.0.0.1:43138',ADMIN_API_KEY:'',CHATGPT_BROWSER_AUTOMATION_ENABLED:'false'}});
server.listen(43138,'127.0.0.1',()=>console.log('UI fixture http://127.0.0.1:43138 (API proxy blocked, fixture only)'));
process.on('SIGINT',()=>{server.close();child.kill();process.exit();});
process.on('SIGTERM',()=>{server.close();child.kill();process.exit();});

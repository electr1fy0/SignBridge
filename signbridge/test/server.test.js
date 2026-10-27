import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createPreviewServer } from '../server.js';
async function listening(server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`; }
async function stop(server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
test('preview serves the real UI and never fakes a connected glove', async () => {
  const server = createPreviewServer(); const url = await listening(server);
  try {
    const page = await fetch(url); assert.equal(page.status, 200);
    assert.match(await page.text(), /Reply to the glove/);
    const state = await fetch(`${url}/api/state`); assert.equal(state.status, 503);
    assert.match((await state.json()).error, /Preview only/);
    const malformed = await fetch(`${url}/%zz`); assert.equal(malformed.status, 400);
    const traversal = await fetch(`${url}/..%2fserver.js`); assert.equal(traversal.status, 403);
  } finally { await stop(server); }
});
test('preview forwards commands and state to a configured real device', async () => {
  const device = http.createServer(async (req, res) => {
    if (req.method === 'POST') { let body=''; for await (const chunk of req) body+=chunk; assert.equal(JSON.parse(body).op,'debug'); res.writeHead(202,{'Content-Type':'application/json'}); res.end('{"queued":true}'); }
    else { res.writeHead(200,{'Content-Type':'application/json'}); res.end('{"type":"state"}'); }
  });
  const deviceUrl = await listening(device), server = createPreviewServer(deviceUrl), url = await listening(server);
  try {
    assert.deepEqual(await (await fetch(`${url}/api/state`)).json(), {type:'state'});
    const result = await fetch(`${url}/api/command`, {method:'POST',headers:{'Content-Type':'application/json'},body:'{"op":"debug","value":true}'});
    assert.equal(result.status,202); assert.equal((await result.json()).queued,true);
  } finally { await stop(server); await stop(device); }
});

test('WebSocket proxy carries live state, controls and physical-delivery flags', { skip: typeof WebSocket === 'undefined' }, async () => {
  const { makeMockDevice } = await import('./helpers/mock-device.js');
  const mock=makeMockDevice(), deviceUrl=await listening(mock.server), server=createPreviewServer(deviceUrl), url=await listening(server);
  const client=new WebSocket(url.replace('http:','ws:')+'/ws');
  function waitState(predicate) {
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{client.removeEventListener('message',onMessage);reject(new Error('No matching device snapshot'));},2500);
      function onMessage(message) {const state=JSON.parse(message.data);if(predicate(state)){clearTimeout(timer);client.removeEventListener('message',onMessage);resolve(state);}}
      client.addEventListener('message',onMessage);
    });
  }
  try {
    const initial=await waitState((state)=>state.boot==='test-boot'); assert.equal(initial.events.length,0);
    const event=waitState((state)=>state.events.some((event)=>event.text==='WAVE'));
    mock.sign('WAVE','motion');assert.equal((await event).events.at(-1).source,'motion');
    mock.state.lcd=false;
    const acknowledged=waitState((state)=>state.events.some((event)=>event.requestId==='test-reply'));
    const response=await fetch(url+'/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'reply',id:'test-reply',text:'Yes',line1:'YES',line2:'',vib:'YES'})});
    assert.equal(response.status,202);
    const reply=(await acknowledged).events.at(-1);assert.equal(reply.lcd,false);assert.equal(reply.text,'Yes');
    const toggled=waitState((state)=>state.live===false && state.debug===true && state.env==='hospital' && state.bendOn[0]===120 && state.shapeMode==='learned');
    for(const [op,value] of [['live',false],['debug',true],['env','hospital']]) await fetch(url+'/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,value})});
    await fetch(url+'/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'bend',values:[120,90,90,110,95]})});
    for(let index=0;index<4;++index) await fetch(url+'/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'trainShape',index})});
    await toggled;
    assert.deepEqual(mock.commands.map((c)=>c.op),['reply','live','debug','env','bend','trainShape','trainShape','trainShape','trainShape']);
  } finally {
    client.close(); await once(client,'close'); await stop(server); await mock.stop();
  }
});

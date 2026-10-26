// Test fixture only. This never runs in the shipped app or ESP32 firmware.
import http from 'node:http';
import { createHash } from 'node:crypto';
export function makeMockDevice() {
  const clients = new Set();
  const commands = [];
  const state = { type:'state', boot:'test-boot', uptime:10000, job:0, remaining:0, notice:'Calibration complete. Show a trained sign.', mpu:true, lcd:true, calibrated:true, imuCalibrated:true, live:true, debug:false, useFlex:true, useMotor:false, pattern:'00000', flex:[2200,2100,1800,2300,2250], delta:[0,0,0,0,0], baseline:[2200,2100,1800,2300,2250], acc:[0,0,9.81], gyro:[0,0,0], env:'everyday', bendOn:[150,100,100,130,110], motion:{swings:0,rate:0,turn:0,tilt:0,energy:0,result:''}, events:[] };
  let seq=0;
  function broadcast() {
    state.uptime+=400;
    const payload=Buffer.from(JSON.stringify(state));
    const header=payload.length<126 ? Buffer.from([0x81,payload.length]) : Buffer.from([0x81,126,payload.length>>8,payload.length&255]);
    for(const socket of clients) socket.write(Buffer.concat([header,payload]));
  }
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json');
    if(req.method==='GET' && req.url==='/api/state') return res.end(JSON.stringify(state));
    if(req.method!=='POST' || req.url!=='/api/command') {res.writeHead(404);return res.end('{}');}
    let body=''; for await(const part of req) body+=part;
    const c=JSON.parse(body); commands.push(c);
    if(c.op==='reply') state.events.push({seq:++seq,type:'reply',text:c.text,source:'partner',requestId:c.id,lcd:state.lcd,haptic:state.useMotor});
    if(c.op==='live') state.live=c.value;
    if(c.op==='debug') state.debug=c.value;
    if(c.op==='env') state.env=c.value;
    if(c.op==='bend') state.bendOn=c.reset ? [150,100,100,130,110] : c.values;
    if(c.op==='settings') Object.assign(state,{useFlex:c.useFlex,useMotor:c.useMotor});
    if(c.op==='calibrate') {state.job=1;state.notice='Calibration: keep fingers straight and hand still.';}
    if(c.op==='cancel') {state.job=0;state.notice='Task cancelled.';}
    res.writeHead(202);res.end('{"queued":true}');broadcast();
  });
  server.on('upgrade',(req,socket)=>{
    const accept=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    clients.add(socket);socket.on('data',(data)=>{if((data[0]&15)===8) socket.end();});
    socket.on('error',()=>clients.delete(socket));socket.on('close',()=>clients.delete(socket));broadcast();
  });
  function sign(text='FIST',source='flex') {state.events.push({seq:++seq,type:'sign',text,source,env:state.env,requestId:'',lcd:false,haptic:false});broadcast();}
  const timer=setInterval(broadcast,400);timer.unref();
  return {server,state,commands,sign,stop:async()=>{clearInterval(timer);for(const client of clients)client.destroy();server.closeAllConnections();await new Promise((resolve)=>server.close(resolve));}};
}

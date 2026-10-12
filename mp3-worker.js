let LAME_OK=false,J=null;
function loadLame(){
  let lastError=null;
  try{
    importScripts('./desktop/node_modules/lamejs/lame.min.js');
    if(self.lamejs&&self.lamejs.Mp3Encoder)return true;
  }catch(e){lastError=e}
  try{
    importScripts('https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js');
    if(self.lamejs&&self.lamejs.Mp3Encoder)return true;
  }catch(e){lastError=e}
  if(lastError)throw lastError;
  return false;
}
try{LAME_OK=loadLame();postMessage({type:'boot',ok:LAME_OK,error:LAME_OK?'':'lamejs não carregou'})}catch(e){postMessage({type:'boot',ok:false,error:e&&e.message?e.message:String(e)})}
function clamp(x){return x<-1?-1:x>1?1:x}
function sampleLinear(arr,pos){if(pos<0||pos>=arr.length-1)return pos>=0&&pos<arr.length?arr[pos]:0;const i=pos|0,f=pos-i;return arr[i]*(1-f)+arr[i+1]*f}
self.onmessage=e=>{
  const d=e.data||{},id=d.id;
  try{
    if(!LAME_OK)throw Error('Codificador MP3 do Worker não carregou');
    if(d.type==='setJingle'){
      J={left:new Float32Array(d.left),right:new Float32Array(d.right),sampleRate:d.sampleRate};
      postMessage({type:'jingleReady',id});return;
    }
    if(d.type!=='mixEncode')return;
    if(!J)throw Error('Vinheta não inicializada no Worker');
    const left=new Float32Array(d.left),right=new Float32Array(d.right),sr=d.sampleRate;
    if(![32000,44100,48000].includes(sr))throw Error('Taxa de amostragem não compatível: '+sr+' Hz');
    const encoder=new lamejs.Mp3Encoder(2,sr,320),parts=[],chunk=1152,startFrame=Math.round(d.position*sr),duck=Math.pow(10,d.duckDb/20),fadeIn=Math.max(1,Math.round(.5*sr)),fadeOut=Math.max(1,Math.round(1*sr)),jDur=J.left.length/J.sampleRate,endFrame=startFrame+Math.round(jDur*sr),outEnd=endFrame+fadeOut,jRatio=J.sampleRate/sr;
    let lastPct=-1;
    for(let i=0;i<left.length;i+=chunk){
      const n=Math.min(chunk,left.length-i),li=new Int16Array(n),ri=new Int16Array(n);
      for(let k=0;k<n;k++){
        const frame=i+k;
        let g=1;
        if(frame>=startFrame-fadeIn&&frame<startFrame)g=1-(1-duck)*(frame-(startFrame-fadeIn))/fadeIn;
        else if(frame>=startFrame&&frame<endFrame)g=duck;
        else if(frame>=endFrame&&frame<outEnd)g=duck+(1-duck)*(frame-endFrame)/fadeOut;
        let lv=left[frame]*g,rv=right[frame]*g;
        if(frame>=startFrame&&frame<endFrame){
          const jp=(frame-startFrame)*jRatio;
          lv+=sampleLinear(J.left,jp)*d.jingleGain;
          rv+=sampleLinear(J.right,jp)*d.jingleGain;
        }
        lv=clamp(lv);rv=clamp(rv);
        li[k]=lv<0?Math.round(lv*32768):Math.round(lv*32767);
        ri[k]=rv<0?Math.round(rv*32768):Math.round(rv*32767);
      }
      const enc=encoder.encodeBuffer(li,ri);if(enc.length)parts.push(new Uint8Array(enc));
      const pct=Math.floor((i/left.length)*100);
      if(pct>=lastPct+10){lastPct=pct;postMessage({type:'progress',id,pct})}
    }
    const tail=encoder.flush();if(tail.length)parts.push(new Uint8Array(tail));
    const total=parts.reduce((n,p)=>n+p.length,0),out=new Uint8Array(total);let o=0;for(const p of parts){out.set(p,o);o+=p.length}
    postMessage({type:'done',id,buffer:out.buffer},[out.buffer]);
  }catch(err){postMessage({type:'error',id,error:err&&err.message?err.message:String(err)})}
};
function clamp(v,a,b){return v<a?a:v>b?b:v}
function median(a){const x=[...a].sort((m,n)=>m-n);return x[Math.floor(x.length/2)]}
function avg(a,k){return a.reduce((s,x)=>s+x[k],0)/Math.max(1,a.length)}
function detect(mono,sr,duration,jingleDuration){
  const startSec=Math.max(14,Math.min(28,duration*.075)),endSec=Math.min(duration-jingleDuration-5,duration*.94);
  if(endSec<=startSec+3)return {point:Math.max(0,Math.min(startSec,duration-jingleDuration-1)),analysis:{confidence:0,label:'baixa',reason:'música curta',mode:'worker'}};
  const bandPower=(pos,frame,freq,sampleStep)=>{const omega=2*Math.PI*freq/sr,coeff=2*Math.cos(omega),cs=Math.cos(omega),sn=Math.sin(omega);let s0=0,s1=0,s2=0,count=0;for(let n=0;n<frame&&pos+n<mono.length;n+=sampleStep){s0=(mono[pos+n]||0)+coeff*s1-s2;s2=s1;s1=s0;count++}const re=s1-s2*cs,im=s2*sn;return (re*re+im*im)/Math.max(1,count*count)};
  const features=(t,frameSec,sampleStep,deep=false)=>{const pos=clamp(Math.floor(t*sr),0,mono.length-1),frame=Math.max(256,Math.floor(frameSec*sr));let rms=0,flux=0,prev=0,nr=0;for(let n=0;n<frame&&pos+n<mono.length;n+=sampleStep){const x=mono[pos+n]||0,a=Math.abs(x);rms+=x*x;flux+=Math.max(0,a-prev);prev=a;nr++}const beatFs=deep?[90,120,155,195,235]:[110,180],vocalFs=deep?[520,760,1050,1450,1950,2700,3500]:[750,1500,2800];let beat=0,vocal=0;for(const f of beatFs)beat+=bandPower(pos,frame,f,sampleStep);for(const f of vocalFs)vocal+=bandPower(pos,frame,f,sampleStep);const total=beat+vocal+1e-12;return {t,rms:Math.sqrt(rms/Math.max(1,nr)),flux:flux/Math.max(1,nr),beatShare:beat/total,vocalShare:vocal/total}};
  const coarseStep=.65,coarse=[];
  for(let t=startSec;t<endSec;t+=coarseStep)coarse.push(features(t,.25,6,false));
  if(coarse.length<8)return {point:Math.max(0,Math.min(startSec,duration-jingleDuration-1)),analysis:{confidence:0,label:'baixa',reason:'poucos dados',mode:'worker'}};
  const medV=median(coarse.map(x=>x.vocalShare)),medB=median(coarse.map(x=>x.beatShare)),medR=median(coarse.map(x=>x.rms)),gapN=Math.max(2,Math.ceil(jingleDuration/coarseStep)),preN=3,postN=4,candidates=[];
  for(let i=preN;i+gapN+postN<coarse.length;i++){
    const gap=coarse.slice(i,i+gapN),pre=coarse.slice(i-preN,i),post=coarse.slice(i+gapN,i+gapN+postN),gapV=avg(gap,'vocalShare'),preV=avg(pre,'vocalShare'),postV=avg(post,'vocalShare'),gapB=avg(gap,'beatShare'),postB=avg(post,'beatShare'),gapR=avg(gap,'rms'),postR=Math.max(...post.map(x=>x.rms));
    const vocalDrop=Math.max(0,(Math.max(preV,medV)-gapV)/Math.max(.02,medV)),vocalReturn=Math.max(0,(postV-gapV)/Math.max(.02,medV)),beatPresent=Math.min(2,gapB/Math.max(.02,medB)),beatRise=Math.max(0,(postB-gapB)/Math.max(.02,medB)),energyRise=Math.max(0,(postR-gapR)/Math.max(.01,medR));
    candidates.push({t:coarse[i].t,score:3.5*Math.min(2,vocalDrop)+2.7*Math.min(2,vocalReturn)+1.5*Math.min(1.7,beatPresent)+2*Math.min(2,beatRise)+1.8*Math.min(2,energyRise)});
  }
  candidates.sort((a,b)=>b.score-a.score);const picked=[];for(const c of candidates){if(picked.every(p=>Math.abs(p.t-c.t)>Math.max(4,jingleDuration*.65)))picked.push(c);if(picked.length>=4)break}
  if(!picked.length)return {point:Math.max(0,Math.min(startSec,duration-jingleDuration-1)),analysis:{confidence:0,label:'baixa',reason:'nenhum candidato',mode:'worker'}};
  let best=null;
  for(const cand of picked){
    for(let t=Math.max(startSec,cand.t-.9);t<=Math.min(endSec,cand.t+.9);t+=.25){
      const pre=[features(Math.max(startSec,t-.9),.2,4,true),features(Math.max(startSec,t-.45),.2,4,true)],gap=[],gapCount=Math.min(5,Math.max(2,Math.ceil(jingleDuration/2.5)));
      for(let gi=0;gi<gapCount;gi++){const g=(jingleDuration-.2)*gi/Math.max(1,gapCount-1);gap.push(features(Math.min(endSec,t+Math.max(0,g)),.19,5,true))}
      const post=[features(Math.min(endSec,t+jingleDuration+.25),.2,4,true),features(Math.min(endSec,t+jingleDuration+.8),.2,4,true)],gapV=avg(gap,'vocalShare'),preV=avg(pre,'vocalShare'),postV=avg(post,'vocalShare'),gapB=avg(gap,'beatShare'),postB=Math.max(...post.map(x=>x.beatShare)),gapR=avg(gap,'rms'),postR=Math.max(...post.map(x=>x.rms));
      const vocalDrop=Math.max(0,(preV-gapV)/Math.max(.02,medV)),vocalReturn=Math.max(0,(postV-gapV)/Math.max(.02,medV)),beatPresent=Math.min(2,gapB/Math.max(.02,medB)),beatExplosion=Math.max(0,(postB-gapB)/Math.max(.02,medB)),energyRise=Math.max(0,(postR-gapR)/Math.max(.01,medR)),voiceLeak=Math.max(0,(gapV-medV*.94)/Math.max(.02,medV)),score=4.1*Math.min(2,vocalDrop)+3*Math.min(2,vocalReturn)+1.6*Math.min(1.7,beatPresent)+2.3*Math.min(2,beatExplosion)+2*Math.min(2,energyRise)-3.2*Math.min(2,voiceLeak);
      if(!best||score>best.score)best={t,score,vocalDrop,vocalReturn,beatExplosion,energyRise};
    }
  }
  if(!best)best={t:picked[0].t,score:picked[0].score,vocalDrop:0,vocalReturn:0,beatExplosion:0,energyRise:0};
  const confidence=Math.round(clamp((best.score+1)*7.3,0,100)),label=confidence>=76?'alta':confidence>=52?'média':'baixa';
  return {point:clamp(best.t,0,duration-jingleDuration-1),analysis:{point:best.t,confidence,label,score:best.score,vocalDrop:best.vocalDrop,vocalReturn:best.vocalReturn,beatExplosion:best.beatExplosion,energyRise:best.energyRise,mode:'worker'}};
}
self.onmessage=e=>{const d=e.data||{},id=d.id;try{if(d.type!=='analyze')return;const mono=new Float32Array(d.mono),result=detect(mono,d.sampleRate,d.duration,d.jingleDuration);postMessage({type:'done',id,...result})}catch(err){postMessage({type:'error',id,error:err&&err.message?err.message:String(err)})}};
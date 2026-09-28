function classifyOI(priceChangePct, oiChangePct) {
  if (oiChangePct == null || Number.isNaN(Number(oiChangePct))) return 'OI n/a';
  const price=Number(priceChangePct), oi=Number(oiChangePct);
  if (price>=0 && oi>=0) return 'Long Buildup';
  if (price<0 && oi>=0) return 'Short Buildup';
  if (price>=0 && oi<0) return 'Short Covering';
  return 'Long Unwinding';
}
function calcPCR(chain) {
  const callOI=chain.reduce((s,r)=>s+Number(r.callOI||0),0);
  const putOI=chain.reduce((s,r)=>s+Number(r.putOI||0),0);
  return callOI>0?putOI/callOI:null;
}
function findSupportResistance(chain) {
  if(!Array.isArray(chain)||!chain.length)return {support:null,resistance:null};
  const support=chain.reduce((a,r)=>Number(r.putOI||0)>Number(a.putOI||0)?r:a);
  const resistance=chain.reduce((a,r)=>Number(r.callOI||0)>Number(a.callOI||0)?r:a);
  return {support:support.strike,resistance:resistance.strike};
}
function expectedValue(winRate,target,entry,stopLoss) {
  const p=Number(winRate)>1?Number(winRate)/100:Number(winRate);
  return p*(Number(target)-Number(entry))-(1-p)*(Number(entry)-Number(stopLoss));
}
function isVerifiedSignal({winRatePct,trades,backtested=false}) {
  return Boolean(backtested)&&Number(winRatePct)>=80&&Number(trades)>=100;
}
module.exports={classifyOI,calcPCR,findSupportResistance,expectedValue,isVerifiedSignal};

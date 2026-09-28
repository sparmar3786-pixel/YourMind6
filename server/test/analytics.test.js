const test=require('node:test');
const assert=require('node:assert/strict');
const {classifyOI,calcPCR,findSupportResistance,expectedValue,isVerifiedSignal}=require('../lib/analytics');

test('price up + OI up = Long Buildup',()=>assert.equal(classifyOI(1,2),'Long Buildup'));
test('price down + OI up = Short Buildup',()=>assert.equal(classifyOI(-1,2),'Short Buildup'));
test('price up + OI down = Short Covering',()=>assert.equal(classifyOI(1,-2),'Short Covering'));
test('price down + OI down = Long Unwinding',()=>assert.equal(classifyOI(-1,-2),'Long Unwinding'));
test('missing OI = OI n/a',()=>assert.equal(classifyOI(1,null),'OI n/a'));
test('PCR is put OI divided by call OI',()=>assert.equal(calcPCR([{callOI:100,putOI:150},{callOI:200,putOI:250}]),400/300));
test('support is max put OI and resistance is max call OI',()=>assert.deepEqual(findSupportResistance([{strike:25000,callOI:100,putOI:250},{strike:25100,callOI:500,putOI:100}]),{support:25000,resistance:25100}));
test('expected value follows blueprint formula',()=>assert.equal(expectedValue(.8,100,60,40),28));
test('signal needs 80 percent and 100 trades',()=>{assert.equal(isVerifiedSignal({winRatePct:80,trades:100}),true);assert.equal(isVerifiedSignal({winRatePct:79.9,trades:100}),false);assert.equal(isVerifiedSignal({winRatePct:80,trades:99}),false)});

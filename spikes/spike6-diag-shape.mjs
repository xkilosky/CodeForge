import { AnalysisWorker } from '@luau-rs/luau/analysis/worker';
const a = new AnalysisWorker({ mode: 'nonstrict' });
a.setModule('main.luau', `local x = 1
print(undefinedGlobal)
local y: number = "bad"
local function f() end
f(1, 2)
`);
const t0 = Date.now();
const r = await a.check('main.luau');
console.log('check took', Date.now() - t0, 'ms |', r.diagnostics.length, 'diagnostics');
console.log('RAW FIRST DIAG:', JSON.stringify(r.diagnostics[0], null, 1));
for (const d of r.diagnostics) {
  console.log(`- ${JSON.stringify(d.span)} ${d.severity}: ${d.message.replace(/\n/g,' ')}`);
}
a.terminate?.(); a.dispose?.();
process.exit(0);

import { AnalysisWorker } from '@luau-rs/luau/analysis/worker';
const a = new AnalysisWorker({ mode: 'nonstrict' });
a.setModule('main.luau', `
local count: number = "oops"
local unused = 123
print(undefinedGlobal)
local function f(x: number): string
	return x
end
local ok = 1 +
`);
const r = await a.check('main.luau');
console.log('diagnostics:', r.diagnostics.length);
for (const d of r.diagnostics) {
  console.log(`  [${d.severity}] ${d.message.replace(/\n/g,' ')} @ line ${d.span?.start?.line}:${d.span?.start?.column}`);
}

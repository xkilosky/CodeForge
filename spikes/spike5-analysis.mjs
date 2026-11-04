// Spike 5: does @luau-rs/luau ship a real Luau type checker / linter?
// NOTE: the position field is `location: {begin,end}`, NOT `span` — see spike6 for the shape.
// NOTE: a parse error suppresses later type diagnostics, so `local ok = 1 +` hides the others.
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
  const { begin } = d.location ?? {};
  console.log(`  [${d.severity}] code=${d.code} ${begin ? `line ${begin.line}:${begin.column} ` : ''}${d.message.replace(/\n/g, ' ')}`);
}
a.terminate?.();
process.exit(0);

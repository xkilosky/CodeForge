// Untrusted code: infinite loop + memory bomb must not hang the tab.
import { LuaWorker, DEFAULT_EXECUTION_OPTIONS } from '@luau-rs/luau/worker';
console.log('DEFAULT_EXECUTION_OPTIONS:', JSON.stringify(DEFAULT_EXECUTION_OPTIONS, null, 1));

const cases = {
  'infinite loop':   'while true do end',
  'memory bomb':     'local t = {} for i=1,1e9 do t[i]=i end',
  'output bomb':     'for i=1,1e6 do print(i) end',
  'normal script':   'return 6*7',
};
for (const [name, src] of Object.entries(cases)) {
  const w = new LuaWorker();
  const t0 = Date.now();
  try {
    const r = await w.execute(src);
    console.log(`${name.padEnd(15)} ok=${r.ok} values=${JSON.stringify(r.values)} err=${r.error?.message ?? '-'} (${Date.now()-t0}ms)`);
  } catch (e) {
    console.log(`${name.padEnd(15)} THREW ${String(e.message).split('\n')[0]} (${Date.now()-t0}ms)`);
  }
  w.terminate?.();
}

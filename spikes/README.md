# Feasibility spikes

Evidence for the claims in [PLAN.md §2](../PLAN.md). Run with:

```bash
cd spikes && npm install          # installs @luau-rs/luau 0.739.0
node spike1-syntax.mjs            # real Luau syntax (+=, continue, types, `{interp}`)
node spike3-prelude.mjs           # Roblox API as a Luau prelude -> render queue
node spike4-limits.mjs            # LuaWorker kills infinite loop / memory / output bombs
node spike5-analysis.mjs          # AnalysisWorker diagnostics
node spike6-diag-shape.mjs        # diagnostic span shape + timing
```

`spike2-shim.mjs` and `diag*.mjs` were exploratory and are intentionally omitted — they
document dead ends (JS-side API objects) rather than the chosen design.

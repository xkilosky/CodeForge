/**
 * The game preview document.
 *
 * A self-contained HTML page rendered in the same sandboxed iframe the Web
 * workspace uses. It receives the scene and the user's script as JSON, steps a
 * copy of the simulation, and draws it on a canvas.
 *
 * ## Why a generated document rather than an in-app canvas
 *
 * The alternative is a `<canvas>` inside React, which means the physics loop
 * shares a thread, a scheduler and a render cycle with Monaco and the store.
 * A previous attempt at this app kept a simulation loop on the main thread and
 * it was one of the things that made behaviour impossible to reason about. The
 * iframe gets its own `requestAnimationFrame`, its own error boundary (a throw
 * is caught by `window.onerror`) and `postMessage` as a hard boundary.
 *
 * ## Why the script is not inlined as code
 *
 * It would be simpler to concatenate the user's text into this document. Then a
 * script containing `</script>` breaks the page, and every frame's error has to
 * be reverse-mapped through generated scaffolding. Instead the source travels
 * as a JSON string and is compiled *inside* the frame, so a syntax error is
 * reported against the user's own line numbers.
 *
 * The document is assembled from parts: the runtime source (`SIM_RUNTIME`, a
 * plain string with no template literals of its own) and a JSON payload. That
 * split is what makes the preview unit-testable — the runtime can be exercised
 * in Node exactly as it is shipped.
 */

import type { Scene } from '../core/scene';

/** Marker so the shell can tell this frame's traffic from anything else. */
export const GAME_MESSAGE_TAG = '__codeforge_game__';

export interface GamePayload {
  scene: Scene;
  /** The entry file's text. */
  script: string;
  /** Path of the entry file, echoed back in error messages. */
  scriptPath: string;
  paused: boolean;
}

/**
 * The code that runs inside the iframe.
 *
 * Kept as a single string with **no backticks and no `${`**: it is injected by
 * concatenation, and a stray template literal here would either break the
 * generated page or, worse, interpolate app-side values into user-facing code.
 * `tests/game-runtime.test.ts` asserts both properties.
 */
export const SIM_RUNTIME = `
(function () {
  var post = function (payload) {
    payload.__codeforge_game__ = 1;
    try { parent.postMessage(payload, "*"); } catch (e) {}
  };

  var DATA = window.__CODEFORGE_GAME__;
  var canvas = document.getElementById("stage");
  var ctx = canvas.getContext("2d");
  var scene = DATA.scene;
  var status = document.getElementById("status");
  var paused = !!DATA.paused;

  // ---- geometry helpers -------------------------------------------------
  function overlaps(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }
  function findEntity(id) {
    for (var i = 0; i < scene.entities.length; i++) {
      if (scene.entities[i].id === id) return scene.entities[i];
    }
    return null;
  }

  // ---- state ------------------------------------------------------------
  var playerEntity = null;
  if (DATA.scene.playerId) playerEntity = findEntity(DATA.scene.playerId);
  if (!playerEntity) {
    for (var p = 0; p < scene.entities.length; p++) {
      if (scene.entities[p].kind === "box") { playerEntity = scene.entities[p]; break; }
    }
  }

  var state = null;
  function reset() {
    state = { entities: [], spawn: null, time: 0, collected: [] };
    if (!playerEntity) return;
    state.spawn = { id: playerEntity.id, x: playerEntity.x, y: playerEntity.y };
    for (var i = 0; i < scene.entities.length; i++) {
      var e = scene.entities[i];
      state.entities.push({ id: e.id, x: e.x, y: e.y, vx: 0, vy: 0, grounded: false });
    }
  }
  function stateOf(id) {
    if (!state) return null;
    for (var i = 0; i < state.entities.length; i++) {
      if (state.entities[i].id === id) return state.entities[i];
    }
    return null;
  }
  reset();

  // ---- input ------------------------------------------------------------
  var input = { axis: 0, jump: false };
  var held = { left: false, right: false, jump: false };
  function recomputeAxis() {
    input.axis = (held.right ? 1 : 0) - (held.left ? 1 : 0);
  }
  var KEYMAP = {
    ArrowLeft: "left", KeyA: "left",
    ArrowRight: "right", KeyD: "right",
    ArrowUp: "jump", KeyW: "jump", Space: "jump"
  };
  window.addEventListener("keydown", function (ev) {
    var slot = KEYMAP[ev.code];
    if (!slot) return;
    // Space scrolls the page by default, which on a phone looks like the game
    // jumped. Only *this* frame needs preventing; the parent is not affected.
    ev.preventDefault();
    held[slot] = true;
    recomputeAxis();
    if (slot === "jump" && !ev.repeat) input.jump = true;
  });
  window.addEventListener("keyup", function (ev) {
    var slot = KEYMAP[ev.code];
    if (!slot) return;
    ev.preventDefault();
    held[slot] = false;
    recomputeAxis();
    if (slot === "jump") input.jump = false;
  });
  // Losing focus while a key is down otherwise leaves the player running
  // forever, because the keyup went to another window.
  window.addEventListener("blur", function () {
    held.left = held.right = held.jump = false;
    recomputeAxis();
  });

  // Touch: two zones at the bottom of the stage. Deliberately not a virtual
  // joystick — this is a one-axis platformer, and a stick would be harder to
  // hit and harder to read.
  function bindTouch(el, slot) {
    if (!el) return;
    var down = function (ev) {
      ev.preventDefault();
      held[slot] = true;
      recomputeAxis();
      if (slot === "jump") input.jump = true;
    };
    var up = function (ev) {
      ev.preventDefault();
      held[slot] = false;
      recomputeAxis();
      if (slot === "jump") input.jump = false;
    };
    el.addEventListener("touchstart", down, { passive: false });
    el.addEventListener("touchend", up, { passive: false });
    el.addEventListener("touchcancel", up, { passive: false });
    el.addEventListener("mousedown", down);
    el.addEventListener("mouseup", up);
    el.addEventListener("mouseleave", up);
  }
  bindTouch(document.getElementById("pad-left"), "left");
  bindTouch(document.getElementById("pad-right"), "right");
  bindTouch(document.getElementById("pad-jump"), "jump");

  // ---- physics (mirrors src/game/physics.ts) ----------------------------
  var FIXED_DT = 1 / 120;
  var MAX_FALL = 2400;
  var SPEED = 300;
  var JUMP = 640;

  function moveAxis(player, entity, solids, axis, delta) {
    void solids;
    var before = player[axis];
    player[axis] += delta;
    for (var i = 0; i < solids.length; i++) {
      if (overlaps({ x: player.x, y: player.y, w: entity.w, h: entity.h }, solids[i])) {
        player[axis] = before;
        if (axis === "y") player.vy = 0; else player.vx = 0;
        return;
      }
    }
  }

  function step(dt) {
    if (!playerEntity || !state) return;
    var player = stateOf(playerEntity.id);
    if (!player) return;

    var solids = [];
    for (var i = 0; i < scene.entities.length; i++) {
      var e = scene.entities[i];
      if (e.solid && e.id !== playerEntity.id) solids.push(e);
    }

    player.vx = input.axis * SPEED;
    player.vy = Math.min(player.vy + scene.world.gravity * dt, MAX_FALL);

    moveAxis(player, playerEntity, solids, "x", player.vx * dt);
    moveAxis(player, playerEntity, solids, "y", player.vy * dt);

    var maxX = scene.world.width - playerEntity.w;
    if (player.x > maxX) player.x = maxX;
    if (player.x < 0) player.x = 0;

    player.grounded = player.vy >= 0 && solids.some(function (s) {
      return overlaps(
        { x: player.x, y: player.y + 2, w: playerEntity.w, h: playerEntity.h },
        s
      );
    });

    for (var j = 0; j < scene.entities.length; j++) {
      var other = scene.entities[j];
      if (other.solid || other.id === player.id) continue;
      if (state.collected.indexOf(other.id) !== -1) continue;
      if (overlaps({ x: player.x, y: player.y, w: playerEntity.w, h: playerEntity.h }, other)) {
        state.collected.push(other.id);
        post({ type: "collected", id: other.id, name: other.name, total: state.collected.length });
      }
    }

    if (input.jump && player.grounded) {
      player.vy = -JUMP;
      player.grounded = false;
    }

    if (player.y > scene.world.height + playerEntity.h * 2) {
      player.x = state.spawn.x;
      player.y = state.spawn.y;
      player.vx = 0;
      player.vy = 0;
      post({ type: "respawn" });
    }

    state.time += dt;
  }

  // ---- drawing ----------------------------------------------------------
  var scale = 1;
  function resize() {
    var box = canvas.parentElement.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var cssW = Math.max(1, box.width);
    var cssH = Math.max(1, box.height);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    // Letterbox the stage rather than stretching it: a 960x540 scene drawn into
    // a tall phone pane would otherwise make every circle an ellipse.
    scale = Math.min(cssW / scene.world.width, cssH / scene.world.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);

  function draw() {
    var cssW = canvas.width / (window.devicePixelRatio > 2 ? 2 : window.devicePixelRatio || 1);
    var cssH = canvas.height / (window.devicePixelRatio > 2 ? 2 : window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, cssW, cssH);

    var offsetX = (cssW - scene.world.width * scale) / 2;
    var offsetY = (cssH - scene.world.height * scale) / 2;

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    ctx.fillStyle = "#0d1220";
    ctx.fillRect(0, 0, scene.world.width, scene.world.height);
    ctx.strokeStyle = "#1b2740";
    ctx.lineWidth = 1 / scale;
    ctx.strokeRect(0, 0, scene.world.width, scene.world.height);

    for (var i = 0; i < scene.entities.length; i++) {
      var entity = scene.entities[i];
      if (state.collected.indexOf(entity.id) !== -1) continue;
      var live = stateOf(entity.id);
      var x = live ? live.x : entity.x;
      var y = live ? live.y : entity.y;

      ctx.fillStyle = entity.color;
      if (entity.kind === "circle") {
        ctx.beginPath();
        ctx.ellipse(x + entity.w / 2, y + entity.h / 2, entity.w / 2, entity.h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(x, y, entity.w, entity.h);
        if (entity.solid) {
          ctx.strokeStyle = "rgba(255,255,255,0.18)";
          ctx.lineWidth = 2 / scale;
          ctx.strokeRect(x + 1, y + 1, entity.w - 2, entity.h - 2);
        }
      }
    }
    ctx.restore();
  }

  // ---- user script ------------------------------------------------------
  var main = null;
  var scriptDead = false;

  // Statement-position only. A line beginning with optional spaces then
  // "export function" or "export const/let/var" loses the keyword; an
  // occurrence inside a string literal is left alone.
  //
  // Built with RegExp constructor strings rather than literal syntax on purpose:
  // this text is itself inside a template literal, and backslashes in a regex
  // literal survive that trip only by careful double-escaping. String.fromCharCode(92)
  // is a backslash with no escape to get wrong.
  var BS = String.fromCharCode(92);
  var EXPORT_FN = new RegExp("^[ " + BS + "t]*export" + BS + "s+(async" + BS + "s+)?function" + BS + "b", "gm");
  var EXPORT_VAR = new RegExp("^[ " + BS + "t]*export" + BS + "s+(const|let|var)" + BS + "b", "gm");
  function stripExports(source) {
    return source.replace(EXPORT_FN, "$1function").replace(EXPORT_VAR, "$1");
  }

  function compile(source) {
    try {
      var body = stripExports(source);
      var factory = new Function(
        body + "\\n; if (typeof onUpdate === \\"function\\") return onUpdate;" +
        " if (typeof update === \\"function\\") return update; return null;"
      );
      main = factory();
      if (!main) {
        post({ type: "script-info", message: "No onUpdate(ctx) found; running the scene without a script." });
      }
    } catch (err) {
      scriptDead = true;
      post({ type: "script-error", message: String(err && err.message ? err.message : err), line: scriptLine(err) });
    }
  }
  // Mirrors errorLine() in src/game/scripts.ts. Out-of-range positions are
  // positions in the wrapper this document adds, not in the user's file, and
  // showing them is worse than showing nothing.
  function scriptLine(err) {
    var text = (err && err.stack ? String(err.stack) : "") + " " + (err && err.message ? err.message : "");
    var m = /:(\\d+):\\d+/.exec(text) || /line (\\d+)/i.exec(text);
    if (!m) return null;
    var n = Number(m[1]);
    var limit = Math.max(1, (DATA.script || "").split("\\n").length) + 2;
    return Number.isFinite(n) && n >= 1 && n <= limit ? n : null;
  }
  compile(DATA.script || "");

  function entityView(entity) {
    var live = stateOf(entity.id);
    return {
      id: entity.id,
      name: entity.name,
      x: live ? live.x : entity.x,
      y: live ? live.y : entity.y,
      w: entity.w,
      h: entity.h,
      color: entity.color,
      solid: entity.solid,
      vx: live ? live.vx : 0,
      vy: live ? live.vy : 0,
      grounded: live ? !!live.grounded : false
    };
  }

  var api = {
    find: function (name) {
      for (var i = 0; i < scene.entities.length; i++) {
        if (scene.entities[i].name === name) return entityView(scene.entities[i]);
      }
      return null;
    },
    pickups: function () {
      var out = [];
      for (var i = 0; i < scene.entities.length; i++) {
        var e = scene.entities[i];
        if (e.solid || (state && e.id === state.spawn.id)) continue;
        if (state && state.collected.indexOf(e.id) !== -1) continue;
        out.push(entityView(e));
      }
      return out;
    },
    log: function () {
      var parts = [];
      for (var i = 0; i < arguments.length; i++) parts.push(String(arguments[i]));
      post({ type: "log", text: parts.join(" ") });
    },
    math: Math
  };

  // Frames the script has been ticked for. Engine-owned: ctx.frames is a fact
  // about the run, not user state the script has to remember.
  var scriptFrames = 0;

  function callScript(dt) {
    if (!main || scriptDead || paused || !state) return;
    scriptFrames += 1;
    var player = stateOf(state.spawn.id);
    if (!player) return;
    var view = entityView(playerEntity);
    view.move = function (vx) { player.vx = vx; };
    view.jump = function () { if (player.grounded) { player.vy = -JUMP; player.grounded = false; } };
    var ctx = {
      api: api,
      player: view,
      time: state.time,
      dt: Math.min(dt, 0.1),
      frames: scriptFrames,
      input: { axis: input.axis, jump: input.jump },
      collected: state.collected.slice()
    };
    try {
      main(ctx);
    } catch (err) {
      // One report, then the script stops. A throw every frame would emit 120
      // identical errors a second and bury the one that matters.
      scriptDead = true;
      post({ type: "script-error", message: String(err && err.message ? err.message : err), line: scriptLine(err) });
    }
  }

  // ---- loop -------------------------------------------------------------
  var acc = 0;
  var last = 0;
  var frames = 0;
  function frame(now) {
    if (!last) last = now;
    var elapsed = Math.min((now - last) / 1000, 0.25);
    last = now;

    if (!paused) {
      acc += elapsed;
      var guard = 0;
      while (acc >= FIXED_DT && guard < 60) {
        step(FIXED_DT);
        acc -= FIXED_DT;
        guard += 1;
      }
      // A long stall (tab backgrounded) must not try to catch up thousands of
      // steps; drop the backlog instead.
      if (acc > FIXED_DT * 60) acc = 0;
      callScript(elapsed);
      input.jump = false;
    }

    draw();
    frames += 1;
    // Status at 4 Hz, not per frame: the parent re-renders on every message and
    // 60 messages a second is a self-inflicted performance problem.
    //
    // Not while paused: the clock has stopped, and a status that kept arriving
    // would make the header's timer look like the game was still running.
    if (!paused && frames % 15 === 0 && state) {
      post({ type: "status", time: Math.round(state.time * 10) / 10, collected: state.collected.length });
    }
    requestAnimationFrame(frame);
  }

  window.addEventListener("message", function (ev) {
    var msg = ev.data;
    if (!msg || !msg.__codeforge_game_cmd__) return;
    if (msg.type === "pause") { paused = true; if (status) status.textContent = "Paused"; }
    if (msg.type === "resume") { paused = false; if (status) status.textContent = ""; last = 0; }
    if (msg.type === "restart") { reset(); scriptDead = false; paused = false; acc = 0; last = 0; }
  });

  resize();
  post({ type: "ready", entities: scene.entities.length });
  requestAnimationFrame(frame);
})();
`;

/** Serialise data for embedding in a `<script>` block without breaking it. */
export function embedJson(value: unknown): string {
  return JSON.stringify(value)
    // `</script` inside a JSON string would close the tag early, exactly as it
    // would with inlined JS. Escaping the slash is legal JSON.
    .replace(/<\/script/gi, '<\\/script')
    // U+2028/2029 are valid in JSON strings but historically illegal in JS
    // source; escaping them keeps the payload safe regardless of engine.
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function buildGameDocument(payload: GamePayload): string {
  const data = embedJson(payload);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>CodeForge game</title>
    <style>
      * { box-sizing: border-box; }
      html, body {
        margin: 0; height: 100%; background: #0b1020; overflow: hidden;
        font-family: system-ui, sans-serif;
      }
      body { display: flex; flex-direction: column; touch-action: none; }
      #stage-host { flex: 1; min-height: 0; position: relative; }
      canvas { display: block; position: absolute; inset: 0; }
      #status {
        position: absolute; top: 8px; left: 10px;
        font-size: 11px; color: #8b98b8;
        font-variant-numeric: tabular-nums;
      }
      #pads {
        display: flex; gap: 6px; padding: 8px; background: #0b1020;
      }
      .pad {
        flex: 1; min-height: 56px; border-radius: 12px;
        border: 1px solid #223052; background: #131c33; color: #cfd8f5;
        font: inherit; font-size: 18px; display: flex; align-items: center;
        justify-content: center; user-select: none; -webkit-user-select: none;
        touch-action: none;
      }
      .pad:active { background: #1d2a4a; }
      .pad.jump { flex: 0 0 38%; background: #1b2f52; }
      @media (pointer: fine) and (min-width: 640px) {
        /* A mouse and keyboard do not need on-screen pads, and they eat the
           stage on a laptop. */
        #pads { display: none; }
      }
    </style>
  </head>
  <body>
    <div id="stage-host">
      <canvas id="stage"></canvas>
      <div id="status"></div>
    </div>
    <div id="pads" aria-hidden="true">
      <button class="pad" id="pad-left" type="button">◀</button>
      <button class="pad" id="pad-right" type="button">▶</button>
      <button class="pad jump" id="pad-jump" type="button">▲</button>
    </div>
    <script>window.__CODEFORGE_GAME__ = ${data};</script>
    <script>${SIM_RUNTIME}</script>
  </body>
</html>`;
}

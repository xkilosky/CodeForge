/**
 * The game runtime, the generated preview document, and the simulation inside it.
 *
 * There is no browser here, so the document is not merely string-matched: it is
 * booted in a hand-built fake window with a real `requestAnimationFrame` queue,
 * and the frames are stepped by hand. That is what lets these tests assert what
 * the shipped document actually *does* — where the player comes to rest, that a
 * key moves it, that a throwing script reports once — instead of asserting that
 * some text appears in a template. The retired Roblox pillar was repeatedly
 * "fixed" on the strength of string assertions, and it never worked; this file
 * exists so the game runtime is held to a higher bar from the start.
 */
import { describe, expect, it } from 'vitest';
import { buildGameDocument, embedJson, SIM_RUNTIME } from '../src/game/preview';
import { compileScript, describeScriptProblem, scriptBody, stripExports } from '../src/game/scripts';
import { emptyScene, starterScene, updateEntity, type Scene } from '../src/core/scene';
import {
  entryPathFor,
  gamePayload,
  isGameMessage,
  translateGameMessage,
} from '../src/runtimes/game';
import { filesFromRecords } from '../src/core/templates';

// ── the fake frame ───────────────────────────────────────────────────────

interface Frame {
  posts: Record<string, unknown>[];
  draws: number[][];
  step(ms?: number): void;
  key(type: 'keydown' | 'keyup', code: string): void;
  command(message: Record<string, unknown>): void;
  messageCount(): number;
}

/**
 * Boots the *shipped* document's scripts in a fake window.
 *
 * Deliberately minimal: a canvas that records `fillRect` calls (so a position
 * can be read back out), the elements `SIM_RUNTIME` looks up, and an event bus.
 * Anything the document needs that is not here is a genuine missing dependency
 * and throws loudly, which is what we want.
 */
function bootFrame(payload: ReturnType<typeof gamePayload>): Frame {
  const listeners: Record<string, ((event: never) => void)[]> = {};
  const posts: Record<string, unknown>[] = [];
  const draws: number[][] = [];
  const on = (type: string, fn: (event: never) => void) => {
    (listeners[type] ??= []).push(fn as (event: never) => void);
  };

  const context = new Proxy(
    {},
    {
      get: (_target, prop) => (...args: unknown[]) => {
        if (prop === 'fillRect') draws.push(args as number[]);
        return undefined;
      },
    },
  ) as CanvasRenderingContext2D;

  const canvas = {
    width: 960,
    height: 540,
    style: {} as CSSStyleDeclaration,
    getContext: () => context,
    parentElement: { getBoundingClientRect: () => ({ width: 960, height: 540 }) },
  };

  const pad = (id: string) => ({
    textContent: '',
    addEventListener: (type: string, fn: (event: never) => void) => on(`${id}:${type}`, fn),
  });

  const elements: Record<string, unknown> = {
    stage: canvas,
    status: { textContent: '' },
    'pad-left': pad('left'),
    'pad-right': pad('right'),
    'pad-jump': pad('jump'),
  };

  let nextFrame: ((time: number) => void) | null = null;
  let now = 0;

  const sandbox = {
    window: {
      devicePixelRatio: 1,
      addEventListener: on,
      __CODEFORGE_GAME__: payload,
    },
    document: {
      getElementById: (id: string) => elements[id] ?? null,
      addEventListener: () => {},
    },
    parent: { postMessage: (message: Record<string, unknown>) => posts.push(message) },
    requestAnimationFrame: (cb: (time: number) => void) => {
      nextFrame = cb;
    },
    Math,
    Number,
    String,
    Object,
    Array,
    JSON,
    Date,
    console,
  };

  // Only the runtime script: the first <script> is the JSON payload.
  const scripts = [...buildGameDocument(payload).matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
    (match) => match[1],
  );
  const runtime = scripts[scripts.length - 1];
  new Function(...Object.keys(sandbox), runtime)(...Object.values(sandbox));

  return {
    posts,
    draws,
    step(ms = 1000 / 120) {
      now += ms;
      const cb = nextFrame;
      nextFrame = null;
      cb?.(now);
    },
    key(type, code) {
      for (const fn of listeners[type] ?? []) {
        (fn as unknown as (e: unknown) => void)({ code, preventDefault() {}, repeat: false });
      }
    },
    command(message) {
      for (const fn of listeners.message ?? []) {
        (fn as unknown as (e: unknown) => void)({
          data: { __codeforge_game_cmd__: 1, ...message },
        });
      }
    },
    messageCount: () => posts.length,
  };
}

/** The most recent rect drawn at exactly the player's size. */
function playerRect(frame: Frame, w: number, h: number): number[] | undefined {
  return frame.draws.filter((args) => args.length === 4 && args[2] === w && args[3] === h).at(-1);
}

const SILENT = 'export function onUpdate(ctx) {}';

function payloadFor(scene: Scene, script = SILENT) {
  return gamePayload({ files: filesFromRecords({ 'game.js': script }), scene, entry: 'game.js' });
}

// ── the document ─────────────────────────────────────────────────────────

describe('generated game document', () => {
  it('is valid enough to parse as JS in both of its script blocks', () => {
    const doc = buildGameDocument(payloadFor(starterScene()));
    const blocks = [...doc.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(blocks).toHaveLength(2);
    for (const code of blocks) {
      expect(() => new Function(code)).not.toThrow();
    }
  });

  it('keeps the runtime free of template-literal syntax', () => {
    // The runtime is injected by concatenation. A backtick or `${` would either
    // break the generated page or interpolate app values into user-facing code.
    expect(SIM_RUNTIME).not.toContain('`');
    expect(SIM_RUNTIME).not.toContain('${');
  });

  it('escapes a closing script tag in the payload', () => {
    const doc = buildGameDocument(
      payloadFor(starterScene(), 'const tag = "</script><script>alert(1)</script>";'),
    );
    // A script block ends at a closing tag and nothing else, so that is the
    // count that matters: the data block and the runtime block, and no third
    // one manufactured by the user's own text.
    expect([...doc.matchAll(/<\/script>/g)]).toHaveLength(2);
    // ...and the payload still round-trips to the text the user wrote, so the
    // escaping is invisible to the script that reads it.
    const data = /__CODEFORGE_GAME__ = ([\s\S]*?);<\/script>/.exec(doc)![1];
    expect(JSON.parse(data).script).toBe('const tag = "</script><script>alert(1)</script>";');
  });

  it('embeds JSON that survives a round trip', () => {
    const value = { a: '</script>', b: '\u2028', text: 'line\nbreak' };
    expect(JSON.parse(embedJson(value))).toEqual(value);
  });

  it('gives the stage somewhere to draw and the pads a real size', () => {
    const doc = buildGameDocument(payloadFor(starterScene()));
    expect(doc).toContain('id="stage"');
    expect(doc).toContain('id="pad-left"');
    // Touch targets below 40px are not reliably hittable with a thumb.
    expect(doc).toMatch(/\.pad\s*\{[^}]*min-height:\s*56px/);
  });
});

// ── the simulation, booted ───────────────────────────────────────────────

describe('simulation', () => {
  it('drops the player and rests it exactly on the floor', () => {
    const scene = starterScene();
    const player = scene.entities.find((e) => e.name === 'Player')!;
    const floor = scene.entities.find((e) => e.name === 'Floor')!;
    const frame = bootFrame(payloadFor(scene));

    for (let i = 0; i < 900; i++) frame.step();
    const rect = playerRect(frame, player.w, player.h);

    expect(rect).toBeDefined();
    // Resting on the floor means its bottom edge equals the floor's top edge.
    expect(rect![1]).toBeCloseTo(floor.y - player.h, 1);
  });

  it('does not fall through the floor', () => {
    const frame = bootFrame(payloadFor(starterScene()));
    for (let i = 0; i < 900; i++) frame.step();
    expect(frame.posts.some((p) => p.type === 'respawn')).toBe(false);
  });

  it('moves the player right when the arrow key is held', () => {
    const scene = starterScene();
    const player = scene.entities.find((e) => e.name === 'Player')!;
    const frame = bootFrame(payloadFor(scene));
    for (let i = 0; i < 240; i++) frame.step();
    const before = playerRect(frame, player.w, player.h)![0];

    frame.key('keydown', 'ArrowRight');
    for (let i = 0; i < 240; i++) frame.step();
    frame.key('keyup', 'ArrowRight');
    const after = playerRect(frame, player.w, player.h)![0];

    expect(after).toBeGreaterThan(before);
  });

  it('stops a released key from leaving the player running', () => {
    const scene = starterScene();
    const player = scene.entities.find((e) => e.name === 'Player')!;
    const frame = bootFrame(payloadFor(scene));
    for (let i = 0; i < 240; i++) frame.step();

    frame.key('keydown', 'ArrowRight');
    for (let i = 0; i < 60; i++) frame.step();
    frame.key('keyup', 'ArrowRight');
    for (let i = 0; i < 5; i++) frame.step();
    const resting = playerRect(frame, player.w, player.h)![0];

    for (let i = 0; i < 240; i++) frame.step();
    expect(playerRect(frame, player.w, player.h)![0]).toBeCloseTo(resting, 0);
  });

  it('jumps and comes back down', () => {
    const scene = starterScene();
    const player = scene.entities.find((e) => e.name === 'Player')!;
    const floor = scene.entities.find((e) => e.name === 'Floor')!;
    const frame = bootFrame(payloadFor(scene));
    for (let i = 0; i < 240; i++) frame.step();
    const rest = floor.y - player.h;

    frame.key('keydown', 'Space');
    const heights: number[] = [];
    for (let i = 0; i < 90; i++) {
      frame.step();
      const rect = playerRect(frame, player.w, player.h);
      if (rect) heights.push(rect[1]);
    }
    frame.key('keyup', 'Space');

    // y grows downward, so a jump is a *smaller* y than resting.
    expect(Math.min(...heights)).toBeLessThan(rest - 40);
    for (let i = 0; i < 240; i++) frame.step();
    expect(playerRect(frame, player.w, player.h)![1]).toBeCloseTo(rest, 1);
  });

  it('collects a pickup the player touches, once', () => {
    const scene = starterScene();
    const player = scene.entities.find((e) => e.name === 'Player')!;
    const coin = scene.entities.find((e) => e.name === 'Coin')!;
    const moved = updateEntity(scene, coin.id, { x: player.x, y: player.y });
    const frame = bootFrame(payloadFor(moved));

    for (let i = 0; i < 30; i++) frame.step();
    const collected = frame.posts.filter((p) => p.type === 'collected');
    expect(collected).toHaveLength(1);
    expect(collected[0].name).toBe('Coin');
  });

  it('respawns a player that falls off the stage', () => {
    const scene = starterScene();
    // Remove the floor and the ledge: nothing left to land on.
    const bare = scene.entities
      .filter((entity) => !entity.solid)
      .reduce((acc, entity) => ({ ...acc, entities: [...acc.entities, entity] }), {
        ...scene,
        entities: [] as Scene['entities'],
      });
    const frame = bootFrame(payloadFor(bare));
    for (let i = 0; i < 600; i++) frame.step();
    expect(frame.posts.some((p) => p.type === 'respawn')).toBe(true);
  });

  it('pauses and resumes on command', () => {
    const frame = bootFrame(payloadFor(starterScene()));
    for (let i = 0; i < 30; i++) frame.step();
    frame.command({ type: 'pause' });

    const before = frame.messageCount();
    for (let i = 0; i < 200; i++) frame.step();
    // Paused frames still draw but must not emit status messages: the clock has
    // stopped, and a status that keeps advancing would say otherwise.
    const statusesWhilePaused = frame.posts
      .slice(before)
      .filter((p) => p.type === 'status');
    expect(statusesWhilePaused).toHaveLength(0);

    frame.command({ type: 'resume' });
    for (let i = 0; i < 200; i++) frame.step();
    expect(frame.posts.slice(before).some((p) => p.type === 'status')).toBe(true);
  });
});

// ── scripts ──────────────────────────────────────────────────────────────

describe('script handling in the frame', () => {
  it('reports a throwing script exactly once', () => {
    const frame = bootFrame(payloadFor(starterScene(), 'export function onUpdate() { nope(); }'));
    for (let i = 0; i < 400; i++) frame.step();
    const errors = frame.posts.filter((p) => p.type === 'script-error');
    expect(errors).toHaveLength(1);
    expect(String(errors[0].message)).toContain('nope');
  });

  it('reports a syntax error, once, and still runs the scene', () => {
    const scene = starterScene();
    const player = scene.entities.find((e) => e.name === 'Player')!;
    const frame = bootFrame(payloadFor(scene, 'export function onUpdate( {'));
    for (let i = 0; i < 300; i++) frame.step();
    expect(frame.posts.filter((p) => p.type === 'script-error')).toHaveLength(1);
    // The stage must still be drawn: a broken script is not a broken preview.
    expect(playerRect(frame, player.w, player.h)).toBeDefined();
  });

  it('never reports a line outside the user\'s file', () => {
    const frame = bootFrame(payloadFor(starterScene(), 'export function onUpdate( {'));
    frame.step();
    const error = frame.posts.find((p) => p.type === 'script-error')!;
    // One line of source, so anything beyond a small wrapper allowance is a lie.
    expect(error.line === null || (error.line as number) <= 3).toBe(true);
  });

  it('keeps module-level state between frames', () => {
    // The failure this guards: recompiling per frame would reset `calls` to 0
    // every tick, so a script could never count anything.
    const script = `
      let calls = 0;
      export function onUpdate(ctx) {
        calls += 1;
        if (calls === 3) ctx.api.log("third frame");
      }
    `;
    const frame = bootFrame(payloadFor(starterScene(), script));
    for (let i = 0; i < 60; i++) frame.step();
    const logs = frame.posts.filter((p) => p.type === 'log');
    expect(logs).toHaveLength(1);
    expect(String(logs[0].text)).toBe('third frame');
  });

  it('exposes the player to the script', () => {
    const script = `
      export function onUpdate(ctx) {
        if (ctx.time > 0.2 && ctx.time < 0.3) {
          ctx.api.log("player y is a number: " + (typeof ctx.player.y === "number"));
          ctx.api.log("grounded: " + ctx.player.grounded);
        }
      }
    `;
    const frame = bootFrame(payloadFor(starterScene(), script));
    for (let i = 0; i < 80; i++) frame.step();
    const texts = frame.posts.filter((p) => p.type === 'log').map((p) => String(p.text));
    expect(texts).toContain('player y is a number: true');
    expect(texts).toContain('grounded: true');
  });
});

// ── the app-side compiler ────────────────────────────────────────────────

describe('compileScript', () => {
  it('accepts the template shape', () => {
    const result = compileScript('export function onUpdate(ctx) {}');
    expect(result.error).toBeNull();
    expect(result.hasHook).toBe(true);
    expect(result.hookName).toBe('onUpdate');
  });

  it('accepts `update` as an alias and a bare function', () => {
    expect(compileScript('export function update() {}').hasHook).toBe(true);
    expect(compileScript('function onUpdate() {}').hasHook).toBe(true);
    expect(compileScript('const onUpdate = () => {};').hasHook).toBe(true);
  });

  it('reports a script with no hook rather than calling it an error', () => {
    const result = compileScript('const x = 1;');
    expect(result.error).toBeNull();
    expect(result.hasHook).toBe(false);
    expect(describeScriptProblem(result, 'game.js')).toContain('no onUpdate');
  });

  it('names the file and line for a syntax error', () => {
    const result = compileScript('const a = 1;\nconst b = 2;\nexport function onUpdate( {');
    expect(result.error).toBeTruthy();
    const message = describeScriptProblem(result, 'game.js')!;
    expect(message).toContain('game.js');
    expect(message).toMatch(/SyntaxError|Unexpected/);
  });

  it('strips only the export keyword, leaving the code intact', () => {
    expect(stripExports('export function onUpdate() {}')).toBe('function onUpdate() {}');
    expect(stripExports('export const a = 1;')).toBe('const a = 1;');
    // A string mention of `export` must not be rewritten.
    expect(stripExports('const s = "export function";')).toBe('const s = "export function";');
  });

  it('wraps the source so both hook names can be returned', () => {
    const body = scriptBody('export function update() {}');
    expect(body).toContain('typeof onUpdate === "function"');
    expect(body).toContain('typeof update === "function"');
    expect(body).not.toContain('export');
  });
});

// ── message translation ──────────────────────────────────────────────────

describe('game messages', () => {
  it('ignores anything not tagged by the game frame', () => {
    expect(isGameMessage({ type: 'log', text: 'hi' })).toBe(false);
    expect(translateGameMessage({ type: 'log', text: 'hi' }, {})).toBeNull();
  });

  it('maps a script error to a console entry with a file and line', () => {
    const event = translateGameMessage(
      { __codeforge_game__: 1, type: 'script-error', message: 'boom', line: 4 },
      { scriptPath: 'game.js' },
    );
    expect(event?.type).toBe('log');
    if (event?.type !== 'log') throw new Error('unreachable');
    expect(event.entry.kind).toBe('error');
    expect(event.entry.text).toContain('game.js:4');
    expect(event.entry.file).toBe('game.js');
    expect(event.entry.line).toBe(4);
  });

  it('does not invent a line when the frame reports none', () => {
    const event = translateGameMessage(
      { __codeforge_game__: 1, type: 'script-error', message: 'boom', line: null },
      { scriptPath: 'game.js' },
    );
    if (event?.type !== 'log') throw new Error('unreachable');
    expect(event.entry.text).not.toMatch(/:\d+/);
    expect(event.entry.line).toBeUndefined();
  });

  it('stays quiet for the once-per-second status message', () => {
    // Four of these a second would bury everything the user's script printed.
    expect(
      translateGameMessage({ __codeforge_game__: 1, type: 'status', time: 1 }, {}),
    ).toBeNull();
  });
});

describe('entry file', () => {
  it('prefers the requested file when it exists', () => {
    const files = filesFromRecords({ 'game.js': '', 'helper.js': '' });
    expect(entryPathFor(files, 'helper.js')).toBe('helper.js');
  });

  it('falls back to a script, then to anything', () => {
    expect(entryPathFor(filesFromRecords({ 'a.txt': '', 'main.js': '' }))).toBe('main.js');
    expect(entryPathFor(filesFromRecords({ 'notes.txt': '' }))).toBe('notes.txt');
    expect(entryPathFor(filesFromRecords({}))).toBe('');
  });

  it('packages the active file, not the first one alphabetically', () => {
    const files = filesFromRecords({ 'a-helper.js': 'x', 'game.js': 'y' });
    const payload = gamePayload({ files, scene: emptyScene(), entry: 'game.js' });
    expect(payload.scriptPath).toBe('game.js');
    expect(payload.script).toBe('y');
  });
});

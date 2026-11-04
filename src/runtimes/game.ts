/**
 * Game workspace runtime.
 *
 * A game project is a scene plus an entry script. The scene is drawn and
 * simulated inside the preview iframe (see `game/preview.ts`); this file is the
 * app-side half: it packages the payload, forwards the user's console output,
 * and turns the frame's errors into `file:line` messages.
 *
 * The runtime holds no reference to the iframe. The React wrapper owns the
 * element and the transport, which keeps runtimes free of DOM handles — the
 * same rule the Web runtime follows.
 */

import { buildGameDocument, GAME_MESSAGE_TAG, type GamePayload } from '../game/preview';
import { compileScript, describeScriptProblem } from '../game/scripts';
import { resolvePlayer, type Scene } from '../core/scene';
import type {
  FileMap,
  IOBridge,
  PreviewEvent,
  PreviewPayload,
  RunHandle,
  Runtime,
} from '../core/types';

/**
 * Which file is the game's entry.
 *
 * Explicit, because guessing from `.js` breaks the moment a project has a
 * helper file: the builder must run the file the user is looking at.
 */
export function entryPathFor(files: FileMap, preferred?: string): string {
  if (preferred && files[preferred]) return preferred;
  const keys = Object.keys(files).sort();
  return (
    keys.find((path) => path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.ts')) ??
    keys[0] ??
    ''
  );
}

export interface GamePreviewInput {
  files: FileMap;
  scene: Scene;
  entry: string;
  paused?: boolean;
}

/**
 * Builds the payload the frame needs. Exported for tests: it is the exact
 * contract between the app and the generated document.
 */
export function gamePayload({ files, scene, entry, paused = false }: GamePreviewInput): GamePayload {
  const path = entryPathFor(files, entry);
  return {
    scene,
    script: files[path]?.content ?? '',
    scriptPath: path,
    paused,
  };
}

/** True when a message came from a game preview rather than a web one. */
export function isGameMessage(data: unknown): data is Record<string, unknown> {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as Record<string, unknown>)[GAME_MESSAGE_TAG] === 1
  );
}

/**
 * Turns one frame message into a console entry.
 *
 * `meta.scriptPath` is on the meta rather than the message because the frame
 * does not need to know the project's file layout; the app decides how to name
 * a file in an error.
 */
export function translateGameMessage(data: unknown, meta: unknown): PreviewEvent | null {
  if (!isGameMessage(data)) return null;
  const path = (meta as { scriptPath?: string } | null)?.scriptPath || 'game script';
  const type = String(data.type ?? '');

  switch (type) {
    case 'script-error': {
      const line = typeof data.line === 'number' ? data.line : null;
      const where = line ? `${path}:${line}` : path;
      return {
        type: 'log',
        entry: {
          kind: 'error',
          text: `Script error in ${where} — ${String(data.message ?? 'unknown error')}`,
          file: line ? path : undefined,
          line: line ?? undefined,
        },
      };
    }
    case 'script-info':
      return { type: 'log', entry: { kind: 'system', text: String(data.message ?? '') } };
    case 'log':
      return { type: 'log', entry: { kind: 'log', text: String(data.text ?? '') } };
    case 'collected':
      return {
        type: 'log',
        entry: {
          kind: 'system',
          text: `Collected ${String(data.name ?? 'pickup')} (${String(data.total ?? '?')})`,
        },
      };
    case 'respawn':
      return { type: 'log', entry: { kind: 'system', text: 'Fell off the stage — back to the start.' } };
    case 'ready':
      return {
        type: 'log',
        entry: { kind: 'system', text: `Scene loaded: ${String(data.entities ?? 0)} entities.` },
      };
    case 'status':
      // Deliberately not logged: this arrives four times a second and would
      // bury everything the user's own script printed.
      return null;
    default:
      return null;
  }
}

export const gameRuntime: Runtime = {
  id: 'game',
  label: 'Games',
  preview: 'canvas',
  available: true,

  run(files: FileMap, entry: string, bridge: IOBridge): RunHandle {
    // The frame compiles the script itself, so this check is about telling the
    // user *before* they play something silent, not about gating the run.
    const path = entryPathFor(files, entry);
    const compiled = compileScript(files[path]?.content ?? '');
    const problem = describeScriptProblem(compiled, path || 'the script');
    if (problem) {
      bridge.log({ kind: compiled.error ? 'error' : 'system', text: problem });
    }
    // Nothing to stop: the preview owns its own loop and is torn down when the
    // iframe is replaced.
    return { stop() {} };
  },

  buildPreview(files: FileMap, scene?: Scene): PreviewPayload {
    if (!scene) {
      // Reachable only if a caller lost the project's scene. An empty stage is
      // a clearer outcome than an exception inside the preview panel.
      return { kind: 'placeholder', message: 'This game project has no scene yet.' };
    }
    const payload = gamePayload({ files, scene, entry: Object.keys(files)[0] ?? '' });
    return { kind: 'srcdoc', srcdoc: buildGameDocument(payload), meta: { scriptPath: payload.scriptPath } };
  },

  handlePreviewMessage(data: unknown, meta: unknown): PreviewEvent | null {
    return translateGameMessage(data, meta);
  },
};

/** Builds the iframe document for a game project. */
export function buildGamePreview(input: GamePreviewInput): { srcdoc: string; meta: unknown } {
  const payload = gamePayload(input);
  return { srcdoc: buildGameDocument(payload), meta: { scriptPath: payload.scriptPath } };
}

/**
 * Scene sanity for the builder UI: the player must be something the run can
 * actually drive. Exported so the builder and the tests agree on the rule.
 */
export function playableScene(scene: Scene): boolean {
  return resolvePlayer(scene) !== null;
}

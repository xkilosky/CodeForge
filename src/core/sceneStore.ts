/**
 * Holds the most recent scene the Roblox runtime produced.
 *
 * The preview panel cannot ask for a scene the way it asks for an iframe
 * document: the scene only exists after user code has executed. So execution
 * pushes a snapshot here and the viewport subscribes — the same shape as
 * `consoleStore`, and equally React-free.
 */
import { Store } from './store';
import type { SceneSnapshot } from './types';

export interface SceneState {
  snapshot: SceneSnapshot | null;
  /** Why the last run produced no scene, when that is worth saying. */
  error: string | null;
}

export const sceneStore = new Store<SceneState>({ snapshot: null, error: null });

let nextRunId = 1;

/** Called by the Roblox runtime after a successful run. */
export function publishScene(parts: SceneSnapshot['parts'], camera?: SceneSnapshot['camera']): void {
  sceneStore.set({ snapshot: { parts, camera, runId: nextRunId++ }, error: null });
}

/**
 * Called when a run failed before it could serialize a scene. The previous
 * scene is kept deliberately: wiping the viewport on a syntax error would
 * punish the user for a typo by taking away the thing they were looking at.
 */
export function reportSceneError(message: string): void {
  sceneStore.set((prev) => ({ ...prev, error: message }));
}

export function clearScene(): void {
  sceneStore.set({ snapshot: null, error: null });
}

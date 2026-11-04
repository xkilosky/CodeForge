/**
 * Solver output -> the scene the viewport draws.
 *
 * The viewport is deliberately ignorant of physics: it reads a `SceneSnapshot`
 * from `sceneStore` and nothing else. So motion is applied here, by patching
 * part positions in place, rather than by teaching the renderer about Rapier.
 *
 * This runs every animation frame (60 Hz), which is why it mutates the existing
 * snapshot object instead of rebuilding it: publishing a new identity each frame
 * would re-run every consumer effect, and `RobloxViewport` rebuilds a mesh when
 * its scene object changes.
 */
import { sceneStore } from '../../core/sceneStore';
import type { SolvedPart } from './physics';

export function applyPhysicsFrame(solved: SolvedPart[]): void {
  if (solved.length === 0) return;
  const current = sceneStore.get().snapshot;
  if (!current) return;

  // Only touch parts that actually moved; a baseplate stays put forever and
  // there is no reason to rewrite its position every frame.
  let changed = false;
  for (const part of current.parts) {
    const move = solved.find((s) => s.path === part.path);
    if (!move) continue;
    const { position } = move;
    if (
      part.position.x === position.x &&
      part.position.y === position.y &&
      part.position.z === position.z
    ) {
      continue;
    }
    part.position = position;
    part.velocity = move.velocity;
    changed = true;
  }

  if (changed) {
    // Same snapshot identity, new contents: the renderer's frame effect reads
    // positions directly and does not depend on referential equality.
    sceneStore.set((prev) => ({ ...prev, snapshot: prev.snapshot }));
  }
}

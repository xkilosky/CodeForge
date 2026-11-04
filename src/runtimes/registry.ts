import type { FileMap, IOBridge, PreviewPayload, RunHandle, Runtime } from '../core/types';
import { webRuntime } from './web';
import { luauRuntime } from './luau';

/**
 * Placeholder for workspaces that land in a later milestone.
 * Declared here so the shell can render an honest "not yet" state instead of
 * pretending the workspace exists.
 */
function upcoming(id: string, label: string, milestone: string, preview: Runtime['preview']): Runtime {
  return {
    id,
    label,
    preview,
    available: false,
    unavailableReason: `Arrives in ${milestone}.`,
    run(_files: FileMap, _entry: string, _io: IOBridge): RunHandle {
      return { stop() {} };
    },
    buildPreview(): PreviewPayload {
      return { kind: 'placeholder', message: `${label} arrives in ${milestone}.` };
    },
  };
}

export const RUNTIMES: Runtime[] = [
  webRuntime,
  luauRuntime,
  upcoming('game', 'Game builder', 'M7', 'canvas'),
  upcoming('python', 'Python', 'M8', 'terminal'),
];

export function runtimeFor(id: string): Runtime | undefined {
  return RUNTIMES.find((r) => r.id === id);
}

export function runtimeForWorkspace(workspace: string): Runtime {
  return runtimeFor(workspace) ?? RUNTIMES[0];
}

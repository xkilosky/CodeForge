import type { FileMap, IOBridge, PreviewPayload, RunHandle, Runtime } from '../core/types';
import { arrivesIn, arrivesInPhrase } from '../core/release';
import { gameRuntime } from './game';
import { webRuntime } from './web';

/**
 * Placeholder for workspaces that land in a later milestone.
 * Declared here so the shell can render an honest "not yet" state instead of
 * pretending the workspace exists.
 */
function upcoming(id: string, label: string, preview: Runtime['preview']): Runtime {
  return {
    id,
    label,
    preview,
    available: false,
    unavailableReason: arrivesIn(),
    run(_files: FileMap, _entry: string, _io: IOBridge): RunHandle {
      return { stop() {} };
    },
    buildPreview(): PreviewPayload {
      return { kind: 'placeholder', message: `${label} ${arrivesInPhrase()}` };
    },
  };
}

export const RUNTIMES: Runtime[] = [
  webRuntime,
  gameRuntime,
  upcoming('python', 'Python', 'terminal'),
];

export function runtimeFor(id: string): Runtime | undefined {
  return RUNTIMES.find((r) => r.id === id);
}

export function runtimeForWorkspace(workspace: string): Runtime {
  return runtimeFor(workspace) ?? RUNTIMES[0];
}

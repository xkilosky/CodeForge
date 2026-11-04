/**
 * Analysis worker entry.
 *
 * A worker we own rather than the library's `AnalysisWorker`, because a check
 * takes ~300 ms and running it on the main thread would stall typing. Owning the
 * worker also avoids depending on how the library resolves its own worker URL
 * under a bundler.
 *
 * Protocol: { id, files, mode } in, { id, diagnostics } out.
 */
import type { Diagnostic, FileMap } from '../../core/types';
import { createLuauAnalyzer, type LuauAnalysisMode, type LuauAnalyzer } from './analyze';

export interface AnalyzeRequest {
  id: number;
  files: FileMap;
  mode: LuauAnalysisMode;
}

export interface AnalyzeResponse {
  id: number;
  diagnostics?: Diagnostic[];
  error?: string;
}

let analyzer: LuauAnalyzer | null = null;
let pending: Promise<LuauAnalyzer> | null = null;

function getAnalyzer(): Promise<LuauAnalyzer> {
  if (analyzer) return Promise.resolve(analyzer);
  if (!pending) {
    pending = createLuauAnalyzer().then((created) => {
      analyzer = created;
      return created;
    });
  }
  return pending;
}

self.onmessage = async (event: MessageEvent<AnalyzeRequest>) => {
  const { id, files, mode } = event.data;
  try {
    const instance = await getAnalyzer();
    const diagnostics = instance.check(files, mode);
    (self as unknown as Worker).postMessage({ id, diagnostics } satisfies AnalyzeResponse);
  } catch (err) {
    const error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    (self as unknown as Worker).postMessage({ id, error } satisfies AnalyzeResponse);
  }
};

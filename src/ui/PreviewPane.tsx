import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from '../core/consoleStore';
import type { FileMap, Runtime } from '../core/types';

interface PreviewPaneProps {
  runtime: Runtime;
  files: FileMap;
  autorun: boolean;
  /** Incrementing this forces a rebuild even when autorun is off. */
  runSignal: number;
  /** Re-executes the project. Unused by static previews; kept for runtimes. */
  onRun?: () => void;
}

const REBUILD_DEBOUNCE_MS = 400;

/**
 * Renders whatever the runtime's preview produces. The shell never interprets
 * preview messages itself — it forwards them to the runtime.
 */
export function PreviewPane({ runtime, files, autorun, runSignal }: PreviewPaneProps) {
  const [debouncedFiles, setDebouncedFiles] = useState(files);
  const metaRef = useRef<unknown>(null);

  // Debounce so keystrokes do not reload the iframe on every character.
  useEffect(() => {
    if (!autorun) return;
    const t = setTimeout(() => setDebouncedFiles(files), REBUILD_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [files, autorun]);

  // A manual Run always rebuilds immediately.
  useEffect(() => {
    if (runSignal > 0) setDebouncedFiles(files);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runSignal]);

  const payload = useMemo(() => {
    if (!runtime.available || !runtime.buildPreview) {
      return {
        kind: 'placeholder' as const,
        message: runtime.unavailableReason ?? 'No preview for this workspace.',
      };
    }
    return runtime.buildPreview(debouncedFiles);
  }, [runtime, debouncedFiles]);

  useEffect(() => {
    if (payload.kind === 'srcdoc') metaRef.current = payload.meta ?? null;
  }, [payload]);

  // Capture console output and uncaught errors from the preview.
  useEffect(() => {
    if (payload.kind !== 'srcdoc') return;
    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (typeof data !== 'object' || data === null) return;
      if (!(data as Record<string, unknown>).__codeforge) return;
      const translated = runtime.handlePreviewMessage?.(data, metaRef.current);
      if (!translated) return;
      if (translated.type === 'clear') io.clear();
      else io.log(translated.entry);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [runtime, payload.kind]);

  if (payload.kind === 'placeholder') {
    return (
      <div className="pane-empty preview-placeholder">
        <div className="placeholder-badge">{runtime.label}</div>
        <p>{payload.message}</p>
        <p className="muted">The Runtime interface is in place; this engine has not been built yet.</p>
      </div>
    );
  }

  return (
    <iframe
      key={payload.srcdoc.length + ':' + payload.srcdoc.slice(0, 64)}
      title="Preview"
      className="preview-frame"
      // No allow-same-origin: the preview runs in an opaque origin and cannot
      // reach the app. Scripts are still allowed so user code executes.
      sandbox="allow-scripts allow-modals allow-forms allow-popups allow-pointer-lock"
      srcDoc={payload.srcdoc}
    />
  );
}

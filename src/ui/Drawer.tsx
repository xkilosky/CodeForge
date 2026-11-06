/**
 * The drawer.
 *
 * The top bar was carrying the brand, three workspace tabs, a name field, a
 * save state, Run/Stop/Auto, "+ New" and an exit button at the same time. On a
 * phone that did not fit, so the workspace tabs and the save state were hidden
 * and the sections of the app simply had no navigation — the only way to change
 * things was a bar of eight controls.
 *
 * The drawer is the navigation surface instead: sections on top, the project's
 * file tree underneath, pinning on a wide screen and overlaying on a narrow one.
 * The top bar keeps only what acts on the *current* thing — Run, the drawer
 * button, and the project name.
 *
 * Pinning is not just layout. Unpinned on a desktop it overlays, which would
 * cover the editor the tree exists to serve; so the tree lives behind the
 * drawer on a phone and sits beside the editor on a desktop until the user
 * chooses otherwise. The choice is remembered per browser, not per project.
 */
import { useEffect, useRef } from 'react';
import type { Project } from '../core/types';
import type { Release } from '../core/release';
import type { LayoutMode } from './useLayoutMode';
import { Explorer } from './Explorer';
import { BrandMark } from './BrandMark';
import {
  CloseIcon,
  LayoutIcon,
  PlayIcon,
  SearchIcon,
  SECTION_ICONS,
  StopIcon,
} from './icons';

/**
 * The sections of the app, in the order they appear in the drawer.
 *
 * `id` is also the `scrollIntoView` target in the phone layout, so the existing
 * `pane-*` ids are reused rather than inventing a second naming scheme.
 */
export type SectionId = 'files' | 'objects' | 'code' | 'preview' | 'output' | 'terminal' | 'look' | 'backup' | 'source';

export const SECTIONS: {
  id: SectionId;
  label: string;
  hint: string;
}[] = [
  { id: 'files', label: 'Files', hint: 'Tree, folders, rename' },
  { id: 'objects', label: 'Objects', hint: 'Stage inspector' },
  { id: 'code', label: 'Code', hint: 'Editor and tabs' },
  { id: 'preview', label: 'Preview', hint: 'Live output' },
  { id: 'output', label: 'Output', hint: 'Console and problems' },
  { id: 'terminal', label: 'Terminal', hint: 'One Bash shell with project file sync' },
  { id: 'look', label: 'Look', hint: 'Interface, accent and editor themes' },
  { id: 'backup', label: 'Backup', hint: 'Export and import' },
  { id: 'source', label: 'Source Control', hint: 'GitHub changes and commits' },
];

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  pinned: boolean;
  onTogglePin: () => void;
  layout: LayoutMode;
  project: Project | null;
  release: Release;
  /** Which section the row list should highlight. */
  activeSection: SectionId;
  onSection: (section: SectionId) => void;
  issues: { errors: number; warnings: number };
  running: boolean;
  onRun: () => void;
  onStop: () => void;
  onExit: () => void;
  /** File-tree callbacks, forwarded to `Explorer`. */
  onSelectFile: (path: string) => void;
  onCreateFile: (path: string) => void;
  onCreateFolder: (path: string) => void;
  onRename: (from: string, to: string) => void;
  onDeleteFile: (path: string) => void;
  onDeleteFolder: (path: string) => void;
  onDuplicateFile: (path: string) => void;
  onOpenSearch: () => void;
}

export function Drawer({
  open,
  onClose,
  pinned,
  onTogglePin,
  layout,
  project,
  release,
  activeSection,
  onSection,
  issues,
  running,
  onRun,
  onStop,
  onExit,
  onSelectFile,
  onCreateFile,
  onCreateFolder,
  onRename,
  onDeleteFile,
  onDeleteFolder,
  onDuplicateFile,
  onOpenSearch,
}: DrawerProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  // Pinning is a desktop layout preference only. On compact screens the drawer
  // is always an overlay, even if the preference persisted from a desktop.
  const pinnedDesktop = layout === 'desktop' && pinned;

  // Escape closes an overlay. Not bound while desktop-pinned: there is nothing
  // to dismiss, and swallowing Escape would break closing a Monaco suggestion.
  useEffect(() => {
    if (!open || pinnedDesktop) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, pinnedDesktop, onClose]);

  const overlay = open && !pinnedDesktop;
  const visibleSections = SECTIONS.filter(
    (section) => section.id !== 'objects' || (layout === 'compact' && project?.workspace === 'game'),
  );

  return (
    <>
      {overlay ? (
        <div
          className="drawer-scrim"
          role="presentation"
          onClick={onClose}
          aria-hidden="true"
        />
      ) : null}

      <aside
        ref={panelRef}
        className={`drawer${open ? ' open' : ''}${pinned && layout === 'desktop' ? ' pinned' : ''}`}
        aria-label="Workspace"
        aria-hidden={!open && !pinnedDesktop ? true : undefined}
      >
        <div className="drawer-head">
          <button className="drawer-brand" onClick={onExit} title={`${release.title} — back to your projects`}>
            <BrandMark size={22} />
            <span className="drawer-brand-text">
              <span className="drawer-brand-name">CodeForge</span>
              <span className="drawer-brand-version">{release.tag}</span>
            </span>
          </button>
          {/* A phone has no sidebar to pin: the drawer is always an overlay
              there, so the pin is hidden rather than shown doing nothing. */}
          {layout === 'desktop' ? (
            <button
              className={`drawer-pin${pinned ? ' active' : ''}`}
              onClick={onTogglePin}
              aria-pressed={pinned}
              title={pinned ? 'Unpin the drawer (Ctrl+B)' : 'Keep the drawer open (Ctrl+B)'}
            >
              <LayoutIcon size={15} />
            </button>
          ) : null}
          {layout === 'desktop' && pinned ? null : (
            <button className="drawer-close" onClick={onClose} aria-label="Close the drawer">
              <CloseIcon size={16} />
            </button>
          )}
        </div>

        <nav className="drawer-sections" aria-label="Sections">
          {visibleSections.map((section) => {
            const Icon = SECTION_ICONS[section.id];
            const active = section.id === activeSection;
            return (
              <button
                key={section.id}
                className={`drawer-section section-${section.id}${active ? ' active' : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={() => onSection(section.id)}
              >
                <span className="drawer-section-icon">
                  <Icon size={15} />
                </span>
                <span className="drawer-section-text">
                  <span className="drawer-section-label">{section.label}</span>
                  <span className="drawer-section-hint">{section.hint}</span>
                </span>
                {section.id === 'output' && issues.errors > 0 ? (
                  <span className="badge error" aria-label={`${issues.errors} errors`}>
                    {issues.errors > 99 ? '99+' : issues.errors}
                  </span>
                ) : section.id === 'output' && issues.warnings > 0 ? (
                  <span className="badge warn" aria-label={`${issues.warnings} warnings`}>
                    {issues.warnings > 99 ? '99+' : issues.warnings}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        {project ? (
          <>
            <div className="drawer-project">
              <span className="drawer-project-name" title={project.name}>
                {project.name}
              </span>
              <span className="drawer-project-actions">
                <button
                  className="drawer-mini"
                  onClick={onOpenSearch}
                  title="Search files (Ctrl+P)"
                  aria-label="Search files"
                >
                  <SearchIcon size={14} />
                </button>
                <button
                  className={`drawer-mini${running ? ' stop' : ''}`}
                  onClick={running ? onStop : onRun}
                  title={running ? 'Stop' : 'Run (Ctrl+Enter)'}
                  aria-label={running ? 'Stop' : 'Run'}
                >
                  {running ? <StopIcon size={12} /> : <PlayIcon size={12} />}
                </button>
              </span>
            </div>

            <div className="drawer-tree">
              <Explorer
                bare
                files={project.files}
                folders={project.folders}
                activeFile={project.activeFile}
                onSelect={onSelectFile}
                onCreateFile={onCreateFile}
                onCreateFolder={onCreateFolder}
                onRename={onRename}
                onDeleteFile={onDeleteFile}
                onDeleteFolder={onDeleteFolder}
                onDuplicate={onDuplicateFile}
              />
            </div>
          </>
        ) : (
          <div className="drawer-empty">
            <p className="muted">No project open.</p>
            <button className="btn" onClick={onExit}>
              Your projects
            </button>
          </div>
        )}
      </aside>
    </>
  );
}

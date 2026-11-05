/**
 * Backup: export and import.
 *
 * This is a section of its own rather than two buttons inside "Look", because
 * it is the only thing standing between the user and losing everything. There
 * is no account and no server; a cleared browser profile takes every project
 * with it. The copy says so plainly instead of hiding it in a tooltip.
 */
import { useRef } from 'react';
import type { Project } from '../core/types';
import { exportFileName } from '../core/transfer';
import { DownloadIcon, UploadIcon } from './icons';

interface BackupPanelProps {
  project: Project;
  onExport: () => void;
  onImport: (file: File) => void;
}

export function BackupPanel({ project, onExport, onImport }: BackupPanelProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <section className="settings" id="pane-backup" aria-labelledby="backup-heading">
      <h2 id="backup-heading" className="settings-heading">
        <DownloadIcon size={15} /> Backup
      </h2>

      <p className="muted settings-note">
        Projects live in this browser and nowhere else. There is no account and no server, so
        clearing site data deletes them. Export makes a file you can keep, and import brings one
        back as a new project — it never overwrites what is already here.
      </p>

      <div className="settings-group">
        <div className="settings-label">This project</div>
        <p className="muted settings-note">
          {Object.keys(project.files).length} files, including folders, the stage and the accent.
          Saved as <code>{exportFileName(project.name)}</code>.
        </p>
        <div className="settings-row">
          <button className="btn" onClick={onExport}>
            <DownloadIcon size={14} /> Export
          </button>
          <button className="btn" onClick={() => inputRef.current?.click()}>
            <UploadIcon size={14} /> Import
          </button>
          <input
            ref={inputRef}
            className="visually-hidden"
            type="file"
            accept="application/json,.json"
            aria-label="Import a project file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onImport(file);
              // Reset so choosing the same file twice still fires a change.
              event.target.value = '';
            }}
          />
        </div>
      </div>

      <p className="muted settings-note">
        Importing opens the file as a new project with a new id. Import the same backup twice and
        you get two copies, not one broken one.
      </p>
    </section>
  );
}

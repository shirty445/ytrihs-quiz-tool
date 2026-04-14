import type { FileProcessingStatus } from "@/lib/types";

interface FileStatusListProps {
  statuses: FileProcessingStatus[];
}

export function FileStatusList({ statuses }: FileStatusListProps) {
  if (statuses.length === 0) {
    return <p className="muted">No files selected yet.</p>;
  }

  return (
    <div className="file-list">
      {statuses.map((status) => (
        <article key={status.fileName} className={`file-item status-${status.state}`}>
          <header className="file-header">
            <strong className="file-name">{status.fileName}</strong>
            <span className="file-state">{status.state}</span>
          </header>
          <p className="file-message">{status.message}</p>
          <p className="file-meta">
            Pages: {status.pages} | Chunks: {status.chunks}
          </p>
          {status.warnings.length > 0 ? (
            <ul className="warning-list">
              {status.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
        </article>
      ))}
    </div>
  );
}

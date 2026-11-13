import {
  Database,
  Download,
  HardDrive,
  Loader2,
  Play,
  RotateCcw,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { ConfirmModal } from "./ConfirmModal";
import { Pagination } from "./Pagination";
import { useBackupManagement } from "../hooks/useBackupManagement";

interface BackupManagementProps {
  onMessage: (message: string) => void;
}

export function BackupManagement({ onMessage }: BackupManagementProps) {
  const backup = useBackupManagement(onMessage);

  const confirmCopy = (() => {
    const pending = backup.pendingConfirm;
    if (!pending) return null;
    if (pending.kind === "restore") {
      return {
        title: "Phục hồi cơ sở dữ liệu?",
        description: `Phục hồi dữ liệu từ tệp “${pending.file.name}”. Dữ liệu hiện tại sẽ bị ghi đè hoàn toàn.`,
        confirmLabel: "Phục hồi ngay",
        tone: "warning" as const,
      };
    }
    if (pending.kind === "delete") {
      return {
        title: "Xóa bản sao lưu?",
        description: `Xóa tệp sao lưu “${pending.filename}” khỏi máy chủ.`,
        confirmLabel: "Xóa bản sao",
        tone: "danger" as const,
      };
    }
    return {
      title: "Xóa toàn bộ bản sao lưu?",
      description:
        "Tất cả tệp sao lưu trên máy chủ sẽ bị xóa vĩnh viễn.",
      confirmLabel: "Xóa toàn bộ",
      tone: "danger" as const,
    };
  })();

  return (
    <section className="workspace-section" aria-labelledby="backup-heading">
      <div className="section-heading">
        <div>
          <h1 id="backup-heading">Sao lưu cơ sở dữ liệu</h1>
          <p className="section-lede">
            Tạo, tải xuống và phục hồi dữ liệu theo quyền quản trị.
          </p>
        </div>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => void backup.load()}
          disabled={backup.loading}
        >
          {backup.loading ? (
            <Loader2 size={16} className="spin" />
          ) : (
            <RotateCcw size={16} />
          )}
          Làm mới
        </button>
      </div>

      <div className="backup-layout">
        <aside className="action-panel">
          <div className="panel-title">
            <HardDrive size={17} />
            <h2>Thao tác</h2>
          </div>
          <button
            className="button button-primary button-wide"
            type="button"
            onClick={() => void backup.createBackup()}
            disabled={Boolean(backup.action)}
          >
            {backup.action === "backup" ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <Play size={16} />
            )}
            Tạo bản sao lưu
          </button>
          <label
            className={`button button-secondary button-wide upload-button ${backup.action ? "is-disabled" : ""}`}
          >
            {backup.action === "restore" ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <UploadCloud size={16} />
            )}
            Phục hồi dữ liệu
            <input
              type="file"
              accept=".tar.gz,.gz,application/gzip,application/x-gzip,.sql,text/plain,application/sql"
              onChange={backup.restore}
              disabled={Boolean(backup.action)}
            />
          </label>
          {backup.pagination.total > 0 ? (
            <button
              className="button button-danger button-wide"
              type="button"
              onClick={backup.removeAll}
              disabled={Boolean(backup.action)}
            >
              <Trash2 size={16} /> Xóa toàn bộ
            </button>
          ) : null}
          <p className="panel-note">
            Phiên xác thực nằm trong cookie HTTP-only, tải xuống qua Blob an toàn.
          </p>
        </aside>

        <div className="backup-content">
          <div className="metric-grid metric-grid-three">
            <div className="metric-card tone-blue">
              <span className="metric-label">Tổng bản sao</span>
              <strong>{backup.status?.totalBackups ?? 0}</strong>
            </div>
            <div className="metric-card tone-green">
              <span className="metric-label">Dung lượng</span>
              <strong>{backup.status?.backupSize ?? "0 MB"}</strong>
            </div>
            <div className="metric-card tone-amber">
              <span className="metric-label">Bản mới nhất</span>
              <strong className="metric-small">
                {backup.status?.latestBackup?.replace("framezoo-backup-", "") ||
                  "Chưa có"}
              </strong>
            </div>
          </div>

          <div className="content-panel">
            {backup.error ? (
              <p className="inline-error" role="alert">
                {backup.error}
              </p>
            ) : null}
            {backup.loading && backup.files.length === 0 ? (
              <div className="empty-state">
                <Loader2 size={24} className="spin" />
                <p>Đang tải bản sao lưu…</p>
              </div>
            ) : backup.files.length === 0 ? (
              <div className="empty-state">
                <Database size={28} />
                <strong>Chưa có bản sao lưu</strong>
                <p>Tạo bản đầu tiên từ bảng thao tác.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table backup-table">
                  <thead>
                    <tr>
                      <th>Tên tệp</th>
                      <th>Dung lượng</th>
                      <th>Thời gian tạo</th>
                      <th className="col-actions">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {backup.files.map((file) => (
                      <tr key={file.name}>
                        <td data-label="Tên tệp">
                          <code className="backup-filename">{file.name}</code>
                        </td>
                        <td data-label="Dung lượng">{file.size}</td>
                        <td data-label="Thời gian tạo" className="cell-date">
                          {new Date(file.created).toLocaleString("vi-VN")}
                        </td>
                        <td data-label="Thao tác" className="col-actions">
                          <div className="row-actions">
                            <button
                              className="icon-button"
                              type="button"
                              onClick={() => void backup.download(file)}
                              title="Tải xuống"
                              aria-label={`Tải xuống ${file.name}`}
                            >
                              <Download size={15} />
                            </button>
                            <button
                              className="icon-button danger"
                              type="button"
                              onClick={() => backup.remove(file.name)}
                              disabled={Boolean(backup.action)}
                              title="Xóa"
                              aria-label={`Xóa ${file.name}`}
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Pagination
              pagination={backup.pagination}
              label="bản sao"
              busy={backup.loading}
              onPageChange={backup.setPage}
              onLimitChange={backup.setLimit}
            />
          </div>
        </div>
      </div>

      <ConfirmModal
        open={Boolean(confirmCopy)}
        title={confirmCopy?.title || ""}
        description={confirmCopy?.description || ""}
        confirmLabel={confirmCopy?.confirmLabel || "Xác nhận"}
        tone={confirmCopy?.tone || "danger"}
        busy={backup.action === "delete" || backup.action === "restore"}
        onConfirm={() => void backup.confirmPending()}
        onCancel={() => backup.setPendingConfirm(null)}
      />
    </section>
  );
}

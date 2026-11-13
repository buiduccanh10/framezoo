import { useCallback, useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import { adminApi, getApiError, type BackupFile, type BackupStatus } from "../lib/api";
import type { ListPagination } from "../types";

const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;
const EMPTY_PAGINATION: ListPagination = { page: 1, limit: 10, total: 0, totalPages: 1 };

type PendingBackupAction =
  | { kind: "restore"; file: File }
  | { kind: "delete"; filename: string }
  | { kind: "delete-all" }
  | null;

export function useBackupManagement(onMessage: (message: string) => void) {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [files, setFiles] = useState<BackupFile[]>([]);
  const [pagination, setPagination] = useState(EMPTY_PAGINATION);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<"backup" | "restore" | "delete" | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingBackupAction>(null);
  const [error, setError] = useState("");

  const load = useCallback(async (targetPage = page, targetLimit = limit) => {
    setLoading(true);
    setError("");
    try {
      const [nextStatus, nextFiles] = await Promise.all([
        adminApi.getBackupStatus(),
        adminApi.getBackupFiles(targetPage, targetLimit),
      ]);
      setStatus(nextStatus);
      setFiles(nextFiles.files);
      setPagination(nextFiles.pagination);
      if (nextFiles.pagination.total > 0 && targetPage > nextFiles.pagination.totalPages) {
        setPage(nextFiles.pagination.totalPages);
      }
    } catch (requestError) {
      setError(getApiError(requestError, "Không thể tải dữ liệu sao lưu."));
    } finally {
      setLoading(false);
    }
  }, [limit, page]);

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void load(page, limit);
  }, [limit, load, page]);

  const setLimitAndReset = (value: number) => {
    setLimit(value);
    setPage(1);
  };

  const createBackup = async () => {
    setAction("backup");
    try {
      const result = await adminApi.triggerBackup();
      onMessage(result.message || "Đã tạo bản sao lưu.");
      await load(page, limit);
    } catch (requestError) {
      onMessage(getApiError(requestError, "Không thể tạo bản sao lưu."));
    } finally { setAction(null); }
  };

  const restore = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      onMessage("Tệp phục hồi vượt quá giới hạn 512 MB.");
      return;
    }
    setPendingConfirm({ kind: "restore", file });
  };

  const download = async (file: BackupFile) => {
    try {
      const blob = await adminApi.downloadBackup(file.name);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.name;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      onMessage(getApiError(requestError, "Không thể tải bản sao lưu."));
    }
  };

  const remove = (filename: string) => {
    setPendingConfirm({ kind: "delete", filename });
  };

  const removeAll = () => {
    setPendingConfirm({ kind: "delete-all" });
  };

  const confirmPending = async () => {
    if (!pendingConfirm) return;
    const current = pendingConfirm;

    if (current.kind === "restore") {
      setAction("restore");
      try {
        const result = await adminApi.restoreBackup(current.file);
        onMessage(result.message || "Đã phục hồi cơ sở dữ liệu.");
        setPendingConfirm(null);
        await load(page, limit);
      } catch (requestError) {
        onMessage(getApiError(requestError, "Không thể phục hồi cơ sở dữ liệu."));
      } finally {
        setAction(null);
      }
      return;
    }

    setAction("delete");
    try {
      if (current.kind === "delete") {
        const result = await adminApi.deleteBackup(current.filename);
        onMessage(result.message || "Đã xóa bản sao lưu.");
        setPendingConfirm(null);
        await load(page, limit);
      } else {
        const result = await adminApi.deleteAllBackups();
        onMessage(result.message || "Đã xóa toàn bộ bản sao lưu.");
        setPendingConfirm(null);
        if (page === 1) await load(1, limit);
        else setPage(1);
      }
    } catch (requestError) {
      onMessage(getApiError(requestError, "Không thể xóa bản sao lưu."));
    } finally {
      setAction(null);
    }
  };

  return {
    status,
    files,
    pagination,
    page,
    limit,
    setPage,
    setLimit: setLimitAndReset,
    loading,
    action,
    pendingConfirm,
    setPendingConfirm,
    confirmPending,
    error,
    load,
    createBackup,
    restore,
    download,
    remove,
    removeAll,
  };
}

import { useCallback, useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import { adminApi, getApiError, type BackupFile, type BackupStatus } from "../lib/api";
import type { ListPagination } from "../types";

const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;
const EMPTY_PAGINATION: ListPagination = { page: 1, limit: 20, total: 0, totalPages: 1 };

export function useBackupManagement(onMessage: (message: string) => void) {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [files, setFiles] = useState<BackupFile[]>([]);
  const [pagination, setPagination] = useState(EMPTY_PAGINATION);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<"backup" | "restore" | "delete" | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async (targetPage = page) => {
    setLoading(true);
    setError("");
    try {
      const [nextStatus, nextFiles] = await Promise.all([
        adminApi.getBackupStatus(),
        adminApi.getBackupFiles(targetPage, pagination.limit),
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
  }, [page, pagination.limit]);

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void load(page);
  }, [load, page]);

  const createBackup = async () => {
    setAction("backup");
    try {
      const result = await adminApi.triggerBackup();
      onMessage(result.message || "Đã tạo bản sao lưu.");
      await load(page);
    } catch (requestError) {
      onMessage(getApiError(requestError, "Không thể tạo bản sao lưu."));
    } finally { setAction(null); }
  };

  const restore = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      onMessage("Tệp phục hồi vượt quá giới hạn 512 MB.");
      return;
    }
    if (!window.confirm(`Phục hồi dữ liệu từ “${file.name}”? Dữ liệu hiện tại sẽ bị ghi đè.`)) return;
    setAction("restore");
    try {
      const result = await adminApi.restoreBackup(file);
      onMessage(result.message || "Đã phục hồi cơ sở dữ liệu.");
      await load(page);
    } catch (requestError) {
      onMessage(getApiError(requestError, "Không thể phục hồi cơ sở dữ liệu."));
    } finally { setAction(null); }
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

  const remove = async (filename: string) => {
    if (!window.confirm(`Xóa bản sao lưu “${filename}”?`)) return;
    setAction("delete");
    try {
      const result = await adminApi.deleteBackup(filename);
      onMessage(result.message || "Đã xóa bản sao lưu.");
      await load(page);
    } catch (requestError) {
      onMessage(getApiError(requestError, "Không thể xóa bản sao lưu."));
    } finally { setAction(null); }
  };

  const removeAll = async () => {
    if (!window.confirm("Xóa toàn bộ bản sao lưu? Hành động này không thể hoàn tác.")) return;
    setAction("delete");
    try {
      const result = await adminApi.deleteAllBackups();
      onMessage(result.message || "Đã xóa toàn bộ bản sao lưu.");
      if (page === 1) await load(1);
      else setPage(1);
    } catch (requestError) {
      onMessage(getApiError(requestError, "Không thể xóa bản sao lưu."));
    } finally { setAction(null); }
  };

  return { status, files, pagination, page, setPage, loading, action, error, load, createBackup, restore, download, remove, removeAll };
}

import { useCallback, useEffect, useState } from "react";
import { adminApi, getApiError } from "../lib/api";
import type { FeedbackItem, ListPagination } from "../types";

type FeedbackFilter = "all" | "pending" | "resolved";

const EMPTY_PAGINATION: ListPagination = {
  page: 1,
  limit: 20,
  total: 0,
  totalPages: 1,
};

export function useFeedbackManagement(
  onMessage: (message: string) => void,
  onPendingChange: (count: number) => void,
) {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [pagination, setPagination] = useState(EMPTY_PAGINATION);
  const [stats, setStats] = useState({ total: 0, pending: 0, resolved: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FeedbackFilter>("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<FeedbackItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(
    async (targetPage = page, targetSearch = search, targetFilter = filter) => {
      setLoading(true);
      setError("");
      try {
        const result = await adminApi.listFeedback(
          targetPage,
          pagination.limit,
          targetSearch,
          targetFilter,
        );
        setItems(result.items);
        setPagination(result.pagination);
        if (
          result.pagination.total > 0 &&
          targetPage > result.pagination.totalPages
        ) {
          setPage(result.pagination.totalPages);
        }
        setStats(result.stats);
        onPendingChange(result.stats.pending);
      } catch (requestError) {
        setError(
          getApiError(requestError, "Không thể tải danh sách phản hồi."),
        );
      } finally {
        setLoading(false);
      }
    },
    [filter, onPendingChange, page, pagination.limit, search],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void load(page, search, filter), 220);
    return () => window.clearTimeout(timer);
  }, [filter, load, page, search]);

  const setSearchAndReset = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const setFilterAndReset = (value: FeedbackFilter) => {
    setFilter(value);
    setPage(1);
  };

  const updateStatus = async (item: FeedbackItem) => {
    const nextStatus = item.status === "pending" ? "resolved" : "pending";
    setBusyId(item.id);
    try {
      const updated = await adminApi.updateFeedback(item.id, nextStatus);
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id ? { ...entry, ...updated } : entry,
        ),
      );
      setSelected((current) =>
        current?.id === item.id ? { ...current, ...updated } : current,
      );
      onMessage(
        nextStatus === "resolved"
          ? "Đã đánh dấu feedback đã xử lý."
          : "Đã đưa feedback về đang xử lý.",
      );
      void load(page, search, filter);
    } catch (requestError) {
      onMessage(getApiError(requestError, "Không thể cập nhật feedback."));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (item: FeedbackItem) => {
    if (
      !window.confirm(
        `Xóa feedback “${item.title}” và toàn bộ files đính kèm? Hành động này không thể hoàn tác.`,
      )
    )
      return;
    setBusyId(item.id);
    try {
      await adminApi.deleteFeedback(item.id);
      setSelected(null);
      onMessage("Đã xóa feedback.");
      void load(page, search, filter);
    } catch (requestError) {
      onMessage(getApiError(requestError, "Không thể xóa feedback."));
    } finally {
      setBusyId(null);
    }
  };

  return {
    items,
    pagination,
    stats,
    loading,
    search,
    filter,
    page,
    selected,
    busyId,
    error,
    setSearch: setSearchAndReset,
    setFilter: setFilterAndReset,
    setPage,
    setSelected,
    load,
    updateStatus,
    remove,
  };
}

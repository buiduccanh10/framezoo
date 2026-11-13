import { useCallback, useEffect, useState } from "react";
import { adminApi, getApiError } from "../lib/api";
import type { FeedbackItem, ListPagination } from "../types";

type FeedbackFilter = "all" | "pending" | "resolved";

const EMPTY_PAGINATION: ListPagination = {
  page: 1,
  limit: 10,
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
  const [limit, setLimit] = useState(10);
  const [selected, setSelected] = useState<FeedbackItem | null>(null);
  const [itemToDelete, setItemToDelete] = useState<FeedbackItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(
    async (
      targetPage = page,
      targetSearch = search,
      targetFilter = filter,
      targetLimit = limit,
    ) => {
      setLoading(true);
      setError("");
      try {
        const result = await adminApi.listFeedback(
          targetPage,
          targetLimit,
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
    [filter, limit, onPendingChange, page, search],
  );

  useEffect(() => {
    const timer = window.setTimeout(
      () => void load(page, search, filter, limit),
      search ? 220 : 0,
    );
    return () => window.clearTimeout(timer);
  }, [filter, limit, load, page, search]);

  const setSearchAndReset = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const setFilterAndReset = (value: FeedbackFilter) => {
    setFilter(value);
    setPage(1);
  };

  const setLimitAndReset = (value: number) => {
    setLimit(value);
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
      void load(page, search, filter, limit);
    } catch (requestError) {
      onMessage(getApiError(requestError, "Không thể cập nhật feedback."));
    } finally {
      setBusyId(null);
    }
  };

  const confirmRemove = async () => {
    if (!itemToDelete) return;
    const item = itemToDelete;
    setBusyId(item.id);
    try {
      await adminApi.deleteFeedback(item.id);
      setItemToDelete(null);
      setSelected((current) => (current?.id === item.id ? null : current));
      onMessage("Đã xóa feedback.");
      void load(page, search, filter, limit);
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
    limit,
    selected,
    itemToDelete,
    busyId,
    error,
    setSearch: setSearchAndReset,
    setFilter: setFilterAndReset,
    setPage,
    setLimit: setLimitAndReset,
    setSelected,
    setItemToDelete,
    load,
    updateStatus,
    confirmRemove,
  };
}

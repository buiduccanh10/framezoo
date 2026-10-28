import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ListPagination, UserPagination } from "../types";

interface PaginationProps {
  pagination: ListPagination | UserPagination;
  label: string;
  busy?: boolean;
  onPageChange: (page: number) => void;
  onLimitChange?: (limit: number) => void;
  limitOptions?: number[];
}

export function Pagination({
  pagination,
  label,
  busy = false,
  onPageChange,
  onLimitChange,
  limitOptions = [10, 20, 50],
}: PaginationProps) {
  if (pagination.total === 0) return null;
  if (!onLimitChange && pagination.totalPages <= 1) return null;

  return (
    <nav className="pagination" aria-label={`Phân trang ${label}`}>
      <div className="pagination-info">
        <p>
          Trang <strong>{pagination.page}</strong> / {pagination.totalPages} ·{" "}
          {pagination.total} {label}
        </p>
        {onLimitChange ? (
          <label className="pagination-limit">
            <span>Hiển thị</span>
            <select
              value={pagination.limit}
              onChange={(e) => onLimitChange(Number(e.target.value))}
              disabled={busy}
              aria-label={`Số ${label} mỗi trang`}
            >
              {limitOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt} / trang
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <div className="pagination-actions">
        <button
          className="button button-secondary"
          type="button"
          onClick={() => onPageChange(Math.max(1, pagination.page - 1))}
          disabled={busy || pagination.page <= 1}
        >
          <ChevronLeft size={15} aria-hidden="true" /> Trước
        </button>
        <button
          className="button button-secondary"
          type="button"
          onClick={() =>
            onPageChange(Math.min(pagination.totalPages, pagination.page + 1))
          }
          disabled={busy || pagination.page >= pagination.totalPages}
        >
          Sau <ChevronRight size={15} aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}

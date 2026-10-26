import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ListPagination } from "../types";

interface PaginationProps {
  pagination: ListPagination;
  label: string;
  busy?: boolean;
  onPageChange: (page: number) => void;
}

export function Pagination({ pagination, label, busy = false, onPageChange }: PaginationProps) {
  if (pagination.totalPages <= 1) return null;

  return (
    <nav className="pagination" aria-label={`Phân trang ${label}`}>
      <p>
        Trang <strong>{pagination.page}</strong> / {pagination.totalPages} · {pagination.total} {label}
      </p>
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
          onClick={() => onPageChange(Math.min(pagination.totalPages, pagination.page + 1))}
          disabled={busy || pagination.page >= pagination.totalPages}
        >
          Sau <ChevronRight size={15} aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}

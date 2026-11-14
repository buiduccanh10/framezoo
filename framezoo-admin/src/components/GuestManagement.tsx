import {
  Activity,
  Calendar,
  Check,
  Clock,
  Compass,
  Copy,
  Loader2,
  RotateCcw,
  Search,
  Smartphone,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Pagination } from "./Pagination";
import { VersionBadge } from "./VersionBadge";
import type { adminApi } from "../lib/api";
import { formatDateTime, formatRelativeTime, shortId } from "../lib/format";
import type {
  GuestItem,
  GuestPlatformFilter,
  GuestStats,
  GuestWindow,
  ListPagination,
} from "../types";

interface GuestManagementProps {
  api: typeof adminApi;
  showMessage: (message: string) => void;
  onStatsUpdate?: (active24h: number) => void;
}

const EMPTY_STATS: GuestStats = {
  counts: { h6: 0, h24: 0, d7: 0, d30: 0 },
  platforms: [],
  versions: [],
};

const EMPTY_PAGINATION: ListPagination = {
  page: 1,
  limit: 10,
  total: 0,
  totalPages: 1,
};

const WINDOW_CARDS: Array<{
  id: GuestWindow;
  label: string;
  tone: "blue" | "green" | "amber" | "red";
  icon: typeof Clock;
  read: (counts: GuestStats["counts"]) => number;
}> = [
  {
    id: "6h",
    label: "6 giờ gần nhất",
    tone: "blue",
    icon: Clock,
    read: (counts) => counts.h6,
  },
  {
    id: "24h",
    label: "24 giờ gần nhất",
    tone: "green",
    icon: Activity,
    read: (counts) => counts.h24,
  },
  {
    id: "7d",
    label: "7 ngày gần nhất",
    tone: "amber",
    icon: Calendar,
    read: (counts) => counts.d7,
  },
  {
    id: "30d",
    label: "30 ngày gần nhất",
    tone: "red",
    icon: Compass,
    read: (counts) => counts.d30,
  },
];

export function GuestManagement({
  api,
  showMessage,
  onStatsUpdate,
}: GuestManagementProps) {
  const [guests, setGuests] = useState<GuestItem[]>([]);
  const [stats, setStats] = useState<GuestStats>(EMPTY_STATS);
  const [pagination, setPagination] =
    useState<ListPagination>(EMPTY_PAGINATION);
  const [loading, setLoading] = useState(false);
  const [windowFilter, setWindowFilter] = useState<GuestWindow>("24h");
  const [platformFilter, setPlatformFilter] =
    useState<GuestPlatformFilter>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("last_seen_desc");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadGuests = useCallback(
    async (
      targetWindow = windowFilter,
      targetPage = page,
      targetSearch = search,
      targetSort = sort,
      targetLimit = limit,
      targetPlatform = platformFilter,
    ) => {
      setLoading(true);
      try {
        const data = await api.listGuests({
          window: targetWindow,
          page: targetPage,
          limit: targetLimit,
          search: targetSearch,
          sort: targetSort,
          platform: targetPlatform,
        });
        setGuests(data.items || []);
        setPagination(
          data.pagination || {
            ...EMPTY_PAGINATION,
            page: targetPage,
            limit: targetLimit,
          },
        );
        if (
          data.pagination?.total > 0 &&
          targetPage > data.pagination.totalPages
        ) {
          setPage(data.pagination.totalPages);
          return;
        }
        setStats(data.stats || EMPTY_STATS);
        onStatsUpdate?.(data.stats?.counts?.h24 ?? 0);
      } catch {
        showMessage("Không thể tải danh sách người dùng khách.");
      } finally {
        setLoading(false);
      }
    },
    [
      api,
      limit,
      onStatsUpdate,
      page,
      platformFilter,
      search,
      showMessage,
      sort,
      windowFilter,
    ],
  );

  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        void loadGuests(
          windowFilter,
          page,
          search,
          sort,
          limit,
          platformFilter,
        ),
      search ? 220 : 0,
    );
    return () => window.clearTimeout(timer);
  }, [limit, loadGuests, page, platformFilter, search, sort, windowFilter]);

  const handleWindowChange = (nextWindow: GuestWindow) => {
    setWindowFilter(nextWindow);
    setPage(1);
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const handlePlatformChange = (value: GuestPlatformFilter) => {
    setPlatformFilter(value);
    setPage(1);
  };

  const handleSortChange = (value: string) => {
    setSort(value);
    setPage(1);
  };

  const handleLimitChange = (value: number) => {
    setLimit(value);
    setPage(1);
  };

  const copyGuestId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      showMessage("Đã sao chép Guest ID");
      window.setTimeout(() => setCopiedId(null), 2000);
    } catch {
      showMessage("Không thể sao chép vào clipboard");
    }
  };

  const activeWindowLabel =
    WINDOW_CARDS.find((item) => item.id === windowFilter)?.label ??
    "24 giờ gần nhất";

  return (
    <section className="workspace-section" aria-labelledby="guests-heading">
      <div className="section-heading">
        <div>
          <h1 id="guests-heading">Người dùng khách</h1>
          <p className="section-lede">
            Thiết bị unique đang dùng app ở chế độ chưa đăng nhập (
            {activeWindowLabel}).
          </p>
        </div>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => void loadGuests()}
          disabled={loading}
        >
          {loading ? (
            <Loader2 size={16} className="spin" />
          ) : (
            <RotateCcw size={16} />
          )}
          Làm mới
        </button>
      </div>

      <div
        className="metric-grid metric-grid-four"
        role="group"
        aria-label="Khoảng thời gian khách hoạt động"
      >
        {WINDOW_CARDS.map((card) => {
          const Icon = card.icon;
          const isSelected = windowFilter === card.id;
          return (
            <button
              key={card.id}
              type="button"
              className={`metric-card is-interactive tone-${card.tone} ${
                isSelected ? "is-active" : ""
              }`}
              aria-pressed={isSelected}
              onClick={() => handleWindowChange(card.id)}
            >
              <span className="metric-label">
                <Icon size={16} aria-hidden="true" />
                {card.label}
              </span>
              <strong>{card.read(stats.counts).toLocaleString("vi-VN")}</strong>
            </button>
          );
        })}
      </div>

      {stats.versions.length > 0 || stats.platforms.length > 0 ? (
        <div className="guest-breakdown-row">
          {stats.versions.length > 0 ? (
            <div className="guest-breakdown-group">
              <span className="guest-breakdown-label">Phiên bản:</span>
              {stats.versions.map((item) => (
                <button
                  key={item.version || "__unknown"}
                  type="button"
                  className="guest-chip-button"
                  onClick={() =>
                    item.version ? handleSearchChange(item.version) : undefined
                  }
                  disabled={!item.version}
                  title={
                    item.version
                      ? `Lọc theo phiên bản ${item.version}`
                      : undefined
                  }
                >
                  <VersionBadge version={item.version} />
                  <span className="guest-chip-count">{item.count}</span>
                </button>
              ))}
            </div>
          ) : null}

          {stats.platforms.length > 0 ? (
            <div className="guest-breakdown-group">
              <span className="guest-breakdown-label">Nền tảng:</span>
              {stats.platforms.map((item) => (
                <span key={item.platform} className="platform-chip">
                  {item.platform} <strong>{item.count}</strong>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="toolbar">
        <label className="search-field">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Tìm người dùng khách</span>
          <input
            value={search}
            onChange={(event) => handleSearchChange(event.target.value)}
            placeholder="Tìm Guest ID, phiên bản hoặc nền tảng…"
          />
          {search ? (
            <button
              className="clear-search"
              type="button"
              onClick={() => handleSearchChange("")}
              aria-label="Xóa tìm kiếm"
            >
              <X size={15} />
            </button>
          ) : null}
        </label>

        <div className="guest-toolbar-controls">
          <label className="sort-field">
            <span>Nền tảng</span>
            <select
              value={platformFilter}
              onChange={(event) =>
                handlePlatformChange(event.target.value as GuestPlatformFilter)
              }
            >
              <option value="all">Tất cả</option>
              <option value="Desktop">Desktop</option>
              <option value="Mobile">Mobile</option>
              <option value="TV">TV</option>
            </select>
          </label>

          <label className="sort-field">
            <span>Sắp xếp</span>
            <select
              value={sort}
              onChange={(event) => handleSortChange(event.target.value)}
            >
              <option value="last_seen_desc">Hoạt động gần nhất</option>
              <option value="last_seen_asc">Hoạt động xa nhất</option>
              <option value="first_seen_desc">Mới xuất hiện</option>
              <option value="requests_desc">Nhiều lượt nhất</option>
              <option value="version_desc">Phiên bản cao → thấp</option>
              <option value="version_asc">Phiên bản thấp → cao</option>
            </select>
          </label>
        </div>
      </div>

      <div className="content-panel">
        {loading && guests.length === 0 ? (
          <div className="empty-state">
            <Loader2 size={24} className="spin" />
            <p>Đang tải danh sách khách…</p>
          </div>
        ) : guests.length === 0 ? (
          <div className="empty-state">
            <Smartphone size={28} />
            <strong>
              {search || platformFilter !== "all"
                ? "Không tìm thấy người dùng khách phù hợp"
                : `Chưa có người dùng khách trong ${activeWindowLabel.toLowerCase()}`}
            </strong>
            <p>
              {search || platformFilter !== "all"
                ? "Thử đổi từ khóa, nền tảng hoặc mở rộng khoảng thời gian."
                : "Thiết bị đang mở app chưa đăng nhập sẽ xuất hiện tại đây."}
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Guest ID</th>
                  <th>Nền tảng</th>
                  <th>Phiên bản</th>
                  <th>Lượt hoạt động</th>
                  <th>Hoạt động cuối</th>
                  <th>Lần đầu thấy</th>
                </tr>
              </thead>
              <tbody>
                {guests.map((guest) => (
                  <tr key={guest.id}>
                    <td data-label="Guest ID">
                      <div className="user-id">
                        <code>{shortId(guest.id)}</code>
                        <button
                          type="button"
                          onClick={() => void copyGuestId(guest.id)}
                          title="Sao chép Guest ID"
                          aria-label="Sao chép Guest ID"
                        >
                          {copiedId === guest.id ? (
                            <Check size={12} />
                          ) : (
                            <Copy size={12} />
                          )}
                        </button>
                      </div>
                    </td>
                    <td data-label="Nền tảng">
                      <span className="platform-chip">{guest.platform}</span>
                    </td>
                    <td data-label="Phiên bản">
                      <VersionBadge version={guest.app_version} />
                    </td>
                    <td data-label="Lượt hoạt động">
                      <span className="count-pill">
                        <Activity size={13} aria-hidden="true" />
                        {guest.request_count.toLocaleString("vi-VN")}
                      </span>
                    </td>
                    <td data-label="Hoạt động cuối" className="cell-date">
                      <div>{formatDateTime(guest.last_seen_at)}</div>
                      <small className="muted-label">
                        {formatRelativeTime(guest.last_seen_at)}
                      </small>
                    </td>
                    <td data-label="Lần đầu thấy" className="cell-date">
                      {formatDateTime(guest.first_seen_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination
          pagination={pagination}
          label="khách"
          busy={loading}
          onPageChange={setPage}
          onLimitChange={handleLimitChange}
        />
      </div>
    </section>
  );
}

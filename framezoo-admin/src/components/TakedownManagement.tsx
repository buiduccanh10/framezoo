import { Ban, Check, Loader2, Plus, RotateCcw, Search, ShieldOff, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { adminApi, getApiError } from "../lib/api";
import type { TakedownRuleItem, TakedownTargetType } from "../types";
import { ConfirmModal } from "./ConfirmModal";

interface TakedownManagementProps {
  onMessage: (message: string) => void;
  onActiveCountChange?: (count: number) => void;
  prefill?: {
    targetType: TakedownTargetType;
    pattern: string;
    reason: string;
    rightsHolder?: string;
    referenceId?: string;
  } | null;
}

const TARGET_TYPE_LABELS: Record<TakedownTargetType, string> = {
  addon_domain: "Miền Addon (domain)",
  tmdb_id: "TMDB ID",
  imdb_id: "IMDb ID (tt...)",
  subtitle_id: "ID Phụ đề",
  infohash: "Torrent Infohash",
};

export function TakedownManagement({
  onMessage,
  onActiveCountChange,
  prefill,
}: TakedownManagementProps) {
  const [rules, setRules] = useState<TakedownRuleItem[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "true" | "false">("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [ruleToDelete, setRuleToDelete] = useState<TakedownRuleItem | null>(null);

  const [targetType, setTargetType] = useState<TakedownTargetType>(
    prefill?.targetType || "addon_domain",
  );
  const [pattern, setPattern] = useState(prefill?.pattern || "");
  const [reason, setReason] = useState(prefill?.reason || "");
  const [rightsHolder, setRightsHolder] = useState(prefill?.rightsHolder || "");
  const [referenceId, setReferenceId] = useState(prefill?.referenceId || "");
  const [creating, setCreating] = useState(false);

  const loadRules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.listTakedowns({
        targetType: typeFilter,
        active: statusFilter,
        search,
      });
      setRules(res.rules || []);
      const count = res.stats?.active ?? 0;
      setActiveCount(count);
      onActiveCountChange?.(count);
    } catch (error) {
      onMessage(getApiError(error, "Không thể tải danh sách takedown rules."));
    } finally {
      setLoading(false);
    }
  }, [typeFilter, statusFilter, search, onMessage, onActiveCountChange]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadRules(), search ? 200 : 0);
    return () => window.clearTimeout(timer);
  }, [loadRules, search]);

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!pattern.trim() || !reason.trim()) return;
    setCreating(true);
    try {
      await adminApi.createTakedown({
        targetType,
        pattern: pattern.trim(),
        reason: reason.trim(),
        rightsHolder: rightsHolder.trim() || null,
        referenceId: referenceId.trim() || null,
        active: true,
      });
      setPattern("");
      setReason("");
      setRightsHolder("");
      setReferenceId("");
      onMessage("Đã thêm quy tắc gỡ bỏ (Notice & Takedown).");
      await loadRules();
    } catch (error) {
      onMessage(getApiError(error, "Không thể tạo quy tắc gỡ bỏ."));
    } finally {
      setCreating(false);
    }
  };

  const toggleRule = async (rule: TakedownRuleItem) => {
    setBusyId(rule.id);
    try {
      await adminApi.updateTakedown(rule.id, { active: !rule.active });
      onMessage(rule.active ? "Đã tạm tắt quy tắc chặn." : "Đã bật lại quy tắc chặn.");
      await loadRules();
    } catch (error) {
      onMessage(getApiError(error, "Không thể cập nhật quy tắc."));
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    if (!ruleToDelete) return;
    setBusyId(ruleToDelete.id);
    try {
      await adminApi.deleteTakedown(ruleToDelete.id);
      setRuleToDelete(null);
      onMessage("Đã xóa quy tắc chặn.");
      await loadRules();
    } catch (error) {
      onMessage(getApiError(error, "Không thể xóa quy tắc."));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="workspace-section" aria-labelledby="takedowns-heading">
      <div className="section-heading">
        <div>
          <h1 id="takedowns-heading">Gỡ bỏ vi phạm (Notice &amp; Takedown)</h1>
          <p className="section-lede">
            Quản lý blocklist miền addon, nội dung hoặc phụ đề bị yêu cầu gỡ bỏ theo Điều 198b Luật SHTT &amp; NĐ 17/2023.
          </p>
        </div>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => void loadRules()}
          disabled={loading}
        >
          {loading ? <Loader2 size={16} className="spin" /> : <RotateCcw size={16} />}
          Làm mới
        </button>
      </div>

      <div className="metric-grid metric-grid-three">
        <div className="metric-card tone-red">
          <span className="metric-label">Quy tắc đang hiệu lực</span>
          <strong>{activeCount.toLocaleString("vi-VN")}</strong>
        </div>
        <div className="metric-card tone-blue">
          <span className="metric-label">Tổng kết quả hiển thị</span>
          <strong>{rules.length.toLocaleString("vi-VN")}</strong>
        </div>
        <div className="metric-card tone-amber">
          <span className="metric-label">Cam kết SLA</span>
          <strong>24h / 72h</strong>
        </div>
      </div>

      <div className="content-panel" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: "0.95rem", fontWeight: 600, marginBottom: 12 }}>
          Thêm quy tắc chặn mới
        </h2>
        <form className="form-stack" onSubmit={handleCreate}>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))" }}>
            <label>
              Loại đối tượng
              <select
                value={targetType}
                onChange={(e) => setTargetType(e.target.value as TakedownTargetType)}
              >
                {(Object.entries(TARGET_TYPE_LABELS) as [TakedownTargetType, string][]).map(
                  ([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label>
              Giá trị chặn (Domain / ID / Infohash)
              <input
                required
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                placeholder="vd: bad-addon.example.com hoặc tt0137523"
              />
            </label>
            <label>
              Chủ thể quyền / Cơ quan yêu cầu
              <input
                value={rightsHolder}
                onChange={(e) => setRightsHolder(e.target.value)}
                placeholder="Tùy chọn"
              />
            </label>
            <label>
              Mã hồ sơ / Số công văn
              <input
                value={referenceId}
                onChange={(e) => setReferenceId(e.target.value)}
                placeholder="vd: DMCA-2026-001"
              />
            </label>
          </div>
          <label>
            Lý do gỡ bỏ / Căn cứ pháp lý
            <input
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Mô tả căn cứ yêu cầu gỡ bỏ để lưu nhật ký kiểm toán"
            />
          </label>
          <div>
            <button
              className="button button-primary"
              type="submit"
              disabled={creating || !pattern.trim() || !reason.trim()}
            >
              {creating ? <Loader2 size={15} className="spin" /> : <Plus size={15} />}
              Thêm vào blocklist
            </button>
          </div>
        </form>
      </div>

      <div className="toolbar">
        <label className="search-field">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Tìm quy tắc takedown</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm domain, ID, chủ thể quyền…"
          />
          {search ? (
            <button
              className="clear-search"
              type="button"
              onClick={() => setSearch("")}
              aria-label="Xóa tìm kiếm"
            >
              <X size={15} />
            </button>
          ) : null}
        </label>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          aria-label="Lọc theo loại đối tượng"
        >
          <option value="all">Tất cả loại</option>
          {(Object.entries(TARGET_TYPE_LABELS) as [TakedownTargetType, string][]).map(
            ([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ),
          )}
        </select>

        <div className="segmented" role="group" aria-label="Trạng thái quy tắc">
          {(
            [
              ["all", "Tất cả"],
              ["true", "Đang chặn"],
              ["false", "Tạm tắt"],
            ] as const
          ).map(([val, label]) => (
            <button
              key={val}
              className={statusFilter === val ? "is-active" : ""}
              type="button"
              onClick={() => setStatusFilter(val)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="content-panel">
        {loading && rules.length === 0 ? (
          <div className="empty-state">
            <Loader2 size={24} className="spin" />
            <p>Đang tải danh sách takedown…</p>
          </div>
        ) : rules.length === 0 ? (
          <div className="empty-state">
            <ShieldOff size={28} />
            <strong>Chưa có quy tắc chặn nào phù hợp</strong>
            <p>Blocklist công khai tại /compliance/blocklist hiện không chặn mục nào khớp bộ lọc.</p>
          </div>
        ) : (
          <div className="feedback-list">
            {rules.map((rule) => (
              <article key={rule.id} className="feedback-row">
                <div className="feedback-main">
                  <div className="feedback-title-row">
                    <h2>
                      <code>{rule.pattern}</code>
                    </h2>
                    <span
                      className={`status-badge ${rule.active ? "status-pending" : "status-resolved"}`}
                    >
                      {rule.active ? (
                        <>
                          <Ban size={12} /> Đang chặn
                        </>
                      ) : (
                        <>
                          <Check size={12} /> Đã tắt
                        </>
                      )}
                    </span>
                    <span className="person-chip">
                      {TARGET_TYPE_LABELS[rule.target_type as TakedownTargetType] || rule.target_type}
                    </span>
                    {rule.rights_holder ? (
                      <span className="person-chip">{rule.rights_holder}</span>
                    ) : null}
                    {rule.reference_id ? (
                      <span className="person-chip">HS: {rule.reference_id}</span>
                    ) : null}
                  </div>
                  <p className="feedback-excerpt">{rule.reason}</p>
                  <time dateTime={rule.created_at}>
                    {new Date(rule.created_at).toLocaleString("vi-VN")}
                    {rule.created_by ? ` · bởi ${rule.created_by}` : ""}
                  </time>
                </div>
                <div className="row-actions">
                  <button
                    className="button button-secondary button-sm"
                    type="button"
                    disabled={busyId === rule.id}
                    onClick={() => void toggleRule(rule)}
                  >
                    {rule.active ? "Tạm tắt" : "Kích hoạt"}
                  </button>
                  <button
                    className="icon-button danger"
                    type="button"
                    disabled={busyId === rule.id}
                    onClick={() => setRuleToDelete(rule)}
                    aria-label={`Xóa quy tắc ${rule.pattern}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <ConfirmModal
        open={Boolean(ruleToDelete)}
        title="Xóa quy tắc gỡ bỏ?"
        description={
          ruleToDelete
            ? `Xóa vĩnh viễn quy tắc chặn “${ruleToDelete.pattern}” khỏi hệ thống?`
            : ""
        }
        confirmLabel="Xóa quy tắc"
        tone="danger"
        busy={Boolean(ruleToDelete) && busyId === ruleToDelete?.id}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setRuleToDelete(null)}
      />
    </section>
  );
}

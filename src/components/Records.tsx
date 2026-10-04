import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  Search,
  Download,
  ArrowUpRight,
  WifiOff,
  CloudUpload,
  Trash2,
  CheckCircle2,
  ClipboardList,
  MapPin,
} from "lucide-react";
import {
  useData,
  kindMeta,
  statuses,
  label,
  dateLabel,
  fmt,
  canWrite,
  downloadReport,
  queueReports,
  api,
  deleteQueue,
  refresh,
  type QueuedReport,
} from "../lib";
import { Badge, PageHeading, Loading, ErrorBox, Empty, Modal } from "./UI";
import type { Entry, Kind, Mine, User } from "../types";
export function Records({
  kind,
  mine,
  mines,
  user,
  onCreate,
  onOpen,
  toast,
}: {
  kind: Kind;
  mine: string;
  mines: Mine[];
  user: User;
  onCreate: (k: Kind) => void;
  onOpen: (r: Entry) => void;
  toast: (s: string) => void;
}) {
  const { data, error, loading, reload } = useData<Entry[]>(
    `/records/${kind}?mine=${mine}`,
  );
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState("all"),
    [priority, setPriority] = useState("all"),
    [page, setPage] = useState(1);
  const meta = kindMeta[kind];
  useEffect(() => {
    setQuery("");
    setStatus("all");
    setPriority("all");
    setPage(1);
  }, [kind, mine]);
  const rows = (data || []).filter(
    (r) =>
      (status === "all" || r.status === status) &&
      (priority === "all" || r.priority === priority) &&
      `${r.title} ${r.owner} ${r.category} ${mines.find((m) => m.id === r.mineId)?.name}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const active = (data || []).filter(
    (r) =>
      ![
        "compliant",
        "resolved",
        "completed",
        "verified",
        "cancelled",
        "expired",
        "absent",
      ].includes(r.status),
  ).length;
  return (
    <div>
      <PageHeading
        eyebrow="CONNECTED WORKSPACE"
        title={meta.title}
        description={meta.description}
      >
        <button
          className="button secondary"
          onClick={() => downloadReport(kind, mine)}
        >
          <Download size={16} /> Export
        </button>
        {canWrite(user, kind) && (
          <button className="button primary" onClick={() => onCreate(kind)}>
            <Plus size={17} /> New {meta.singular}
          </button>
        )}
      </PageHeading>
      {kind === "field" && <OfflineQueue user={user} toast={toast} />}
      <div className="mini-stats">
        <div>
          <span>Total records</span>
          <strong>{fmt(data?.length || 0)}</strong>
          <ClipboardList size={20} />
        </div>
        <div>
          <span>Active / awaiting review</span>
          <strong>{fmt(active)}</strong>
          <span className="mini-stat-dot amber" />
        </div>
        <div>
          <span>High & critical priority</span>
          <strong>
            {fmt(
              data?.filter((r) => ["high", "critical"].includes(r.priority))
                .length || 0,
            )}
          </strong>
          <span className="mini-stat-dot red" />
        </div>
        <div>
          <span>Mine sites represented</span>
          <strong>{new Set(data?.map((r) => r.mineId)).size}</strong>
          <MapPin size={20} />
        </div>
      </div>
      <section className="panel records-panel">
        <div className="records-toolbar">
          <div className="input-search">
            <Search size={17} />
            <input
              aria-label="Search records"
              placeholder={`Search ${meta.title.toLowerCase()}…`}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div>
            <select
              aria-label="Filter status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">All statuses</option>
              {statuses[kind].map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter priority"
              value={priority}
              onChange={(e) => {
                setPriority(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">All priorities</option>
              {["low", "medium", "high", "critical"].map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {error && <ErrorBox message={error} retry={reload} />}{" "}
        {loading ? (
          <Loading />
        ) : !rows.length ? (
          <Empty
            title={
              query || status !== "all"
                ? "No matching records"
                : "A fresh start"
            }
            text={
              query || status !== "all"
                ? "Try a different search or filter."
                : `Create your first ${meta.singular} to start tracking.`
            }
          />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>
                    {kind === "contractor"
                      ? "Contractor"
                      : kind === "attendance"
                        ? "Worker"
                        : "Record / obligation"}
                  </th>
                  <th>Mine site</th>
                  <th>Status</th>
                  <th>
                    {[
                      "contractor",
                      "operation",
                      "environment",
                      "attendance",
                    ].includes(kind)
                      ? "Key details"
                      : "Priority"}
                  </th>
                  <th>{meta.date}</th>
                  <th>Owner</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.slice((page - 1) * 12, page * 12).map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => onOpen(r)}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && onOpen(r)}
                  >
                    <td>
                      <strong>{r.title}</strong>
                      <small>
                        {r.category} <span>·</span>{" "}
                        {r.id.slice(0, 8).toUpperCase()}
                      </small>
                    </td>
                    <td>
                      {mines.find((m) => m.id === r.mineId)?.name || r.mineId}
                    </td>
                    <td>
                      <Badge value={r.status} />
                    </td>
                    <td>
                      {kind === "contractor" ? (
                        `${fmt(r.data.workers)} workers`
                      ) : kind === "operation" ? (
                        `${fmt(r.data.tonnes)} / ${fmt(r.data.target)} t`
                      ) : kind === "environment" ? (
                        `PM₁₀ ${r.data.pm10} µg/m³`
                      ) : kind === "attendance" ? (
                        r.data.shift
                      ) : (
                        <Badge value={r.priority} />
                      )}
                    </td>
                    <td>{dateLabel(r.dueDate)}</td>
                    <td>
                      <div className="owner-cell">
                        <span>
                          {r.owner
                            .split(" ")
                            .map((w) => w[0])
                            .slice(0, 2)
                            .join("")}
                        </span>
                        {r.owner}
                      </div>
                    </td>
                    <td>
                      <ArrowUpRight size={16} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="pagination">
          <span>
            {rows.length
              ? `${Math.min((page - 1) * 12 + 1, rows.length)}–${Math.min(page * 12, rows.length)} of ${rows.length} records`
              : "0 records"}
          </span>
          <div>
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <span>
              Page {page} of {Math.max(1, Math.ceil(rows.length / 12))}
            </span>
            <button
              disabled={page * 12 >= rows.length}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </section>
      {kind === "compliance" && (
        <div className="subtle-note">
          <CheckCircle2 size={16} />
          <p>
            Officers can submit obligations for review. Only administrators can
            approve compliance, with a required review note. Regulatory
            references must be validated for your mine.
          </p>
        </div>
      )}
      {kind === "environment" && (
        <div className="subtle-note">
          <p>
            Readings are reported measurements, not certified results. Risk
            signals use illustrative screening thresholds; use site-specific
            consent limits for compliance decisions.
          </p>
        </div>
      )}
    </div>
  );
}
function OfflineQueue({
  user,
  toast,
}: {
  user: User;
  toast: (s: string) => void;
}) {
  const [queue, setQueue] = useState<QueuedReport[]>([]),
    [busy, setBusy] = useState(false),
    [online, setOnline] = useState(navigator.onLine),
    [error, setError] = useState("");
  const load = useCallback(() => {
    queueReports(user.id)
      .then(setQueue)
      .catch(() =>
        setError(
          "Device storage is unavailable. Offline reports cannot be stored in this browser.",
        ),
      );
  }, [user.id]);
  useEffect(() => {
    load();
    const on = () => setOnline(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    window.addEventListener("cg-refresh", load);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
      window.removeEventListener("cg-refresh", load);
    };
  }, [load]);
  async function sync() {
    setBusy(true);
    setError("");
    let count = 0;
    try {
      for (const q of queue) {
        await api("/records/field", {
          method: "POST",
          body: JSON.stringify(q.body),
          headers: { "Idempotency-Key": q.id },
        });
        await deleteQueue(q.id);
        count++;
      }
      if (count)
        toast(
          `${count} field report${count === 1 ? "" : "s"} synced successfully.`,
        );
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      load();
    }
  }
  return (
    <div className="offline-panel">
      <div>
        <span className="icon-tile">
          {online ? <CloudUpload size={21} /> : <WifiOff size={21} />}
        </span>
        <div>
          <strong>
            {online
              ? "Ready for the field. Even without a signal."
              : "You’re offline. Your observations still matter."}
          </strong>
          <p>
            {queue.length
              ? `${queue.length} report(s) stored on this device, waiting to sync.`
              : "New reports can be saved offline with their original timestamp and device location."}
          </p>
        </div>
        {queue.length > 0 && (
          <button
            className="button primary small"
            onClick={sync}
            disabled={busy || !online}
          >
            {busy ? "Syncing…" : "Sync reports"}
          </button>
        )}
      </div>
      {error && <ErrorBox message={error} />}{" "}
      {queue.map((q) => (
        <div className="queued-row" key={q.id}>
          <span>
            {q.body.title}
            <small>{new Date(q.queuedAt).toLocaleString()}</small>
          </span>
          <Badge value="pending">Queued on device</Badge>
          <button
            className="icon-button danger"
            aria-label={`Discard ${q.body.title}`}
            onClick={async () => {
              if (
                confirm("Discard this unsynced report? This cannot be undone.")
              ) {
                await deleteQueue(q.id);
                load();
              }
            }}
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
export function RecordDetail({
  entry: r,
  mines,
  user,
  onClose,
  onEdit,
  onDelete,
}: {
  entry: Entry;
  mines: Mine[];
  user: User;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Modal
      title={r.title}
      subtitle={`${kindMeta[r.kind].title} · ${r.id.slice(0, 8).toUpperCase()}`}
      onClose={onClose}
      wide
    >
      <div className="detail-content">
        <div className="detail-badges">
          <Badge value={r.status} />
          <Badge value={r.priority} />
        </div>
        <dl className="detail-grid">
          <div>
            <dt>Mine site</dt>
            <dd>{mines.find((m) => m.id === r.mineId)?.name}</dd>
          </div>
          <div>
            <dt>Responsible person</dt>
            <dd>{r.owner}</dd>
          </div>
          <div>
            <dt>{kindMeta[r.kind].date}</dt>
            <dd>
              {dateLabel(r.dueDate, {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </dd>
          </div>
          <div>
            <dt>Category</dt>
            <dd>{r.category}</dd>
          </div>
          {Object.entries(r.data)
            .filter(([, v]) => v !== "" && v !== null)
            .map(([k, v]) => (
              <div key={k}>
                <dt>{k.replace(/([A-Z])/g, " $1")}</dt>
                <dd>{String(v)}</dd>
              </div>
            ))}
        </dl>
        {r.notes && (
          <div className="detail-notes">
            <h4>Notes & evidence</h4>
            <p>{r.notes}</p>
          </div>
        )}
        <div className="detail-timestamp">
          Created{" "}
          {dateLabel(r.createdAt, {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}{" "}
          · Revision {r.version}
          <br />
          Record ID: {r.id}
        </div>
      </div>
      <div className="form-footer">
        <div>
          {user.role === "admin" && (
            <button className="button danger subtle" onClick={onDelete}>
              <Trash2 size={15} /> Delete record
            </button>
          )}
        </div>
        <div>
          <button className="button secondary" onClick={onClose}>
            Close
          </button>
          {canWrite(user, r.kind) && (
            <button className="button primary" onClick={onEdit}>
              Edit record <ArrowUpRight size={16} />
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

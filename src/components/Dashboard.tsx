import { useState } from "react";
import {
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  ArrowUpRight,
  ArrowRight,
  ShieldCheck,
  ClipboardCheck,
  TriangleAlert,
  Mountain,
  ChevronDown,
  Plus,
  CalendarDays,
  Check,
  Leaf,
  Users,
  Factory,
  Sparkles,
  MapPin,
  Activity,
} from "lucide-react";
import { useData, fmt, dateLabel, navigate, canWrite } from "../lib";
import {
  Badge,
  PageHeading,
  SectionHeader,
  Loading,
  ErrorBox,
  Empty,
} from "./UI";
import type { Dashboard as DashboardData, Entry, Kind, User } from "../types";
function MineIllustration() {
  return (
    <svg
      className="mine-illustration"
      viewBox="0 0 410 270"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id="land"
          x1="60"
          y1="100"
          x2="330"
          y2="260"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#b4cdb8" />
          <stop offset="1" stopColor="#8eac94" />
        </linearGradient>
        <linearGradient id="side" x1="0" y1="170" x2="0" y2="245">
          <stop stopColor="#799781" />
          <stop offset="1" stopColor="#4e725b" />
        </linearGradient>
      </defs>
      <ellipse
        cx="222"
        cy="224"
        rx="162"
        ry="31"
        fill="#5b8065"
        opacity=".08"
      />
      <path d="m52 126 170-70 151 69v58l-163 67-158-69Z" fill="url(#side)" />
      <path d="m52 126 170-70 151 69-163 71Z" fill="url(#land)" />
      <path
        d="m52 145 158 70 163-71M52 163l158 69 163-69"
        stroke="#c8d9c8"
        strokeOpacity=".24"
      />
      <path d="m93 131 130-51 111 47-124 53Z" fill="#d7dfc8" />
      <path d="m110 130 113-42 96 40-108 46Z" fill="#7f997b" />
      <path d="m118 132 105-38 87 35-99 40Z" fill="#b7c5a3" />
      <path d="m134 133 89-31 73 28-85 34Z" fill="#70856b" />
      <path d="m143 134 80-25 64 22-76 29Z" fill="#9aa88c" />
      <path d="m159 135 64-18 49 16-61 22Z" fill="#526b55" />
      <path d="m174 137 49-12 34 11-46 15Z" fill="#405b48" />
      <path d="m179 137 44-8 28 9-40 9Z" fill="#77917a" />
      <path
        d="m68 126 60-24M251 74l97 44M71 167l118 51"
        stroke="#e8eedf"
        strokeOpacity=".5"
        strokeWidth="2"
      />
      <g transform="translate(288 95)">
        <path d="m0 0 24-10 14 7-24 10Z" fill="#f8f7e3" />
        <path d="M0 0v18l14 7V7Z" fill="#afba9a" />
        <path d="m14 7 24-10v18L14 25Z" fill="#d9dec8" />
        <path d="m19 8 4-2v7l-4 2M29 4l4-2v7l-4 2" fill="#5c7b66" />
      </g>
      <g stroke="#385c44" strokeWidth="3">
        <path d="M110 104V77m-6 10 6-10 6 10m-14 8 8-11 8 11M318 163v-27m-6 10 6-10 6 10m-14 8 8-11 8 11M335 154v-23m-6 10 6-10 6 10" />
      </g>
      <g transform="translate(252 153)">
        <path d="m0 0 20-8 12 5-20 8Z" fill="#f4d08b" />
        <path d="M0 0v7l12 6V5Z" fill="#b99b59" />
        <path d="m12 5 20-8v7l-20 9Z" fill="#d3b776" />
        <circle cx="5" cy="10" r="3" fill="#42594a" />
        <circle cx="24" cy="8" r="3" fill="#42594a" />
      </g>
      <path d="M225 69V34" stroke="#3b6c50" strokeWidth="2" />
      <circle cx="225" cy="27" r="15" fill="#f4faf0" />
      <circle cx="225" cy="27" r="9" fill="#5f9471" />
      <path d="m221 27 3 3 5-6" stroke="white" strokeWidth="1.8" />
      <path
        d="m127 228 39 16m94-6 50-21"
        stroke="#b7cfb7"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
export function Dashboard({
  mine,
  user,
  onCreate,
  onEdit,
  onMine,
}: {
  mine: string;
  user: User;
  onCreate: (k: Kind) => void;
  onEdit: (e: Entry) => void;
  onMine: (id: string) => void;
}) {
  const {
    data: d,
    error,
    loading,
    reload,
  } = useData<DashboardData>(`/dashboard?mine=${mine}`);
  const { data: inspections } = useData<Entry[]>(
    `/records/inspection?mine=${mine}`,
  );
  const [days, setDays] = useState("14");
  if (loading) return <Loading />;
  if (error || !d)
    return (
      <ErrorBox message={error || "Unable to load dashboard"} retry={reload} />
    );
  const prodChange = d.previousProduction
    ? ((d.production - d.previousProduction) / d.previousProduction) * 100
    : 0;
  return (
    <div className="dashboard-page">
      <PageHeading
        eyebrow="YOUR WORKSPACE, AT A GLANCE"
        title="Governance overview"
        description="A connected view of your mines. Confidence in every decision."
      >
        <button
          className="button secondary"
          onClick={() => navigate("reports")}
        >
          <CalendarDays size={16} /> Generate report
        </button>
        {canWrite(user, "inspection") && (
          <button
            className="button primary"
            onClick={() => onCreate("inspection")}
          >
            <Plus size={17} /> New inspection
          </button>
        )}
      </PageHeading>
      <div className="welcome-grid">
        <section className="welcome-card">
          <div className="welcome-text">
            <div className="eyebrow">
              <span className="tiny-dot" /> BUILT FOR A SAFER TOMORROW
            </div>
            <h2>
              Good governance.
              <br />
              From the ground up.
            </h2>
            <p>
              Less paperwork. More perspective.
              <br />
              Keep every mine moving in the right direction.
            </p>
            <button
              className="hero-link"
              onClick={() => navigate("compliance")}
            >
              Explore compliance <ArrowRight size={16} />
            </button>
          </div>
          <MineIllustration />
          <span className="hero-glass-label">
            <span className="tiny-dot" /> {d.mines.length} mine sites connected
          </span>
        </section>
        <section className="pulse-card">
          <div className="pulse-top">
            <span className="icon-tile">
              <Activity size={19} />
            </span>
            <span className="live-pill">
              <span /> WORKSPACE LIVE
            </span>
          </div>
          <h3>
            A little clarity.
            <br />A lot of confidence.
          </h3>
          <div className="pulse-stats">
            <div>
              <strong>{d.mines.length.toString().padStart(2, "0")}</strong>
              <span>Mine sites</span>
            </div>
            <div>
              <strong>
                {new Set(d.mines.map((m) => m.subsidiary)).size
                  .toString()
                  .padStart(2, "0")}
              </strong>
              <span>Subsidiaries</span>
            </div>
            <div>
              <strong>{d.insights.length.toString().padStart(2, "0")}</strong>
              <span>Risk signals</span>
            </div>
          </div>
          <div className="pulse-footer">
            <ShieldCheck size={14} /> One workspace. Shared accountability.
          </div>
        </section>
      </div>
      <div className="stats-grid">
        <Stat
          title="Overall compliance"
          value={d.compliance === null ? "—" : `${d.compliance}%`}
          icon={<ShieldCheck size={20} />}
          note={`${d.complianceCount} of ${d.totalCompliance} obligations fulfilled`}
          tag="Across your portfolio"
          tone="green"
          onClick={() => navigate("compliance")}
        />
        <Stat
          title="Inspections tracked"
          value={String(d.inspections).padStart(2, "0")}
          icon={<ClipboardCheck size={20} />}
          note={`${d.completedInspections} completed · ${d.inspections - d.completedInspections} remaining`}
          tag="Every observation matters"
          tone="blue"
          onClick={() => navigate("inspection")}
        />
        <Stat
          title="Open corrective actions"
          value={String(d.openActions).padStart(2, "0")}
          icon={<TriangleAlert size={20} />}
          note="Assigned and awaiting closure"
          tag={d.openActions ? "Needs your attention" : "All caught up"}
          tone="amber"
          onClick={() => navigate("action")}
        />
        <Stat
          title="Coal production today"
          value={`${(d.production / 1000).toFixed(1)}`}
          unit="k tonnes"
          icon={<Mountain size={20} />}
          note={
            d.previousProduction
              ? `${prodChange >= 0 ? "+" : ""}${prodChange.toFixed(1)}% from previous day`
              : "No previous-day baseline"
          }
          tag="Reported mine output"
          tone="purple"
          onClick={() => navigate("operation")}
        />
      </div>
      <div className="analytics-grid">
        <section className="panel production-panel">
          <div className="section-header">
            <div>
              <h3>Production performance</h3>
              <p>Daily output against your operating targets</p>
            </div>
            <select
              className="compact-select"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              aria-label="Production chart period"
            >
              <option value="14">Last 14 days</option>
              <option value="7">Last 7 days</option>
            </select>
          </div>
          <div className="chart-summary">
            <strong>
              {(
                d.trend.slice(-Number(days)).reduce((s, r) => s + r.actual, 0) /
                1000000
              ).toFixed(2)}
              <small> million tonnes</small>
            </strong>
            <div className="chart-legend">
              <span>
                <i />
                Actual output
              </span>
              <span>
                <i />
                Target
              </span>
            </div>
          </div>
          <div className="production-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={d.trend.slice(-Number(days))}
                margin={{ top: 12, right: 8, left: -21, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#86b89b" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#86b89b" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  vertical={false}
                  stroke="#ecf0ed"
                  strokeDasharray="3 4"
                />
                <XAxis
                  dataKey="date"
                  tickFormatter={(s) => dateLabel(s)}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: "#8a9690" }}
                  minTickGap={38}
                  dy={10}
                />
                <YAxis
                  tickFormatter={(v) => `${Math.round(v / 1000)}k`}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: "#8a9690" }}
                />
                <Tooltip
                  contentStyle={{
                    border: "1px solid #e5ebe6",
                    borderRadius: 12,
                    fontSize: 12,
                    boxShadow: "0 8px 30px #23483115",
                  }}
                  labelFormatter={(v) => dateLabel(String(v))}
                  formatter={(v: number, n: string) => [
                    `${fmt(v)} tonnes`,
                    n === "actual" ? "Actual" : "Target",
                  ]}
                />
                <Area
                  isAnimationActive={false}
                  type="monotone"
                  dataKey="target"
                  fill="transparent"
                  stroke="#bac8be"
                  strokeDasharray="5 5"
                  strokeWidth={1.5}
                />
                <Area
                  isAnimationActive={false}
                  type="monotone"
                  dataKey="actual"
                  fill="url(#chartFill)"
                  stroke="#53886b"
                  strokeWidth={2.6}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="panel-foot">
            <span className="tiny-dot" /> Based on submitted production records{" "}
            <button
              className="text-button"
              onClick={() => navigate("operation")}
            >
              View operations <ArrowUpRight size={14} />
            </button>
          </div>
        </section>
        <section className="panel compliance-panel">
          <SectionHeader
            title="Compliance health"
            subtitle="A balance across every responsibility"
          />
          <div
            className="compliance-ring"
            style={
              {
                "--progress": `${(d.compliance || 0) * 3.6}deg`,
              } as React.CSSProperties
            }
          >
            <div>
              <ShieldCheck size={20} />
              <strong>
                {d.compliance ?? "—"}
                <small>%</small>
              </strong>
              <span>Portfolio score</span>
            </div>
          </div>
          <div className="category-list">
            {d.categoryCompliance.map((c, i) => {
              const Icon = [ShieldCheck, Leaf, Users, Factory][i];
              const score = c.total
                ? Math.round((c.complete / c.total) * 100)
                : 0;
              return (
                <div className="category-row" key={c.category}>
                  <Icon size={14} />
                  <span>{c.category}</span>
                  <div className="mini-track">
                    <i style={{ width: `${score}%` }} />
                  </div>
                  <strong>{c.total ? score + "%" : "—"}</strong>
                </div>
              );
            })}
          </div>
          <button className="full-link" onClick={() => navigate("compliance")}>
            Open compliance register <ArrowRight size={14} />
          </button>
        </section>
      </div>
      <div className="bottom-grid">
        <section className="panel mine-panel">
          <SectionHeader
            title="Your mine portfolio"
            subtitle="Local accountability. Collective progress."
            action="View all sites"
            onAction={() => navigate("mines")}
          />
          <div className="table-scroll">
            <table className="mine-table">
              <thead>
                <tr>
                  <th>Mine site</th>
                  <th>Compliance</th>
                  <th>Risk level</th>
                  <th>Open issues</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {d.mines.slice(0, 4).map((m) => (
                  <tr
                    key={m.id}
                    onClick={() => onMine(m.id)}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && onMine(m.id)}
                  >
                    <td>
                      <div className="mine-name">
                        <span className="mine-icon">
                          <Mountain size={18} />
                        </span>
                        <div>
                          <strong>{m.name}</strong>
                          <small>
                            {m.subsidiary} <span>·</span>{" "}
                            {m.region.split(",")[0]}
                          </small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="table-progress">
                        <strong>
                          {m.compliance === null ? "—" : `${m.compliance}%`}
                        </strong>
                        <div>
                          <i style={{ width: `${m.compliance || 0}%` }} />
                        </div>
                      </div>
                    </td>
                    <td>
                      <Badge value={m.risk || "low"} />
                    </td>
                    <td>
                      <span className={m.overdue ? "issue-count" : "muted"}>
                        {m.overdue || "—"}
                      </span>
                    </td>
                    <td>
                      <ArrowUpRight size={15} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!d.mines.length && (
            <Empty
              title="Your portfolio starts here"
              text="Add your first mine in Settings."
            />
          )}
          <div className="panel-foot">
            <span>
              Showing {Math.min(d.mines.length, 4)} of {d.mines.length} mine
              sites
            </span>
            <span className="muted">
              <MapPin size={12} /> India
            </span>
          </div>
        </section>
        <section className="panel attention-panel">
          <SectionHeader
            title="On your radar"
            subtitle="Small actions. Meaningful impact."
          />
          <div className="radar-tabs">
            <span className="active">
              Priority signals <b>{d.insights.length}</b>
            </span>
            <Sparkles size={15} />
          </div>
          <div className="radar-list">
            {d.insights.slice(0, 3).map((s, i) => (
              <button
                key={s.id}
                className="radar-item"
                onClick={() => navigate("intelligence")}
              >
                <span className={`radar-dot ${s.severity}`}>
                  <TriangleAlert size={15} />
                </span>
                <div>
                  <strong>{s.title}</strong>
                  <p>{d.mines.find((m) => m.id === s.mineId)?.name}</p>
                  <small>
                    {s.category} <span>·</span>{" "}
                    {s.severity === "high"
                      ? "Review recommended"
                      : "Monitor closely"}
                  </small>
                </div>
                <ArrowUpRight size={15} />
              </button>
            ))}
            {!d.insights.length && (
              <Empty
                title="A clear horizon"
                text="No signals found by the screening rules."
              />
            )}
          </div>
          <button
            className="full-link"
            onClick={() => navigate("intelligence")}
          >
            Explore risk insights <ArrowRight size={14} />
          </button>
        </section>
      </div>
      <section className="panel schedule-panel">
        <SectionHeader
          title="Next on the ground"
          subtitle="Your upcoming and in-progress inspections"
          action="Inspection calendar"
          onAction={() => navigate("inspection")}
        />
        <div className="schedule-list">
          {inspections
            ?.filter((i) => ["scheduled", "in_progress"].includes(i.status))
            .sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""))
            .slice(0, 3)
            .map((i) => (
              <button
                className="schedule-item"
                key={i.id}
                onClick={() => onEdit(i)}
              >
                <div className="date-block">
                  <span>{dateLabel(i.dueDate, { month: "short" })}</span>
                  <strong>{dateLabel(i.dueDate, { day: "2-digit" })}</strong>
                </div>
                <div>
                  <strong>{i.title}</strong>
                  <p>
                    {d.mines.find((m) => m.id === i.mineId)?.name}{" "}
                    <span>·</span> {i.owner}
                  </p>
                </div>
                <Badge value={i.status} />
              </button>
            ))}
          {!inspections?.filter((i) =>
            ["scheduled", "in_progress"].includes(i.status),
          ).length && (
            <p className="muted">
              No upcoming inspections. Schedule one to get started.
            </p>
          )}
        </div>
      </section>
      <div className="workspace-footer">
        <span>
          <ShieldCheck size={13} /> Better governance. Safer mines. Together.
        </span>
        <span>
          Last synced{" "}
          {new Date(d.updatedAt).toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
          })}{" "}
          <span className="tiny-dot" />
        </span>
      </div>
    </div>
  );
}
function Stat({
  title,
  value,
  unit,
  icon,
  note,
  tag,
  tone,
  onClick,
}: {
  title: string;
  value: string;
  unit?: string;
  icon: React.ReactNode;
  note: string;
  tag: string;
  tone: string;
  onClick: () => void;
}) {
  return (
    <button className={`stat-card ${tone}`} onClick={onClick}>
      <div className="stat-top">
        <span>{title}</span>
        <span className="stat-icon">{icon}</span>
      </div>
      <div className="stat-value">
        {value}
        <small>{unit}</small>
      </div>
      <p>{note}</p>
      <div className="stat-bottom">
        <span>
          <span className="tiny-dot" />
          {tag}
        </span>
        <ArrowUpRight size={14} />
      </div>
    </button>
  );
}

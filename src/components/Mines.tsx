import { useEffect, useState } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Tooltip,
  useMap,
} from "react-leaflet";
import {
  Mountain,
  MapPin,
  ArrowUpRight,
  Map as MapIcon,
  List,
  Plus,
  Layers,
  ShieldCheck,
  ClipboardCheck,
  TriangleAlert,
  Leaf,
  Factory,
  X,
} from "lucide-react";
import "leaflet/dist/leaflet.css";
import { useData, fmt } from "../lib";
import { PageHeading, Badge, Loading, ErrorBox, Empty, Modal } from "./UI";
import type { Dashboard, Mine, User } from "../types";

function MapBounds({ mines }: { mines: Mine[] }) {
  const map = useMap();
  useEffect(() => {
    if (mines.length)
      map.fitBounds(
        mines.map((m) => [m.latitude, m.longitude] as [number, number]),
        { padding: [65, 65], maxZoom: 12 },
      );
  }, [map, mines]);
  return null;
}

function MineProfile({ mine, onClose }: { mine: Mine; onClose: () => void }) {
  const { data: dashboard } = useData<Dashboard>("/dashboard?mine=" + mine.id);
  const { data: inspections } = useData<any[]>("/records/inspection?mine=" + mine.id);
  const { data: actions } = useData<any[]>("/records/action?mine=" + mine.id);
  const { data: compliance } = useData<any[]>("/records/compliance?mine=" + mine.id);
  const { data: environment } = useData<any[]>("/records/environment?mine=" + mine.id);
  const { data: documents } = useData<any[]>("/documents?mine=" + mine.id);

  const totalRecords =
    (inspections?.length || 0) +
    (actions?.length || 0) +
    (compliance?.length || 0) +
    (environment?.length || 0) +
    (documents?.length || 0);

  const openIssues =
    (inspections?.filter((i: any) => !["completed", "cancelled"].includes(i.status)).length || 0) +
    (actions?.filter((a: any) => !["resolved"].includes(a.status)).length || 0) +
    (compliance?.filter((c: any) => !["compliant"].includes(c.status)).length || 0);

  return (
    <Modal
      title={mine.name}
      subtitle={mine.subsidiary + " · " + mine.region}
      onClose={onClose}
      wide
    >
      <div className="mine-profile">
        <div className="mine-profile-header">
          <div className="mine-profile-icon">
            <Mountain size={32} />
          </div>
          <div className="mine-profile-info">
            <h2>{mine.name}</h2>
            <p>{mine.subsidiary} · {mine.region}</p>
            <div className="mine-profile-badges">
              <Badge value={dashboard?.mines[0]?.risk || "low"}>
                {dashboard?.mines[0]?.risk || "low"} risk
              </Badge>
              <span className="mine-profile-capacity">
                <Factory size={14} /> {mine.capacity} MTPA capacity
              </span>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="mine-profile-metrics">
          <div className="mine-metric">
            <span className="mine-metric-value">{dashboard?.mines[0]?.compliance ?? "—"}%</span>
            <span className="mine-metric-label">Compliance</span>
            <div className="mine-metric-bar">
              <div style={{ width: String(dashboard?.mines[0]?.compliance || 0) + "%" }} />
            </div>
          </div>
          <div className="mine-metric">
            <span className="mine-metric-value">{dashboard?.mines[0]?.obligations || 0}</span>
            <span className="mine-metric-label">Obligations</span>
          </div>
          <div className="mine-metric">
            <span className="mine-metric-value">{openIssues || "—"}</span>
            <span className="mine-metric-label">Open issues</span>
          </div>
          <div className="mine-metric">
            <span className="mine-metric-value">{totalRecords}</span>
            <span className="mine-metric-label">Total records</span>
          </div>
        </div>

        <div className="mine-profile-sections">
          <section className="mine-profile-section">
            <h3><ShieldCheck size={16} /> Compliance status</h3>
            <div className="mine-section-content">
              {compliance?.slice(0, 5).map((c: any) => (
                <div key={c.id} className="mine-section-item">
                  <Badge value={c.status} />
                  <span>{c.title}</span>
                  <small>{c.category}</small>
                </div>
              ))}
              {(!compliance || !compliance.length) && <p className="muted">No compliance records</p>}
            </div>
          </section>

          <section className="mine-profile-section">
            <h3><ClipboardCheck size={16} /> Inspections</h3>
            <div className="mine-section-content">
              {inspections?.slice(0, 5).map((i: any) => (
                <div key={i.id} className="mine-section-item">
                  <Badge value={i.status} />
                  <span>{i.title}</span>
                  <small>{i.owner}</small>
                </div>
              ))}
              {(!inspections || !inspections.length) && <p className="muted">No inspections</p>}
            </div>
          </section>

          <section className="mine-profile-section">
            <h3><TriangleAlert size={16} /> Corrective actions</h3>
            <div className="mine-section-content">
              {actions?.slice(0, 5).map((a: any) => (
                <div key={a.id} className="mine-section-item">
                  <Badge value={a.status} />
                  <span>{a.title}</span>
                  <small>{a.priority} priority</small>
                </div>
              ))}
              {(!actions || !actions.length) && <p className="muted">No corrective actions</p>}
            </div>
          </section>

          <section className="mine-profile-section">
            <h3><Leaf size={16} /> Environmental</h3>
            <div className="mine-section-content">
              {environment?.slice(0, 3).map((e: any) => (
                <div key={e.id} className="mine-section-item">
                  <Badge value={e.status} />
                  <span>PM₁₀ {e.data.pm10} µg/m³</span>
                  <small>{e.owner}</small>
                </div>
              ))}
              {(!environment || !environment.length) && <p className="muted">No environmental records</p>}
            </div>
          </section>
        </div>

        <div className="mine-profile-footer">
          <span><MapPin size={14} /> {mine.latitude.toFixed(3)}°, {mine.longitude.toFixed(3)}°</span>
          <span className="muted">{totalRecords} records · {openIssues} open issues</span>
        </div>
      </div>
    </Modal>
  );
}

export function Mines({
  mine,
  user,
  onMine,
  onAdd,
}: {
  mine: string;
  user: User;
  onMine: (id: string) => void;
  onAdd: () => void;
}) {
  const { data, error, loading, reload } = useData<Dashboard>("/dashboard?mine=" + mine);
  const [view, setView] = useState("map");
  const [tileError, setTileError] = useState(false);
  const [selectedMine, setSelectedMine] = useState<Mine | null>(null);

  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox message={error || "Unable to load mines"} retry={reload} />;

  return (
    <div>
      <PageHeading
        eyebrow="MINE INTELLIGENCE"
        title="Every site. In sight."
        description="Geographic perspective for ground-level decisions."
      >
        <div className="segmented">
          <button className={view === "map" ? "active" : ""} onClick={() => setView("map")}>
            <MapIcon size={16} /> Map
          </button>
          <button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>
            <List size={16} /> List
          </button>
        </div>
        {user.role === "admin" && (
          <button className="button primary" onClick={onAdd}>
            <Plus size={16} /> Add mine
          </button>
        )}
      </PageHeading>
      {!data.mines.length ? (
        <section className="panel">
          <Empty title="Build your mine portfolio" text="Add a mine with its location to begin." />
        </section>
      ) : (
        <>
          {view === "map" && (
            <section className="panel map-panel">
              <div className="map-overlay-title">
                <Layers size={17} />
                <span>Mine network</span>
                <small>{data.mines.length} sites</small>
              </div>
              <MapContainer
                center={[23.2, 82.5]}
                zoom={7}
                scrollWheelZoom={false}
                className="mine-map"
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  errorTileUrl="/map-tile-fallback.svg"
                  eventHandlers={{ tileerror: () => setTileError(true) }}
                  referrerPolicy="strict-origin-when-cross-origin"
                  url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <MapBounds mines={data.mines} />
                {data.mines.map((m) => (
                  <CircleMarker
                    key={m.id}
                    center={[m.latitude, m.longitude]}
                    radius={11}
                    pathOptions={{
                      color: "white",
                      weight: 3,
                      fillColor:
                        m.risk === "high"
                          ? "#ca7a63"
                          : m.risk === "medium"
                            ? "#c6a261"
                            : "#52836a",
                      fillOpacity: 1,
                    }}
                    eventHandlers={{ click: () => onMine(m.id) }}
                  >
                    <Tooltip direction="top">
                      <strong>{m.name}</strong>
                      <br />
                      {m.subsidiary} · {m.compliance ?? "—"}% compliant
                      <br />
                      Click to open this mine
                    </Tooltip>
                  </CircleMarker>
                ))}
              </MapContainer>
              <div className="panel-foot">
                <span>
                  <span className="tiny-dot" /> Site locations · not survey boundaries
                </span>
                <span role={tileError ? "status" : undefined}>
                  {tileError
                    ? "Map tiles could not be loaded. Site markers remain visible."
                    : "Map tiles require an internet connection"}
                </span>
              </div>
            </section>
          )}
          {view === "list" && (
            <div className="mine-card-grid">
              {data.mines.map((m) => (
                <button
                  className="panel site-card"
                  key={m.id}
                  onClick={() => setSelectedMine(m)}
                >
                  <div>
                    <span className="icon-tile"><Mountain size={24} /></span>
                    <Badge value={m.risk || "low"}>{m.risk} risk</Badge>
                  </div>
                  <h3>{m.name}</h3>
                  <p><MapPin size={13} />{m.region}</p>
                  <div className="site-metrics">
                    <span><strong>{m.compliance ?? "—"}%</strong>Compliance</span>
                    <span><strong>{m.capacity} MTPA</strong>Annual capacity</span>
                    <span><strong>{m.obligations || 0}</strong>Obligations</span>
                  </div>
                  <div className="site-foot">
                    <span>{m.subsidiary} · {m.obligations || 0} obligations</span>
                    <ArrowUpRight size={17} />
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {selectedMine && (
        <MineProfile mine={selectedMine} onClose={() => setSelectedMine(null)} />
      )}
    </div>
  );
}

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
} from "lucide-react";
import "leaflet/dist/leaflet.css";
import { useData, fmt } from "../lib";
import { PageHeading, Badge, Loading, ErrorBox, Empty } from "./UI";
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
  const { data, error, loading, reload } = useData<Dashboard>(
    `/dashboard?mine=${mine}`,
  );
  const [view, setView] = useState("map");
  const [tileError, setTileError] = useState(false);
  if (loading) return <Loading />;
  if (error || !data)
    return (
      <ErrorBox message={error || "Unable to load mines"} retry={reload} />
    );
  return (
    <div>
      <PageHeading
        eyebrow="YOUR CONNECTED PORTFOLIO"
        title="Every site. In sight."
        description="Geographic perspective for ground-level decisions."
      >
        <div className="segmented">
          <button
            className={view === "map" ? "active" : ""}
            onClick={() => setView("map")}
          >
            <MapIcon size={16} /> Map
          </button>
          <button
            className={view === "list" ? "active" : ""}
            onClick={() => setView("list")}
          >
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
          <Empty
            title="Build your mine portfolio"
            text="Add a mine with its location to begin."
          />
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
                  <span className="tiny-dot" /> Site locations · not survey
                  boundaries
                </span>
                <span role={tileError ? "status" : undefined}>
                  {tileError
                    ? "Map tiles could not be loaded. Site markers remain visible."
                    : "Map tiles require an internet connection"}
                </span>
              </div>
            </section>
          )}
          <div className="mine-card-grid">
            {data.mines.map((m) => (
              <button
                className="panel site-card"
                key={m.id}
                onClick={() => onMine(m.id)}
              >
                <div>
                  <span className="icon-tile">
                    <Mountain size={24} />
                  </span>
                  <Badge value={m.risk || "low"}>{m.risk} risk</Badge>
                </div>
                <h3>{m.name}</h3>
                <p>
                  <MapPin size={13} />
                  {m.region}
                </p>
                <div className="site-metrics">
                  <span>
                    <strong>{m.compliance ?? "—"}%</strong>Compliance
                  </span>
                  <span>
                    <strong>{m.capacity} MTPA</strong>Annual capacity
                  </span>
                </div>
                <div className="site-foot">
                  <span>
                    {m.subsidiary} · {m.obligations} obligations
                  </span>
                  <ArrowUpRight size={17} />
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

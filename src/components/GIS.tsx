import { useEffect, useState } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Tooltip,
  useMap,
  Marker,
  Popup,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import {
  Layers,
  Navigation,
  AlertTriangle,
  MapPin,
  ShieldCheck,
  ArrowUpRight,
  ZoomIn,
  ZoomOut,
  LocateFixed,
} from "lucide-react";
import { useData } from "../lib";
import { PageHeading, Badge, Loading, ErrorBox, Empty, SectionHeader } from "./UI";
import type { Dashboard, Mine } from "../types";

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

function MapControls({ map }: { map: L.Map }) {
  return (
    <div className="gis-controls">
      <button
        className="gis-control-btn"
        onClick={() => map.zoomIn()}
        aria-label="Zoom in"
      >
        <ZoomIn size={18} />
      </button>
      <button
        className="gis-control-btn"
        onClick={() => map.zoomOut()}
        aria-label="Zoom out"
      >
        <ZoomOut size={18} />
      </button>
      <button
        className="gis-control-btn"
        onClick={() => {
          map.setView([23.2, 82.5], 7);
        }}
        aria-label="Reset to India view"
      >
        <Navigation size={18} />
      </button>
    </div>
  );
}

export function GIS() {
  const { data, error, loading, reload } = useData<Dashboard>("/dashboard?mine=all");
  const [selectedMine, setSelectedMine] = useState<Mine | null>(null);
  const [filterRisk, setFilterRisk] = useState<string>("all");
  const [showLabels, setShowLabels] = useState(true);

  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox message={error || "Unable to load GIS data"} retry={reload} />;

  const filteredMines = data.mines.filter((m) => {
    if (filterRisk === "all") return true;
    return m.risk === filterRisk;
  });

  return (
    <div>
      <PageHeading
        eyebrow="GEOSPATIAL INTELLIGENCE"
        title="GIS intelligence"
        description="Geographic distribution of your mine portfolio with risk and compliance overlay."
      >
        <div className="segmented">
          <button
            className={showLabels ? "active" : ""}
            onClick={() => setShowLabels(!showLabels)}
          >
            <MapPin size={16} /> Labels
          </button>
          <select
            className="compact-select"
            value={filterRisk}
            onChange={(e) => setFilterRisk(e.target.value)}
            aria-label="Filter by risk level"
          >
            <option value="all">All risk levels</option>
            <option value="high">High risk</option>
            <option value="medium">Medium risk</option>
            <option value="low">Low risk</option>
          </select>
        </div>
      </PageHeading>

      <div className="gis-layout">
        <section className="panel gis-map-panel">
          <div className="map-overlay-title">
            <Layers size={17} />
            <span>Mine network · {filteredMines.length} sites</span>
            <small>
              {new Set(filteredMines.map((m) => m.subsidiary)).size} subsidiaries
            </small>
          </div>
          <div className="map-wrapper">
            <MapContainer
              center={[23.2, 82.5]}
              zoom={7}
              scrollWheelZoom={true}
              className="gis-map"
              zoomControl={false}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                referrerPolicy="strict-origin-when-cross-origin"
              />
              <MapBounds mines={filteredMines} />
              {filteredMines.map((m) => (
                <CircleMarker
                  key={m.id}
                  center={[m.latitude, m.longitude]}
                  radius={m.risk === "high" ? 14 : m.risk === "medium" ? 12 : 10}
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
                  eventHandlers={{ click: () => setSelectedMine(m) }}
                >
                  <Tooltip direction="top">
                    <strong>{m.name}</strong>
                    <br />
                    {m.subsidiary} · {m.region}
                    <br />
                    <br />
                    <span>
                      Compliance: {m.compliance ?? "—"}%
                    </span>
                    <br />
                    <span>
                      Capacity: {m.capacity} MTPA
                    </span>
                    <br />
                    <span
                      className={m.risk === "high" ? "risk-high" : m.risk === "medium" ? "risk-medium" : "risk-low"}
                    >
                      Risk: {m.risk}
                    </span>
                  </Tooltip>
                </CircleMarker>
              ))}
              <MapControls map={useMap()} />
            </MapContainer>
          </div>
          <div className="panel-foot">
            <span>
              <span className="tiny-dot" /> Site locations are approximate · not survey boundaries
            </span>
            <span className="muted">
              {" "}
              <MapPin size={12} /> India
            </span>
          </div>
        </section>

        <aside className="gis-sidebar">
          <SectionHeader
            title="Site selector"
            subtitle={`${filteredMines.length} mines`}
          />
          <div className="gis-site-list">
            {filteredMines.map((m) => (
              <button
                key={m.id}
                className={`gis-site-item ${selectedMine?.id === m.id ? "selected" : ""}`}
                onClick={() => setSelectedMine(m)}
              >
                <div className="gis-site-risk-dot" style={{
                  background:
                    m.risk === "high"
                      ? "#ca7a63"
                      : m.risk === "medium"
                        ? "#c6a261"
                        : "#52836a"
                }} />
                <div className="gis-site-info">
                  <strong>{m.name}</strong>
                  <p>
                    {m.subsidiary} · {m.region.split(",")[0]}
                  </p>
                </div>
                <div className="gis-site-metrics">
                  <span>
                    <strong>{m.compliance ?? "—"}%</strong>
                    compliant
                  </span>
                  <Badge value={m.risk || "low"}>{m.risk}</Badge>
                </div>
                <ArrowUpRight size={16} className="gis-site-arrow" />
              </button>
            ))}
            {!filteredMines.length && (
              <Empty
                title="No sites match filter"
                text="Try a different risk filter."
              />
            )}
          </div>

          {selectedMine && (
            <section className="panel gis-detail-panel">
              <SectionHeader
                title={selectedMine.name}
                subtitle={selectedMine.subsidiary}
                action="View this mine"
                onAction={() => {
                  setSelectedMine(null);
                  window.location.hash = "mines";
                }}
              />
              <div className="gis-detail-content">
                <div className="gis-detail-grid">
                  <div>
                    <span className="gis-detail-label">Region</span>
                    <span className="gis-detail-value">{selectedMine.region}</span>
                  </div>
                  <div>
                    <span className="gis-detail-label">Coordinates</span>
                    <span className="gis-detail-value">
                      {selectedMine.latitude.toFixed(3)}°,{" "}
                      {selectedMine.longitude.toFixed(3)}°
                    </span>
                  </div>
                  <div>
                    <span className="gis-detail-label">Capacity</span>
                    <span className="gis-detail-value">{selectedMine.capacity} MTPA</span>
                  </div>
                  <div>
                    <span className="gis-detail-label">Compliance</span>
                    <span className="gis-detail-value">
                      {selectedMine.compliance ?? "—"}%
                    </span>
                  </div>
                  <div>
                    <span className="gis-detail-label">Risk level</span>
                    <Badge value={selectedMine.risk || "low"}>
                      {selectedMine.risk || "low"}
                    </Badge>
                  </div>
                </div>

                <div className="gis-risk-assessment">
                  <h4>Risk assessment</h4>
                  <div className="gis-risk-indicators">
                    <div className="gis-risk-indicator">
                      <span className="gis-risk-dot" style={{
                        background:
                          selectedMine.risk === "high"
                            ? "#ca7a63"
                            : selectedMine.risk === "medium"
                              ? "#c6a261"
                              : "#52836a"
                      }} />
                      <span>
                        {selectedMine.risk === "high"
                          ? "High risk — requires immediate attention"
                          : selectedMine.risk === "medium"
                            ? "Medium risk — monitor closely"
                            : "Low risk — on track"}
                      </span>
                    </div>
                  </div>
                  <p className="gis-risk-note">
                    Risk assessment is based on compliance status, open corrective
                    actions, and environmental signals. This is a screening tool,
                    not a formal risk determination.
                  </p>
                </div>
              </div>
            </section>
          )}
        </aside>
      </div>

      <div className="gis-legend">
        <span className="gis-legend-title">Risk legend</span>
        <div className="gis-legend-items">
          <div className="gis-legend-item">
            <span className="gis-legend-dot" style={{ background: "#ca7a63" }} />
            <span>High risk</span>
          </div>
          <div className="gis-legend-item">
            <span className="gis-legend-dot" style={{ background: "#c6a261" }} />
            <span>Medium risk</span>
          </div>
          <div className="gis-legend-item">
            <span className="gis-legend-dot" style={{ background: "#52836a" }} />
            <span>Low risk</span>
          </div>
        </div>
      </div>
    </div>
  );
}

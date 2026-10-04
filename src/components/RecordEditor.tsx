import { useState, useCallback } from "react";
import { Save, MapPin, Loader2, ShieldCheck } from "lucide-react";
import { Modal, ErrorBox } from "./UI";
import {
  api,
  post,
  refresh,
  today,
  label,
  statuses,
  kindMeta,
  saveQueue,
} from "../lib";
import type { Entry, Kind, Mine, User } from "../types";
export function RecordEditor({
  kind,
  entry,
  mines,
  mine,
  user,
  onClose,
  onSaved,
}: {
  kind: Kind;
  entry?: Entry;
  mines: Mine[];
  mine: string;
  user: User;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const meta = kindMeta[kind];
  const defaults: Record<Kind, Record<string, any>> = {
    compliance: { regulation: "", documentId: "" },
    inspection: { inspector: user.name, findings: "" },
    action: { sourceId: "", resolution: "" },
    contractor: { workers: 0, contact: "", license: "" },
    operation: { tonnes: 0, target: 1, shift: "Morning" },
    environment: { pm10: 0, waterPh: 7, noise: 0 },
    attendance: { workerId: "", shift: "Morning", contractorId: "" },
    grievance: { reporter: "", resolution: "" },
    field: {
      latitude: null,
      longitude: null,
      accuracy: null,
      capturedAt: new Date().toISOString(),
      locationSource: "unavailable",
      deviceReportId: crypto.randomUUID(),
    },
  };
  const [form, setForm] = useState<any>(
    entry
      ? { ...entry, data: { ...entry.data } }
      : {
          mineId: mine !== "all" ? mine : mines[0]?.id || "",
          title: "",
          category: meta.categories[0],
          status: statuses[kind][0],
          priority: "medium",
          dueDate: today(),
          owner: user.name,
          notes: "",
          data: defaults[kind],
        },
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [locating, setLocating] = useState(false),
    [locError, setLocError] = useState("");
  const close = useCallback(() => {
    if (!busy) onClose();
  }, [onClose, busy]);
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const data = (k: string, v: any) =>
    setForm((f: any) => ({ ...f, data: { ...f.data, [k]: v } }));
  const locate = () => {
    if (!navigator.geolocation) {
      setLocError(
        "Location is not supported. You can still submit with location marked unavailable.",
      );
      return;
    }
    setLocating(true);
    setLocError("");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setForm((f: any) => ({
          ...f,
          data: {
            ...f.data,
            latitude: p.coords.latitude,
            longitude: p.coords.longitude,
            accuracy: p.coords.accuracy,
            locationSource: "device",
          },
        }));
        setLocating(false);
      },
      () => {
        setLocError(
          "Location permission was denied or a fix was unavailable. The report will explicitly show that location was not captured.",
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  };
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (kind === "field" && !entry && !navigator.onLine) {
        await saveQueue({
          id: form.data.deviceReportId,
          userId: user.id,
          body: form,
          queuedAt: new Date().toISOString(),
        });
        onSaved("Report saved on this device. Sync it when you reconnect.");
        onClose();
        refresh();
        return;
      }
      if (entry)
        await api(`/records/${kind}/${entry.id}`, {
          method: "PATCH",
          body: JSON.stringify(form),
        });
      else await post(`/records/${kind}`, form);
      refresh();
      onSaved(
        entry ? "Record updated successfully." : "Record created successfully.",
      );
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const input = (
    key: string,
    title: string,
    type = "text",
    isData = false,
    required = false,
    extra: Record<string, any> = {},
  ) => (
    <label key={key}>
      {title}
      <input
        type={type}
        value={(isData ? form.data[key] : form[key]) ?? ""}
        onChange={(e) =>
          isData
            ? data(
                key,
                type === "number" ? Number(e.target.value) : e.target.value,
              )
            : set(key, e.target.value)
        }
        required={required}
        {...extra}
      />
    </label>
  );
  return (
    <Modal
      title={`${entry ? "Edit" : "New"} ${meta.singular}`}
      subtitle="Changes are recorded in your workspace audit trail."
      onClose={close}
      wide
    >
      <form onSubmit={save} className="record-form">
        {error && <ErrorBox message={error} />}
        <div className="form-grid">
          <label className="full">
            {kind === "contractor"
              ? "Company name"
              : kind === "attendance"
                ? "Worker name"
                : "Title"}
            <input
              autoFocus
              value={form.title}
              maxLength={250}
              required
              onChange={(e) => set("title", e.target.value)}
              placeholder={`Give this ${meta.singular} a clear title`}
            />
          </label>
          <label>
            Mine site
            <select
              value={form.mineId}
              onChange={(e) => set("mineId", e.target.value)}
              required
            >
              <option value="" disabled>
                Select a mine
              </option>
              {mines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Category
            <select
              value={form.category}
              onChange={(e) => set("category", e.target.value)}
            >
              {Array.from(new Set([...meta.categories, form.category])).map(
                (c) => (
                  <option key={c}>{c}</option>
                ),
              )}
            </select>
          </label>
          <label>
            Status
            <select
              value={form.status}
              onChange={(e) => set("status", e.target.value)}
            >
              {statuses[kind].map((s) => (
                <option
                  key={s}
                  value={s}
                  disabled={
                    kind === "compliance" &&
                    s === "compliant" &&
                    user.role !== "admin"
                  }
                >
                  {label(s)}
                  {kind === "compliance" && s === "compliant"
                    ? " · admin approval"
                    : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select
              value={form.priority}
              onChange={(e) => set("priority", e.target.value)}
            >
              {["low", "medium", "high", "critical"].map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </select>
          </label>
          {input(
            "dueDate",
            meta.date,
            "date",
            false,
            !["field", "grievance"].includes(kind),
          )}
          {input("owner", "Responsible person", "text", false, true)}
          {kind === "compliance" && (
            <>
              {input(
                "regulation",
                "Regulation / control reference",
                "text",
                true,
              )}
              {input(
                "documentId",
                "Evidence document ID (optional)",
                "text",
                true,
              )}
            </>
          )}
          {kind === "inspection" && (
            <>
              {input("inspector", "Inspector", "text", true)}
              <label className="full">
                Inspection findings
                <textarea
                  value={form.data.findings}
                  onChange={(e) => data("findings", e.target.value)}
                  rows={3}
                />
              </label>
            </>
          )}
          {kind === "action" && (
            <>
              {input("sourceId", "Source record ID (optional)", "text", true)}
              <label className="full">
                Resolution evidence
                <textarea
                  value={form.data.resolution}
                  onChange={(e) => data("resolution", e.target.value)}
                  required={form.status === "resolved"}
                  rows={3}
                />
              </label>
            </>
          )}
          {kind === "contractor" && (
            <>
              {input("workers", "Deployed workers", "number", true, true, {
                min: 0,
                max: 100000,
              })}
              {input("contact", "Contact email / phone", "text", true)}
              {input("license", "Labour licence reference", "text", true)}
            </>
          )}
          {kind === "operation" && (
            <>
              {input("tonnes", "Actual output (tonnes)", "number", true, true, {
                min: 0,
                max: 1000000,
                step: "any",
              })}
              {input("target", "Target output (tonnes)", "number", true, true, {
                min: 1,
                max: 1000000,
                step: "any",
              })}
            </>
          )}
          {["operation", "attendance"].includes(kind) && (
            <label>
              Shift
              <select
                value={form.data.shift}
                onChange={(e) => data("shift", e.target.value)}
              >
                {["Morning", "Evening", "Night"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          )}
          {kind === "attendance" && (
            <>
              {input("workerId", "Worker ID", "text", true, true)}
              {input(
                "contractorId",
                "Contractor reference (optional)",
                "text",
                true,
              )}
            </>
          )}
          {kind === "environment" && (
            <>
              {input("pm10", "PM₁₀ (µg/m³)", "number", true, true, {
                min: 0,
                max: 10000,
                step: "any",
              })}
              {input("waterPh", "Water pH", "number", true, true, {
                min: 0,
                max: 14,
                step: "any",
              })}
              {input("noise", "Noise (dB)", "number", true, true, {
                min: 0,
                max: 200,
                step: "any",
              })}
            </>
          )}
          {kind === "grievance" && (
            <>
              {input("reporter", "Submitted by (optional)", "text", true)}
              <label className="full">
                Resolution notes
                <textarea
                  value={form.data.resolution}
                  onChange={(e) => data("resolution", e.target.value)}
                  rows={3}
                />
              </label>
            </>
          )}
          {kind === "field" && (
            <div className="location-box full">
              <div>
                <MapPin size={20} />
                <div>
                  <strong>
                    {form.data.latitude !== null
                      ? `${form.data.latitude.toFixed(6)}, ${form.data.longitude.toFixed(6)}`
                      : "Add the ground truth"}
                  </strong>
                  <p>
                    {form.data.accuracy !== null
                      ? `Device location · accuracy ±${Math.round(form.data.accuracy)} m`
                      : "Capture your device location. Never inferred or fabricated."}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="button secondary small"
                onClick={locate}
                disabled={locating || !!entry}
              >
                {locating ? (
                  <Loader2 className="spin" size={16} />
                ) : (
                  <MapPin size={15} />
                )}{" "}
                {locating ? "Locating…" : "Capture location"}
              </button>
              {locError && <p className="full">{locError}</p>}
              <small>
                Captured{" "}
                {new Date(form.data.capturedAt).toLocaleString("en-IN")} ·
                retained during offline sync
              </small>
            </div>
          )}
          <label className="full">
            {kind === "compliance" && form.status === "compliant"
              ? "Approval review note / evidence (required)"
              : "Notes & observations"}
            <textarea
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={3}
              maxLength={10000}
              required={kind === "compliance" && form.status === "compliant"}
              placeholder="Add context, supporting evidence, or next steps…"
            />
          </label>
        </div>
        <div className="form-footer">
          <span>
            <ShieldCheck size={15} /> Accountable by design
          </span>
          <div>
            <button
              type="button"
              className="button secondary"
              onClick={close}
              disabled={busy}
            >
              Cancel
            </button>
            <button className="button primary" disabled={busy || !mines.length}>
              {busy ? (
                <Loader2 size={16} className="spin" />
              ) : (
                <Save size={16} />
              )}{" "}
              {busy
                ? "Saving…"
                : kind === "field" && !navigator.onLine
                  ? "Save offline"
                  : "Save record"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

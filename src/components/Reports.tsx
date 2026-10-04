import { useState } from "react";
import {
  FileBarChart,
  Download,
  FileSpreadsheet,
  ShieldCheck,
  ChevronRight,
  Fingerprint,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import {
  useData,
  api,
  dateLabel,
  kindMeta,
  downloadReport,
  label,
} from "../lib";
import {
  PageHeading,
  ErrorBox,
  Loading,
  Empty,
  Badge,
  SectionHeader,
} from "./UI";
import type { Kind, User } from "../types";
export function Reports({ mine }: { mine: string }) {
  const [kind, setKind] = useState<Kind>("compliance"),
    [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  return (
    <div>
      <PageHeading
        eyebrow="FROM RECORDS TO READINESS"
        title="Your reporting, simplified."
        description="Consistent, traceable exports. Without the spreadsheet shuffle."
      />
      <div className="report-layout">
        <section className="panel report-builder">
          <span className="large-icon">
            <FileBarChart size={30} />
          </span>
          <h2>A clear record of progress.</h2>
          <p>
            Generate a report from your current mine scope and date range. Every
            export is recorded in the audit trail.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              downloadReport(kind, mine, "pdf", from, to);
            }}
          >
            <div className="form-grid">
              <label className="full">
                Report type
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as Kind)}
                >
                  {Object.entries(kindMeta).map(([k, m]) => (
                    <option key={k} value={k}>
                      {m.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                From date
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  max={to || undefined}
                />
              </label>
              <label>
                To date
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  min={from || undefined}
                />
              </label>
            </div>
            <small className="muted">
              Leave dates blank to include all records. Dates refer to the
              reporting / due date.
            </small>
            <div className="report-buttons">
              <button className="button primary">
                <Download size={16} /> Download PDF
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={!!(from && to && from > to)}
                onClick={() => downloadReport(kind, mine, "csv", from, to)}
              >
                <FileSpreadsheet size={16} /> Export CSV
              </button>
            </div>
          </form>
          <div className="subtle-note">
            <ShieldCheck size={17} />
            <p>
              These are internal governance reports, not regulator-approved
              filing formats. An authorized reviewer must verify statutory
              submissions.
            </p>
          </div>
        </section>
        <section className="panel report-catalog">
          <SectionHeader
            title="One workspace. Every responsibility."
            subtitle="Choose the perspective you need."
          />
          {Object.entries(kindMeta).map(([k, m]) => (
            <button
              key={k}
              onClick={() => setKind(k as Kind)}
              className={kind === k ? "active" : ""}
            >
              <span>
                <FileBarChart size={18} />
              </span>
              <div>
                <strong>{m.title}</strong>
                <small>{m.description}</small>
              </div>
              <ChevronRight size={17} />
            </button>
          ))}
        </section>
      </div>
    </div>
  );
}
export function Audit({ mine, user }: { mine: string; user: User }) {
  const { data, error, loading, reload } = useData<any[]>(
    `/audit?mine=${mine}`,
  );
  const [verification, setVerification] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [verifyError, setVerifyError] = useState("");
  async function verify() {
    setBusy(true);
    setVerifyError("");
    try {
      setVerification(await api("/audit/verify"));
    } catch (e) {
      setVerifyError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <PageHeading
        eyebrow="TRUST, WITH A TRACE"
        title="Every change has a story."
        description="A linked record of who did what, and when."
      >
        {["admin", "regulator"].includes(user.role) && (
          <button className="button primary" onClick={verify} disabled={busy}>
            {busy ? (
              <Loader2 className="spin" size={16} />
            ) : (
              <Fingerprint size={17} />
            )}{" "}
            Verify audit chain
          </button>
        )}
      </PageHeading>
      <div className="ai-disclosure">
        <span className="icon-tile">
          <Fingerprint size={23} />
        </span>
        <div>
          <strong>SHA-256 linked audit entries</strong>
          <p>
            Each entry includes the previous entry’s hash. Chain verification
            detects broken links and changed entries. This is tamper-evident
            application logging—not an immutable blockchain or external legal
            proof.
          </p>
        </div>
      </div>
      {verifyError && <ErrorBox message={verifyError} />}{" "}
      {verification && (
        <div className={verification.valid ? "success-box" : "error-box"}>
          <ShieldCheck size={19} />
          {verification.valid
            ? `Chain intact · ${verification.count} entries verified`
            : `Integrity issue detected at entry ${verification.brokenAt}`}
        </div>
      )}
      <section className="panel">
        <SectionHeader
          title="Activity trail"
          subtitle="Latest 500 entries within your authorized scope"
        />
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorBox message={error} retry={reload} />
        ) : !data?.length ? (
          <Empty
            title="Your history starts here"
            text="Record updates, approvals, uploads, and exports appear here."
          />
        ) : (
          <div className="audit-list">
            {data.map((a) => (
              <div className="audit-item" key={a.id}>
                <span className="audit-icon">
                  <Fingerprint size={17} />
                </span>
                <div>
                  <div>
                    <strong>{a.actor_name}</strong>
                    <Badge value="low">{label(a.action)}</Badge>
                  </div>
                  <p>{a.entity}</p>
                  <details>
                    <summary>
                      Entry #{a.id} ·{" "}
                      {new Date(a.created_at).toLocaleString("en-IN")}
                    </summary>
                    <p>
                      Hash: <code>{a.hash}</code>
                    </p>
                    <p>
                      Previous: <code>{a.previous_hash}</code>
                    </p>
                    <pre>{JSON.stringify(JSON.parse(a.payload), null, 2)}</pre>
                  </details>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

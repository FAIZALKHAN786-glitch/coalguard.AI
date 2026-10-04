import { useState } from "react";
import {
  Settings2,
  Plus,
  ShieldCheck,
  Users,
  Mountain,
  KeyRound,
  Server,
  Copy,
  Check,
  Loader2,
  LogOut,
} from "lucide-react";
import { useData, post, refresh, label } from "../lib";
import {
  PageHeading,
  Badge,
  SectionHeader,
  Modal,
  ErrorBox,
  Loading,
  Empty,
} from "./UI";
import type { User, Mine } from "../types";
export function Settings({
  user,
  mines,
  onAddMine,
  toast,
  onLogout,
}: {
  user: User;
  mines: Mine[];
  onAddMine: () => void;
  toast: (s: string) => void;
  onLogout: () => void;
}) {
  const { data: integrations } = useData<any>("/integrations");
  const { data: users, error: usersError } = useData<User[]>(
    user.role === "admin" ? "/users" : null,
  );
  const [addUser, setAddUser] = useState(false);
  return (
    <div>
      <PageHeading
        eyebrow="A WORKSPACE THAT WORKS FOR YOU"
        title="Workspace settings"
        description="People, sites, and the connections that bring them together."
      />
      <div className="settings-layout">
        <section className="panel profile-panel">
          <SectionHeader title="Your profile" />
          <div className="profile-large">
            <div className="avatar large">
              {user.name
                .split(" ")
                .map((n) => n[0])
                .slice(0, 2)
                .join("")}
            </div>
            <h3>{user.name}</h3>
            <p>{user.email}</p>
            <Badge value="active">{label(user.role)}</Badge>
          </div>
          <div className="profile-access">
            <ShieldCheck size={19} />
            <div>
              <strong>
                {user.mines.length
                  ? `${user.mines.length} assigned mine sites`
                  : "Portfolio-wide access"}
              </strong>
              <p>
                {user.role === "regulator"
                  ? "Read-only regulatory oversight"
                  : user.role === "field"
                    ? "Field reporting, grievances & attendance"
                    : user.role === "officer"
                      ? "Operational workflows & review submissions"
                      : "Workspace administration & compliance approval"}
              </p>
            </div>
          </div>
          <button className="button secondary" onClick={onLogout}>
            <LogOut size={16} /> Sign out
          </button>
        </section>
        <section className="panel integrations-panel">
          <SectionHeader
            title="Intelligence connections"
            subtitle="Credentials stay on the server. Always."
          />
          {["text", "decision", "embedding", "rerank"].map((type, i) => (
            <div className="integration-row" key={type}>
              <span className="icon-tile">
                <KeyRound size={17} />
              </span>
              <div>
                <strong>
                  {
                    [
                      "Conversational text model",
                      "Decision support model",
                      "Document embeddings",
                      "Evidence reranker",
                    ][i]
                  }
                </strong>
                <p>
                  {
                    [
                      "Question-specific, evidence-grounded answers",
                      "Advisory prioritization of risk signals",
                      "Semantic retrieval over document text",
                      "Refines the order of retrieved evidence",
                    ][i]
                  }
                </p>
              </div>
              <Badge
                value={integrations?.models?.[type] ? "active" : "pending"}
              >
                {integrations?.models?.[type]
                  ? "Configured"
                  : integrations?.configuredModels?.[type]
                    ? "Configured · disabled"
                    : "Not configured"}
              </Badge>
            </div>
          ))}
          {integrations?.policy?.reason && (
            <div className="config-help" role="status">
              <ShieldCheck size={18} />
              <p>
                {integrations.policy.reason} Provider configuration does not
                prove connectivity.
              </p>
            </div>
          )}
          <div className="config-help">
            <Server size={18} />
            <p>
              Configure <code>AI_TEXT_*</code>, <code>AI_DECISION_*</code>,{" "}
              <code>AI_EMBEDDING_*</code>, and <code>AI_RERANK_*</code> in the
              server environment, then restart the API. Use{" "}
              <code>.env.example</code> and the setup guide. Do not put secrets
              in browser code. In a private deployment, use hosting secrets or
              an absolute <code>AI_TEXT_API_KEY_FILE</code> path to a read-only
              secret mount, and explicitly enable <code>AI_ENABLED=true</code>.
            </p>
          </div>
        </section>
      </div>
      {user.role === "admin" && (
        <>
          <section className="panel settings-section">
            <SectionHeader
              title="People & permissions"
              subtitle="Mine-level access, with clear responsibilities."
              action="Add team member"
              onAction={() => setAddUser(true)}
            />
            {usersError && <ErrorBox message={usersError} />}
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Team member</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Mine access</th>
                  </tr>
                </thead>
                <tbody>
                  {users?.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <strong>{u.name}</strong>
                      </td>
                      <td>{u.email}</td>
                      <td>
                        <Badge value="low">{u.role}</Badge>
                      </td>
                      <td>
                        {u.mines.length
                          ? u.mines
                              .map((id) => mines.find((m) => m.id === id)?.name)
                              .join(", ")
                          : "All mine sites"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel settings-section">
            <SectionHeader
              title="Mine network"
              subtitle={`${mines.length} sites in your workspace`}
              action="Add mine site"
              onAction={onAddMine}
            />
            <div className="mine-settings-list">
              {mines.map((m) => (
                <div key={m.id}>
                  <Mountain size={20} />
                  <div>
                    <strong>{m.name}</strong>
                    <p>
                      {m.subsidiary} · {m.region}
                    </p>
                  </div>
                  <span>
                    {m.latitude.toFixed(3)}°, {m.longitude.toFixed(3)}°
                  </span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
      {addUser && (
        <UserForm
          mines={mines}
          onClose={() => setAddUser(false)}
          toast={toast}
        />
      )}
    </div>
  );
}
function UserForm({
  mines,
  onClose,
  toast,
}: {
  mines: Mine[];
  onClose: () => void;
  toast: (s: string) => void;
}) {
  const [form, setForm] = useState({
      name: "",
      email: "",
      password: "",
      role: "officer",
      mines: [] as string[],
    }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post("/users", form);
      refresh();
      toast(
        "Team member added. Share their credentials through a secure channel.",
      );
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Add a team member"
      subtitle="Access is enforced on the server, not only in the interface."
      onClose={onClose}
    >
      <form className="record-form" onSubmit={save}>
        {error && <ErrorBox message={error} />}
        <div className="form-grid">
          {(["name", "email", "password"] as const).map((k) => (
            <label className="full" key={k}>
              {label(k)}
              <input
                type={k === "name" ? "text" : k}
                required
                minLength={k === "password" ? 12 : 1}
                autoComplete={k === "password" ? "new-password" : "off"}
                value={form[k]}
                onChange={(e) =>
                  setForm((f) => ({ ...f, [k]: e.target.value }))
                }
              />
            </label>
          ))}
          <label className="full">
            Role
            <select
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
            >
              {["officer", "field", "regulator", "admin"].map((r) => (
                <option value={r} key={r}>
                  {label(r)}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="full mine-checkboxes">
            <legend>Assigned mine sites</legend>
            {mines.map((m) => (
              <label key={m.id}>
                <input
                  type="checkbox"
                  checked={form.mines.includes(m.id)}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      mines: e.target.checked
                        ? [...f.mines, m.id]
                        : f.mines.filter((id) => id !== m.id),
                    }))
                  }
                />
                {m.name}
              </label>
            ))}
            <small>
              Officers and field staff require at least one site. Admins have
              all-site access; regulators with no assigned sites can view the
              portfolio.
            </small>
          </fieldset>
        </div>
        <div className="form-footer">
          <span>Minimum 12-character password</span>
          <button className="button primary" disabled={busy}>
            {busy ? "Creating…" : "Create account"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function MineForm({
  onClose,
  toast,
}: {
  onClose: () => void;
  toast: (s: string) => void;
}) {
  const [form, setForm] = useState<any>({
      name: "",
      subsidiary: "",
      region: "",
      latitude: "",
      longitude: "",
      capacity: "",
    }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post("/mines", form);
      refresh();
      toast("Mine added to your connected portfolio.");
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Connect a mine site"
      subtitle="Create a shared home for this site's records and responsibilities."
      onClose={onClose}
    >
      <form className="record-form" onSubmit={save}>
        {error && <ErrorBox message={error} />}
        <div className="form-grid">
          {[
            ["name", "Mine name"],
            ["subsidiary", "Subsidiary"],
            ["region", "District, State"],
            ["latitude", "Latitude"],
            ["longitude", "Longitude"],
            ["capacity", "Annual capacity (MTPA)"],
          ].map(([k, t]) => (
            <label key={k} className={k === "name" ? "full" : ""}>
              {t}
              <input
                required
                value={form[k]}
                onChange={(e) =>
                  setForm((f: any) => ({ ...f, [k]: e.target.value }))
                }
                type={
                  ["latitude", "longitude", "capacity"].includes(k)
                    ? "number"
                    : "text"
                }
                step="any"
                min={
                  k === "latitude"
                    ? -90
                    : k === "longitude"
                      ? -180
                      : k === "capacity"
                        ? 0.001
                        : undefined
                }
                max={
                  k === "latitude"
                    ? 90
                    : k === "longitude"
                      ? 180
                      : k === "capacity"
                        ? 1000
                        : undefined
                }
              />
            </label>
          ))}
        </div>
        <div className="form-footer">
          <span>Site boundaries can be managed externally.</span>
          <button className="button primary" disabled={busy}>
            {busy ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}{" "}
            Add mine
          </button>
        </div>
      </form>
    </Modal>
  );
}

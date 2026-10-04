import { useCallback, useEffect, useState, useRef } from "react";
import type { Kind, User } from "./types";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
// Preview-only session fallback: memory for this tab, never browser storage or URLs.
let previewSessionToken: string | null = null;
export const hasPreviewSession = () => previewSessionToken !== null;
export function clearPreviewSession() {
  previewSessionToken = null;
}
export function sessionExpired() {
  clearPreviewSession();
  window.dispatchEvent(new Event("cg-session-expired"));
}
function browserStore(name: "localStorage" | "sessionStorage") {
  const fallback = new Map<string, string>();
  return {
    getItem(key: string) {
      try {
        return window[name].getItem(key);
      } catch {
        return fallback.get(key) ?? null;
      }
    },
    setItem(key: string, value: string) {
      fallback.set(key, value);
      try {
        window[name].setItem(key, value);
      } catch {
        /* Storage is optional for online sign-in. */
      }
    },
    removeItem(key: string) {
      fallback.delete(key);
      try {
        window[name].removeItem(key);
      } catch {
        /* Restricted embedding context. */
      }
    },
  };
}
export const localStore = browserStore("localStorage");
export const sessionStore = browserStore("sessionStorage");
async function request(
  path: string,
  options: RequestInit = {},
  timeoutMs = 20000,
): Promise<Response> {
  const controller = new AbortController();
  const aborted = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener("abort", aborted, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const headers = new Headers(options.headers);
    if (!(options.body instanceof FormData) && !headers.has("Content-Type"))
      headers.set("Content-Type", "application/json");
    if (previewSessionToken)
      headers.set("X-CoalGuard-Session", previewSessionToken);
    const res = await fetch("/api" + path, {
      ...options,
      credentials: "include",
      headers,
      signal: controller.signal,
    });
    if (!res.ok) {
      if (res.status === 401 && !path.startsWith("/auth/")) sessionExpired();
      let message =
        "The preview did not return an API response. Refresh it inside Arena and try again.";
      if (res.headers.get("content-type")?.includes("application/json")) {
        const data = await res.json();
        message = data.error || "Request failed";
      }
      throw new ApiError(
        message,
        res.status,
        res.headers.get("x-coalguard-request-id") || undefined,
      );
    }
    return res;
  } catch (error) {
    if (timedOut)
      throw new Error(
        "The server took too long to respond. Refresh the preview, then try signing in again.",
      );
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", aborted);
  }
}
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await request(
    path,
    options,
    path.startsWith("/ai/") ? 120000 : 20000,
  );
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw new Error(
      "The preview returned a page instead of an API response. Reopen the live preview inside Arena.",
    );
  return response.json();
}
export const post = <T = any,>(path: string, body: unknown) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });
export async function signIn(
  path: "/auth/login" | "/auth/demo",
  body: Record<string, unknown>,
): Promise<User> {
  clearPreviewSession();
  await post(path, body);
  try {
    return (await api<{ user: User }>("/auth/me")).user;
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    const config = await api<{ demo: boolean; embeddedPreview: boolean }>(
      "/config",
    );
    if (!config.demo || !config.embeddedPreview)
      throw new Error(
        "Your browser did not keep the sign-in session. Open the workspace directly in its own tab and sign in again.",
      );
    const session = await post<{ accessToken?: string; transport?: string }>(
      path,
      { ...body, sessionTransport: "memory" },
    );
    if (session.transport !== "memory" || !session.accessToken)
      throw new Error(
        "Could not establish the demonstration session. Refresh the Arena preview and try again.",
      );
    previewSessionToken = session.accessToken;
    try {
      return (await api<{ user: User }>("/auth/me")).user;
    } catch (error) {
      clearPreviewSession();
      if (error instanceof ApiError && error.status === 401)
        throw new Error(
          `The preview could not keep your demo session. ${error.requestId ? `Connection reference: ${error.requestId}. ` : ""}Please share this message so the failed request can be traced.`,
        );
      throw error;
    }
  }
}
export async function downloadFile(path: string, filename: string) {
  try {
    const response = await request(path, {}, 120000);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) {
    window.dispatchEvent(
      new CustomEvent("cg-notice", { detail: (error as Error).message }),
    );
  }
}
export function refresh() {
  window.dispatchEvent(new Event("cg-refresh"));
}
export function useData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    const seq = ++sequence.current;
    controller.current?.abort();
    controller.current = new AbortController();
    if (!path) {
      setLoading(false);
      return;
    }
    try {
      const d = await api<T>(path, { signal: controller.current.signal });
      if (seq === sequence.current) {
        setData(d);
        setError("");
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError" && seq === sequence.current)
        setError((e as Error).message);
    } finally {
      if (seq === sequence.current) setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    setData(null);
    setError("");
    setLoading(true);
    void load();
    const timer = setInterval(load, 30000);
    window.addEventListener("cg-refresh", load);
    window.addEventListener("online", load);
    return () => {
      ++sequence.current;
      controller.current?.abort();
      clearInterval(timer);
      window.removeEventListener("cg-refresh", load);
      window.removeEventListener("online", load);
    };
  }, [load]);
  return { data, error, loading, reload: load };
}
export const fmt = (n: number) => new Intl.NumberFormat("en-IN").format(n);
export const label = (s: string) =>
  s.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
export const dateLabel = (
  s: string | null,
  opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" },
) =>
  s
    ? new Date(s.length === 10 ? s + "T12:00:00" : s).toLocaleDateString(
        "en-IN",
        opts,
      )
    : "Not set";
export const today = () => new Date().toISOString().slice(0, 10);
export const canWrite = (u: User, kind?: Kind) =>
  u.role === "admin" ||
  u.role === "officer" ||
  (u.role === "field" &&
    kind &&
    ["field", "attendance", "grievance"].includes(kind));
export const statuses: Record<Kind, string[]> = {
  compliance: [
    "pending",
    "in_progress",
    "under_review",
    "compliant",
    "overdue",
  ],
  inspection: ["scheduled", "in_progress", "completed", "cancelled"],
  action: ["open", "in_progress", "under_review", "resolved"],
  contractor: ["active", "under_review", "suspended", "expired"],
  operation: ["submitted", "verified", "flagged"],
  environment: ["submitted", "verified", "flagged"],
  attendance: ["present", "absent", "on_leave"],
  grievance: ["open", "in_progress", "resolved"],
  field: ["open", "in_progress", "resolved"],
};
export const kindMeta: Record<
  Kind,
  {
    title: string;
    singular: string;
    description: string;
    categories: string[];
    date: string;
  }
> = {
  compliance: {
    title: "Compliance register",
    singular: "obligation",
    description: "Every obligation. One source of truth.",
    categories: ["Safety", "Environment", "Labour", "Production"],
    date: "Due date",
  },
  inspection: {
    title: "Inspections",
    singular: "inspection",
    description: "From the first observation to the final sign-off.",
    categories: ["Safety", "Environment", "Equipment", "Labour"],
    date: "Inspection date",
  },
  action: {
    title: "Corrective actions",
    singular: "action",
    description: "Close the loop on observations and violations.",
    categories: ["Safety", "Environment", "Labour", "Production"],
    date: "Target date",
  },
  contractor: {
    title: "Contractors",
    singular: "contractor",
    description: "Connected partners. Accountable operations.",
    categories: ["Mining services", "Transport", "Equipment", "Civil works"],
    date: "Contract expiry",
  },
  operation: {
    title: "Production & operations",
    singular: "production record",
    description: "A clear picture of output, targets, and shift performance.",
    categories: ["Production", "Dispatch"],
    date: "Reporting date",
  },
  environment: {
    title: "Environment",
    singular: "monitoring record",
    description: "Track the footprint. Protect what surrounds us.",
    categories: ["Environment", "Air quality", "Water quality", "Noise"],
    date: "Sample date",
  },
  attendance: {
    title: "Worker attendance",
    singular: "attendance record",
    description: "A dependable daily record of the people on site.",
    categories: ["Attendance"],
    date: "Attendance date",
  },
  grievance: {
    title: "Grievances",
    singular: "grievance",
    description: "Every voice heard. Every concern accounted for.",
    categories: ["Welfare", "Safety", "Payment", "Other"],
    date: "Resolution target",
  },
  field: {
    title: "Field workspace",
    singular: "field report",
    description: "Ground-level observations. Connected to the bigger picture.",
    categories: ["Safety", "Environment", "Incident", "Observation"],
    date: "Follow-up date",
  },
};
export function useRoute() {
  const get = () => location.hash.slice(1).split("?")[0] || "dashboard";
  const [route, setRoute] = useState(get);
  useEffect(() => {
    const f = () => setRoute(get());
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  return route;
}
export function navigate(route: string) {
  location.hash = route;
}
export function downloadReport(
  kind: string,
  mine: string,
  format = "csv",
  from = "",
  to = "",
) {
  const p = new URLSearchParams({ kind, mine, from, to });
  void downloadFile(`/reports/${format}?${p}`, `coalguard-${kind}.${format}`);
}
export type QueuedReport = {
  id: string;
  userId: string;
  body: any;
  queuedAt: string;
  error?: string;
};
function queueDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("coalguard-offline", 1);
    req.onupgradeneeded = () =>
      req.result.createObjectStore("reports", { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function queueReports(userId: string): Promise<QueuedReport[]> {
  const db = await queueDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("reports", "readonly");
    const r = tx.objectStore("reports").getAll();
    r.onsuccess = () =>
      resolve((r.result as QueuedReport[]).filter((q) => q.userId === userId));
    r.onerror = () => reject(r.error);
    tx.oncomplete = () => db.close();
  });
}
export async function saveQueue(report: QueuedReport) {
  const db = await queueDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("reports", "readwrite");
    tx.objectStore("reports").put(report);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
export async function deleteQueue(id: string) {
  const db = await queueDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("reports", "readwrite");
    tx.objectStore("reports").delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

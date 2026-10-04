export const today = () => new Date().toISOString().slice(0, 10);
const closed = new Set([
  "compliant",
  "completed",
  "resolved",
  "cancelled",
  "verified",
]);
export function insights(records, mines) {
  const result = [];
  const date = today();
  for (const m of mines) {
    const rows = records.filter((r) => r.mineId === m.id);
    const overdue = rows.filter(
      (r) =>
        ["compliance", "action"].includes(r.kind) &&
        r.dueDate &&
        r.dueDate < date &&
        !closed.has(r.status),
    );
    if (overdue.length)
      result.push({
        id: `overdue-${m.id}`,
        mineId: m.id,
        title: `${overdue.length} overdue obligation${overdue.length > 1 ? "s" : ""}`,
        description: `${m.name} has overdue compliance items or corrective actions. Assign owners and verify closure evidence.`,
        severity: overdue.length > 2 ? "high" : "medium",
        category: "Compliance",
        evidence: overdue.map((r) => r.id),
        recommendation:
          "Review overdue controls, confirm deadlines, and escalate items overdue by more than seven days.",
      });
    const env = rows
      .filter((r) => r.kind === "environment")
      .sort((a, b) => b.dueDate.localeCompare(a.dueDate))[0];
    if (
      env &&
      (env.data.pm10 > 100 ||
        env.data.noise > 75 ||
        env.data.waterPh < 6.5 ||
        env.data.waterPh > 8.5)
    )
      result.push({
        id: `environment-${m.id}`,
        mineId: m.id,
        title: "Environmental reading outside screening range",
        description: `${m.name}: PM₁₀ ${env.data.pm10} µg/m³, noise ${env.data.noise} dB, pH ${env.data.waterPh}. Screening thresholds are illustrative, not a regulatory determination.`,
        severity: "high",
        category: "Environment",
        evidence: [env.id],
        recommendation:
          "Confirm sample method and averaging period, verify readings, and compare with site-specific consent limits.",
      });
    const ops = rows.filter(
      (r) => r.kind === "operation" && r.dueDate === date,
    );
    const t = ops.reduce((s, r) => s + r.data.target, 0),
      v = ops.reduce((s, r) => s + r.data.tonnes, 0);
    if (t && v / t < 0.8)
      result.push({
        id: `production-${m.id}`,
        mineId: m.id,
        title: "Production below planned output",
        description: `${m.name} is at ${Math.round((v / t) * 100)}% of its reported daily target.`,
        severity: "medium",
        category: "Production",
        evidence: ops.map((r) => r.id),
        recommendation:
          "Review shift downtime, dispatch constraints, and equipment availability. Never trade safety for output.",
      });
    const group = {};
    for (const r of rows.filter(
      (r) => ["field", "action"].includes(r.kind) && r.status !== "resolved",
    ))
      (group[r.category] ??= []).push(r);
    for (const [cat, rr] of Object.entries(group))
      if (rr.length >= 3)
        result.push({
          id: `recurring-${m.id}-${cat}`,
          mineId: m.id,
          title: `Recurring ${cat.toLowerCase()} observations`,
          description: `${rr.length} open items share this category at ${m.name}.`,
          severity: "high",
          category: cat,
          evidence: rr.map((r) => r.id),
          recommendation:
            "Perform a root-cause review and assign a preventive action.",
        });
  }
  return result.sort(
    (a, b) =>
      (a.severity === "high" ? -1 : 1) - (b.severity === "high" ? -1 : 1),
  );
}
export function dashboard(records, mines) {
  const signals = insights(records, mines);
  const cs = records.filter((r) => r.kind === "compliance");
  const date = today();
  const previous = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const production = (d) =>
    records
      .filter((r) => r.kind === "operation" && r.dueDate === d)
      .reduce((s, r) => s + r.data.tonnes, 0);
  const mineStats = mines.map((m) => {
    const rows = cs.filter((r) => r.mineId === m.id),
      complete = rows.filter((r) => r.status === "compliant").length;
    const pending = records.filter(
      (r) =>
        r.mineId === m.id &&
        ["compliance", "action"].includes(r.kind) &&
        r.dueDate < date &&
        !closed.has(r.status),
    ).length;
    return {
      ...m,
      compliance: rows.length
        ? Math.round((complete / rows.length) * 100)
        : null,
      obligations: rows.length,
      overdue: pending,
      risk: signals.some((s) => s.mineId === m.id && s.severity === "high")
        ? "high"
        : pending
          ? "medium"
          : "low",
    };
  });
  const trend = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.now() - (13 - i) * 86400000)
      .toISOString()
      .slice(0, 10);
    const ops = records.filter(
      (r) => r.kind === "operation" && r.dueDate === d,
    );
    return {
      date: d,
      actual: ops.reduce((s, r) => s + r.data.tonnes, 0),
      target: ops.reduce((s, r) => s + r.data.target, 0),
    };
  });
  return {
    compliance: cs.length
      ? Math.round(
          (cs.filter((r) => r.status === "compliant").length / cs.length) * 100,
        )
      : null,
    complianceCount: cs.filter((r) => r.status === "compliant").length,
    totalCompliance: cs.length,
    openActions: records.filter(
      (r) => r.kind === "action" && !closed.has(r.status),
    ).length,
    inspections: records.filter(
      (r) => r.kind === "inspection" && r.status !== "cancelled",
    ).length,
    completedInspections: records.filter(
      (r) => r.kind === "inspection" && r.status === "completed",
    ).length,
    production: production(date),
    previousProduction: production(previous),
    mines: mineStats,
    trend,
    insights: signals,
    categoryCompliance: ["Safety", "Environment", "Labour", "Production"].map(
      (category) => {
        const rows = cs.filter((r) => r.category === category);
        return {
          category,
          total: rows.length,
          complete: rows.filter((r) => r.status === "compliant").length,
        };
      },
    ),
  };
}
export function notifications(records) {
  return records
    .filter(
      (r) =>
        r.dueDate &&
        !closed.has(r.status) &&
        ["compliance", "action", "inspection", "contractor"].includes(r.kind),
    )
    .flatMap((r) => {
      const diff = Math.floor(
        (Date.parse(r.dueDate) - Date.parse(today())) / 86400000,
      );
      if (diff > 7) return [];
      return [
        {
          id: `${r.id}:${r.dueDate}:${r.status}`,
          recordId: r.id,
          mineId: r.mineId,
          kind: r.kind,
          title: r.title,
          severity: diff < -7 ? "critical" : diff < 0 ? "high" : "medium",
          message:
            diff < -7
              ? `Escalated · ${-diff} days overdue`
              : diff < 0
                ? `${-diff} days overdue`
                : diff === 0
                  ? "Due today"
                  : `Due in ${diff} days`,
          dueDate: r.dueDate,
        },
      ];
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

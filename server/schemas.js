import { z } from "zod";
const text = z.string().trim().min(1).max(250);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(s);
    return !isNaN(d) && d.toISOString().slice(0, 10) === s;
  }, "Invalid calendar date");
const optionalDate = z.union([date, z.literal(""), z.null()]).optional();
export const statuses = {
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
const dataSchemas = {
  compliance: z.object({
    regulation: z.string().max(250).default(""),
    documentId: z.string().max(100).default(""),
  }),
  inspection: z.object({
    inspector: z.string().max(150).default(""),
    findings: z.string().max(5000).default(""),
  }),
  action: z.object({
    sourceId: z.string().max(100).default(""),
    resolution: z.string().max(5000).default(""),
  }),
  contractor: z.object({
    workers: z.coerce.number().int().min(0).max(100000),
    contact: z.string().max(150).default(""),
    license: z.string().max(150).default(""),
  }),
  operation: z.object({
    tonnes: z.coerce.number().min(0).max(1000000),
    target: z.coerce.number().positive().max(1000000),
    shift: z.enum(["Morning", "Evening", "Night"]),
  }),
  environment: z.object({
    pm10: z.coerce.number().min(0).max(10000),
    waterPh: z.coerce.number().min(0).max(14),
    noise: z.coerce.number().min(0).max(200),
  }),
  attendance: z.object({
    workerId: text,
    shift: z.enum(["Morning", "Evening", "Night"]),
    contractorId: z.string().max(100).default(""),
  }),
  grievance: z.object({
    reporter: z.string().max(150).default("Anonymous"),
    resolution: z.string().max(5000).default(""),
  }),
  field: z.object({
    latitude: z.number().min(-90).max(90).nullable().default(null),
    longitude: z.number().min(-180).max(180).nullable().default(null),
    accuracy: z.number().nonnegative().nullable().default(null),
    capturedAt: z.string().datetime(),
    locationSource: z.enum(["device", "unavailable"]),
    deviceReportId: z.string().max(100).optional(),
  }),
};
export function recordSchema(kind) {
  return z
    .object({
      mineId: text,
      title: text,
      category: text,
      status: z.enum(statuses[kind]),
      priority: z.enum(["low", "medium", "high", "critical"]),
      dueDate: optionalDate,
      owner: text,
      notes: z.string().max(10000).default(""),
      data: dataSchemas[kind],
      version: z.number().int().positive().optional(),
    })
    .superRefine((v, ctx) => {
      if (
        [
          "compliance",
          "inspection",
          "action",
          "contractor",
          "operation",
          "environment",
          "attendance",
        ].includes(kind) &&
        !v.dueDate
      )
        ctx.addIssue({
          code: "custom",
          path: ["dueDate"],
          message: "Date is required",
        });
      if (
        kind === "action" &&
        v.status === "resolved" &&
        !v.data.resolution?.trim()
      )
        ctx.addIssue({
          code: "custom",
          path: ["data", "resolution"],
          message: "Record a resolution before closing an action",
        });
      if (
        kind === "field" &&
        v.data.locationSource === "device" &&
        (v.data.latitude === null || v.data.longitude === null)
      )
        ctx.addIssue({
          code: "custom",
          path: ["data"],
          message: "Device coordinates are required",
        });
    });
}
export const loginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});
export const userSchema = z.object({
  name: text,
  email: z.string().email().max(200),
  password: z.string().min(12).max(200),
  role: z.enum(["admin", "officer", "field", "regulator"]),
  mines: z.array(text).max(100).default([]),
});
export const mineSchema = z.object({
  name: text,
  subsidiary: text,
  region: text,
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  capacity: z.coerce.number().positive().max(1000),
});

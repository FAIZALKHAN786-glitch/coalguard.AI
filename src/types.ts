export type Role = "admin" | "officer" | "field" | "regulator";
export type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  mines: string[];
};
export type Mine = {
  id: string;
  name: string;
  subsidiary: string;
  region: string;
  latitude: number;
  longitude: number;
  capacity: number;
  compliance?: number | null;
  overdue?: number;
  risk?: string;
  obligations?: number;
};
export type Kind =
  | "compliance"
  | "inspection"
  | "action"
  | "contractor"
  | "operation"
  | "environment"
  | "attendance"
  | "grievance"
  | "field";
export type Entry = {
  id: string;
  kind: Kind;
  mineId: string;
  title: string;
  category: string;
  status: string;
  priority: string;
  dueDate: string | null;
  owner: string;
  notes: string;
  data: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  version: number;
};
export type Signal = {
  id: string;
  mineId: string;
  title: string;
  description: string;
  severity: string;
  category: string;
  evidence: string[];
  recommendation: string;
};
export type Dashboard = {
  compliance: number | null;
  complianceCount: number;
  totalCompliance: number;
  openActions: number;
  inspections: number;
  completedInspections: number;
  production: number;
  previousProduction: number;
  mines: Mine[];
  trend: { date: string; actual: number; target: number }[];
  insights: Signal[];
  categoryCompliance: { category: string; total: number; complete: number }[];
  updatedAt: string;
};
export type Notice = {
  id: string;
  recordId: string;
  mineId: string;
  kind: Kind;
  title: string;
  severity: string;
  message: string;
  dueDate: string;
  read: boolean;
};
export type Doc = {
  id: string;
  mine_id: string;
  name: string;
  mime: string;
  size: number;
  text: string;
  status: string;
  created_at: string;
};

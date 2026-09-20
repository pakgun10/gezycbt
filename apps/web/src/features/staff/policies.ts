import type { StaffRole } from "./types";

export const MONITOR_POLL_INTERVAL_MS = 15_000;
export const MONITOR_JITTER_MS = 3_000;

export interface StaffMenuItem {
  readonly key: string;
  readonly label: string;
  readonly to: string;
  readonly roles: readonly StaffRole[];
}

export const STAFF_MENU: readonly StaffMenuItem[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    to: "/staff/dashboard",
    roles: ["ADMIN", "TEACHER"],
  },
  { key: "users", label: "Pengguna", to: "/admin/users", roles: ["ADMIN"] },
  {
    key: "academic",
    label: "Akademik",
    to: "/admin/academic",
    roles: ["ADMIN"],
  },
  {
    key: "teachers",
    label: "Guru",
    to: "/admin/teachers",
    roles: ["ADMIN"],
  },
  {
    key: "questions",
    label: "Bank Soal",
    to: "/teacher/questions",
    roles: ["ADMIN", "TEACHER"],
  },
  {
    key: "exams",
    label: "Ujian",
    to: "/teacher/exams",
    roles: ["ADMIN", "TEACHER"],
  },
  {
    key: "schedules",
    label: "Jadwal",
    to: "/teacher/schedules",
    roles: ["ADMIN", "TEACHER"],
  },
  {
    key: "monitoring",
    label: "Monitoring",
    to: "/teacher/monitoring",
    roles: ["ADMIN", "TEACHER"],
  },
  {
    key: "results",
    label: "Hasil",
    to: "/teacher/results",
    roles: ["ADMIN", "TEACHER"],
  },
  {
    key: "exports",
    label: "Export",
    to: "/teacher/exports",
    roles: ["ADMIN", "TEACHER"],
  },
  { key: "audit", label: "Audit Log", to: "/admin/audit", roles: ["ADMIN"] },
  {
    key: "integrations",
    label: "Integrasi Agent",
    to: "/admin/integrations",
    roles: ["ADMIN"],
  },
];

export function menuForRole(role: StaffRole): readonly StaffMenuItem[] {
  return STAFF_MENU.filter((item) => item.roles.includes(role));
}

export function nextMonitorDelay(random = Math.random()): number {
  const bounded = Math.min(Math.max(random, 0), 1);
  return (
    MONITOR_POLL_INTERVAL_MS -
    MONITOR_JITTER_MS +
    Math.round(bounded * MONITOR_JITTER_MS * 2)
  );
}

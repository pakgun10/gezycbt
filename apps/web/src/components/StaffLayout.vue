<script setup lang="ts">
import { computed, ref } from "vue";
import { useEscapeClose } from "../lib/dialog-a11y";
import { RouterLink, useRoute, useRouter } from "vue-router";
import ThemeToggle from "./ThemeToggle.vue";
import StaffSectionBoundary from "./StaffSectionBoundary.vue";
import { menuForRole } from "../features/staff/policies";
import { useStaffAuth } from "../features/staff/auth-store";
import { mutationHeaders } from "../lib/api";

const props = defineProps<{ readonly title: string; readonly area?: "Admin" | "Guru" }>();
const auth = useStaffAuth();
const route = useRoute();
const router = useRouter();
const menuOpen = ref(false);

const role = computed(() => auth.user.value?.role ?? (props.area === "Admin" ? "ADMIN" : "TEACHER"));
const admin = computed(() => role.value === "ADMIN");
const nav = computed(() => menuForRole(role.value === "ADMIN" ? "ADMIN" : "TEACHER").map((item) => ({
  ...item,
  to: item.key === "dashboard" ? `/${admin.value ? "admin" : "teacher"}/dashboard` : item.to,
  icon: { dashboard: "⌂", users: "◎", academic: "▦", teachers: "♙", questions: "◇", exams: "□", schedules: "◷", monitoring: "◉", results: "▤", exports: "⇩", audit: "≡", backup: "▣", integrations: "⚿" }[item.key] ?? "•",
})));
const menuFilter = ref("");
const menuGroups = [
  { label: "Kelola", keys: ["users", "academic", "teachers"] },
  { label: "Konten", keys: ["questions", "exams", "schedules"] },
  { label: "Pantau", keys: ["monitoring", "results", "exports"] },
  { label: "Sistem", keys: ["audit", "backup", "integrations"] },
] as const;
const dashboardItem = computed(() => nav.value.find((item) => item.key === "dashboard"));
const dashboardVisible = computed(
  () => !menuFilter.value || (dashboardItem.value?.label.toLowerCase().includes(menuFilter.value.toLowerCase()) ?? false),
);
const filteredGroups = computed(() =>
  menuGroups
    .map((group) => ({
      label: group.label,
      items: nav.value.filter(
        (item) =>
          group.keys.some((key) => key === item.key) &&
          item.label.toLowerCase().includes(menuFilter.value.toLowerCase()),
      ),
    }))
    .filter((group) => group.items.length > 0),
);
const currentItem = computed(() =>
  nav.value.find((item) => route.path === item.to || route.path.startsWith(`${item.to}/`)),
);
const dashboardTo = computed(() => (admin.value ? "/admin/dashboard" : "/teacher/dashboard"));

function active(to: string): boolean { return route.path === to || route.path.startsWith(`${to}/`); }
function closeMenu(): void { menuOpen.value = false; }
useEscapeClose(menuOpen, closeMenu);
async function logout(): Promise<void> {
  try {
    await fetch("/api/v1/auth/logout", {
      method: "POST",
      credentials: "include",
      headers: mutationHeaders(crypto.randomUUID(), auth.csrfToken.value),
    });
  } finally {
    auth.clear();
    await router.replace("/staff/login");
  }
}
</script>

<template>
  <div class="staff-app">
    <a class="skip-link" href="#staff-content">Lewati ke konten utama</a>
    <header class="staff-topbar">
      <button class="mobile-menu btn-secondary" type="button" aria-label="Buka menu navigasi" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen">☰</button>
      <RouterLink class="brand" :to="admin ? '/admin/dashboard' : '/teacher/dashboard'">GezyCBT</RouterLink>
      <span class="topbar-context">{{ currentItem?.label ?? props.title }}</span>
      <div class="topbar-actions"><ThemeToggle /><span class="user-chip">{{ auth.user.value?.displayName ?? "Staff" }}</span><button class="btn-quiet" type="button" @click="logout">Keluar</button></div>
    </header>
    <div class="staff-body">
      <aside class="staff-sidebar" :class="{ open: menuOpen }" aria-label="Navigasi staf">
        <label class="menu-search"><span class="sr-only">Cari menu</span><input v-model="menuFilter" type="search" placeholder="Cari menu…" aria-label="Cari menu" /></label>
        <nav v-if="dashboardItem && dashboardVisible" aria-label="Menu utama">
          <RouterLink :to="dashboardItem.to" :class="{ active: active(dashboardItem.to) }" @click="closeMenu"><span aria-hidden="true">{{ dashboardItem.icon }}</span><span>{{ dashboardItem.label }}</span></RouterLink>
        </nav>
        <section v-for="group in filteredGroups" :key="group.label" class="menu-group">
          <h2>{{ group.label }}</h2>
          <nav :aria-label="`Menu ${group.label}`">
            <RouterLink v-for="item in group.items" :key="item.to" :to="item.to" :class="{ active: active(item.to) }" @click="closeMenu"><span aria-hidden="true">{{ item.icon }}</span><span>{{ item.label }}</span></RouterLink>
          </nav>
        </section>
        <p v-if="menuFilter && !dashboardVisible && filteredGroups.length === 0" class="muted menu-empty">Tidak ada menu yang cocok.</p>
        <div class="sidebar-help"><strong>Butuh bantuan?</strong><p class="muted">Perubahan penting selalu meminta konfirmasi dan dicatat di audit.</p></div>
      </aside>
      <div v-if="menuOpen" class="sidebar-scrim" aria-hidden="true" @click="closeMenu" />
      <main id="staff-content" class="staff-content" tabindex="-1">
        <nav class="breadcrumb" aria-label="Breadcrumb">
          <RouterLink :to="dashboardTo">Dashboard</RouterLink>
          <template v-if="currentItem && currentItem.key !== 'dashboard'">
            <span aria-hidden="true"> / </span>
            <span aria-current="page">{{ currentItem.label }}</span>
          </template>
        </nav>
        <StaffSectionBoundary><slot /></StaffSectionBoundary>
      </main>
    </div>
  </div>
</template>

<style scoped>
.staff-app { min-height: 100vh; background: var(--canvas); }
.staff-topbar { position: sticky; top: 0; z-index: 10; min-height: 64px; display: flex; align-items: center; gap: 16px; padding: 10px 24px; border-bottom: 1px solid var(--border); background: color-mix(in srgb, var(--surface) 94%, transparent); backdrop-filter: blur(12px); }
.brand { color: var(--text); font-weight: 800; font-size: 1.125rem; text-decoration: none; }
.topbar-context { color: var(--muted); border-left: 1px solid var(--border); padding-left: 16px; }
.topbar-actions { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.user-chip { max-width: 180px; overflow: hidden; color: var(--muted); text-overflow: ellipsis; white-space: nowrap; }
.mobile-menu { display: none; min-height: 40px; padding: 0 10px; }
.staff-body { display: grid; grid-template-columns: 240px minmax(0, 1fr); min-height: calc(100vh - 64px); }
.staff-sidebar { display: flex; flex-direction: column; gap: 24px; padding: 24px 14px; border-right: 1px solid var(--border); background: var(--surface); }
.staff-sidebar nav { display: grid; gap: 4px; }
.staff-sidebar nav a { display: flex; align-items: center; gap: 12px; min-height: 40px; padding: 8px 12px; border-radius: 8px; color: var(--muted); text-decoration: none; }
.menu-search input { width: 100%; min-height: 40px; border: 1px solid var(--border-strong); border-radius: 8px; padding: 8px 10px; color: var(--text); background: var(--surface); }
.menu-group h2 { margin: 8px 12px 4px; color: var(--subtle); font-size: .8rem; }
.menu-empty { padding: 0 12px; font-size: .875rem; }
.breadcrumb { margin-bottom: 16px; color: var(--muted); font-size: .875rem; }
.breadcrumb [aria-current="page"] { color: var(--text); font-weight: 600; }
.staff-sidebar nav a:hover, .staff-sidebar nav a.active { color: var(--text); background: var(--primary-soft); }
.staff-sidebar nav a.active { font-weight: 700; }
.sidebar-help { margin-top: auto; padding: 14px; border: 1px solid var(--border); border-radius: 10px; font-size: .84rem; }
.sidebar-help p { margin-bottom: 0; }
.staff-content { min-width: 0; padding: 28px clamp(16px, 4vw, 48px) 64px; }
@media (max-width: 767px) {
  .staff-topbar { padding: 8px 12px; }
  .mobile-menu { display: inline-flex; align-items: center; justify-content: center; }
  .topbar-context, .user-chip { display: none; }
  .staff-body { display: block; }
  .staff-sidebar { position: fixed; inset: 64px auto 0 0; z-index: 12; width: min(280px, 84vw); transform: translateX(-105%); transition: transform .2s ease; box-shadow: var(--shadow); }
  .staff-sidebar.open { transform: translateX(0); }
  .sidebar-scrim { position: fixed; inset: 64px 0 0; z-index: 11; background: rgb(2 6 23 / 35%); }
  .staff-content { padding: 20px 14px 48px; }
}
@media (prefers-reduced-motion: reduce) { .staff-sidebar { transition: none; } }
</style>

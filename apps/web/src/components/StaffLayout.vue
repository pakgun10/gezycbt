<script setup lang="ts">
import { computed, ref } from "vue";
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
  icon: { dashboard: "⌂", users: "◎", academic: "▦", questions: "◇", exams: "□", schedules: "◷", monitoring: "◉", results: "▤", exports: "⇩", audit: "≡" }[item.key] ?? "•",
})));
const visibleNav = computed(() => nav.value);

function active(to: string): boolean { return route.path === to || route.path.startsWith(`${to}/`); }
function closeMenu(): void { menuOpen.value = false; }
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
      <span class="topbar-context">{{ props.title }}</span>
      <div class="topbar-actions"><ThemeToggle /><span class="user-chip">{{ auth.user.value?.displayName ?? "Staff" }}</span><button class="btn-quiet" type="button" @click="logout">Keluar</button></div>
    </header>
    <div class="staff-body">
      <aside class="staff-sidebar" :class="{ open: menuOpen }" aria-label="Navigasi staf">
        <nav>
          <RouterLink v-for="item in visibleNav" :key="item.to" :to="item.to" :class="{ active: active(item.to) }" @click="closeMenu"><span aria-hidden="true">{{ item.icon }}</span><span>{{ item.label }}</span></RouterLink>
        </nav>
        <div class="sidebar-help"><strong>Butuh bantuan?</strong><p class="muted">Perubahan penting selalu meminta konfirmasi dan dicatat di audit.</p></div>
      </aside>
      <div v-if="menuOpen" class="sidebar-scrim" aria-hidden="true" @click="closeMenu" />
      <main id="staff-content" class="staff-content" tabindex="-1"><StaffSectionBoundary><slot /></StaffSectionBoundary></main>
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

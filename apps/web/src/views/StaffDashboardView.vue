<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { useStaffAuth } from "../features/staff/auth-store";

const auth = useStaffAuth();
const isAdmin = computed(() => auth.user.value?.role === "ADMIN");
</script>

<template>
  <header class="page-heading between"><div><p class="eyebrow">{{ isAdmin ? "Administrasi sekolah" : "Ruang kerja guru" }}</p><h1>Dashboard</h1><p class="muted">Ringkasan pekerjaan dan aktivitas terbaru Anda.</p></div><span class="badge badge-success">Sistem siap</span></header>
  <section class="stat-grid" aria-label="Ringkasan">
    <article class="card stat-card"><span class="subtle">Jadwal hari ini</span><strong>0</strong><span class="muted">Belum ada jadwal aktif</span></article>
    <article class="card stat-card"><span class="subtle">Draft perlu ditinjau</span><strong>0</strong><span class="muted">Validasi saat membuka editor</span></article>
    <article v-if="isAdmin" class="card stat-card"><span class="subtle">Peserta aktif</span><strong>0</strong><span class="muted">Data diperbarui dari server</span></article>
    <article class="card stat-card"><span class="subtle">Export terbaru</span><strong>—</strong><span class="muted">Tidak ada job tertunda</span></article>
  </section>
  <section class="card dashboard-panel"><div class="between"><div><h2>Mulai dari sini</h2><p class="muted">Gunakan quick action untuk melanjutkan workflow.</p></div></div><div class="quick-actions"><RouterLink v-if="isAdmin" class="btn-secondary action-link" to="/admin/users">Kelola pengguna</RouterLink><RouterLink v-if="isAdmin" class="btn-secondary action-link" to="/admin/academic">Atur akademik</RouterLink><RouterLink class="btn-primary action-link" to="/teacher/questions">Buat soal</RouterLink><RouterLink class="btn-secondary action-link" to="/teacher/exams">Buat ujian</RouterLink><RouterLink class="btn-secondary action-link" to="/teacher/schedules">Buat jadwal</RouterLink></div></section>
  <section class="card dashboard-panel"><h2>Aktivitas administratif</h2><p class="empty-copy">Aktivitas akan muncul setelah ada perubahan data.</p></section>
</template>

<style scoped>
.page-heading { margin-bottom: 24px; align-items: flex-start; }.page-heading h1 { margin: 0 0 6px; }.eyebrow { margin: 0 0 4px; color: var(--primary); font-weight: 700; }.stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; margin-bottom: 18px; }.stat-card { display: grid; gap: 6px; padding: 18px; }.stat-card strong { font-size: 2rem; }.dashboard-panel { padding: 20px; margin-top: 16px; }.dashboard-panel h2 { margin-top: 0; }.quick-actions { display: flex; flex-wrap: wrap; gap: 10px; }.action-link { display: inline-flex; align-items: center; text-decoration: none; }.empty-copy { color: var(--muted); margin-bottom: 0; }.badge { padding: 5px 10px; border-radius: 99px; font-size: .8rem; font-weight: 700; }.badge-success { color: var(--success); background: var(--success-soft); }
</style>

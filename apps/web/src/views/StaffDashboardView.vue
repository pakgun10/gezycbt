<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { HttpStaffApi } from "../features/staff/api";
import { useStaffAuth } from "../features/staff/auth-store";
import { messageFrom } from "../features/staff/helpers";
import type {
  ExportJob,
  ScheduleSummary,
} from "../features/staff/types";

const api = new HttpStaffApi();
const auth = useStaffAuth();
const isAdmin = computed(() => auth.user.value?.role === "ADMIN");

const loading = ref(true);
const error = ref("");
const updatedAt = ref<Date | null>(null);
const openSchedules = ref<readonly ScheduleSummary[]>([]);
const openCountLabel = ref("0");
const activeCount = ref(0);
const activeCapped = ref(false);
const activePartial = ref(false);
const draftLabel = ref("0");
const runningExports = ref(0);
const latestReadyExport = ref<ExportJob | null>(null);

const MONITOR_LIMIT = 5;

function countLabel(length: number, truncated: boolean): string {
  return truncated ? `${length}+` : String(length);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(new Date(value));
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const [openPage, draftSchedulePage, examPage, exportPage] =
      await Promise.all([
        api.schedules({ status: "OPEN" }),
        api.schedules({ status: "DRAFT" }),
        api.exams(),
        api.exports(),
      ]);
    openSchedules.value = openPage.items;
    openCountLabel.value = countLabel(
      openPage.items.length,
      openPage.nextCursor !== null,
    );
    const draftExams = examPage.items.filter(
      (exam) => exam.status === "DRAFT",
    ).length;
    draftLabel.value = countLabel(
      draftSchedulePage.items.length + draftExams,
      draftSchedulePage.nextCursor !== null || examPage.nextCursor !== null,
    );
    runningExports.value = exportPage.items.filter(
      (job) => job.status === "QUEUED" || job.status === "RUNNING",
    ).length;
    const ready = exportPage.items.filter((job) => job.status === "READY");
    latestReadyExport.value =
      ready.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null;

    // Sesi aktif hanya bisa dibaca per jadwal, jadi pantau jadwal terbuka
    // saja dan katakan dengan jujur bila daftarnya dipotong.
    const monitored = openPage.items.slice(0, MONITOR_LIMIT);
    activeCapped.value = openPage.items.length > MONITOR_LIMIT;
    const pages = await Promise.all(
      monitored.map((schedule) => api.monitor(schedule.id).catch(() => null)),
    );
    activePartial.value = pages.some((page) => page === null);
    activeCount.value = pages.reduce(
      (sum, page) => sum + (page?.counts.active ?? 0),
      0,
    );
    updatedAt.value = new Date();
  } catch (cause) {
    error.value = messageFrom(cause, "Ringkasan belum tersedia.");
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void load();
});
</script>

<template>
  <header class="page-heading between">
    <div>
      <p class="eyebrow">{{ isAdmin ? "Administrasi sekolah" : "Ruang kerja guru" }}</p>
      <h1>Dashboard</h1>
      <p class="muted">Ringkasan pekerjaan dan aktivitas terbaru Anda.</p>
    </div>
    <span v-if="loading" class="muted">Memuat…</span>
    <span v-else-if="updatedAt" class="muted"
      >Diperbarui {{ formatDate(updatedAt.toISOString()) }}</span
    >
  </header>
  <div v-if="error" class="alert alert-error dashboard-alert" role="alert">
    {{ error }}
    <button class="btn-secondary" type="button" @click="load">Coba lagi</button>
  </div>
  <section v-if="loading" class="card dashboard-panel" aria-label="Ringkasan">
    <p class="muted">Memuat ringkasan…</p>
  </section>
  <section v-else class="stat-grid" aria-label="Ringkasan">
    <article class="card stat-card">
      <span class="subtle">Jadwal terbuka</span>
      <strong>{{ openCountLabel }}</strong>
      <span class="muted">{{
        openSchedules.length > 0
          ? "Jadwal sedang dibuka untuk peserta"
          : "Belum ada jadwal terbuka"
      }}</span>
    </article>
    <article class="card stat-card">
      <span class="subtle">Peserta aktif</span>
      <strong>{{ activeCount }}</strong>
      <span class="muted">{{
        openSchedules.length === 0
          ? "Tidak ada jadwal terbuka untuk dipantau"
          : activePartial
            ? "Sebagian jadwal gagal dipantau"
            : activeCapped
              ? `Sesi ACTIVE dari ${MONITOR_LIMIT} jadwal terbuka pertama`
              : "Sesi ACTIVE di semua jadwal terbuka"
      }}</span>
    </article>
    <article class="card stat-card">
      <span class="subtle">Draft perlu ditinjau</span>
      <strong>{{ draftLabel }}</strong>
      <span class="muted">Jadwal DRAFT + ujian DRAFT</span>
    </article>
    <article class="card stat-card">
      <span class="subtle">Export berjalan</span>
      <strong>{{ runningExports }}</strong>
      <span class="muted">{{
        latestReadyExport
          ? `Siap terbaru: ${formatDate(latestReadyExport.createdAt)}`
          : "Belum ada export yang siap"
      }}</span>
    </article>
  </section>
  <section class="card dashboard-panel">
    <div class="between">
      <div>
        <h2>Jadwal terbuka</h2>
        <p class="muted">Jadwal yang sedang bisa dikerjakan peserta.</p>
      </div>
      <RouterLink class="btn-secondary action-link" to="/teacher/schedules">
        Lihat semua jadwal
      </RouterLink>
    </div>
    <ul v-if="openSchedules.length > 0" class="open-list">
      <li v-for="item in openSchedules.slice(0, 3)" :key="item.id" class="open-item">
        <div>
          <strong>{{ item.title }}</strong>
          <p class="muted">
            {{ formatDate(item.startsAt) }} – {{ formatDate(item.endsAt) }}
          </p>
        </div>
        <RouterLink
          class="btn-quiet action-link"
          :to="`/teacher/monitoring?scheduleId=${item.id}`"
        >
          Monitoring
        </RouterLink>
      </li>
    </ul>
    <p v-else class="empty-copy">
      Belum ada jadwal terbuka. Buat jadwal dari halaman Jadwal.
    </p>
  </section>
  <section class="card dashboard-panel">
    <div class="between">
      <div>
        <h2>Mulai dari sini</h2>
        <p class="muted">Gunakan quick action untuk melanjutkan workflow.</p>
      </div>
    </div>
    <div class="quick-actions">
      <RouterLink v-if="isAdmin" class="btn-secondary action-link" to="/admin/users">Kelola pengguna</RouterLink>
      <RouterLink v-if="isAdmin" class="btn-secondary action-link" to="/admin/academic">Atur akademik</RouterLink>
      <RouterLink class="btn-primary action-link" to="/teacher/questions">Buat soal</RouterLink>
      <RouterLink class="btn-secondary action-link" to="/teacher/exams">Buat ujian</RouterLink>
      <RouterLink class="btn-secondary action-link" to="/teacher/schedules">Buat jadwal</RouterLink>
    </div>
  </section>
</template>

<style scoped>
.page-heading { margin-bottom: 24px; align-items: flex-start; }.page-heading h1 { margin: 0 0 6px; }.eyebrow { margin: 0 0 4px; color: var(--primary); font-weight: 700; }.dashboard-alert { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-bottom: 18px; }.stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; margin-bottom: 18px; }.stat-card { display: grid; gap: 6px; padding: 18px; }.stat-card strong { font-size: 2rem; }.dashboard-panel { padding: 20px; margin-top: 16px; }.dashboard-panel h2 { margin-top: 0; }.dashboard-panel p { margin-bottom: 0; }.quick-actions { display: flex; flex-wrap: wrap; gap: 10px; }.action-link { display: inline-flex; align-items: center; text-decoration: none; }.empty-copy { color: var(--muted); margin-bottom: 0; }.open-list { display: grid; gap: 10px; padding: 0; margin: 16px 0 0; list-style: none; }.open-item { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px; border: 1px solid var(--border); border-radius: 8px; }.open-item p { margin: 4px 0 0; }
</style>

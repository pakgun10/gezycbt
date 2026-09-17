<script setup lang="ts">
import { onMounted, ref } from "vue";
import ParticipantHeader from "../components/ParticipantHeader.vue";
import FeedbackState from "../components/FeedbackState.vue";
import { ApiClientError } from "../lib/api";
import { HttpParticipantApi } from "../features/participant/api";
import { useParticipantAuth } from "../features/participant/auth-store";
import type { ParticipantSchedule } from "../features/participant/types";

const api = new HttpParticipantApi();
const auth = useParticipantAuth();
const user = auth.user;
const schedules = ref<readonly ParticipantSchedule[]>([]);
const loading = ref(true);
const error = ref("");
const requestId = ref("");

onMounted(async () => {
  try { schedules.value = await api.schedules(); }
  catch (cause) {
    error.value = cause instanceof ApiClientError ? cause.message : "Koneksi tidak tersedia. Coba lagi.";
    requestId.value = cause instanceof ApiClientError ? cause.requestId ?? "" : "";
  } finally { loading.value = false; }
});

function date(value: string): string {
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(value));
}
function stateLabel(item: ParticipantSchedule): string {
  if (item.attemptResetAvailable) return "Attempt baru tersedia";
  if (item.activeSessionId) return "Sedang berlangsung";
  if (item.resultReleased) return "Hasil tersedia";
  if (item.status === "OPEN") return "Siap dimulai";
  if (item.status === "CLOSED" || item.status === "ARCHIVED") return "Selesai";
  return "Belum dimulai";
}
function reload(): void { window.location.reload(); }
</script>

<template>
  <ParticipantHeader title="Ujian peserta" />
  <a class="skip-link" href="#schedule-list">Lewati ke daftar ujian</a>
  <main id="schedule-list" class="page">
    <header class="between page-heading"><div><p class="eyebrow">{{ user?.displayName ?? "Peserta" }}</p><h1>Daftar Ujian</h1></div><RouterLink class="btn-secondary action-link" to="/practice/token">Ujian Latihan</RouterLink></header>
    <FeedbackState v-if="loading" title="Memuat ujian…" message="Memeriksa jadwal dan eligibility Anda." />
    <FeedbackState v-else-if="error" title="Daftar ujian belum tersedia" :message="error" tone="error"><small v-if="requestId">Request ID: {{ requestId }}</small><br /><button class="btn-secondary" type="button" @click="reload">Coba lagi</button></FeedbackState>
    <section v-else-if="schedules.length === 0" class="card empty"><h2>Belum ada ujian</h2><p class="muted">Jadwal yang tersedia untuk Anda akan muncul di sini.</p></section>
    <section v-else class="schedule-grid" aria-label="Jadwal ujian">
      <article v-for="item in schedules" :key="item.id" class="card schedule-card">
        <div class="between"><span class="badge">{{ stateLabel(item) }}</span><span class="subtle">{{ item.mode === "MAIN" ? "Ujian Utama" : "Latihan" }}</span></div>
        <h2>{{ item.title }}</h2><p class="muted">{{ item.subjectName ?? "Mata pelajaran" }}</p>
        <dl><div><dt>Waktu</dt><dd>{{ date(item.startsAt) }}</dd></div><div><dt>Durasi</dt><dd>{{ Math.round(item.durationSeconds / 60) }} menit</dd></div></dl>
        <div class="card-actions">
          <RouterLink v-if="item.activeSessionId" class="btn-primary action-link" :to="`/participant/exam/${item.activeSessionId}`">Lanjutkan Ujian</RouterLink>
          <RouterLink v-else-if="item.resultReleased && item.resultSessionId" class="btn-secondary action-link" :to="`/participant/results/${item.resultSessionId}`">Lihat Hasil</RouterLink>
          <RouterLink v-else-if="item.mode === 'MAIN' && item.status === 'OPEN'" class="btn-primary action-link" :to="`/participant/schedules/${item.id}/pre-exam`">Mulai Ujian</RouterLink>
          <button v-else class="btn-secondary" type="button" disabled>{{ stateLabel(item) }}</button>
        </div>
      </article>
    </section>
  </main>
</template>

<style scoped>
.page-heading { margin-bottom: 24px; }.page-heading h1 { margin: 0; }.eyebrow { margin: 0 0 4px; color: var(--primary); font-weight: 700; }
.action-link { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; text-decoration: none; }
.schedule-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
.schedule-card { display: flex; flex-direction: column; gap: 10px; padding: 20px; }.schedule-card h2 { margin: 6px 0 0; font-size: 1.2rem; }.schedule-card p { margin: 0; }
dl { display: grid; gap: 8px; margin: 8px 0; } dt { color: var(--subtle); font-size: .8rem; } dd { margin: 2px 0 0; }.card-actions { margin-top: auto; display: flex; gap: 8px; }.card-actions > * { flex: 1; }
.badge { padding: 4px 8px; border-radius: 99px; color: var(--info); background: var(--info-soft); font-size: .8rem; font-weight: 700; }.subtle { font-size: .8rem; }.empty { padding: 32px; }
</style>

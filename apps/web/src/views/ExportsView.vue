<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { HttpStaffApi } from "../features/staff/api";
import type { ExportJob, ScheduleSummary } from "../features/staff/types";
import { formatDate, messageFrom } from "../features/staff/helpers";

const api = new HttpStaffApi();
const items = ref<readonly ExportJob[]>([]);
const schedules = ref<readonly ScheduleSummary[]>([]);
const scheduleId = ref("");
const format = ref<"CSV" | "JSON">("CSV");
const includePii = ref(false);
const loading = ref(true);
const error = ref("");
let timer: number | undefined;
async function load(): Promise<void> { try { items.value = (await api.exports()).items; } catch (cause) { error.value = messageFrom(cause, "Riwayat export belum tersedia."); } finally { loading.value = false; } }
async function create(): Promise<void> { if (!scheduleId.value) return; try { await api.createExport(scheduleId.value, { format: format.value, includePii: includePii.value }); await load(); } catch (cause) { error.value = messageFrom(cause); } }
function schedulePoll(): void { if (timer !== undefined) window.clearTimeout(timer); if (items.value.some((job) => job.status === "QUEUED" || job.status === "RUNNING")) timer = window.setTimeout(() => { void load().then(schedulePoll); }, 15_000); }
function statusLabel(status: ExportJob["status"]): string { return { QUEUED: "Menunggu", RUNNING: "Diproses", READY: "Siap", FAILED: "Gagal", EXPIRED: "Kedaluwarsa" }[status]; }
async function download(job: ExportJob): Promise<void> { try { const result = await api.exportDownloadToken(job.id); window.location.assign(`/api/v1/teacher/exports/${encodeURIComponent(job.id)}/download?token=${encodeURIComponent(result.token)}`); } catch (cause) { error.value = messageFrom(cause, "File export belum dapat diunduh."); } }
onMounted(async () => { try { schedules.value = (await api.schedules()).items; scheduleId.value = schedules.value[0]?.id ?? ""; } catch { /* the list below reports the actionable error */ } await load(); schedulePoll(); });
onBeforeUnmount(() => { if (timer !== undefined) window.clearTimeout(timer); });
</script>

<template>
  <header class="page-heading"><p class="eyebrow">Guru · Output</p><h1>Riwayat export</h1><p class="muted">Job berjalan di server dan tetap hidup walau browser ditutup.</p></header>
  <section class="card export-form"><div class="form-grid"><label>Jadwal<select v-model="scheduleId"><option value="">Pilih jadwal</option><option v-for="schedule in schedules" :key="schedule.id" :value="schedule.id">{{ schedule.title }}</option></select></label><label>Format<select v-model="format"><option value="CSV">CSV</option><option value="JSON">JSON</option></select></label><label class="check"><input v-model="includePii" type="checkbox" /> Sertakan PII (sesuai izin)</label><button class="btn-primary" type="button" :disabled="!scheduleId" @click="create">Buat export</button></div></section>
  <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div><section class="card table-card"><div v-if="loading" class="table-state">Memuat job…</div><div v-else-if="items.length === 0" class="table-state"><strong>Belum ada export</strong><span class="muted">Buat export dari hasil ujian.</span></div><div v-else class="table-scroll"><table><caption class="sr-only">Riwayat export</caption><thead><tr><th>Job</th><th>Status</th><th>Dibuat</th><th>Expired</th><th></th></tr></thead><tbody><tr v-for="job in items" :key="job.id"><td><strong>{{ job.format }}</strong><small>{{ job.id }}</small></td><td><span class="badge" :class="`badge-${job.status.toLowerCase()}`">{{ statusLabel(job.status) }}</span><small v-if="job.errorMessage" class="error-copy">{{ job.errorMessage }}</small></td><td>{{ formatDate(job.createdAt) }}</td><td>{{ formatDate(job.expiresAt) }}</td><td><button v-if="job.status === 'READY'" class="btn-secondary" type="button" @click="download(job)">Unduh</button><button v-else-if="job.status === 'FAILED' || job.status === 'EXPIRED'" class="btn-quiet" type="button" @click="create">Buat lagi</button></td></tr></tbody></table></div></section>
</template>

<style scoped>
.page-heading { margin-bottom: 18px; }.page-heading h1 { margin: 0 0 6px; }.eyebrow { margin: 0 0 4px; color: var(--primary); font-weight: 700; }.export-form, .table-card { padding: 20px; margin-bottom: 16px; }.form-grid { display: flex; flex-wrap: wrap; align-items: end; gap: 14px; }.form-grid label { display: grid; gap: 6px; color: var(--muted); font-weight: 700; }.form-grid select { min-height: 40px; border: 1px solid var(--border-strong); border-radius: 8px; padding: 6px 10px; background: var(--surface); color: var(--text); font-weight: 400; }.check { display: flex !important; align-items: center; min-height: 40px; }.check input { width: 18px; height: 18px; }.table-scroll { overflow-x: auto; } table { width: 100%; border-collapse: collapse; } th, td { padding: 11px 9px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; } th { color: var(--muted); font-size: .8rem; } td small { display: block; color: var(--subtle); margin-top: 3px; }.badge { display: inline-flex; padding: 4px 8px; border-radius: 99px; font-size: .78rem; font-weight: 700; }.badge-queued, .badge-running { color: var(--info); background: var(--info-soft); }.badge-ready { color: var(--success); background: var(--success-soft); }.badge-failed, .badge-expired { color: var(--danger); background: var(--danger-soft); }.error-copy { color: var(--danger); }.table-state { display: grid; place-items: center; gap: 6px; min-height: 180px; }.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media (max-width: 600px) { .form-grid { display: grid; grid-template-columns: 1fr; align-items: stretch; } }
</style>

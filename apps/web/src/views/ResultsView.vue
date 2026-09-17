<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { HttpStaffApi } from "../features/staff/api";
import type { ResultRow, ScheduleSummary } from "../features/staff/types";
import { formatDate, messageFrom } from "../features/staff/helpers";

const api = new HttpStaffApi();
const route = useRoute();
const scheduleId = ref(String(route.query.scheduleId ?? ""));
const schedules = ref<readonly ScheduleSummary[]>([]);
const results = ref<readonly ResultRow[]>([]);
const selected = ref<string[]>([]);
const allFiltered = ref(false);
const filter = ref("ALL");
const loading = ref(false);
const error = ref("");
const actionMessage = ref("");
const reason = ref("");

async function loadSchedules(): Promise<void> { try { schedules.value = (await api.schedules()).items; if (!scheduleId.value) scheduleId.value = schedules.value[0]?.id ?? ""; } catch (cause) { error.value = messageFrom(cause, "Jadwal belum tersedia."); } }
async function load(): Promise<void> { if (!scheduleId.value) return; loading.value = true; try { results.value = (await api.results(scheduleId.value, undefined, filter.value)).items; selected.value = []; allFiltered.value = false; } catch (cause) { error.value = messageFrom(cause, "Hasil belum tersedia."); } finally { loading.value = false; } }
function toggle(id: string): void { selected.value = selected.value.includes(id) ? selected.value.filter((item) => item !== id) : [...selected.value, id]; }
function allOnPage(): boolean { return results.value.length > 0 && results.value.every((row) => selected.value.includes(row.id)); }
function togglePage(): void { selected.value = allOnPage() ? [] : results.value.map((row) => row.id); }
async function release(): Promise<void> { if (!scheduleId.value || (!allFiltered.value && selected.value.length === 0)) return; if (!window.confirm(allFiltered.value ? "Rilis seluruh hasil yang cocok dengan filter saat ini?" : `Rilis ${selected.value.length} hasil terpilih?`)) return; actionMessage.value = ""; try { const outcome = await api.releaseResults(scheduleId.value, selected.value, undefined, allFiltered.value, filter.value); actionMessage.value = `${outcome.released} hasil dirilis, ${outcome.skipped} dilewati.`; await load(); } catch (cause) { error.value = messageFrom(cause); } }
async function unrelease(): Promise<void> { if (!scheduleId.value || (!allFiltered.value && selected.value.length === 0)) return; if (!window.confirm(allFiltered.value ? "Sembunyikan kembali seluruh hasil yang cocok dengan filter saat ini?" : `Sembunyikan kembali ${selected.value.length} hasil terpilih?`)) return; if (!reason.value.trim()) { actionMessage.value = "Alasan unrelease wajib diisi."; return; } try { const outcome = await api.unreleaseResults(scheduleId.value, selected.value, reason.value, allFiltered.value, filter.value); actionMessage.value = `${outcome.released} hasil disembunyikan kembali.`; reason.value = ""; await load(); } catch (cause) { error.value = messageFrom(cause); } }
onMounted(async () => { await loadSchedules(); await load(); });
</script>

<template>
  <header class="page-heading"><p class="eyebrow">Guru · Penilaian</p><h1>Hasil ujian</h1><p class="muted">Release dapat ditargetkan ke subset pada halaman ini. Status peserta tetap authoritative di server.</p></header>
  <div class="filters"><label>Jadwal<select v-model="scheduleId" @change="load"><option value="">Pilih jadwal</option><option v-for="schedule in schedules" :key="schedule.id" :value="schedule.id">{{ schedule.title }} · {{ schedule.mode }}</option></select></label><label>Status rilis<select v-model="filter" @change="load"><option value="ALL">Semua</option><option value="RELEASED">Dirilis</option><option value="UNRELEASED">Belum dirilis</option></select></label></div>
  <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div><div v-if="actionMessage" class="alert alert-info" role="status">{{ actionMessage }}</div>
  <section class="card table-card"><div class="selection-bar"><label class="select-filter"><input v-model="allFiltered" type="checkbox" /> Pilih semua hasil filter</label><span>{{ allFiltered ? "Semua hasil filter dipilih" : `${selected.length} dipilih` }}</span><button class="btn-secondary" type="button" :disabled="!allFiltered && selected.length === 0" @click="release">Rilis terpilih</button><label class="reason-inline"><span class="sr-only">Alasan unrelease</span><input v-model="reason" placeholder="Alasan unrelease" /><button class="btn-secondary" type="button" :disabled="!allFiltered && selected.length === 0" @click="unrelease">Unrelease</button></label></div><div v-if="loading" class="table-state">Memuat hasil…</div><div v-else-if="results.length === 0" class="table-state"><strong>Belum ada hasil</strong><span class="muted">Hasil akan muncul setelah peserta menyelesaikan session.</span></div><div v-else class="table-scroll"><table><caption class="sr-only">Hasil ujian</caption><thead><tr><th><input type="checkbox" :checked="allOnPage()" aria-label="Pilih semua hasil pada halaman" @change="togglePage" /></th><th>Peserta</th><th>Skor</th><th>Rincian</th><th>Rilis</th><th>Waktu</th></tr></thead><tbody><tr v-for="row in results" :key="row.id"><td><input type="checkbox" :checked="selected.includes(row.id)" :disabled="row.status !== 'SCORED'" :aria-label="`Pilih hasil ${row.participantName}`" @change="toggle(row.id)" /></td><td><strong>{{ row.participantName }}</strong><small>{{ row.username ?? 'Latihan' }}</small></td><td><strong>{{ row.percentage }}%</strong><small>{{ row.earnedScore }}/{{ row.maxScore }}</small></td><td>{{ row.correctCount }} benar · {{ row.incorrectCount }} salah · {{ row.unansweredCount }} kosong</td><td><span class="badge" :class="row.releasedAt ? 'badge-success' : 'badge-muted'">{{ row.releasedAt ? 'Dirilis' : 'Belum dirilis' }}</span></td><td>{{ formatDate(row.releasedAt) }}</td></tr></tbody></table></div></section>
</template>

<style scoped>
.page-heading { margin-bottom: 18px; }.page-heading h1 { margin: 0 0 6px; }.eyebrow { margin: 0 0 4px; color: var(--primary); font-weight: 700; }.filters { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; }.filters label { display: grid; gap: 5px; color: var(--muted); font-weight: 700; font-size: .85rem; }.filters select, .reason-inline input { min-height: 40px; border: 1px solid var(--border-strong); border-radius: 8px; padding: 6px 10px; background: var(--surface); color: var(--text); font-weight: 400; }.table-card { padding: 20px; }.selection-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 14px; }.reason-inline { display: flex; gap: 6px; margin-left: auto; }.table-scroll { overflow-x: auto; } table { width: 100%; border-collapse: collapse; } th, td { padding: 11px 9px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; } th { color: var(--muted); font-size: .8rem; } td small { display: block; color: var(--subtle); margin-top: 3px; }.badge { display: inline-flex; padding: 4px 8px; border-radius: 99px; font-size: .78rem; font-weight: 700; }.badge-success { color: var(--success); background: var(--success-soft); }.badge-muted { color: var(--muted); background: var(--canvas); }.table-state { display: grid; place-items: center; gap: 6px; min-height: 180px; }.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media (max-width: 600px) { .reason-inline { margin-left: 0; width: 100%; }.reason-inline input { flex: 1; min-width: 0; } }
</style>

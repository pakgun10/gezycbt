<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { HttpStaffApi } from "../features/staff/api";
import type {
  ClassRecord,
  ExamSummary,
  ParticipantOption,
  ScheduleSummary,
} from "../features/staff/types";
import { formatDate, messageFrom } from "../features/staff/helpers";
import ScopeSwitcher from "../components/ScopeSwitcher.vue";

const api = new HttpStaffApi();
const items = ref<readonly ScheduleSummary[]>([]);
const exams = ref<readonly ExamSummary[]>([]);
const classes = ref<readonly ClassRecord[]>([]);
const participants = ref<readonly ParticipantOption[]>([]);
const selectedClassIds = ref<string[]>([]);
const selectedParticipants = ref<readonly ParticipantOption[]>([]);
const participantSearch = ref("");
const participantLoading = ref(false);
const loading = ref(true);
const error = ref("");
const showForm = ref(false);
const saving = ref(false);
const revealedCode = ref("");
const form = ref({ examRevisionId: "", mode: "MAIN", startsAt: "", endsAt: "", durationSeconds: 3600, maxAttempts: 1, allowLateStart: true, resultReleasePolicy: "MANUAL" });
const selectedClassCount = computed(() => selectedClassIds.value.length);
const selectedParticipantCount = computed(() => selectedParticipants.value.length);
const hasMainTarget = computed(
  () => selectedClassCount.value > 0 || selectedParticipantCount.value > 0,
);
async function load(): Promise<void> { loading.value = true; try { const [schedulePage, examPage, classPage, participantPage] = await Promise.all([api.schedules(), api.exams(), api.teacherClasses(), api.teacherParticipants()]); items.value = schedulePage.items; exams.value = examPage.items.filter((exam) => exam.status === "PUBLISHED"); classes.value = classPage.items; participants.value = participantPage.items; } catch (cause) { error.value = messageFrom(cause, "Jadwal atau pilihan target belum tersedia."); } finally { loading.value = false; } }
async function loadParticipants(): Promise<void> { participantLoading.value = true; try { participants.value = (await api.teacherParticipants(participantSearch.value)).items; } catch (cause) { error.value = messageFrom(cause, "Daftar peserta belum tersedia."); } finally { participantLoading.value = false; } }
function toggleParticipant(participant: ParticipantOption): void { selectedParticipants.value = selectedParticipants.value.some((item) => item.id === participant.id) ? selectedParticipants.value.filter((item) => item.id !== participant.id) : [...selectedParticipants.value, participant]; }
function isParticipantSelected(id: string): boolean { return selectedParticipants.value.some((item) => item.id === id); }
function resetTargetSelection(): void { selectedClassIds.value = []; selectedParticipants.value = []; participantSearch.value = ""; }
async function create(): Promise<void> { if (form.value.mode === "MAIN" && !hasMainTarget.value) { error.value = "Pilih minimal satu kelas atau satu peserta langsung sebagai target."; return; } saving.value = true; try { await api.createSchedule({ ...form.value, targetClassIds: form.value.mode === "MAIN" ? selectedClassIds.value : [], targetParticipantIds: form.value.mode === "MAIN" ? selectedParticipants.value.map((item) => item.id) : [], startsAt: new Date(form.value.startsAt).toISOString(), endsAt: new Date(form.value.endsAt).toISOString(), maxAttempts: form.value.mode === "MAIN" ? 1 : form.value.maxAttempts, resultReleasePolicy: form.value.mode === "MAIN" ? "MANUAL" : "IMMEDIATE_SCORE", ...(form.value.mode === "PRACTICE" ? { identityFields: [{ key: "name", label: "Nama", type: "TEXT", required: true }] } : {}) }); showForm.value = false; resetTargetSelection(); form.value.examRevisionId = ""; await load(); } catch (cause) { error.value = messageFrom(cause); } finally { saving.value = false; } }
async function rotate(item: ScheduleSummary): Promise<void> { try { const result = await api.rotateCode(item.id, item.mode === "MAIN" ? "main-code" : "practice-token"); revealedCode.value = result.code; await load(); } catch (cause) { error.value = messageFrom(cause); } }
async function transition(item: ScheduleSummary, action: "ready" | "open" | "close"): Promise<void> { if (action === "close" && !window.confirm("Tutup jadwal? Session aktif akan difinalisasi bertahap.")) return; try { await api.transitionSchedule(item.id, action, item.updatedAt, action === "close" ? "Ditutup dari halaman jadwal" : undefined); await load(); } catch (cause) { error.value = messageFrom(cause); } }
function examLabel(exam: ExamSummary): string { return `${exam.title} · revision #${exam.revisionId}`; }
function classLabel(item: ClassRecord): string { return `${item.name} (${item.code})`; }
onMounted(() => { void load(); });
</script>

<template>
  <header class="page-heading between"><div><p class="eyebrow">Guru · Operasional</p><h1>Jadwal</h1><p class="muted">Atur window akses, target peserta, token latihan, dan kode tambahan ujian utama.</p></div><button class="btn-primary" type="button" @click="showForm = !showForm">Buat jadwal</button></header>
  <ScopeSwitcher />
  <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>
  <div v-if="revealedCode" class="alert alert-info code-reveal" role="status"><strong>Salin kode sekarang: {{ revealedCode }}</strong><span>Kode plaintext hanya ditampilkan sekali; halaman berikutnya hanya menampilkan hint.</span><button class="btn-quiet" type="button" @click="revealedCode = ''">Tutup</button></div>
  <section v-if="showForm" class="card form-panel"><div class="between"><div><h2>Jadwal baru</h2><p class="muted">Pilih nama ujian dan target dari daftar. ID akan diurus oleh sistem.</p></div><button class="btn-quiet" type="button" @click="showForm = false">Tutup</button></div><form class="form-grid" @submit.prevent="create"><label class="wide">Ujian<select v-model="form.examRevisionId" required><option value="" disabled>Pilih ujian yang sudah dipublish</option><option v-for="exam in exams" :key="exam.revisionId" :value="exam.revisionId">{{ examLabel(exam) }}</option></select><small v-if="exams.length === 0" class="muted">Belum ada ujian yang dipublish.</small></label><label>Mode<select v-model="form.mode"><option value="MAIN">Ujian utama</option><option value="PRACTICE">Latihan</option></select></label><label>Mulai<input v-model="form.startsAt" type="datetime-local" required /></label><label>Selesai<input v-model="form.endsAt" type="datetime-local" required /></label><label>Durasi (detik)<input v-model.number="form.durationSeconds" type="number" min="1" max="86400" required /></label><label>Max attempt<input v-model.number="form.maxAttempts" type="number" min="1" :disabled="form.mode === 'MAIN'" /></label><div v-if="form.mode === 'MAIN'" class="target-picker wide"><div class="between"><div><h3>Target kelas</h3><p class="muted">Peserta dari kelas terpilih akan menjadi target ujian.</p></div><span class="selection-count">{{ selectedClassCount }} dipilih</span></div><div v-if="classes.length" class="option-list"><label v-for="item in classes" :key="item.id" class="target-option"><input v-model="selectedClassIds" type="checkbox" :value="item.id" /><span>{{ classLabel(item) }}</span></label></div><p v-else class="muted">Belum ada kelas dalam scope Anda.</p></div><div v-if="form.mode === 'MAIN'" class="target-picker wide"><div class="between"><div><h3>Target peserta langsung <span class="optional">(opsional)</span></h3><p class="muted">Gunakan pencarian nama atau username untuk menambahkan peserta tertentu.</p></div><span class="selection-count">{{ selectedParticipantCount }} dipilih</span></div><div class="picker-search"><input v-model="participantSearch" placeholder="Cari nama atau username" @keydown.enter.prevent="loadParticipants" /><button class="btn-secondary" type="button" :disabled="participantLoading" @click="loadParticipants">{{ participantLoading ? 'Mencari…' : 'Cari' }}</button></div><div v-if="participants.length" class="option-list"><label v-for="participant in participants" :key="participant.id" class="target-option"><input type="checkbox" :checked="isParticipantSelected(participant.id)" @change="toggleParticipant(participant)" /><span><strong>{{ participant.displayName }}</strong><small>{{ participant.username }}</small></span></label></div><p v-else class="muted">Tidak ada peserta yang cocok.</p></div><p v-if="form.mode === 'MAIN' && !hasMainTarget" class="form-hint wide">Pilih minimal satu kelas atau satu peserta langsung untuk melanjutkan.</p><button class="btn-primary" type="submit" :disabled="saving || !form.examRevisionId || (form.mode === 'MAIN' && !hasMainTarget)">{{ saving ? 'Menyimpan…' : 'Simpan draft jadwal' }}</button></form></section>
  <section class="schedule-grid"><article v-for="item in items" :key="item.id" class="card schedule-card"><div class="between"><span class="badge">{{ item.status }}</span><span class="subtle">{{ item.mode === 'MAIN' ? 'Utama' : 'Latihan' }}</span></div><h2>{{ item.title }}</h2><p class="muted">{{ formatDate(item.startsAt) }} – {{ formatDate(item.endsAt) }}</p><dl><div><dt>Durasi</dt><dd>{{ Math.round(item.durationSeconds / 60) }} menit</dd></div><div><dt>Akses</dt><dd>{{ item.hasAccessCode ? 'Hint ' + (item.accessHint ?? 'tersedia') : 'Belum dibuat' }}</dd></div></dl><div class="card-actions"><button v-if="item.status === 'DRAFT'" class="btn-secondary" type="button" @click="transition(item, 'ready')">Siapkan</button><button v-if="item.status === 'READY'" class="btn-primary" type="button" @click="transition(item, 'open')">Buka</button><button v-if="item.status === 'OPEN'" class="btn-secondary" type="button" @click="transition(item, 'close')">Tutup jadwal</button><button v-if="item.status !== 'CLOSED' && item.status !== 'ARCHIVED'" class="btn-quiet" type="button" @click="rotate(item)">{{ item.mode === 'MAIN' ? 'Rotasi kode' : 'Rotasi token' }}</button><RouterLink v-if="item.status === 'OPEN'" class="btn-quiet action-link" :to="'/teacher/monitoring?scheduleId=' + item.id">Monitoring</RouterLink></div></article><div v-if="!loading && items.length === 0" class="card table-state"><strong>Belum ada jadwal</strong><span class="muted">Jadwal dibuat dari exam revision yang sudah dipublish.</span></div><div v-if="loading" class="card table-state">Memuat jadwal…</div></section>
</template>

<style scoped>
.page-heading { align-items: flex-start; margin-bottom: 18px; }
.page-heading h1 { margin: 0 0 6px; }
.eyebrow { margin: 0 0 4px; color: var(--primary); font-weight: 700; }
.form-panel { padding: 20px; margin: 16px 0; }
.form-panel h2 { margin: 0; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 16px; }
.form-grid label { display: grid; gap: 6px; font-weight: 600; }
.form-grid label.wide, .form-grid button, .target-picker.wide { grid-column: 1 / -1; }
.form-grid input, .form-grid select { min-height: 44px; border: 1px solid var(--border-strong); border-radius: 8px; padding: 8px; color: var(--text); background: var(--surface); font-weight: 400; }
.target-picker { display: grid; gap: 12px; padding: 14px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-elevated); }
.target-picker h3 { margin: 0; font-size: 1rem; }
.target-picker p { margin: 4px 0 0; }
.selection-count, .optional { color: var(--subtle); font-size: .82rem; font-weight: 600; }
.option-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; max-height: 220px; overflow: auto; }
.target-option { display: flex !important; align-items: flex-start; gap: 9px !important; padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); font-weight: 500 !important; }
.target-option input { width: 18px; min-height: 18px; margin-top: 2px; }
.target-option span { display: grid; gap: 3px; }
.target-option small { color: var(--subtle); font-weight: 400; }
.form-hint { margin: 0; color: var(--warning); font-size: .85rem; font-weight: 600; }
.picker-search { display: flex; gap: 8px; }
.picker-search input { min-width: 0; flex: 1; }
.schedule-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; margin-top: 16px; }
.schedule-card { display: flex; flex-direction: column; gap: 9px; padding: 18px; }
.schedule-card h2 { margin: 2px 0 0; font-size: 1.15rem; }
.schedule-card p { margin: 0; }
.schedule-card dl { display: grid; gap: 6px; margin: 4px 0; }
.schedule-card dt { color: var(--subtle); font-size: .78rem; }
.schedule-card dd { margin: 2px 0 0; }
.badge { display: inline-flex; padding: 4px 8px; border-radius: 99px; color: var(--primary); background: var(--primary-soft); font-size: .78rem; font-weight: 700; }
.subtle { font-size: .8rem; }
.card-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: auto; }
.action-link { display: inline-flex; align-items: center; text-decoration: none; }
.code-reveal { display: grid; gap: 4px; margin: 16px 0; }
.table-state { display: grid; place-items: center; gap: 6px; min-height: 160px; padding: 24px; text-align: center; }
.muted { color: var(--muted); }
@media (max-width: 700px) {
  .page-heading { display: grid; }
  .form-grid { grid-template-columns: 1fr; }
  .form-grid label.wide, .form-grid button, .target-picker.wide { grid-column: auto; }
  .option-list { grid-template-columns: 1fr; }
  .picker-search { display: grid; }
  .picker-search button { width: 100%; }
}
</style>

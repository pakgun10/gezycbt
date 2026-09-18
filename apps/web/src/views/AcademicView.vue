<script setup lang="ts">
import { onMounted, ref } from "vue";
import { HttpStaffApi } from "../features/staff/api";
import type { AcademicYear, ClassRecord, Subject } from "../features/staff/types";
import { messageFrom, formatShortDate } from "../features/staff/helpers";
import { preserveAcademicYearSelection } from "../features/staff/master-data-policies";

const api = new HttpStaffApi();
const tab = ref<"years" | "classes" | "subjects">("years");
const years = ref<readonly AcademicYear[]>([]);
const classes = ref<readonly ClassRecord[]>([]);
const subjects = ref<readonly Subject[]>([]);
const loading = ref(true);
const error = ref("");
const form = ref({ name: "", startsOn: "", endsOn: "", code: "", className: "", subjectCode: "", subjectName: "" });
const saving = ref(false);
const academicYearId = ref("");

async function load(): Promise<void> {
  loading.value = true; error.value = "";
  try {
    const yearPage = await api.academicYears();
    years.value = yearPage.items;
    academicYearId.value = preserveAcademicYearSelection(academicYearId.value, years.value);
    const [classPage, subjectPage] = await Promise.all([
      api.classes(academicYearId.value || undefined),
      api.subjects(),
    ]);
    classes.value = classPage.items; subjects.value = subjectPage.items;
  } catch (cause) { error.value = messageFrom(cause, "Data akademik belum tersedia."); } finally { loading.value = false; }
}
async function saveYear(): Promise<void> { saving.value = true; try { await api.createAcademicYear({ name: form.value.name, startsOn: form.value.startsOn, endsOn: form.value.endsOn, isActive: false }); form.value.name = ""; await load(); } catch (cause) { error.value = messageFrom(cause); } finally { saving.value = false; } }
async function saveClass(): Promise<void> {
  const selectedYearId = academicYearId.value;
  if (!selectedYearId) { error.value = "Pilih tahun ajaran terlebih dahulu."; return; }
  saving.value = true; error.value = "";
  try {
    await api.createClass({ academicYearId: selectedYearId, code: form.value.code, name: form.value.className });
    form.value.code = ""; form.value.className = ""; await load();
  } catch (cause) { error.value = messageFrom(cause); } finally { saving.value = false; }
}
async function saveSubject(): Promise<void> { saving.value = true; try { await api.createSubject({ code: form.value.subjectCode, name: form.value.subjectName }); form.value.subjectCode = ""; form.value.subjectName = ""; await load(); } catch (cause) { error.value = messageFrom(cause); } finally { saving.value = false; } }
async function activate(year: AcademicYear): Promise<void> { try { await api.activateAcademicYear(year.id); await load(); } catch (cause) { error.value = messageFrom(cause); } }
onMounted(() => { void load(); });
</script>

<template>
  <header class="page-heading"><p class="eyebrow">Admin · Master data</p><h1>Akademik</h1><p class="muted">Atur tahun ajaran, kelas, dan mata pelajaran sebagai dasar scope guru.</p></header>
  <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>
  <div class="tabs" role="tablist" aria-label="Data akademik"><button v-for="item in [{ key: 'years', label: 'Tahun ajaran' }, { key: 'classes', label: 'Kelas' }, { key: 'subjects', label: 'Mata pelajaran' }]" :key="item.key" class="tab" :class="{ selected: tab === item.key }" type="button" role="tab" :aria-selected="tab === item.key" @click="tab = item.key as typeof tab">{{ item.label }}</button></div>
  <section class="card form-panel"><form v-if="tab === 'years'" class="form-grid" @submit.prevent="saveYear"><div><h2>Tahun ajaran</h2><p class="muted">Hanya satu tahun ajaran dapat aktif.</p></div><label>Nama<input v-model="form.name" required placeholder="2026/2027" /></label><label>Mulai<input v-model="form.startsOn" type="date" required /></label><label>Selesai<input v-model="form.endsOn" type="date" required /></label><button class="btn-primary" type="submit" :disabled="saving">Tambah tahun ajaran</button></form><form v-else-if="tab === 'classes'" class="form-grid" @submit.prevent="saveClass"><div><h2>Kelas</h2><p class="muted">Kelas melekat pada tahun ajaran yang dipilih.</p></div><label>Tahun ajaran<select v-model="academicYearId" required><option v-for="year in years" :key="year.id" :value="year.id">{{ year.name }}</option></select></label><label>Kode kelas<input v-model="form.code" required placeholder="X-A" /></label><label>Nama kelas<input v-model="form.className" required placeholder="Kelas X A" /></label><button class="btn-primary" type="submit" :disabled="saving || !academicYearId">Tambah kelas</button></form><form v-else class="form-grid" @submit.prevent="saveSubject"><div><h2>Mata pelajaran</h2><p class="muted">Kode unik dipakai pada question bank dan ujian.</p></div><label>Kode<input v-model="form.subjectCode" required placeholder="MTK" /></label><label>Nama<input v-model="form.subjectName" required placeholder="Matematika" /></label><button class="btn-primary" type="submit" :disabled="saving">Tambah mata pelajaran</button></form></section>
  <section class="card table-card"><div v-if="loading" class="table-state">Memuat data akademik…</div><div v-else-if="tab === 'years' && years.length === 0" class="table-state"><strong>Belum ada tahun ajaran</strong><span class="muted">Buat tahun ajaran pertama.</span></div><div v-else-if="tab === 'classes' && classes.length === 0" class="table-state"><strong>Belum ada kelas</strong><span class="muted">Tambahkan kelas pada tahun ajaran aktif.</span></div><div v-else-if="tab === 'subjects' && subjects.length === 0" class="table-state"><strong>Belum ada mata pelajaran</strong><span class="muted">Tambahkan subject sebelum membuat bank soal.</span></div><div v-else class="table-scroll"><table v-if="tab === 'years'"><caption class="sr-only">Tahun ajaran</caption><thead><tr><th>Nama</th><th>Periode</th><th>Status</th><th></th></tr></thead><tbody><tr v-for="year in years" :key="year.id"><td><strong>{{ year.name }}</strong><small>ID {{ year.id }}</small></td><td>{{ formatShortDate(year.startsOn) }} – {{ formatShortDate(year.endsOn) }}</td><td><span class="badge" :class="year.isActive ? 'badge-success' : 'badge-muted'">{{ year.isActive ? 'Aktif' : 'Tidak aktif' }}</span></td><td><button v-if="!year.isActive" class="btn-quiet" type="button" @click="activate(year)">Jadikan aktif</button></td></tr></tbody></table><table v-else-if="tab === 'classes'"><caption class="sr-only">Kelas</caption><thead><tr><th>Kode</th><th>Nama</th><th>Tahun ajaran</th><th>Status</th></tr></thead><tbody><tr v-for="item in classes" :key="item.id"><td>{{ item.code }}</td><td>{{ item.name }}</td><td>{{ years.find((year) => year.id === item.academicYearId)?.name ?? item.academicYearId }}</td><td>{{ item.status === 'ACTIVE' ? 'Aktif' : 'Arsip' }}</td></tr></tbody></table><table v-else><caption class="sr-only">Mata pelajaran</caption><thead><tr><th>Kode</th><th>Nama</th><th>Status</th></tr></thead><tbody><tr v-for="item in subjects" :key="item.id"><td>{{ item.code }}</td><td>{{ item.name }}</td><td>{{ item.status === 'ACTIVE' ? 'Aktif' : 'Arsip' }}</td></tr></tbody></table></div></section>
</template>

<style scoped>
.page-heading { margin-bottom: 20px; }.page-heading h1 { margin: 0 0 6px; }.eyebrow { margin: 0 0 4px; color: var(--primary); font-weight: 700; }.tabs { display: flex; gap: 4px; overflow-x: auto; margin-bottom: 14px; border-bottom: 1px solid var(--border); }.tab { min-height: 40px; border: 0; border-bottom: 3px solid transparent; border-radius: 0; background: transparent; color: var(--muted); white-space: nowrap; }.tab.selected { color: var(--primary); border-bottom-color: var(--primary); font-weight: 700; }.form-panel, .table-card { padding: 20px; margin-bottom: 18px; }.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 16px; }.form-grid > div { grid-column: 1 / -1; }.form-grid label { display: grid; gap: 6px; font-weight: 600; }.form-grid input, .form-grid select { min-height: 44px; border: 1px solid var(--border-strong); border-radius: 8px; padding: 8px 12px; color: var(--text); background: var(--surface); font-weight: 400; }.form-grid button { justify-self: start; }.table-scroll { overflow-x: auto; } table { width: 100%; border-collapse: collapse; } th, td { padding: 12px 10px; text-align: left; border-bottom: 1px solid var(--border); } th { color: var(--muted); font-size: .8rem; } td small { display: block; color: var(--subtle); margin-top: 4px; }.table-state { display: grid; gap: 6px; justify-items: center; padding: 42px 12px; }.badge { display: inline-flex; padding: 4px 8px; border-radius: 99px; background: var(--primary-soft); color: var(--primary); font-size: .78rem; font-weight: 700; }.badge-success { color: var(--success); background: var(--success-soft); }.badge-muted { color: var(--muted); background: var(--canvas); }.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media (max-width: 700px) { .form-grid { grid-template-columns: 1fr; } }
</style>

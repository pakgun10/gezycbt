<script setup lang="ts">
import { onMounted, ref } from "vue";
import { HttpStaffApi } from "../features/staff/api";
import type {
  AcademicYear,
  ClassRecord,
  StaffUser,
  Subject,
  TeacherScope,
} from "../features/staff/types";
import { messageFrom } from "../features/staff/helpers";

const api = new HttpStaffApi();
const teachers = ref<readonly StaffUser[]>([]);
const subjects = ref<readonly Subject[]>([]);
const classes = ref<readonly ClassRecord[]>([]);
const years = ref<readonly AcademicYear[]>([]);
const selectedTeacherId = ref("");
const selectedSubjectIds = ref<string[]>([]);
const selectedClassIds = ref<string[]>([]);
const loading = ref(true);
const scopeLoading = ref(false);
const saving = ref(false);
const error = ref("");
const notice = ref("");

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const [teacherPage, subjectPage, classPage, yearPage] = await Promise.all([
      api.users("", "TEACHER", 1, 100),
      api.subjects(100),
      api.classes(undefined, 100),
      api.academicYears(),
    ]);
    teachers.value = teacherPage.items.filter(
      (teacher) => teacher.role === "TEACHER" && teacher.status === "ACTIVE",
    );
    subjects.value = subjectPage.items.filter((subject) => subject.status === "ACTIVE");
    classes.value = classPage.items.filter((item) => item.status === "ACTIVE");
    years.value = yearPage.items;
  } catch (cause) {
    error.value = messageFrom(cause, "Data guru dan akademik belum tersedia.");
  } finally {
    loading.value = false;
  }
}

async function loadScope(): Promise<void> {
  if (!selectedTeacherId.value) {
    selectedSubjectIds.value = [];
    selectedClassIds.value = [];
    return;
  }
  scopeLoading.value = true;
  error.value = "";
  notice.value = "";
  try {
    const scope = await api.teacherScope(selectedTeacherId.value);
    selectedSubjectIds.value = [...scope.subjectIds];
    selectedClassIds.value = [...scope.classIds];
  } catch (cause) {
    error.value = messageFrom(cause, "Scope guru belum dapat dimuat.");
    selectedSubjectIds.value = [];
    selectedClassIds.value = [];
  } finally {
    scopeLoading.value = false;
  }
}

async function saveScope(): Promise<void> {
  if (!selectedTeacherId.value) return;
  saving.value = true;
  error.value = "";
  notice.value = "";
  try {
    const scope: TeacherScope = await api.updateTeacherScope(selectedTeacherId.value, {
      teacherId: selectedTeacherId.value,
      subjectIds: selectedSubjectIds.value,
      classIds: selectedClassIds.value,
    });
    selectedSubjectIds.value = [...scope.subjectIds];
    selectedClassIds.value = [...scope.classIds];
    const teacher = teachers.value.find((item) => item.id === selectedTeacherId.value);
    notice.value = `Scope ${teacher?.displayName ?? "guru"} berhasil disimpan.`;
  } catch (cause) {
    error.value = messageFrom(cause, "Scope guru belum dapat disimpan.");
  } finally {
    saving.value = false;
  }
}

function teacherLabel(teacher: StaffUser): string {
  return `${teacher.displayName} · ${teacher.username}`;
}

function classLabel(item: ClassRecord): string {
  const year = years.value.find((candidate) => candidate.id === item.academicYearId);
  return `${item.name} (${item.code}) · ${year?.name ?? `Tahun ajaran #${item.academicYearId}`}`;
}

onMounted(() => {
  void load();
});
</script>

<template>
  <header class="page-heading">
    <p class="eyebrow">Admin · Otorisasi</p>
    <h1>Kelola scope guru</h1>
    <p class="muted">Tentukan mata pelajaran dan kelas yang dapat diakses setiap guru.</p>
  </header>

  <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>
  <div v-if="notice" class="alert alert-info" role="status">{{ notice }}</div>

  <section class="card scope-card" aria-labelledby="teacher-scope-title">
    <h2 id="teacher-scope-title">Guru</h2>
    <label class="teacher-select">
      Pilih guru
      <select v-model="selectedTeacherId" :disabled="loading || scopeLoading" @change="loadScope">
        <option value="" disabled>Pilih akun guru</option>
        <option v-for="teacher in teachers" :key="teacher.id" :value="teacher.id">
          {{ teacherLabel(teacher) }}
        </option>
      </select>
    </label>
    <p v-if="loading" class="muted">Memuat guru dan data akademik…</p>
    <p v-else-if="teachers.length === 0" class="muted">Belum ada akun guru aktif. Buat akun guru dari menu Pengguna.</p>

    <template v-else-if="selectedTeacherId">
      <p v-if="scopeLoading" class="muted">Memuat scope guru…</p>
      <div v-else class="scope-grid">
        <fieldset>
          <legend>Mata pelajaran</legend>
          <p class="muted">Guru dapat membuat bank soal dan ujian untuk mata pelajaran yang dipilih.</p>
          <label v-for="subject in subjects" :key="subject.id" class="scope-option">
            <input v-model="selectedSubjectIds" type="checkbox" :value="subject.id" />
            <span><strong>{{ subject.name }}</strong><small>{{ subject.code }}</small></span>
          </label>
          <p v-if="subjects.length === 0" class="muted">Belum ada mata pelajaran aktif.</p>
        </fieldset>
        <fieldset>
          <legend>Kelas</legend>
          <p class="muted">Guru dapat mengelola peserta dan jadwal untuk kelas yang dipilih.</p>
          <label v-for="item in classes" :key="item.id" class="scope-option">
            <input v-model="selectedClassIds" type="checkbox" :value="item.id" />
            <span><strong>{{ item.name }}</strong><small>{{ classLabel(item) }}</small></span>
          </label>
          <p v-if="classes.length === 0" class="muted">Belum ada kelas aktif.</p>
        </fieldset>
      </div>
      <div class="scope-summary">
        <span>{{ selectedSubjectIds.length }} mata pelajaran dipilih</span>
        <span>{{ selectedClassIds.length }} kelas dipilih</span>
      </div>
      <div class="scope-actions">
        <button class="btn-primary" type="button" :disabled="saving || scopeLoading" @click="saveScope">
          {{ saving ? "Menyimpan…" : "Simpan scope" }}
        </button>
      </div>
    </template>
    <p v-else class="muted">Pilih guru untuk melihat dan mengatur scope-nya.</p>
  </section>
</template>

<style scoped>
.page-heading { margin-bottom: 20px; }
.page-heading h1 { margin: 0 0 6px; }
.eyebrow { margin: 0 0 4px; color: var(--primary); font-weight: 700; }
.scope-card { display: grid; gap: 16px; padding: 20px; }
.scope-card h2 { margin: 0; }
.teacher-select { display: grid; gap: 6px; max-width: 620px; font-weight: 700; }
.teacher-select select { min-height: 44px; border: 1px solid var(--border-strong); border-radius: 8px; padding: 8px 12px; color: var(--text); background: var(--surface); font-weight: 400; }
.scope-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
fieldset { min-width: 0; display: grid; gap: 10px; margin: 0; padding: 16px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-elevated); }
legend { padding: 0 6px; font-weight: 800; }
fieldset p { margin: 0; }
.scope-option { display: flex; align-items: flex-start; gap: 10px; padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); cursor: pointer; }
.scope-option input { width: 18px; height: 18px; margin-top: 2px; flex: 0 0 auto; }
.scope-option span { display: grid; gap: 3px; }
.scope-option small { color: var(--subtle); }
.scope-summary { display: flex; flex-wrap: wrap; gap: 8px; color: var(--muted); font-size: .9rem; }
.scope-summary span { padding: 8px 10px; border-radius: 8px; background: var(--canvas); }
.scope-actions { display: flex; justify-content: flex-end; }
@media (max-width: 700px) { .scope-grid { grid-template-columns: 1fr; }.scope-actions button { width: 100%; } }
</style>

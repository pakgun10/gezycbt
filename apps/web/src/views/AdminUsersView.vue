<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { HttpStaffApi } from "../features/staff/api";
import { useStaffAuth } from "../features/staff/auth-store";
import type { NumberedPage, StaffUser } from "../features/staff/types";
import { formatDate, messageFrom } from "../features/staff/helpers";

const api = new HttpStaffApi();
const auth = useStaffAuth();
const users = ref<readonly StaffUser[]>([]);
const userPage = ref<NumberedPage<StaffUser> | null>(null);
const currentPage = ref(1);
const search = ref("");
const loading = ref(true);
const saving = ref(false);
const error = ref("");
const activePanel = ref<"none" | "create" | "import">("none");
const form = ref({ username: "", displayName: "", role: "PARTICIPANT", password: "" });
const csvText = ref("");
const academicYearId = ref("");
const preview = ref<{ id: string; totalRows: number; blockingCount: number; createCount: number; updateCount: number; unchangedCount: number; duplicateCount: number; errorCount: number; expiresAt: string; status: string } | null>(null);
const commitToken = ref("");
const credentialArtifactId = ref("");
const importBusy = ref(false);
const importMessage = ref("");
const importRows = ref<readonly { rowNumber: number; username: string | null; displayName: string | null; classification: string; errors: readonly { field: string; message: string }[] }[]>([]);
const importRowFilter = ref("ALL");
const importRowsLoading = ref(false);
const canCommit = computed(() => Boolean(preview.value && preview.value.blockingCount === 0 && preview.value.status === "PENDING" && commitToken.value));
const pageItems = computed<readonly (number | "start-gap" | "end-gap")[]>(() => compactPageItems(currentPage.value, userPage.value?.totalPages ?? 0));

function compactPageItems(page: number, totalPages: number): readonly (number | "start-gap" | "end-gap")[] {
  if (totalPages < 2) return totalPages === 1 ? [1] : [];
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  if (page <= 4) return [1, 2, 3, 4, 5, "end-gap", totalPages];
  if (page >= totalPages - 3) return [1, "start-gap", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  return [1, "start-gap", page - 1, page, page + 1, "end-gap", totalPages];
}
async function load(page = currentPage.value): Promise<void> {
  loading.value = true; error.value = "";
  try { const result = await api.users(search.value, undefined, page); users.value = result.items; userPage.value = result; currentPage.value = result.page; } catch (cause) { error.value = messageFrom(cause, "Daftar pengguna belum tersedia."); } finally { loading.value = false; }
}
async function create(): Promise<void> {
  saving.value = true; error.value = "";
  try { await api.createUser(form.value); activePanel.value = "none"; form.value = { username: "", displayName: "", role: "PARTICIPANT", password: "" }; const totalAfterCreate = (userPage.value?.totalItems ?? 0) + 1; await load(Math.max(1, Math.ceil(totalAfterCreate / (userPage.value?.pageSize ?? 25)))); } catch (cause) { error.value = messageFrom(cause); } finally { saving.value = false; }
}
async function disable(user: StaffUser): Promise<void> {
  if (!window.confirm(`Nonaktifkan akun ${user.displayName}? Sesi aktif akan dicabut.`)) return;
  try { await api.disableUser(user.id, user.updatedAt); await load(); } catch (cause) { error.value = messageFrom(cause); }
}
async function readFile(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { error.value = "File maksimal 2 MiB."; return; }
  csvText.value = await file.text();
  preview.value = null; commitToken.value = ""; credentialArtifactId.value = ""; importMessage.value = "File siap dipratinjau.";
}
function downloadParticipantImportTemplate(): void {
  const csv = "\uFEFFusername,display_name,class_code\n";
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "template-import-peserta.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}
async function loadImportRows(): Promise<void> { if (!preview.value) return; importRowsLoading.value = true; try { importRows.value = (await api.importRows(preview.value.id, importRowFilter.value === "ALL" ? undefined : importRowFilter.value)).items; } catch (cause) { importMessage.value = messageFrom(cause, "Baris preview belum tersedia."); } finally { importRowsLoading.value = false; } }
async function downloadImportErrors(): Promise<void> { if (!preview.value) return; try { const csv = await api.importErrorsCsv(preview.value.id); const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "import-errors.csv"; anchor.click(); URL.revokeObjectURL(url); } catch (cause) { importMessage.value = messageFrom(cause, "Error row belum dapat diunduh."); } }
async function makePreview(): Promise<void> {
  if (!academicYearId.value || !csvText.value) { importMessage.value = "Pilih tahun ajaran dan file CSV."; return; }
  importBusy.value = true; importMessage.value = "Server sedang memvalidasi file…";
  try { const result = await api.previewImport(academicYearId.value, csvText.value); preview.value = result.preview; commitToken.value = result.commitToken; credentialArtifactId.value = ""; importMessage.value = "Preview berhasil dibuat. Token disimpan internal selama wizard."; importRowFilter.value = "ALL"; await loadImportRows(); } catch (cause) { importMessage.value = messageFrom(cause, "Preview gagal dibuat."); } finally { importBusy.value = false; }
}
async function commit(): Promise<void> {
  if (!preview.value || !canCommit.value) return;
  if (!window.confirm(`Import ${preview.value.createCount} peserta baru?`)) return;
  importBusy.value = true;
  try { const password = window.prompt("Masukkan ulang password admin untuk commit import:"); if (!password) { importMessage.value = "Commit dibatalkan karena re-authentication diperlukan."; return; } await api.reauth(password); const result = await api.commitImport(preview.value.id, commitToken.value); preview.value = { ...preview.value, status: "COMMITTED" }; commitToken.value = ""; credentialArtifactId.value = result.artifactId; importRows.value = []; importMessage.value = `Import selesai. ${result.createdUserCount} akun diproses.`; await load(); } catch (cause) { importMessage.value = messageFrom(cause, "Import gagal."); } finally { importBusy.value = false; }
}
async function downloadImportCredentials(): Promise<void> {
  if (!credentialArtifactId.value) return;
  const password = window.prompt("Masukkan ulang password admin untuk mengunduh credential:");
  if (!password) { importMessage.value = "Unduhan dibatalkan karena re-authentication diperlukan."; return; }
  importBusy.value = true;
  try {
    await api.reauth(password);
    const result = await api.downloadImportCredentials(credentialArtifactId.value);
    const url = URL.createObjectURL(new Blob([result.content], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result.filename;
    anchor.click();
    URL.revokeObjectURL(url);
    credentialArtifactId.value = "";
    importMessage.value = "Credential berhasil diunduh. File ini hanya dapat diunduh sekali.";
  } catch (cause) { importMessage.value = messageFrom(cause, "Credential belum dapat diunduh."); } finally { importBusy.value = false; }
}
onMounted(() => { void load(); });
</script>

<template>
  <header class="page-heading between"><div><p class="eyebrow">Admin</p><h1>Pengguna</h1><p class="muted">Kelola akun admin, guru, dan peserta. Password tidak pernah ditampilkan ulang.</p></div><div class="stack"><button class="btn-secondary" type="button" @click="activePanel = activePanel === 'import' ? 'none' : 'import'">Impor peserta</button><button class="btn-primary" type="button" @click="activePanel = activePanel === 'create' ? 'none' : 'create'">Tambah pengguna</button></div></header>
  <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>
  <section v-if="activePanel === 'create'" class="card form-panel" aria-labelledby="create-user-title"><div class="between"><h2 id="create-user-title">Tambah pengguna</h2><button class="btn-quiet" type="button" @click="activePanel = 'none'">Tutup</button></div><form class="form-grid" @submit.prevent="create"><div class="form-row"><label for="new-username">Username</label><input id="new-username" v-model="form.username" required autocomplete="off" /></div><div class="form-row"><label for="new-display">Nama tampilan</label><input id="new-display" v-model="form.displayName" required /></div><div class="form-row"><label for="new-role">Role</label><select id="new-role" v-model="form.role"><option value="PARTICIPANT">Peserta</option><option value="TEACHER">Guru</option><option value="ADMIN">Admin</option></select></div><div class="form-row"><label for="new-password">Password sementara</label><input id="new-password" v-model="form.password" type="password" minlength="8" required autocomplete="new-password" /><small class="muted">Minimal 12 karakter untuk staff, 8 untuk peserta.</small></div><button class="btn-primary" type="submit" :disabled="saving">{{ saving ? 'Menyimpan…' : 'Simpan pengguna' }}</button></form></section>
  <section v-if="activePanel === 'import'" class="card form-panel" aria-labelledby="import-title"><div class="between"><div><h2 id="import-title">Impor peserta</h2><p class="muted">Preview sampai 1.500 baris memakai pagination server.</p></div><button class="btn-quiet" type="button" @click="activePanel = 'none'">Tutup</button></div><div class="form-grid"><div class="form-row"><label for="import-year">ID tahun ajaran</label><input id="import-year" v-model="academicYearId" placeholder="Contoh: 1" /></div><div class="form-row"><label for="import-file">File CSV</label><input id="import-file" type="file" accept=".csv,text/csv" @change="readFile" /><small class="muted">Kolom wajib: username dan display_name. class_code opsional.</small></div></div><div class="import-template-actions"><button class="btn-quiet" type="button" @click="downloadParticipantImportTemplate">Unduh template CSV</button><small class="muted">Template memakai kolom username, display_name, class_code. Jangan menambahkan kolom password.</small></div><p v-if="importMessage" class="alert alert-info" aria-live="polite">{{ importMessage }}</p><button class="btn-secondary" type="button" :disabled="importBusy || !csvText" @click="makePreview">{{ importBusy ? 'Memproses…' : 'Buat preview' }}</button><div v-if="preview" class="import-summary"><span>Total {{ preview.totalRows }}</span><span>Baru {{ preview.createCount }}</span><span>Berubah {{ preview.updateCount }}</span><span>Duplikat {{ preview.duplicateCount }}</span><span :class="{ 'text-danger': preview.blockingCount > 0 }">Blocking {{ preview.blockingCount }}</span><span>Expired {{ formatDate(preview.expiresAt) }}</span><strong v-if="preview.status === 'COMMITTED'">Selesai</strong></div><div v-if="preview?.status === 'COMMITTED' && credentialArtifactId" class="import-template-actions"><button class="btn-secondary" type="button" :disabled="importBusy" @click="downloadImportCredentials">Unduh credential peserta</button><small class="muted">Berisi username dan password sementara. Hanya bisa diunduh sekali dan kedaluwarsa dalam 15 menit.</small></div><div v-if="preview && preview.status === 'PENDING'" class="import-rows"><div class="between"><label>Filter baris<select v-model="importRowFilter" @change="loadImportRows"><option value="ALL">Semua</option><option value="CREATE">Baru</option><option value="WOULD_UPDATE">Berubah</option><option value="UNCHANGED">Tidak berubah</option><option value="DUPLICATE">Duplikat</option><option value="ERROR">Error</option></select></label><button class="btn-secondary" type="button" :disabled="preview.errorCount === 0" @click="downloadImportErrors">Unduh baris error</button></div><div v-if="importRowsLoading" class="table-state">Memuat baris preview…</div><div v-else-if="importRows.length" class="table-scroll"><table><caption class="sr-only">Baris preview import</caption><thead><tr><th>Baris</th><th>Identitas</th><th>Status</th><th>Error</th></tr></thead><tbody><tr v-for="row in importRows" :key="row.rowNumber"><td>{{ row.rowNumber }}</td><td>{{ row.displayName ?? "—" }}<small>{{ row.username ?? "—" }}</small></td><td>{{ row.classification }}</td><td><span v-if="row.errors.length === 0">—</span><span v-for="item in row.errors" :key="`${item.field}-${item.message}`">{{ item.field }}: {{ item.message }}</span></td></tr></tbody></table></div><p v-else class="muted small-copy">Tidak ada baris pada filter ini.</p></div><button class="btn-primary" type="button" :disabled="importBusy || !canCommit" @click="commit">{{ preview?.status === 'COMMITTED' ? 'Sudah selesai' : 'Import peserta' }}</button><p class="muted small-copy">Commit dinonaktifkan bila ada blocking error. Commit token dan baris normalized tetap internal di server.</p></section>
  <section class="card table-card" aria-labelledby="users-table-title"><div class="table-toolbar"><div><h2 id="users-table-title">Daftar akun</h2><p class="muted">{{ users.length }} dari {{ userPage?.totalItems ?? 0 }} akun<span v-if="userPage?.totalPages"> · Halaman {{ currentPage }} dari {{ userPage.totalPages }}</span></p></div><form class="search-form" @submit.prevent="load(1)"><label class="sr-only" for="user-search">Cari pengguna</label><input id="user-search" v-model="search" placeholder="Cari nama atau username" /><button class="btn-secondary" type="submit">Cari</button></form></div><div v-if="loading" class="table-state">Memuat pengguna…</div><div v-else-if="users.length === 0" class="table-state"><strong>Belum ada pengguna</strong><span class="muted">Tambahkan akun atau jalankan impor peserta.</span></div><template v-else><div class="table-scroll"><table><caption class="sr-only">Daftar pengguna</caption><thead><tr><th>Nama</th><th>Username</th><th>Role</th><th>Status</th><th>Login terakhir</th><th><span class="sr-only">Tindakan</span></th></tr></thead><tbody><tr v-for="user in users" :key="user.id"><td><strong>{{ user.displayName }}</strong><small>ID {{ user.id }}</small></td><td>{{ user.username }}</td><td><span class="badge">{{ user.role }}</span></td><td><span class="badge" :class="user.status === 'ACTIVE' ? 'badge-success' : 'badge-muted'">{{ user.status === 'ACTIVE' ? 'Aktif' : 'Nonaktif' }}</span></td><td>{{ formatDate(user.lastLoginAt) }}</td><td><button v-if="user.status === 'ACTIVE' && user.id !== auth.user.value?.id" class="btn-quiet" type="button" @click="disable(user)">Nonaktifkan</button></td></tr></tbody></table></div><nav v-if="userPage && userPage.totalPages > 1" class="pagination" aria-label="Pagination daftar pengguna"><button class="page-button" type="button" :disabled="currentPage === 1" aria-label="Halaman pertama" @click="load(1)">«</button><button class="page-button" type="button" :disabled="currentPage === 1" aria-label="Halaman sebelumnya" @click="load(currentPage - 1)">‹</button><template v-for="item in pageItems" :key="item"><span v-if="typeof item !== 'number'" class="page-gap" aria-hidden="true">…</span><button v-else class="page-button" :class="{ current: item === currentPage }" type="button" :aria-current="item === currentPage ? 'page' : undefined" :aria-label="`Halaman ${item}`" @click="load(item)">{{ item }}</button></template><button class="page-button" type="button" :disabled="currentPage === userPage.totalPages" aria-label="Halaman berikutnya" @click="load(currentPage + 1)">›</button><button class="page-button" type="button" :disabled="currentPage === userPage.totalPages" aria-label="Halaman terakhir" @click="load(userPage.totalPages)">»</button></nav></template></section>
</template>

<style scoped>
.page-heading { align-items: flex-start; margin-bottom: 22px; }.page-heading h1 { margin: 0 0 6px; }.eyebrow { margin: 0 0 4px; color: var(--primary); font-weight: 700; }.form-panel, .table-card { padding: 20px; margin-bottom: 18px; }.form-panel h2, .table-card h2 { margin: 0; }.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 16px; }.form-grid > button { justify-self: start; }.table-toolbar { display: flex; justify-content: space-between; align-items: end; gap: 16px; margin-bottom: 16px; }.search-form { display: flex; gap: 8px; }.search-form input { min-height: 40px; min-width: min(300px, 45vw); }.table-scroll { overflow-x: auto; } table { width: 100%; border-collapse: collapse; } th, td { padding: 12px 10px; text-align: left; border-bottom: 1px solid var(--border); vertical-align: top; } th { color: var(--muted); font-size: .8rem; } td small { display: block; color: var(--subtle); margin-top: 4px; }.table-state { display: grid; gap: 6px; justify-items: center; padding: 42px 12px; }.badge { display: inline-flex; padding: 4px 8px; border-radius: 99px; background: var(--primary-soft); color: var(--primary); font-size: .78rem; font-weight: 700; }.badge-success { color: var(--success); background: var(--success-soft); }.badge-muted { color: var(--muted); background: var(--canvas); }.pagination { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 4px; padding-top: 16px; }.page-button { display: grid; place-items: center; min-width: 36px; min-height: 36px; padding: 4px 8px; border: 1px solid var(--border-strong); border-radius: 8px; color: var(--text); background: var(--surface); cursor: pointer; font: inherit; }.page-button:hover:not(:disabled) { border-color: var(--primary); background: var(--primary-soft); }.page-button.current { border-color: var(--primary); color: var(--primary); background: var(--primary-soft); font-weight: 700; }.page-button:disabled { cursor: not-allowed; opacity: .45; }.page-gap { display: grid; place-items: center; min-width: 28px; min-height: 36px; color: var(--muted); }.import-template-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 12px 0 16px; }.import-summary { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0; }.import-rows { margin: 16px 0; padding-top: 14px; border-top: 1px solid var(--border); }.import-rows label { display: grid; gap: 5px; color: var(--muted); font-size: .85rem; font-weight: 700; }.import-rows select { min-height: 36px; border: 1px solid var(--border-strong); border-radius: 7px; padding: 4px 8px; background: var(--surface); color: var(--text); font-weight: 400; }.import-rows table { margin-top: 12px; }.import-rows td span { display: block; }.import-summary span, .import-summary strong { padding: 8px 10px; border-radius: 8px; background: var(--canvas); font-size: .86rem; }.text-danger { color: var(--danger); }.small-copy { font-size: .85rem; }.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media (max-width: 700px) { .page-heading, .table-toolbar { display: grid; align-items: stretch; }.form-grid { grid-template-columns: 1fr; }.search-form input { min-width: 0; flex: 1; } }
</style>

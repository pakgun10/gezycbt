<script setup lang="ts">
import { ref } from "vue";
import { HttpStaffApi } from "../features/staff/api";
import type { BackupSummary } from "../features/staff/types";
import { formatDate, messageFrom } from "../features/staff/helpers";

const api = new HttpStaffApi();
const downloadPassphrase = ref("");
const restorePassphrase = ref("");
const fileBase64 = ref("");
const fileName = ref("");
const summary = ref<BackupSummary | null>(null);
const confirmed = ref(false);
const restored = ref(false);
const busy = ref(false);
const error = ref("");
const notice = ref("");

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function onFileChange(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  summary.value = null;
  restored.value = false;
  error.value = "";
  if (!file) {
    fileBase64.value = "";
    fileName.value = "";
    return;
  }
  fileName.value = file.name;
  const reader = new FileReader();
  reader.onload = () => {
    const result = String(reader.result ?? "");
    fileBase64.value = result.includes(",") ? result.split(",")[1] ?? "" : result;
  };
  reader.onerror = () => {
    error.value = "Berkas backup tidak dapat dibaca.";
  };
  reader.readAsDataURL(file);
}

async function download(): Promise<void> {
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    const result = await api.backupDownload(downloadPassphrase.value);
    const url = URL.createObjectURL(result.blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result.filename;
    anchor.click();
    URL.revokeObjectURL(url);
    notice.value = `Backup diunduh: ${result.filename}. Simpan berkas ini di luar server dan jangan bagikan passphrase-nya.`;
  } catch (cause) {
    error.value = messageFrom(cause, "Backup tidak dapat diunduh.");
  } finally {
    busy.value = false;
  }
}

async function preview(): Promise<void> {
  if (!fileBase64.value) {
    error.value = "Pilih berkas backup dulu.";
    return;
  }
  busy.value = true;
  error.value = "";
  notice.value = "";
  confirmed.value = false;
  try {
    summary.value = await api.backupPreview(fileBase64.value, restorePassphrase.value);
  } catch (cause) {
    summary.value = null;
    error.value = messageFrom(cause, "Pratinjau backup gagal.");
  } finally {
    busy.value = false;
  }
}

async function restore(): Promise<void> {
  if (!summary.value || !confirmed.value) return;
  busy.value = true;
  error.value = "";
  try {
    await api.backupRestore(fileBase64.value, restorePassphrase.value);
    restored.value = true;
    summary.value = null;
    notice.value = "";
  } catch (cause) {
    error.value = messageFrom(cause, "Restore gagal. Data lama tidak diubah bila gagal sebelum transaksi.");
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <header class="page-heading"><p class="eyebrow">Admin · Governance</p><h1>Backup &amp; Restore</h1><p class="muted">Satu berkas terenkripsi berisi seluruh data aplikasi dan media soal, untuk pindah server. Backup harian otomatis di server tetap berjalan terpisah.</p></header>
  <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>
  <div v-if="notice" class="alert alert-success" role="alert">{{ notice }}</div>
  <section class="card"><h2>Unduh backup</h2><p class="muted">Berkas dienkripsi dengan passphrase yang Anda isi. Tanpa passphrase ini berkas tidak bisa dibuka, jadi simpan keduanya di tempat yang berbeda.</p><div class="form-grid"><label>Passphrase backup (minimal 12 karakter)<input v-model="downloadPassphrase" type="password" autocomplete="new-password" /></label><button class="btn-primary" type="button" :disabled="busy || downloadPassphrase.length < 12" @click="download">Unduh backup</button></div><p class="muted small-copy">Isi backup: 34 tabel data (pengguna, akademik, bank soal, ujian, jadwal, sesi, jawaban, hasil, media, integrasi, log audit). Tidak ikut: sesi login, token unduhan export, artefak impor, dan kredensial integrasi (harus diterbitkan ulang setelah pindah).</p></section>
  <section class="card"><h2>Restore dari berkas</h2><p class="muted">Restore <strong>mengganti seluruh data</strong> di server ini dengan isi berkas, menghapus semua sesi login, dan menolak bila ada sesi ujian yang sedang berjalan.</p><div class="form-grid"><label>Berkas backup (.gezycbtbackup)<input type="file" accept=".gezycbtbackup" @change="onFileChange" /></label><label>Passphrase berkas<input v-model="restorePassphrase" type="password" autocomplete="current-password" /></label><button class="btn-secondary" type="button" :disabled="busy || !fileBase64 || restorePassphrase.length < 12" @click="preview">Pratinjau isi berkas</button></div>
    <div v-if="summary" class="summary"><p><strong>Isi berkas: {{ fileName }}</strong></p><dl><div><dt>Diekspor</dt><dd>{{ formatDate(summary.exportedAt) }}</dd></div><div><dt>Versi skema</dt><dd>{{ summary.schemaVersion }}</dd></div><div><dt>Total baris</dt><dd>{{ summary.totalRows }}</dd></div><div><dt>Media</dt><dd>{{ summary.mediaCount }} berkas · {{ formatBytes(summary.mediaBytes) }}</dd></div></dl><p v-for="warning in summary.warnings" :key="warning" class="muted small-copy">⚠️ {{ warning }}</p><details><summary>Jumlah baris per tabel</summary><ul><li v-for="table in summary.tables.filter((t) => t.rows > 0)" :key="table.name">{{ table.name }}: {{ table.rows }}</li></ul></details><label class="check"><input v-model="confirmed" type="checkbox" /> Saya mengerti restore mengganti seluruh data dan mengeluarkan semua sesi login.</label><button class="btn-danger" type="button" :disabled="busy || !confirmed" @click="restore">Restore sekarang</button></div>
    <div v-if="restored" class="restored"><strong>Restore berhasil.</strong><p class="muted">Semua sesi login sudah dibersihkan, termasuk sesi Anda. Silakan login ulang dengan akun dari berkas backup, lalu jalankan migrasi maju bila pratinjau tadi menyebut skema lama.</p><a class="btn-primary" href="/admin/login">Ke halaman login</a></div>
  </section>
</template>

<style scoped>
.page-heading { margin-bottom: 18px; }.page-heading h1 { margin: 0 0 6px; }.eyebrow { margin: 0 0 4px; color: var(--primary); font-weight: 700; }.card { padding: 20px; margin-bottom: 16px; }.card h2 { margin: 0 0 8px; }.form-grid { display: flex; flex-wrap: wrap; align-items: end; gap: 14px; margin-top: 12px; }.form-grid label { display: grid; gap: 6px; color: var(--muted); font-weight: 700; }.form-grid input { min-height: 40px; border: 1px solid var(--border-strong); border-radius: 8px; padding: 6px 10px; background: var(--surface); color: var(--text); font-weight: 400; }.check { display: flex !important; align-items: flex-start; gap: 8px; margin: 14px 0; }.check input { width: 18px; height: 18px; }.summary { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border); }.summary dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }.summary dt { color: var(--subtle); font-size: .8rem; }.summary dd { margin: 3px 0 0; }.summary ul { columns: 2; }.restored { margin-top: 16px; padding: 16px; border-radius: 8px; background: var(--success-soft); }.small-copy { font-size: .85rem; }.alert-success { color: var(--success); background: var(--success-soft); padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; }
</style>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { HttpStaffApi } from "../features/staff/api";
import type { AuditRow, NumberedPage } from "../features/staff/types";
import { formatDate, messageFrom } from "../features/staff/helpers";

const api = new HttpStaffApi();
const items = ref<readonly AuditRow[]>([]);
const auditPage = ref<NumberedPage<AuditRow> | null>(null);
const currentPage = ref(1);
const query = ref("");
const selected = ref<AuditRow | null>(null);
const loading = ref(true);
const error = ref("");
const pageItems = computed<readonly (number | "start-gap" | "end-gap")[]>(() => compactPageItems(currentPage.value, auditPage.value?.totalPages ?? 0));

function compactPageItems(page: number, totalPages: number): readonly (number | "start-gap" | "end-gap")[] {
  if (totalPages < 2) return totalPages === 1 ? [1] : [];
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  if (page <= 4) return [1, 2, 3, 4, 5, "end-gap", totalPages];
  if (page >= totalPages - 3) return [1, "start-gap", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  return [1, "start-gap", page - 1, page, page + 1, "end-gap", totalPages];
}

async function load(page = 1): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const result = await api.audit(query.value, page);
    items.value = result.items;
    auditPage.value = result;
    currentPage.value = result.page;
  } catch (cause) {
    error.value = messageFrom(cause, "Audit log belum tersedia.");
  } finally {
    loading.value = false;
  }
}
onMounted(() => { void load(1); });
</script>

<template>
  <header class="page-heading"><p class="eyebrow">Admin · Governance</p><h1>Audit log</h1><p class="muted">Jejak perubahan penting, tanpa password, token, answer key, atau raw answer.</p><p class="muted small-copy">Ringkasan audit disimpan minimal 1 tahun. Detail action agent minimal 90 hari. Saat ini tidak ada penghapusan otomatis audit.</p></header>
  <form class="toolbar" @submit.prevent="load(1)"><label class="sr-only" for="audit-search">Cari audit</label><input id="audit-search" v-model="query" placeholder="Actor, action, entity, request ID" /><button class="btn-secondary" type="submit">Filter</button></form><div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>
  <section class="card table-card"><div v-if="loading" class="table-state">Memuat audit…</div><div v-else-if="items.length === 0" class="table-state"><strong>Belum ada aktivitas</strong><span class="muted">Audit akan tampil setelah mutation pertama.</span></div><template v-else><div class="table-summary"><strong>{{ items.length }} dari {{ auditPage?.totalItems ?? 0 }} catatan</strong><span v-if="auditPage?.totalPages">Halaman {{ currentPage }} dari {{ auditPage.totalPages }}</span></div><div class="table-scroll"><table><caption class="sr-only">Audit log</caption><thead><tr><th>Waktu</th><th>Aksi</th><th>Actor</th><th>Entity</th><th>Outcome</th><th></th></tr></thead><tbody><tr v-for="item in items" :key="item.id"><td>{{ formatDate(item.createdAt) }}</td><td>{{ item.action }}</td><td>{{ item.actorLabel }}</td><td>{{ item.entityType }} {{ item.entityId ?? '—' }}</td><td>{{ item.outcome }}</td><td><button class="btn-quiet" type="button" @click="selected = item">Detail</button></td></tr></tbody></table></div><nav v-if="auditPage && auditPage.totalPages > 1" class="pagination" aria-label="Pagination audit log"><button class="page-button" type="button" :disabled="currentPage === 1 || loading" aria-label="Halaman pertama" @click="load(1)">«</button><button class="page-button" type="button" :disabled="currentPage === 1 || loading" aria-label="Halaman sebelumnya" @click="load(currentPage - 1)">‹</button><template v-for="item in pageItems" :key="item"><span v-if="typeof item !== 'number'" class="page-gap" aria-hidden="true">…</span><button v-else class="page-button" :class="{ current: item === currentPage }" type="button" :disabled="loading" :aria-current="item === currentPage ? 'page' : undefined" :aria-label="`Halaman ${item}`" @click="load(item)">{{ item }}</button></template><button class="page-button" type="button" :disabled="currentPage === auditPage.totalPages || loading" aria-label="Halaman berikutnya" @click="load(currentPage + 1)">›</button><button class="page-button" type="button" :disabled="currentPage === auditPage.totalPages || loading" aria-label="Halaman terakhir" @click="load(auditPage.totalPages)">»</button></nav></template></section>
  <div v-if="selected" class="overlay" role="dialog" aria-modal="true" aria-labelledby="audit-detail-title"><aside class="drawer"><div class="between"><h2 id="audit-detail-title">Detail audit</h2><button class="btn-quiet" type="button" @click="selected = null">Tutup</button></div><dl><div><dt>Action</dt><dd>{{ selected.action }}</dd></div><div><dt>Outcome</dt><dd>{{ selected.outcome }}</dd></div><div><dt>Actor</dt><dd>{{ selected.actorLabel }}</dd></div><div><dt>Entity</dt><dd>{{ selected.entityType }} · {{ selected.entityId ?? '—' }}</dd></div><div><dt>Request ID</dt><dd><code>{{ selected.requestId }}</code></dd></div><div><dt>Metadata aman</dt><dd><pre>{ "redacted": true, "note": "Field sensitif tidak ditampilkan" }</pre></dd></div></dl></aside></div>
</template>

<style scoped>
.page-heading { margin-bottom: 16px; }.page-heading h1 { margin: 0 0 6px; }.eyebrow { margin: 0 0 4px; color: var(--primary); font-weight: 700; }.toolbar { display: flex; gap: 8px; margin-bottom: 16px; }.toolbar input { min-height: 40px; flex: 1; max-width: 500px; border: 1px solid var(--border-strong); border-radius: 8px; padding: 8px 10px; color: var(--text); background: var(--surface); }.table-card { padding: 20px; }.table-summary { display: flex; gap: 12px; margin-bottom: 14px; color: var(--muted); font-size: .9rem; }.table-summary strong { color: var(--text); }.table-scroll { overflow-x: auto; } table { width: 100%; border-collapse: collapse; } th, td { padding: 11px 9px; border-bottom: 1px solid var(--border); text-align: left; } th { color: var(--muted); font-size: .8rem; }.table-state { display: grid; place-items: center; gap: 6px; min-height: 180px; }.pagination { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 4px; padding-top: 16px; }.page-button { display: grid; place-items: center; min-width: 36px; min-height: 36px; padding: 4px 8px; border: 1px solid var(--border-strong); border-radius: 8px; color: var(--text); background: var(--surface); cursor: pointer; font: inherit; }.page-button:hover:not(:disabled) { border-color: var(--primary); background: var(--primary-soft); }.page-button.current { border-color: var(--primary); color: var(--primary); background: var(--primary-soft); font-weight: 700; }.page-button:disabled { cursor: not-allowed; opacity: .45; }.page-gap { display: grid; place-items: center; min-width: 28px; min-height: 36px; color: var(--muted); }.overlay { position: fixed; inset: 0; z-index: 20; display: flex; justify-content: flex-end; background: rgb(2 6 23 / 45%); }.drawer { width: min(460px, 100%); height: 100%; overflow: auto; padding: 24px; background: var(--surface); }.drawer dl { display: grid; gap: 14px; }.drawer dt { color: var(--subtle); font-size: .8rem; }.drawer dd { margin: 3px 0 0; }.drawer pre { max-width: 100%; overflow: auto; padding: 10px; border-radius: 8px; background: var(--canvas); }.small-copy { font-size: .85rem; }.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
</style>

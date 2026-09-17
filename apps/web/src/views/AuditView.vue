<script setup lang="ts">
import { onMounted, ref } from "vue";
import { HttpStaffApi } from "../features/staff/api";
import type { AuditRow } from "../features/staff/types";
import { formatDate, messageFrom } from "../features/staff/helpers";

const api = new HttpStaffApi();
const items = ref<readonly AuditRow[]>([]);
const query = ref("");
const selected = ref<AuditRow | null>(null);
const loading = ref(true);
const error = ref("");
async function load(): Promise<void> { loading.value = true; try { items.value = (await api.audit(query.value)).items; } catch (cause) { error.value = messageFrom(cause, "Audit log belum tersedia."); } finally { loading.value = false; } }
onMounted(() => { void load(); });
</script>

<template>
  <header class="page-heading"><p class="eyebrow">Admin · Governance</p><h1>Audit log</h1><p class="muted">Jejak perubahan penting, tanpa password, token, answer key, atau raw answer.</p></header>
  <form class="toolbar" @submit.prevent="load"><label class="sr-only" for="audit-search">Cari audit</label><input id="audit-search" v-model="query" placeholder="Actor, action, entity, request ID" /><button class="btn-secondary" type="submit">Filter</button></form><div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>
  <section class="card table-card"><div v-if="loading" class="table-state">Memuat audit…</div><div v-else-if="items.length === 0" class="table-state"><strong>Belum ada aktivitas</strong><span class="muted">Audit akan tampil setelah mutation pertama.</span></div><div v-else class="table-scroll"><table><caption class="sr-only">Audit log</caption><thead><tr><th>Waktu</th><th>Aksi</th><th>Actor</th><th>Entity</th><th>Outcome</th><th></th></tr></thead><tbody><tr v-for="item in items" :key="item.id"><td>{{ formatDate(item.createdAt) }}</td><td>{{ item.action }}</td><td>{{ item.actorLabel }}</td><td>{{ item.entityType }} {{ item.entityId ?? '—' }}</td><td>{{ item.outcome }}</td><td><button class="btn-quiet" type="button" @click="selected = item">Detail</button></td></tr></tbody></table></div></section>
  <div v-if="selected" class="overlay" role="dialog" aria-modal="true" aria-labelledby="audit-detail-title"><aside class="drawer"><div class="between"><h2 id="audit-detail-title">Detail audit</h2><button class="btn-quiet" type="button" @click="selected = null">Tutup</button></div><dl><div><dt>Action</dt><dd>{{ selected.action }}</dd></div><div><dt>Outcome</dt><dd>{{ selected.outcome }}</dd></div><div><dt>Actor</dt><dd>{{ selected.actorLabel }}</dd></div><div><dt>Entity</dt><dd>{{ selected.entityType }} · {{ selected.entityId ?? '—' }}</dd></div><div><dt>Request ID</dt><dd><code>{{ selected.requestId }}</code></dd></div><div><dt>Metadata aman</dt><dd><pre>{ "redacted": true, "note": "Field sensitif tidak ditampilkan" }</pre></dd></div></dl></aside></div>
</template>

<style scoped>
.page-heading { margin-bottom: 16px; }.page-heading h1 { margin: 0 0 6px; }.eyebrow { margin: 0 0 4px; color: var(--primary); font-weight: 700; }.toolbar { display: flex; gap: 8px; margin-bottom: 16px; }.toolbar input { min-height: 40px; flex: 1; max-width: 500px; border: 1px solid var(--border-strong); border-radius: 8px; padding: 8px 10px; color: var(--text); background: var(--surface); }.table-card { padding: 20px; }.table-scroll { overflow-x: auto; } table { width: 100%; border-collapse: collapse; } th, td { padding: 11px 9px; border-bottom: 1px solid var(--border); text-align: left; } th { color: var(--muted); font-size: .8rem; }.table-state { display: grid; place-items: center; gap: 6px; min-height: 180px; }.overlay { position: fixed; inset: 0; z-index: 20; display: flex; justify-content: flex-end; background: rgb(2 6 23 / 45%); }.drawer { width: min(460px, 100%); height: 100%; overflow: auto; padding: 24px; background: var(--surface); }.drawer dl { display: grid; gap: 14px; }.drawer dt { color: var(--subtle); font-size: .8rem; }.drawer dd { margin: 3px 0 0; }.drawer pre { max-width: 100%; overflow: auto; padding: 10px; border-radius: 8px; background: var(--canvas); }.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
</style>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { HttpStaffApi } from "../features/staff/api";
import type { IntegrationAction, IntegrationClient, IntegrationClientDetail } from "../features/staff/types";
import { formatDate, messageFrom } from "../features/staff/helpers";

const api = new HttpStaffApi();
const clients = ref<readonly IntegrationClient[]>([]);
const pendingActions = ref<readonly IntegrationAction[]>([]);
const selected = ref<IntegrationClientDetail | null>(null);
const loading = ref(true);
const saving = ref(false);
const error = ref("");
const notice = ref("");
const showCreate = ref(false);
const showGrant = ref(false);
const showReauth = ref(false);
const reauthPassword = ref("");
const reauthUntil = ref(0);
let pendingAction: (() => Promise<void>) | null = null;
const clientForm = ref({ name: "", platformHint: "HIVEKEEP", ownerUserId: "", description: "" });
const grantForm = ref({ capability: "questions.read", scopeType: "SCHOOL", scopeIds: "", autoApproveR1: true });
const revealedToken = ref("");

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    clients.value = (await api.integrationClients()).items;
    try { pendingActions.value = (await api.integrationActions()).items; } catch { pendingActions.value = []; }
  } catch (cause) { error.value = messageFrom(cause, "Integrasi agent belum tersedia."); } finally { loading.value = false; }
}
async function openClient(client: IntegrationClient): Promise<void> {
  error.value = "";
  try { selected.value = await api.integrationClient(client.id); } catch (cause) { error.value = messageFrom(cause); }
}
function requireReauth(action: () => Promise<void>): void {
  if (Date.now() < reauthUntil.value) { void action(); return; }
  pendingAction = action;
  showReauth.value = true;
}
async function confirmReauth(): Promise<void> {
  saving.value = true;
  try {
    const result = await api.reauth(reauthPassword.value);
    reauthUntil.value = Date.parse(result.expiresAt);
    showReauth.value = false;
    reauthPassword.value = "";
    const action = pendingAction;
    pendingAction = null;
    if (action) await action();
  } catch (cause) { error.value = messageFrom(cause, "Re-authentication gagal."); } finally { saving.value = false; }
}
async function createClient(): Promise<void> {
  requireReauth(async () => {
    saving.value = true;
    try {
      await api.createIntegrationClient({ ...clientForm.value, ownerUserId: clientForm.value.ownerUserId });
      showCreate.value = false;
      clientForm.value = { name: "", platformHint: "HIVEKEEP", ownerUserId: "", description: "" };
      notice.value = "Integration client dibuat.";
      await load();
    } catch (cause) { error.value = messageFrom(cause, "Client belum dapat dibuat."); } finally { saving.value = false; }
  });
}
function cancelCreate(): void {
  if (saving.value) return;
  showCreate.value = false;
  error.value = "";
}
function toggleClient(): void {
  if (!selected.value) return;
  const client = selected.value.client;
  const next = client.status === "ACTIVE" ? "DISABLED" : "ACTIVE";
  if (next === "DISABLED" && !window.confirm("Nonaktifkan client dan cabut semua credential aktif?")) return;
  requireReauth(async () => {
    saving.value = true;
    try {
      const updated = await api.updateIntegrationClient(client.id, { status: next, expectedUpdatedAt: client.updatedAt });
      selected.value = { ...selected.value!, client: updated };
      notice.value = next === "DISABLED" ? "Kill switch aktif; credential aktif telah dicabut." : "Client diaktifkan kembali. Credential harus dibuat ulang.";
      await load();
    } catch (cause) { error.value = messageFrom(cause, "Status client belum dapat diubah."); } finally { saving.value = false; }
  });
}
function issueCredential(): void {
  if (!selected.value) return;
  requireReauth(async () => {
    saving.value = true;
    try {
      const result = await api.issueIntegrationCredential(selected.value!.client.id);
      revealedToken.value = result.token;
      selected.value = { ...selected.value!, credentials: [result.credential, ...selected.value!.credentials] };
      notice.value = result.warning;
    } catch (cause) { error.value = messageFrom(cause, "Credential belum dapat dibuat."); } finally { saving.value = false; }
  });
}
function revokeCredential(id: string): void {
  if (!selected.value || !window.confirm("Cabut credential ini sekarang?")) return;
  requireReauth(async () => {
    saving.value = true;
    try {
      await api.revokeIntegrationCredential(selected.value!.client.id, id, "Dicabut dari console admin");
      selected.value = await api.integrationClient(selected.value!.client.id);
      notice.value = "Credential dicabut.";
    } catch (cause) { error.value = messageFrom(cause, "Credential belum dapat dicabut."); } finally { saving.value = false; }
  });
}
function createGrant(): void {
  if (!selected.value) return;
  requireReauth(async () => {
    saving.value = true;
    try {
      const created = await api.createIntegrationGrant(selected.value!.client.id, {
        capability: grantForm.value.capability,
        scopeType: grantForm.value.scopeType,
        scopeIds: grantForm.value.scopeIds.split(",").map((id) => id.trim()).filter(Boolean),
        constraints: { auto_approve_r1: grantForm.value.autoApproveR1 },
        expectedPolicyVersion: selected.value!.client.policyVersion,
      });
      selected.value = { ...selected.value!, grants: [created, ...selected.value!.grants], client: { ...selected.value!.client, policyVersion: created.grantVersion } };
      showGrant.value = false;
      grantForm.value = { capability: "questions.read", scopeType: "SCHOOL", scopeIds: "", autoApproveR1: true };
      notice.value = "Grant dibuat dan grant version bertambah.";
    } catch (cause) { error.value = messageFrom(cause, "Grant belum dapat dibuat."); } finally { saving.value = false; }
  });
}
function revokeGrant(id: string): void {
  if (!selected.value || !window.confirm("Cabut grant ini? Agent akan kehilangan capability terkait pada request berikutnya.")) return;
  requireReauth(async () => {
    saving.value = true;
    try {
      await api.revokeIntegrationGrant(selected.value!.client.id, id, "Dicabut dari console admin");
      selected.value = await api.integrationClient(selected.value!.client.id);
      notice.value = "Grant dicabut.";
    } catch (cause) { error.value = messageFrom(cause, "Grant belum dapat dicabut."); } finally { saving.value = false; }
  });
}
async function copyToken(): Promise<void> { if (revealedToken.value) await navigator.clipboard?.writeText(revealedToken.value); }
function approveAction(action: IntegrationAction): void {
  if (!window.confirm(`Setujui action ${action.operation} untuk target ${action.targetType} #${action.targetId}?\n\n${actionSummary(action)}\n\nPlan: ${action.planHash}`)) return;
  requireReauth(async () => {
    saving.value = true;
    try {
      await api.approveIntegrationAction(action.id, action.planHash);
      notice.value = "Action disetujui dan diproses.";
      pendingActions.value = pendingActions.value.filter((item) => item.id !== action.id);
    } catch (cause) { error.value = messageFrom(cause, "Action belum dapat disetujui."); } finally { saving.value = false; }
  });
}
function actionSummary(action: IntegrationAction): string {
  const impact = action.plan.impact;
  if (!impact || typeof impact !== "object" || Array.isArray(impact)) return "Dampak: tersedia di plan.";
  const entries = Object.entries(impact as Record<string, unknown>)
    .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${String(value)}`);
  return entries.length ? `Dampak: ${entries.join(" · ")}` : "Dampak: tersedia di plan.";
}
onMounted(() => { void load(); });
</script>

<template>
  <header class="page-heading between"><div><p class="eyebrow">Admin · Integrasi</p><h1>Agent eksternal</h1><p class="muted">Kelola client Hivekeep/Hermes, credential, dan grant. Agent tidak pernah mengubah izin sendiri.</p></div><button class="btn-primary" type="button" @click="showCreate = !showCreate">Buat client</button></header>
  <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div><div v-if="notice" class="alert alert-success" role="status">{{ notice }}</div>
  <section v-if="showCreate" class="card form-card"><h2>Integration client baru</h2><form class="integration-form-grid" @submit.prevent="createClient"><label class="field-wide">Nama<input v-model="clientForm.name" maxlength="120" required /></label><label>Platform<select v-model="clientForm.platformHint"><option>HIVEKEEP</option><option>HERMES</option><option>OTHER</option></select></label><label>Owner user ID<input v-model="clientForm.ownerUserId" inputmode="numeric" pattern="[0-9]+" required /></label><label class="field-wide">Deskripsi<textarea v-model="clientForm.description" maxlength="500" rows="3" /></label><div class="integration-form-actions"><button class="btn-secondary" type="button" :disabled="saving" @click="cancelCreate">Batal</button><button class="btn-primary" type="submit" :disabled="saving">{{ saving ? "Menyimpan…" : "Buat client" }}</button></div></form></section>
  <section v-if="pendingActions.length" class="card table-card"><div class="between"><div><h2>Menunggu persetujuan</h2><p class="muted">Action berisiko tinggi harus ditinjau sebelum dijalankan agent.</p></div><span class="badge badge-warning">{{ pendingActions.length }}</span></div><div class="table-scroll"><table><caption class="sr-only">Agent actions awaiting approval</caption><thead><tr><th>Operasi</th><th>Target dan dampak</th><th>Risiko</th><th>Berakhir</th><th>Aksi</th></tr></thead><tbody><tr v-for="action in pendingActions" :key="action.id"><td><strong>{{ action.operation }}</strong><small>Client #{{ action.clientId }} · plan {{ action.planHash.slice(0, 12) }}…</small></td><td>{{ action.targetType }} #{{ action.targetId }}<small>{{ actionSummary(action) }}</small></td><td><span class="badge badge-danger">{{ action.riskLevel }}</span></td><td>{{ formatDate(action.expiresAt) }}</td><td><button class="btn-primary" type="button" :disabled="saving" @click="approveAction(action)">Setujui</button></td></tr></tbody></table></div></section>
  <section class="card table-card"><div v-if="loading" class="table-state">Memuat integration client…</div><div v-else-if="clients.length === 0" class="table-state"><strong>Belum ada agent terhubung</strong><span class="muted">Buat client dari tombol di atas.</span></div><div v-else class="table-scroll"><table><caption class="sr-only">Integration clients</caption><thead><tr><th>Client</th><th>Owner</th><th>Status</th><th>Grant version</th><th>Aktivitas</th></tr></thead><tbody><tr v-for="client in clients" :key="client.id"><td><strong>{{ client.name }}</strong><small>{{ client.platformHint }} · #{{ client.id }}</small></td><td>{{ client.ownerDisplayName }} · {{ client.ownerRole }}</td><td><span class="badge" :class="client.status === 'ACTIVE' ? 'badge-success' : 'badge-warning'">{{ client.status }}</span></td><td>{{ client.policyVersion }}</td><td><button class="btn-quiet" type="button" @click="openClient(client)">Kelola</button></td></tr></tbody></table></div></section>
  <div v-if="selected" class="overlay" role="dialog" aria-modal="true" aria-labelledby="integration-detail-title"><aside class="drawer"><div class="between"><div><p class="eyebrow">{{ selected.client.platformHint }} · #{{ selected.client.id }}</p><h2 id="integration-detail-title">{{ selected.client.name }}</h2></div><button class="btn-quiet" type="button" @click="selected = null">Tutup</button></div><p class="muted">Owner: {{ selected.client.ownerDisplayName }} ({{ selected.client.ownerRole }}) · policy version {{ selected.client.policyVersion }}</p><button class="btn-secondary" type="button" :disabled="saving" @click="toggleClient">{{ selected.client.status === 'ACTIVE' ? 'Kill switch · nonaktifkan' : 'Aktifkan client' }}</button><hr /><div class="between"><h3>Credential</h3><button class="btn-secondary" type="button" :disabled="saving || selected.client.status !== 'ACTIVE'" @click="issueCredential">Buat credential</button></div><p v-if="revealedToken" class="secret-box"><strong>Token plaintext (tampil sekali)</strong><code>{{ revealedToken }}</code><button class="btn-quiet" type="button" @click="copyToken">Salin</button></p><ul class="compact-list"><li v-for="credential in selected.credentials" :key="credential.id"><span><code>{{ credential.tokenPrefix }}…</code> · {{ credential.status }}<small>Dibuat {{ formatDate(credential.createdAt) }}</small></span><button v-if="credential.status === 'ACTIVE'" class="btn-quiet danger" type="button" @click="revokeCredential(credential.id)">Cabut</button></li></ul><hr /><div class="between"><h3>Grant</h3><button class="btn-secondary" type="button" :disabled="saving || selected.client.status !== 'ACTIVE'" @click="showGrant = !showGrant">Tambah grant</button></div><form v-if="showGrant" class="grant-form" @submit.prevent="createGrant"><label>Capability<input v-model="grantForm.capability" required /></label><label>Scope type<select v-model="grantForm.scopeType"><option>SCHOOL</option><option>SUBJECT</option><option>CLASS</option><option>QUESTION_BANK</option><option>EXAM</option><option>SCHEDULE</option><option>ACADEMIC_YEAR</option><option>OWNER</option></select></label><label>Scope IDs (koma, kosong untuk SCHOOL)<input v-model="grantForm.scopeIds" /></label><label><input v-model="grantForm.autoApproveR1" type="checkbox" /> Auto approve draft R1</label><button class="btn-primary" type="submit" :disabled="saving">Simpan grant</button></form><ul class="compact-list"><li v-for="grant in selected.grants" :key="grant.id"><span><strong>{{ grant.capability }}</strong><small>{{ grant.scopeType }} {{ grant.scopeIds.join(', ') || 'seluruh sekolah' }} · v{{ grant.grantVersion }}</small></span><button v-if="grant.status === 'ACTIVE'" class="btn-quiet danger" type="button" @click="revokeGrant(grant.id)">Cabut</button></li></ul></aside></div>
  <div v-if="showReauth" class="overlay center" role="dialog" aria-modal="true" aria-labelledby="reauth-title"><section class="modal card"><h2 id="reauth-title">Autentikasi ulang admin</h2><p class="muted">Operasi credential, grant, dan kill switch memerlukan verifikasi ulang.</p><form @submit.prevent="confirmReauth"><label>Password<input v-model="reauthPassword" type="password" autocomplete="current-password" required /></label><div class="editor-actions"><button class="btn-secondary" type="button" @click="showReauth = false">Batal</button><button class="btn-primary" type="submit" :disabled="saving">Verifikasi</button></div></form></section></div>
</template>

<style scoped>
.page-heading { align-items: flex-start; margin-bottom: 18px; }.page-heading h1 { margin: 0 0 6px; }.eyebrow { margin: 0 0 4px; color: var(--primary); font-weight: 700; }.form-card, .table-card { padding: 20px; margin-bottom: 16px; }.integration-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 20px; margin-top: 18px; }.integration-form-grid label { display: grid; gap: 8px; color: var(--muted); font-weight: 700; }.integration-form-grid .field-wide { grid-column: 1 / -1; }.integration-form-grid input, .integration-form-grid select, .integration-form-grid textarea { width: 100%; min-height: 42px; border: 1px solid var(--border-strong); border-radius: 9px; padding: 9px 12px; color: var(--text); background: var(--surface-elevated); }.integration-form-grid textarea { min-height: 88px; resize: vertical; }.integration-form-actions { grid-column: 1 / -1; display: flex; justify-content: flex-end; gap: 10px; padding-top: 2px; }.table-scroll { overflow-x: auto; } table { width: 100%; border-collapse: collapse; } th, td { padding: 12px 10px; text-align: left; border-bottom: 1px solid var(--border); vertical-align: top; } th { color: var(--muted); font-size: .8rem; } td small, li small { display: block; color: var(--subtle); margin-top: 4px; }.table-state { display: grid; gap: 6px; justify-items: center; padding: 42px 12px; }.badge { display: inline-flex; padding: 4px 8px; border-radius: 99px; font-size: .78rem; font-weight: 700; }.badge-success { color: var(--success); background: var(--success-soft); }.badge-warning { color: var(--warning); background: var(--warning-soft); }.badge-danger { color: var(--danger); background: var(--danger-soft); }.overlay { position: fixed; inset: 0; z-index: 20; display: flex; justify-content: flex-end; background: rgb(2 6 23 / 45%); }.overlay.center { align-items: center; justify-content: center; padding: 16px; }.drawer { width: min(600px, 100%); height: 100%; overflow: auto; padding: 24px; background: var(--surface); box-shadow: var(--shadow); }.modal { width: min(420px, 100%); padding: 22px; }.secret-box { display: grid; gap: 8px; padding: 12px; margin: 12px 0; border: 1px solid var(--warning); border-radius: 8px; background: var(--warning-soft); }.secret-box code { word-break: break-all; }.compact-list { display: grid; gap: 8px; padding: 0; list-style: none; }.compact-list li { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 0; border-bottom: 1px solid var(--border); }.grant-form { display: grid; gap: 10px; margin: 12px 0; padding: 12px; border: 1px solid var(--border); border-radius: 8px; }.danger { color: var(--danger); }.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media (max-width: 900px) { .drawer { padding: 18px 14px; }.integration-form-grid { grid-template-columns: 1fr; }.integration-form-grid .field-wide, .integration-form-actions { grid-column: auto; }.integration-form-actions { justify-content: stretch; }.integration-form-actions button { flex: 1; } }
</style>

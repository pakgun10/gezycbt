<script setup lang="ts">
import { nextTick, onErrorCaptured, ref } from "vue";

const failed = ref(false);
const requestId = ref("");
onErrorCaptured(() => {
  failed.value = true;
  requestId.value = crypto.randomUUID();
  void nextTick(() => document.querySelector<HTMLElement>("#staff-error-title")?.focus());
  return false;
});
function reloadSection(): void { failed.value = false; window.location.reload(); }
</script>

<template>
  <section v-if="failed" class="card staff-error" role="alert" aria-labelledby="staff-error-title"><h1 id="staff-error-title" tabindex="-1">Bagian ini mengalami kendala</h1><p class="muted">Data lain tetap aman. Muat ulang untuk mencoba kembali.</p><p v-if="requestId" class="small-copy">Request ID: <code>{{ requestId }}</code></p><button class="btn-secondary" type="button" @click="reloadSection">Muat ulang</button></section>
  <slot v-else />
</template>

<style scoped>
.staff-error { padding: 28px; }.staff-error h1 { margin-top: 0; }.small-copy { font-size: .85rem; }
</style>

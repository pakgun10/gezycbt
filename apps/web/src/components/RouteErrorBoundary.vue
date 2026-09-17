<script setup lang="ts">
import { onErrorCaptured, ref } from "vue";

const failed = ref(false);
const requestId = ref("");
onErrorCaptured(() => {
  failed.value = true;
  requestId.value = crypto.randomUUID();
  return false;
});

function reload(): void {
  window.location.reload();
}
</script>

<template>
  <main v-if="failed" role="alert">
    <h1>Halaman tidak dapat dimuat</h1>
    <p>Silakan muat ulang halaman. Jika masalah berlanjut, catat request ID dari pesan server.</p>
    <small v-if="requestId">Request ID: {{ requestId }}</small>
    <button type="button" @click="reload">Muat ulang</button>
  </main>
  <slot v-else />
</template>

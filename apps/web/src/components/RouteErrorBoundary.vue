<script setup lang="ts">
import { onErrorCaptured, ref } from "vue";

const failed = ref(false);
onErrorCaptured(() => {
  failed.value = true;
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
    <button type="button" @click="reload">Muat ulang</button>
  </main>
  <slot v-else />
</template>

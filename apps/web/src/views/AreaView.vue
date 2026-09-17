<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";

const route = useRoute();
const area = computed(() => String(route.meta.area ?? "GezyCBT"));
</script>

<template>
  <main>
    <h1>{{ area }}</h1>
    <p>Shell route sedang disiapkan.</p>
  </main>
</template>

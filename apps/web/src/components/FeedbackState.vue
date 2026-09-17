<script setup lang="ts">
withDefaults(defineProps<{
  readonly title: string;
  readonly message?: string;
  readonly tone?: "info" | "error" | "warning";
}>(), { tone: "info" });
</script>

<template>
  <section class="card feedback" :class="`alert-${tone}`" role="status">
    <h2>{{ title }}</h2>
    <p v-if="message">{{ message }}</p>
    <slot />
  </section>
</template>

<style scoped>
.feedback { padding: 24px; }
.feedback h2 { margin: 0 0 8px; font-size: 1.1rem; }
.feedback p { margin: 0 0 16px; }
</style>

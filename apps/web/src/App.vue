<template>
  <div class="app-shell">
    <RouteErrorBoundary>
      <RouterView />
    </RouteErrorBoundary>
    <AppFooter v-if="showFooter" />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { RouterView, useRoute } from "vue-router";
import AppFooter from "./components/AppFooter.vue";
import RouteErrorBoundary from "./components/RouteErrorBoundary.vue";

const route = useRoute();
const showFooter = computed(() => route.meta.exam !== true);
</script>

<style scoped>
.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
</style>

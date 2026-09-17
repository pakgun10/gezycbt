<template>
  <RouteErrorBoundary>
    <RouterView />
  </RouteErrorBoundary>
</template>

<script setup lang="ts">
import { RouterView } from "vue-router";
import RouteErrorBoundary from "./components/RouteErrorBoundary.vue";
</script>

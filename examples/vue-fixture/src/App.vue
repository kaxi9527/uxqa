<script setup lang="ts">
import { RouterView } from 'vue-router';
</script>

<template>
  <RouterView />
</template>

<style scoped>
.link:focus {
  outline: none;
}
.title {
  color: #333333;
  transition: all 0.2s;
}
</style>

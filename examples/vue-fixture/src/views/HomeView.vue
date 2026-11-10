<script setup lang="ts">
import { Button } from '@/components/ui/button';
import SearchIcon from '@/components/icons/SearchIcon.vue';
defineProps<{ visitors: number; orders: number; refunds: number }>();
</script>

<template>
  <main class="space-y-4">
    <div class="rounded-lg border p-4 shadow-sm">
      <h3 class="text-sm font-medium text-gray-500">访客</h3>
      <p class="text-2xl font-semibold">{{ visitors }}</p>
    </div>
    <div class="rounded-lg border p-4 shadow-sm">
      <h3 class="text-sm font-medium text-gray-500">订单</h3>
      <p class="text-2xl font-semibold">{{ orders }}</p>
    </div>
    <div class="rounded-lg border p-4 shadow-sm">
      <h3 class="text-sm font-medium text-gray-500">退款</h3>
      <p class="text-2xl font-semibold">{{ refunds }}</p>
    </div>
    <Button variant="outline"><SearchIcon /></Button>
    <Button variant="outline" aria-label="搜索"><SearchIcon /></Button>
  </main>
</template>

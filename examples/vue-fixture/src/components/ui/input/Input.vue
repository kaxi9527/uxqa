<script setup lang="ts">
type InputSize = 'sm' | 'md';
const { size = 'md' } = defineProps<{ modelValue?: string; size?: InputSize }>();
defineEmits(['update:modelValue']);
</script>

<template>
  <input class="h-9 rounded-md border border-border px-3 text-sm" :value="modelValue" @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)" />
</template>

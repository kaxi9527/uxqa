<script lang="ts">
import { defineComponent, type PropType } from 'vue';

export default defineComponent({
  props: {
    tone: { type: String as PropType<'plain' | 'muted'>, default: 'plain' },
  },
});
</script>

<template>
  <div class="rounded-lg border border-border p-4">
    <slot />
  </div>
</template>

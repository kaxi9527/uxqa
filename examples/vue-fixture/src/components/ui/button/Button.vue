<script setup lang="ts">
import { buttonVariants } from '.';

const props = withDefaults(defineProps<{ variant?: 'default' | 'outline'; size?: 'default' | 'sm' }>(), { variant: 'default', size: 'default' });
</script>

<template>
  <button :class="buttonVariants({ variant: props.variant, size: props.size })">
    <slot />
  </button>
</template>

<script lang="ts">
  export let variant: 'default' | 'outline' = 'default';
  export let size: 'sm' | 'md' = 'md';
</script>

<button class="btn btn-{variant} btn-{size}" on:click {...$$restProps}><slot /></button>

<style>
  .btn { border-radius: 6px; }
</style>

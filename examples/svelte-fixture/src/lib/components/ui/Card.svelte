<script lang="ts">
  export let padded = true;
</script>

<div class="rounded-lg border p-4" class:p-0={!padded}><slot /></div>

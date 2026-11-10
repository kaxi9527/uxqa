<script lang="ts">
  type Size = 'sm' | 'md';
  interface Props { value?: string; size?: Size; [key: string]: unknown }
  let { value = $bindable(''), size = 'md', ...rest }: Props = $props();
</script>

<input bind:value class="input input-{size}" {...rest} />

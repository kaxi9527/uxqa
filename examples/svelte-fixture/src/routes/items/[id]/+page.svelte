<script lang="ts">
  export let data: { id: string; liked: boolean };
</script>

<h1 class="text-xl">商品 {data.id}</h1>
<button type="button" aria-pressed={data.liked} class="border px-2">{#if data.liked}已收藏{:else}收藏{/if}</button>

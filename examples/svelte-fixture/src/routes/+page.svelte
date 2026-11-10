<script lang="ts">
  import Button from '$lib/components/ui/Button.svelte';
  let count = 0;
</script>

<section class="grid gap-4">
  <div class="rounded-xl border bg-white p-6">
    <h2 class="text-lg font-semibold">新品</h2>
    <p class="text-sm text-gray-500">本周上架 {count} 件</p>
    <a class="text-sm underline" href="/new">查看</a>
  </div>
  <div class="rounded-xl border bg-white p-6">
    <h2 class="text-lg font-semibold">热卖</h2>
    <p class="text-sm text-gray-500">销量最高的商品</p>
    <a class="text-sm underline" href="/hot">查看</a>
  </div>
  <Button variant="outline" on:click={() => count++}>加载更多</Button>
</section>

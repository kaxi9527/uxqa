<script lang="ts">
  import Button from '$lib/components/ui/Button.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  let query = '';
  let open = false;
  let active = false;
  const extra = 'shadow';
</script>

<div class="mx-auto w-[720px] p-4">
  <button class="rounded bg-[#ff3e01] px-3 text-white" on:click={() => (open = true)}>新建订单</button>
  <input bind:value={query} placeholder="搜索" />
  <span on:click={() => (open = !open)} class="cursor-pointer">筛选</span>
  <img src="/empty.png" class="h-24 w-24" />
  <a href="/help" target="_blank" rel="external">帮助</a>
  <div style="margin-top: 18px; z-index: 2000" class="card {extra}">卡片</div>
  <p class:text-[#999999]={active} style:color="#123456">提示文字</p>
  <button type="button" tabindex="3" class="border px-2">次要操作</button>
  <form>
    <button class="px-2">提交</button>
  </form>
  <Button variant="outline" on:click={() => (open = false)}>取消</Button>
  <Input bind:value={query} aria-label="订单号" />
  <div class="rounded-[{radius}px] {active ? 'bg-[#eeeeee]' : ''}">动态类名</div>
  <iframe src="/map" class="h-40 w-full"></iframe>
</div>

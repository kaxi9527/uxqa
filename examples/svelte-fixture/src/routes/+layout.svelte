<script>
  import '../app.css';
</script>

<nav class="flex gap-2">
  <a href="/">首页</a>
  <a href="/orders">订单</a>
  <button class="icon-btn" on:click={() => history.back()}><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6" /></svg></button>
</nav>
<slot />

<style>
  .icon-btn { transition: all 0.2s; outline: none; }
  .icon-btn:focus-visible { box-shadow: 0 0 0 2px #ff3e00; }
</style>

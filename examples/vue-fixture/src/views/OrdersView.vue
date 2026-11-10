<script setup lang="ts">
import { ref } from 'vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const keyword = ref('');
const tabRole = ref('tab');
function submit() {}
function open() {}
</script>

<template>
  <div class="p-[13px]">
    <button class="bg-[#1a73e9] px-4" @click="submit">提交订单</button>
    <input v-model="keyword" placeholder="搜索订单" />
    <img src="/banner.png" />
    <div class="cursor-pointer" @click="open">查看详情</div>
    <a href="#">更多</a>
    <p style="color: #ff0000; padding: 13px">库存不足</p>
    <div :style="{ zIndex: 9999 }">浮层</div>
    <a href="https://example.com" target="_blank">帮助</a>
    <!-- uxqa-ignore basic/use-library-component -- 第三方支付要求原生按钮 -->
    <button type="button">去支付</button>
    <!-- uxqa-ignore basic/use-library-component -->
    <button type="button">没写理由</button>
    <Button variant="outline" @click="submit">正确用法</Button>
    <Input id="order-no" v-model="keyword" />
    <img src="/logo.png" alt="商城标志" class="h-8 w-8" />
    <div :role="tabRole" @click="open">动态角色</div>
    <span :class="{ 'text-red-500': keyword }">提示</span>
  </div>
</template>

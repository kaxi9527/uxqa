<script setup lang="ts">
import { ref } from 'vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Card from '@/components/ui/card/Card.vue';

const name = ref('');
const kind = ref('text');
const active = ref(false);
const avatar = '/me.png';
</script>

<template>
  <Card tone="muted">
    <label for="name" class="text-sm">名字</label>
    <Input id="name" v-model="name" />
    <label class="text-sm">
      邮箱
      <Input v-model="name" />
    </label>
    <img :src="avatar" alt="头像" class="h-10 w-10 rounded-full" />
    <input :type="kind" :class="{ hidden: !active }" />
    <a href="/help" target="_blank" rel="noopener">帮助</a>
    <Button :class="active ? 'ring-2' : ''" @click="active = !active">保存</Button>
    <p :class="['text-sm', active && 'font-medium']">已保存</p>
  </Card>
</template>

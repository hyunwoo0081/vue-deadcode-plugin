<script setup lang="ts">
import { buttonHelper } from '../utils.js';

interface Props {
  label: string;
  disabled?: boolean;
  size?: 'small' | 'large';
}

interface Emits {
  (e: 'click'): void;
  (e: 'change', value: string): void;
  hover: [val: boolean];
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const click = () => {
  buttonHelper();
  emit('click');
};
</script>

<template>
  <button :disabled="disabled" @click="click">
    <slot name="icon" />
    {{ label }}
    <slot />
  </button>
</template>

<script setup lang="ts">
import { buttonHelper } from '../utils.js';

const click = () => {
  buttonHelper();
};
</script>

<template>
  <button @click="click">Button</button>
</template>

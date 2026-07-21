<script setup lang="ts">
import MyButton from './components/MyButton.vue';
import UnusedComponent from './components/UnusedComponent.vue';

const title = 'Vue DeadFinder Playground';
</script>

<template>
  <div>
    <h1>{{ title }}</h1>
    <MyButton />
  </div>
</template>

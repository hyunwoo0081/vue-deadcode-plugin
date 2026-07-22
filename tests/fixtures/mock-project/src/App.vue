<script setup lang="ts">
import MyButton from './components/MyButton.vue';
import UnusedComponent from './components/UnusedComponent.vue';

const title = 'Vue DeadFinder Playground';
const clickHandler = () => {
  console.log('Button clicked!');
};
</script>

<template>
  <div>
    <h1>{{ title }}</h1>
    <MyButton label="Submit" @click="clickHandler">
      <span>Default Slot Content</span>
    </MyButton>
  </div>
</template>

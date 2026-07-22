<script setup lang="ts">
import MyButton from './components/MyButton.vue';
import UnusedComponent from './components/UnusedComponent.vue';
import { useCounterStore } from './store/counter.js';

const title = 'Vue DeadFinder Playground';
const clickHandler = () => {
  console.log('Button clicked!');
};

// Access Pinia Store
const store = useCounterStore();
store.increment();
console.log('Double Count:', store.doubleCount);
</script>

<template>
  <div>
    <h1>{{ title }}</h1>
    <img src="@/assets/logo.png" alt="logo" />
    <router-link to="/about">About Page</router-link>
    <MyButton label="Submit" @click="clickHandler">
      <span>Default Slot Content</span>
    </MyButton>
  </div>
</template>

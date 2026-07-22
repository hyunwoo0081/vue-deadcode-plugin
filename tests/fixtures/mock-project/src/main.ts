import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router/index.js';
import { unusedHelper } from './utils.js';

// Setup app
const app = createApp(App);
app.use(router);
app.mount('#app');
// Reference unusedHelper and App so they are imported and traced
console.log(App);
console.log(unusedHelper);

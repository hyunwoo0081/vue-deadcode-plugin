// Mock vue-router definition
export const createRouter = (options: any) => {
  return {};
};

export const router = createRouter({
  routes: [
    {
      path: '/',
      component: () => import('../App.vue')
    },
    {
      path: '/about',
      component: () => import('../components/MyButton.vue')
    },
    {
      path: '/unused-route',
      component: () => import('../components/UnusedComponent.vue')
    }
  ]
});

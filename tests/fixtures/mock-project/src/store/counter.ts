// Mock Pinia store definition
export const defineStore = (id: string, options: any) => {
  return () => ({});
};

export const useCounterStore = defineStore('counter', {
  state: () => ({
    count: 0,
    unusedState: 'hello'
  }),
  getters: {
    doubleCount: (state: any) => state.count * 2,
    unusedGetter: (state: any) => state.count * 3
  },
  actions: {
    increment() {
      // Used action
    },
    unusedAction() {
      // Unused action
    }
  }
});

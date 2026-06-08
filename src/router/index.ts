import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'library',
      component: { template: '<main aria-hidden="true" />' },
    },
  ],
})

export default router

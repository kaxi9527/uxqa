import { createRouter, createWebHistory } from 'vue-router';
import HomeView from '../views/HomeView.vue';

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: HomeView },
    { path: '/orders', component: () => import('../views/OrdersView.vue') },
    { path: '/products/:id', component: () => import('../views/ProductView.vue') },
    { path: '/settings', component: () => import('../views/SettingsView.vue'), children: [{ path: 'profile', component: HomeView }] },
  ],
});

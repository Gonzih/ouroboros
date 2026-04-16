import { createRouter, createWebHashHistory } from 'vue-router'
import Dashboard from '../views/Dashboard.vue'
import Jobs from '../views/Jobs.vue'
import Logs from '../views/Logs.vue'
import Feedback from '../views/Feedback.vue'
import McpRegistry from '../views/McpRegistry.vue'
import Workers from '../views/Workers.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: Dashboard },
    { path: '/jobs', component: Jobs },
    { path: '/workers', component: Workers },
    { path: '/logs', component: Logs },
    { path: '/feedback', component: Feedback },
    { path: '/mcp', component: McpRegistry }
  ]
})

export default router

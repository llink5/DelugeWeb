import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      redirect: '/presets',
    },
    {
      path: '/presets',
      component: () => import('./modules/preset-manager/PresetManagerView.vue'),
    },
    {
      path: '/files',
      component: () => import('./modules/file-browser/FileBrowserView.vue'),
    },
    {
      path: '/editor',
      component: () => import('./modules/preset-editor/PresetEditorView.vue'),
    },
    {
      path: '/display',
      component: () => import('./modules/display-mirror/DisplayMirrorView.vue'),
    },
    {
      path: '/waves',
      component: () => import('./modules/wave-editor/WaveEditorView.vue'),
    },
    {
      path: '/perf',
      component: () => import('./modules/perf-trace/PerfTraceView.vue'),
    },
  ],
})

export { router }

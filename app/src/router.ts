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
      path: '/emulator',
      component: () => import('./modules/emulator/EmulatorView.vue'),
    },
    {
      path: '/virtual-hardware',
      component: () => import('./modules/virtual-hardware/VirtualHardwareView.vue'),
    },
    {
      path: '/symbols',
      component: () => import('./modules/symbol-debugger/SymbolDebuggerView.vue'),
    },
    {
      path: '/waves',
      component: () => import('./modules/wave-editor/WaveEditorView.vue'),
    },
    {
      path: '/perf',
      component: () => import('./modules/perf-trace/PerfTraceView.vue'),
    },
    {
      path: '/debug',
      component: () => import('./modules/debug-tools/DebugToolsView.vue'),
    },
    {
      path: '/docs',
      component: () => import('./modules/param-docs/ParamDocsView.vue'),
    },
  ],
})

export { router }

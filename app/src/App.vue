<script setup lang="ts">
import StatusBar from '@/components/StatusBar.vue'
</script>

<template>
  <div class="flex flex-col h-screen bg-zinc-950 text-zinc-100">
    <!-- Status Bar -->
    <StatusBar />

    <!-- Main Layout -->
    <div class="flex flex-1 overflow-hidden">
      <!-- Sidebar -->
      <nav class="flex flex-col justify-between w-16 lg:w-48 bg-zinc-900 border-r border-zinc-800 py-3 shrink-0">
        <ul class="flex flex-col gap-1">
          <li>
            <router-link
              to="/presets"
              class="flex items-center gap-3 px-3 py-2.5 rounded-lg mx-2 transition"
              active-class="bg-blue-500/10 text-blue-400"
              :class="[$route.path === '/presets' ? '' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50']"
            >
              <svg class="w-5 h-5 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="2" width="6" height="6" rx="1" />
                <rect x="12" y="2" width="6" height="6" rx="1" />
                <rect x="2" y="12" width="6" height="6" rx="1" />
                <rect x="12" y="12" width="6" height="6" rx="1" />
              </svg>
              <span class="hidden lg:inline text-sm">Presets</span>
            </router-link>
          </li>
          <li>
            <router-link
              to="/files"
              class="flex items-center gap-3 px-3 py-2.5 rounded-lg mx-2 transition"
              active-class="bg-blue-500/10 text-blue-400"
              :class="[$route.path === '/files' ? '' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50']"
            >
              <svg class="w-5 h-5 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2 5a2 2 0 0 1 2-2h3l2 2h5a2 2 0 0 1 2 2v1H8.5a2 2 0 0 0-2 1.5L5 15H4a2 2 0 0 1-2-2V5z" />
                <path d="M6 10.5A1.5 1.5 0 0 1 7.5 9H17l-2 7H5.5L6 10.5z" />
              </svg>
              <span class="hidden lg:inline text-sm">Files</span>
            </router-link>
          </li>
          <li>
            <router-link
              to="/editor"
              class="flex items-center gap-3 px-3 py-2.5 rounded-lg mx-2 transition"
              active-class="bg-blue-500/10 text-blue-400"
              :class="[$route.path === '/editor' ? '' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50']"
            >
              <svg class="w-5 h-5 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="4" y1="6" x2="16" y2="6" />
                <circle cx="8" cy="6" r="2" fill="currentColor" />
                <line x1="4" y1="14" x2="16" y2="14" />
                <circle cx="12" cy="14" r="2" fill="currentColor" />
              </svg>
              <span class="hidden lg:inline text-sm">Editor</span>
            </router-link>
          </li>
          <li>
            <router-link
              to="/display"
              class="flex items-center gap-3 px-3 py-2.5 rounded-lg mx-2 transition"
              active-class="bg-blue-500/10 text-blue-400"
              :class="[$route.path === '/display' ? '' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50']"
            >
              <svg class="w-5 h-5 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="3" width="16" height="11" rx="2" />
                <line x1="7" y1="17" x2="13" y2="17" />
                <line x1="10" y1="14" x2="10" y2="17" />
              </svg>
              <span class="hidden lg:inline text-sm">Display</span>
            </router-link>
          </li>
          <li>
            <router-link
              to="/waves"
              class="flex items-center gap-3 px-3 py-2.5 rounded-lg mx-2 transition"
              active-class="bg-blue-500/10 text-blue-400"
              :class="[$route.path === '/waves' ? '' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50']"
            >
              <svg class="w-5 h-5 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="1,10 3,4 5,16 7,7 9,13 11,3 13,17 15,6 17,14 19,10" />
              </svg>
              <span class="hidden lg:inline text-sm">Waves</span>
            </router-link>
          </li>
          <li>
            <router-link
              to="/perf"
              class="flex items-center gap-3 px-3 py-2.5 rounded-lg mx-2 transition"
              active-class="bg-blue-500/10 text-blue-400"
              :class="[$route.path === '/perf' ? '' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50']"
            >
              <svg class="w-5 h-5 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="10" width="3" height="7" rx="0.5" />
                <rect x="7" y="6" width="3" height="11" rx="0.5" />
                <rect x="12" y="3" width="3" height="14" rx="0.5" />
                <line x1="1" y1="18" x2="19" y2="18" />
              </svg>
              <span class="hidden lg:inline text-sm">Perf</span>
            </router-link>
          </li>
        </ul>

        <!-- Version -->
        <div class="px-3 mx-2 text-xs text-zinc-600 hidden lg:block">v1.0.0</div>
      </nav>

      <!-- Main Content -->
      <main class="flex-1 overflow-auto">
        <router-view />
      </main>
    </div>
  </div>
</template>

import { defineConfig, loadEnv } from 'vite';
import type { PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { visualizer } from 'rollup-plugin-visualizer';
import { createHtmlPlugin } from 'vite-plugin-html';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  // Load env variables
  const env = loadEnv(mode, process.cwd(), '');

  const plugins: PluginOption[] = [
    react(),
    tailwindcss(),
    createHtmlPlugin({
      minify: {
        collapseWhitespace: true,
        removeComments: true,
        removeRedundantAttributes: true,
        removeEmptyAttributes: true,
        minifyCSS: true,
        minifyJS: true,
      },
    }),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'android-chrome-192x192.png'],
      manifest: {
        name: 'ArcadesBox',
        short_name: 'ArcadesBox',
        description: 'Play amazing arcade games online',
        theme_color: '#ffffff',
        icons: [
          {
            src: 'android-chrome-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'android-chrome-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        runtimeCaching: [
          {
            // Cache CDN JSON files with Stale-While-Revalidate
            urlPattern: ({ url }: { url: URL }) => {
              return url.hostname.includes('cdn.arcadesbox.org') && url.pathname.includes('/cdn/') && url.pathname.endsWith('.json');
            },
            handler: 'StaleWhileRevalidate' as const,
            options: {
              cacheName: 'cdn-json-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 5 * 60, // 5 minutes
              },
              cacheableResponse: {
                statuses: [0, 200, 304],
              },
            },
          },
          {
            // Cache API responses with Network First
            urlPattern: ({ url }: { url: URL }) => {
              return url.hostname.includes('api') && url.hostname.includes('arcadesbox.com');
            },
            handler: 'NetworkFirst' as const,
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 5 * 60,
              },
              networkTimeoutSeconds: 3,
            },
          },
          {
            // Cache game images with Cache First
            urlPattern: ({ url }: { url: URL }) => {
              return url.hostname.includes('cdn.arcadesbox.org') && /\.(png|jpg|jpeg|webp|svg|gif)$/i.test(url.pathname);
            },
            handler: 'CacheFirst' as const,
            options: {
              cacheName: 'images-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: false, // Disable in development to avoid conflicts
      },
    }),
  ];

  if (mode === 'analyze' || process.env.ANALYZE === 'true') {
    plugins.push(
      visualizer({
        filename: 'dist/bundle-analysis.html',
        template: 'treemap',
        gzipSize: true,
        brotliSize: true,
        open: true,
      })
    );
  }

  return {
    plugins,
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
      dedupe: ['react', 'react-dom'],
    },
    // Proxy /sitemap.xml to backend
    server: {
      proxy: {
        '/sitemap.xml': {
          target: env.VITE_API_URL,
          changeOrigin: true,
        },
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'react-core': ['react', 'react-dom', 'react/jsx-runtime'],
            'react-router': ['react-router-dom'],
            'ui-radix': [
              '@radix-ui/react-alert-dialog',
              '@radix-ui/react-aspect-ratio',
              '@radix-ui/react-avatar',
              '@radix-ui/react-checkbox',
              '@radix-ui/react-collapsible',
              '@radix-ui/react-dialog',
              '@radix-ui/react-dropdown-menu',
              '@radix-ui/react-label',
              '@radix-ui/react-popover',
              '@radix-ui/react-progress',
              '@radix-ui/react-radio-group',
              '@radix-ui/react-scroll-area',
              '@radix-ui/react-select',
              '@radix-ui/react-separator',
              '@radix-ui/react-slider',
              '@radix-ui/react-slot',
              '@radix-ui/react-switch',
              '@radix-ui/react-tabs',
              '@radix-ui/react-toggle',
              '@radix-ui/react-toggle-group',
              '@radix-ui/react-tooltip',
            ],
          },
        },
      },
      // Staging: minified + source maps + console.logs (debuggable)
      // Production: fully minified, no source maps, no console.logs (optimized)
      sourcemap: mode === 'staging',
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: mode !== 'staging',  // Keep console.logs ONLY in staging
          drop_debugger: mode !== 'staging', // Keep debugger ONLY in staging
        },
        format: {
          comments: false,
        },
      },
    }
  };
});

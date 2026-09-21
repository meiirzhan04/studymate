import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true
      },
      '/health': {
        target: 'http://localhost:8000',
        changeOrigin: true
      }
    }
  }
  // For production builds, set VITE_API_URL env var to point at the backend host.
  // The api() helper in main.jsx reads import.meta.env.VITE_API_URL automatically.
})

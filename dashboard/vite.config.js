import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Listen on all network interfaces (like the backend's 0.0.0.0), so the
    // dashboard is reachable from other devices on the same network, not just
    // this machine's localhost.
    host: true,
    port: 5174,
  },
})

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import fs from 'node:fs'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: process.env.NODE_ENV === 'production' ? undefined : {
    host: true,
    https: {
      key: fs.readFileSync(path.resolve('certs/localhost-key.pem')),
      cert: fs.readFileSync(path.resolve('certs/localhost.pem')),
    },
  },
})

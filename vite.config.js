import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/bbang_test/',
  plugins: [react()],
  build: {
    outDir: 'docs'   // 改为 docs
  }
})
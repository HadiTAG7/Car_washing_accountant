import { defineConfig, mergeConfig } from 'vite';
import base from '../../vite.config.js';
export default defineConfig(env => mergeConfig(base(env), { server: { host: '127.0.0.1', port: 5215, strictPort: true } }));

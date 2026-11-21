// Development: the fixtures server (synthetic Demo athlete, mock coach) on :5281 and Vite on :5173.
import { spawn } from 'node:child_process';
const server = spawn(process.execPath, ['../channel/server.ts', '--fixtures', '--no-token', '--port', '5281',
  '--dev-origin', 'http://localhost:5173'], { stdio: 'inherit' });
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' });
const stop = () => { server.kill(); vite.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
vite.on('exit', stop);

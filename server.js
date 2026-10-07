import { existsSync } from 'node:fs';
import { createApp } from './src/app.js';

if (existsSync('.env')) process.loadEnvFile('.env');

const port = Number(process.env.PORT) || 3000;
createApp().listen(port, () => {
  console.log(`To-do app running at http://localhost:${port}`);
});

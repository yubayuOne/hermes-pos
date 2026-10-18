import { spawn } from 'node:child_process';

const root = process.cwd();
const env = {
  ...process.env,
  SUPABASE_URL: 'http://127.0.0.1:54400',
  SUPABASE_ANON_KEY: 'mock-anon-key-for-local-e2e-only',
  APP_URL: 'http://127.0.0.1:3001',
  VITE_LANDING_URL: 'http://127.0.0.1:3000',
  MOCK_PORT: '54400',
  E2E_TELEMETRY_DISABLED: '1',
};

const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child && !child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 250).unref();
}

function start(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, env, stdio: 'inherit', ...options });
  children.push(child);
  child.on('exit', (code) => {
    if (!stopping && code !== 0) stop(code ?? 1);
  });
  return child;
}

process.on('SIGINT', () => stop(130));
process.on('SIGTERM', () => stop(0));

start(process.execPath, ['e2e/mock-supabase.mjs']);

async function waitFor(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.status >= 200 && response.status < 500) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

try {
  await waitFor('http://127.0.0.1:54400/__scenario');
  start('npm', ['run', 'dev', '-w', '@hermes-pos/backoffice', '--', '--host', '127.0.0.1'], {
    env: { ...env, PORT: '3001' },
  });
  await waitFor('http://127.0.0.1:3001/login', 120_000);
  // Keep this process alive while the E2E runner drives the browser.
  await new Promise((resolve) => {
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, resolve);
  });
} catch (error) {
  console.error(error);
  stop(1);
}

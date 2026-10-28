import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const worker = fileURLToPath(new URL('./cli-worker.mjs', import.meta.url));
const endpoint = 'https://hackathon.api.qloo.com';
const failed = code => Object.assign(new Error('Provider failed'), { code });
const runtimeEnvironment = new Set([
  'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'TZ',
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR'
]);
const childEnvironment = environment => Object.fromEntries(Object.entries(environment).filter(([name]) => {
  const normalized = name.toUpperCase();
  if (normalized === 'QLOO_BASE_URL' || normalized === 'QLOO_TRUSTED_BASE_URL') return false;
  return runtimeEnvironment.has(normalized) || normalized.startsWith('XDG_') || normalized.startsWith('LC_') || normalized.startsWith('QLOO_');
}));

// One request at a time keeps the CLI's stdout and global log context isolated.
// Idle IPC/child handles are unreferenced; parent exit disconnects the worker.
export function createCliRunner({ workerPath = worker, nodeArgs = ['--env-file=qloo-endpoint.env'], timeoutMs = 45_000, maxBytes = 2 * 1024 * 1024, env = process.env } = {}) {
  let child; let pending; let sequence = 0;
  function start() {
    const qlooEnvironment = childEnvironment(env);
    const current = spawn(process.execPath, [...nodeArgs, workerPath], {
      cwd: root, shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: { ...qlooEnvironment, QLOO_BASE_URL: endpoint, QLOO_TRUSTED_BASE_URL: endpoint }
    });
    child = current;
    current.on('message', message => {
      if (!pending || pending.child !== current || message?.id !== pending.id) return;
      if (message.type === 'output' && typeof message.text === 'string') {
        pending.bytes += Buffer.byteLength(message.text);
        if (pending.bytes > maxBytes) { finish(current, failed('UPSTREAM'), true); return; }
        pending.output += message.text;
      } else if (message.type === 'done' && Number.isInteger(message.code)) {
        const error = message.code === 0 ? null : Object.assign(new Error('Provider failed'), { stdout: pending.output });
        finish(current, error);
      } else { finish(current, failed('UPSTREAM'), true); }
    });
    current.on('error', () => finish(current, failed('UPSTREAM'), true));
    current.on('exit', () => { if (child === current) child = undefined; finish(current, failed('UPSTREAM')); });
    return current;
  }
  function finish(current, error, kill = false) {
    if (kill && child === current) { child = undefined; current.kill(); }
    if (!pending || pending.child !== current) return;
    const completed = pending; pending = undefined;
    clearTimeout(completed.timer);
    current.unref(); current.channel?.unref();
    if (error) completed.reject(error); else completed.resolve(completed.output);
  }
  return function run(args, input = '') {
    if (pending) return Promise.reject(failed('BUSY'));
    if (input !== '') return Promise.reject(failed('UPSTREAM'));
    return new Promise((resolve, reject) => {
      const current = child ?? start();
      current.ref(); current.channel?.ref();
      const id = ++sequence;
      const timer = setTimeout(() => finish(current, failed('TIMEOUT'), true), timeoutMs);
      pending = { child: current, id, output: '', bytes: 0, timer, resolve, reject };
      current.send({ id, args }, error => { if (error) finish(current, failed('UPSTREAM'), true); });
    });
  };
}

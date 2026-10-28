import { createServer as httpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { evidenceCopy } from '../web/evidence-copy.mjs';
import { listScenarios, loadScenario } from './recorded/scenarios.mjs';
import { createLiveService } from './live/service.mjs';
import { createQlooTransport, LiveError } from './live/transport.mjs';
import { createHandoffService, HandoffError } from './mcp/service.mjs';
import { handleMcpRequest } from './mcp/http.mjs';

const demoSnapshot = loadScenario('mixed-domain');
const assets = new Map([
  ['/evidence-copy.mjs', ['../web/evidence-copy.mjs', 'text/javascript']],
  ['/', ['../web/index.html', 'text/html']],
  ['/app.mjs', ['../web/app.mjs', 'text/javascript']],
  ['/live.mjs', ['../web/live.mjs', 'text/javascript']],
  ['/participant-names.mjs', ['../web/participant-names.mjs', 'text/javascript']],
  ['/walkthrough.mjs', ['../web/walkthrough.mjs', 'text/javascript']],
  ['/showcase.mjs', ['../web/showcase.mjs', 'text/javascript']],
  ['/evidence-recovery.mjs', ['../web/evidence-recovery.mjs', 'text/javascript']],
  ['/assets/together.jpg', ['../web/assets/together.jpg', 'image/jpeg']],
  ['/assets/taste-action.webp', ['../web/assets/taste-action.webp', 'image/webp']],
  ['/assets/taste-indie.webp', ['../web/assets/taste-indie.webp', 'image/webp']],
  ['/assets/taste-desert.webp', ['../web/assets/taste-desert.webp', 'image/webp']],
  ['/assets/new-york-cinematic.webp', ['../web/assets/new-york-cinematic.webp', 'image/webp']],
  ['/assets/new-york.jpg', ['../web/assets/new-york.jpg', 'image/jpeg']],
  ['/assets/one-world-trade-center.webp', ['../web/assets/one-world-trade-center.webp', 'image/webp']],
  ['/assets/statue-of-liberty.webp', ['../web/assets/statue-of-liberty.webp', 'image/webp']],
  ['/assets/fraunces-latin.woff2', ['../web/assets/fraunces-latin.woff2', 'font/woff2']],
  ['/assets/dm-sans-latin.woff2', ['../web/assets/dm-sans-latin.woff2', 'font/woff2']],
  ['/styles.css', ['../web/styles.css', 'text/css']],
  ['/showcase.css', ['../web/showcase.css', 'text/css']],
  ['/favicon.svg', ['../web/favicon.svg', 'image/svg+xml']],
  ['/shared/decision.mjs', ['./shared/decision.mjs', 'text/javascript']],
  ['/shared/session.mjs', ['./shared/session.mjs', 'text/javascript']],
  ['/shared/qloo-image.mjs', ['./shared/qloo-image.mjs', 'text/javascript']],
  ['/shared/favorite-recovery.mjs', ['./shared/favorite-recovery.mjs', 'text/javascript']],
  ['/shared/countries.mjs', ['./shared/countries.mjs', 'text/javascript']]
]);

function readJsonBody(request, bodyTimeoutMs) {
  return new Promise((resolveBody, reject) => {
    let size = 0; const chunks = []; let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      request.removeListener('data', onData);
      request.removeListener('end', onEnd);
      request.removeListener('error', onError);
      request.removeListener('aborted', onAborted);
      request.removeListener('close', onClose);
    };
    const settle = (error, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error); else resolveBody(value);
    };
    const fail = (status, closeConnection = false) => settle(Object.assign(new Error(), { status, closeConnection }));
    const onData = chunk => {
      size += chunk.length;
      if (size > 16 * 1024) { fail(413, true); return; }
      chunks.push(chunk);
    };
    const onEnd = () => {
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        settle(undefined, value);
      } catch { fail(400); }
    };
    const onError = () => fail(400, true);
    const onAborted = () => fail(400, true);
    const onClose = () => { if (!request.complete) fail(400, true); };
    const timer = setTimeout(() => fail(408, true), bodyTimeoutMs);
    request.on('data', onData);
    request.on('end', onEnd);
    request.on('error', onError);
    request.on('aborted', onAborted);
    request.on('close', onClose);
  });
}

function publicUrl(value) {
  if (value === undefined) return undefined;
  let url;
  try { url = new URL(value); } catch { throw new RangeError('PUBLIC_ORIGIN must be an HTTPS origin'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new RangeError('PUBLIC_ORIGIN must be an HTTPS origin without credentials, path, query or fragment');
  }
  return url;
}

function requestBudget(options, now) {
  const limits = { windowMs: 3600_000, liveUnits: 180,
    clientWindowMs: 60_000, clientRequests: 30, maxClients: 1000, ...options };
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError('Each request limit must be a positive safe integer');
  }
  const clients = new Map();
  let expires = 0; let liveUnits = 0;
  return (path, address, inputType) => {
    const time = now();
    if (time >= expires) { expires = time + limits.windowMs; liveUnits = 0; }
    for (const [key, client] of clients) if (time >= client.expires) clients.delete(key);
    const client = clients.get(address) ?? { count: 0, expires: time + limits.clientWindowMs };
    if ((!clients.has(address) && clients.size >= limits.maxClients) || client.count >= limits.clientRequests) {
      return Math.max(1, Math.ceil((client.expires - time) / 1000));
    }
    // Compare can discover pooled + eight unique tastes and rank eight profiles.
    // Charge the upper bound even if the service later reuses cached evidence.
    // Locality search may make one additional bounded alias/combined-name lookup.
    const cost = path === '/api/live/compare' ? 17 : path === '/api/live/search' && inputType === 'locality' ? 2 : ['/api/handoff', '/mcp'].includes(path) ? 0 : 1;
    if (liveUnits + cost > limits.liveUnits) {
      return Math.max(1, Math.ceil((expires - time) / 1000));
    }
    client.count++; clients.set(address, client);
    liveUnits += cost;
    return 0;
  };
}

export function createServer({ liveService, allowedHosts = ['127.0.0.1', 'localhost', '[::1]'],
  publicOrigin, requestLimits, now = Date.now, enableMcp = false, handoffOptions, bodyTimeoutMs = 10_000 } = {}) {
  if (!Number.isSafeInteger(bodyTimeoutMs) || bodyTimeoutMs <= 0 || bodyTimeoutMs > 2_147_483_647) throw new RangeError('Body timeout must be a positive safe integer supported by Node timers');
  const external = publicUrl(publicOrigin);
  if (enableMcp && (external || !liveService)) throw new RangeError('MCP proof requires a local live service without PUBLIC_ORIGIN');
  const handoffService = enableMcp ? createHandoffService({ liveService, now, ...handoffOptions }) : undefined;
  const budget = requestBudget(requestLimits, now);
  return httpServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' https://images.qloo.com; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const requestBodyFramed = request.headers['transfer-encoding'] !== undefined || Number(request.headers['content-length']) > 0;
    let requestBodyConsumed = false;
    const json = (status, data) => {
      if (requestBodyFramed && !requestBodyConsumed) response.setHeader('Connection', 'close');
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(data));
    };
    const rawHeaderNames = request.rawHeaders.filter((_, index) => index % 2 === 0).map(name => name.toLowerCase());
    if (rawHeaderNames.filter(name => name === 'host').length !== 1 || rawHeaderNames.filter(name => name === 'origin').length > 1) {
      json(403, { error: 'Request origin is not allowed' });
      return;
    }
    if (request.method === 'GET' && requestBodyFramed) { json(400, { error: 'GET requests cannot include a body' }); return; }
    let path;
    try { path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
    catch { json(400, { error: 'Invalid request' }); return; }
    const livePath = ['/api/live/search', '/api/live/compare'].includes(path);
    try {
      if (handoffService && ['/mcp', '/api/handoff'].includes(path)) {
        // Local proof only: reject remote sockets, rebinding hosts, cross-origin
        // browser requests and forged ports before any tool/provider execution.
        let host;
        try { host = new URL(`http://${request.headers.host}`); } catch {}
        const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress);
        if (!local || !host || !['127.0.0.1', 'localhost', '[::1]'].includes(host.hostname)
          || host.host !== request.headers.host || Number(host.port || 80) !== request.socket.localPort
          || (request.headers.origin && request.headers.origin !== host.origin) || request.headers['sec-fetch-site'] === 'cross-site') {
          json(403, { error: 'Request origin is not allowed' }); return;
        }
        if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); json(405, { error: 'Method not supported' }); return; }
        if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') { json(415, { error: 'Send a JSON request' }); return; }
        const input = await readJsonBody(request, bodyTimeoutMs);
        requestBodyConsumed = true;
        const operation = path === '/mcp' && input.method === 'tools/call' ? input.params?.name : undefined;
        const charge = operation === 'compare_group' ? '/api/live/compare' : operation === 'resolve_input' ? '/api/live/search' : path;
        const retryAfter = budget(charge, request.socket.remoteAddress, input.params?.arguments?.type);
        if (retryAfter) { response.setHeader('Retry-After', String(retryAfter)); json(429, { error: 'The demo request budget was reached. Wait before trying again.', code: 'RATE_LIMIT' }); return; }
        if (path === '/api/handoff') {
          if (Object.keys(input).some(key => key !== 'token')) { json(400, { error: 'Check the comparison link' }); return; }
          json(200, await handoffService.read(input.token)); return;
        }
        await handleMcpRequest(request, response, input, { handoffService, origin: host.origin }); return;
      }
      const service = livePath ? liveService : undefined;
      if (service) {
        if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); json(405, { error: 'Method not supported' }); return; }
        let host;
        try { host = new URL(`${external?.protocol ?? 'http:'}//${request.headers.host}`); } catch { json(403, { error: 'Request origin is not allowed' }); return; }
        const permitted = external
          ? host.host === external.host && request.headers.origin === external.origin
          : allowedHosts.includes(host.hostname) && (!request.headers.origin || request.headers.origin === host.origin);
        if (host.host !== request.headers.host || !permitted || request.headers['sec-fetch-site'] === 'cross-site') { json(403, { error: 'Request origin is not allowed' }); return; }
        if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') { json(415, { error: 'Send a JSON request' }); return; }
        const input = await readJsonBody(request, bodyTimeoutMs);
        requestBodyConsumed = true;
        const retryAfter = budget(path, request.socket.remoteAddress, input.type);
        if (retryAfter) {
          response.setHeader('Retry-After', String(retryAfter));
          json(429, { error: 'The demo request budget was reached. Wait before trying again; recorded comparisons and manual controls remain available.', code: 'RATE_LIMIT' }); return;
        }
        const result = await service[path.endsWith('/search') ? 'search' : 'compare'](input);
        json(200, result); return;
      }
      if (request.method !== 'GET') {
        if (liveService && !livePath && path.startsWith('/api/live/')) { json(404, { error: 'Not found' }); return; }
        response.setHeader('Allow', 'GET'); json(405, { error: 'Method not supported' }); return;
      }
      if (path === '/api/status') { json(200, { recorded: true, live: Boolean(liveService) }); return; }
      if (path === '/api/scenarios') { json(200, listScenarios()); return; }
      if (path.startsWith('/api/scenarios/')) {
        const id = path.slice('/api/scenarios/'.length);
        if (!listScenarios().some(s => s.id === id)) { json(404, { error: 'Unknown scenario' }); return; }
        json(200, loadScenario(id)); return;
      }
      if (!assets.has(path)) { json(404, { error: 'Not found' }); return; }
      const [file, type] = assets.get(path);
      let body = await readFile(new URL(file, import.meta.url));
      if (path === '/' && demoSnapshot.evidenceKind === 'synthetic') {
        body = Buffer.from(evidenceCopy(demoSnapshot, body.toString()).replace('<body>', '<body><aside class="synthetic-note" role="note">Public source demo: invented scores and identities. No Qloo response data is included.</aside>'));
      }
      response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
      response.end(body);
    } catch (error) {
      if (response.headersSent) { response.end(); return; }
      if (error instanceof HandoffError) {
        json(error.code === 'CONTEXT_EXPIRED' ? 410 : 400, { code: error.code, error: error.code === 'CONTEXT_EXPIRED' ? 'This comparison link expired or is unavailable. Create a new comparison.' : 'Check the comparison inputs.' }); return;
      }
      if ([400, 408, 413].includes(error.status)) {
        if (error.closeConnection || error.status === 413 || error.status === 408) response.setHeader('Connection', 'close');
        json(error.status, { error: error.status === 413 ? 'The request is too large' : error.status === 408 ? 'The request body timed out' : 'Check the JSON request' }); return;
      }
      const safe = error instanceof LiveError ? error : new LiveError(error.code);
      const status = { INVALID_INPUT: 400, EXPIRED_INPUT: 400, CONTEXT_EXPIRED: 400, INVALID_RESPONSE: 502, BUSY: 409, RATE_LIMIT: 429, AUTH: 503, TIMEOUT: 504, UPSTREAM: 502 }[safe.code];
      json(status, { error: safe.message, code: safe.code });
    }
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError('PORT must be a valid port number');
  const host = process.env.HOST ?? '127.0.0.1';
  const transport = createQlooTransport();
  const liveService = createLiveService({ transport });
  const requestLimits = {};
  for (const [name, key] of Object.entries({ DEMO_LIVE_UNITS: 'liveUnits', DEMO_CLIENT_REQUESTS: 'clientRequests' })) {
    if (process.env[name] !== undefined) requestLimits[key] = Number(process.env[name]);
  }
  const enableMcp = process.env.COMMONGROUND_MCP === '1';
  if (enableMcp && !['127.0.0.1', 'localhost', '::1'].includes(host)) throw new RangeError('MCP proof must bind a loopback host');
  const server = createServer({ liveService, publicOrigin: process.env.PUBLIC_ORIGIN, requestLimits, enableMcp });
  server.on('error', () => { console.error('CommonGround could not start. Check the selected host and port.'); process.exitCode = 1; });
  console.log('Preparing the local Qloo worker; no provider request is made.');
  try { await transport.prepare(); }
  catch { console.warn('Local Qloo preparation did not finish. Recorded demos remain available; a live request can try again explicitly.'); }
  server.listen(port, host, () => console.log(`CommonGround: http://${host}:${server.address().port}`));
}

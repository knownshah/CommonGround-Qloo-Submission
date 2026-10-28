// Keep CLI stdout inside the private child and send bounded request frames only.
export function startCliWorker(run) {
  let active;
  const send = message => {
    if (!process.connected) process.exit(1);
    process.send(message, error => { if (error) process.exit(1); });
  };
  process.stdout.write = (chunk, encoding, callback) => {
    if (typeof encoding === 'function') callback = encoding;
    if (active) {
      const text = Buffer.isBuffer(chunk) ? chunk.toString(typeof encoding === 'string' ? encoding : 'utf8') : String(chunk);
      active.bytes += Buffer.byteLength(text);
      if (active.bytes > 2 * 1024 * 1024) process.exit(1);
      send({ id: active.id, type: 'output', text });
    }
    if (callback) queueMicrotask(callback);
    return true;
  };
  process.on('disconnect', () => process.exit(0));
  process.on('message', async message => {
    if (active || !Number.isInteger(message?.id) || !Array.isArray(message.args) || message.args.some(arg => typeof arg !== 'string')) process.exit(1);
    active = { id: message.id, bytes: 0 };
    try {
      const code = await run(message.args);
      send({ id: active.id, type: 'done', code });
    } catch { send({ id: active.id, type: 'done', code: 1 }); }
    finally { active = undefined; }
  });
}

// Accept only the image host observed in Qloo's place responses. Never build
// an image URL from an entity ID or fetch arbitrary provider URLs server-side.
export function qlooImageUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.origin === 'https://images.qloo.com' && !url.username && !url.password && url.pathname.startsWith('/i/')
      ? url.href : null;
  } catch { return null; }
}

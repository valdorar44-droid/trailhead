const BLOCKED_PAGE_HOSTS = [
  'dailymotion.com',
  'facebook.com',
  'instagram.com',
  'loom.com',
  'tiktok.com',
  'vimeo.com',
  'youtu.be',
  'youtube.com',
] as const;

const BLOCKED_PATH_SUFFIXES = [
  '.avi', '.doc', '.docx', '.htm', '.html', '.m4v', '.mkv', '.mov',
  '.mp3', '.mp4', '.mpeg', '.mpg', '.pdf', '.ppt', '.pptx', '.webm',
] as const;

export function isRenderableImageUrl(value: unknown): value is string {
  const clean = typeof value === 'string' ? value.trim() : '';
  if (!clean) return false;
  if (/^(file:\/\/|content:\/\/|data:image\/)/i.test(clean)) return true;
  if (clean.startsWith('/')) return true;
  if (!/^https?:\/\//i.test(clean)) return false;
  try {
    const parsed = new URL(clean);
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
    if (BLOCKED_PAGE_HOSTS.some(blocked => hostname === blocked || hostname.endsWith(`.${blocked}`))) {
      return false;
    }
    const path = parsed.pathname.toLowerCase().replace(/\/$/, '');
    return !BLOCKED_PATH_SUFFIXES.some(suffix => path.endsWith(suffix));
  } catch {
    return false;
  }
}

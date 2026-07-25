export type OriginalShareSource = {
  slug: string;
  title: string;
  summary?: string | null;
};

const ORIGINALS_LANDING_ROOT = 'https://gettrailhead.app/originals';

export type OriginalShareContent = {
  title: string;
  message: string;
  url: string;
};

export function originalShareContent(source: OriginalShareSource): OriginalShareContent {
  const title = String(source.title || '').trim() || 'Trailhead Original';
  const summary = String(source.summary || '').trim();
  const slug = String(source.slug || '').trim();
  const url = slug
    ? `${ORIGINALS_LANDING_ROOT}/${encodeURIComponent(slug)}`
    : ORIGINALS_LANDING_ROOT;

  return {
    title,
    message: [title, summary, url].filter(Boolean).join('\n\n'),
    url,
  };
}

type CommunityReportCopySource = {
  type?: string | null;
  description?: string | null;
};

export function communityReportNotes(source: CommunityReportCopySource): string {
  const description = String(source.description || '').trim();
  if (!description) return '';
  if (String(source.type || '').trim().toLowerCase() !== 'gpx_import') return description;

  return description
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !/^imported from gpx\s*:/i.test(line))
    .join('\n');
}

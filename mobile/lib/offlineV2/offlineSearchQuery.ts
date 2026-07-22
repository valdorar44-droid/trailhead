/** Build a literal prefix query; user punctuation never becomes FTS syntax. */
export function offlineFtsPrefixQuery(value: string) {
  const terms = value
    .normalize('NFKC')
    .match(/[\p{L}\p{N}]+/gu)
    ?.slice(0, 12) ?? [];
  return terms.map(term => `"${term.replace(/"/g, '""')}"*`).join(' AND ');
}

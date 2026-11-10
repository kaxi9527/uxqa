/**
 * URL glob used by flow network rules, expectUrl and expectRequestCount.
 * `**` matches any characters, `*` matches any characters except `/`, everything else is literal.
 * A pattern without a scheme is matched against the URL path plus query.
 */
export function globToRegExp(pattern: string): RegExp {
  let source = '';
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    if (char === '*' && pattern[index + 1] === '*') { source += '.*'; index++; continue; }
    if (char === '*') { source += '[^/]*'; continue; }
    source += char.replace(/[\\^$.|?+()[\]{}]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

export function matchesUrl(pattern: string, url: string): boolean {
  const regex = globToRegExp(pattern);
  if (/^[a-z][a-z0-9+.-]*:/i.test(pattern) || pattern.startsWith('**')) return regex.test(url);
  try {
    const parsed = new URL(url);
    return regex.test(`${parsed.pathname}${parsed.search}`) || regex.test(parsed.pathname);
  } catch {
    return regex.test(url);
  }
}

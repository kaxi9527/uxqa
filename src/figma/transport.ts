/** Expand the collector's lossless JSON string-token dictionary, with a hard decoded-size budget. */
export function unpackCapture(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || (raw as { encoding?: unknown }).encoding !== 'uxqa-json-dictionary-v1') return raw;
  const { dictionary, payload } = raw as { dictionary: unknown; payload: unknown };
  if (!Array.isArray(dictionary) || dictionary.length > 20000 || dictionary.some(x => typeof x !== 'string' || x.length > 100000) || typeof payload !== 'string') throw new Error('Invalid Figma transport dictionary');
  let expandedLength = payload.length;
  const expanded = payload.replace(/"(?:\\.|[^"\\])*"|@(\d+)/g, (token, reference: string | undefined) => {
    if (reference === undefined) return token;
    const value = dictionary[Number(reference)]; if (typeof value !== 'string') throw new Error('Invalid Figma transport reference');
    const replacement = JSON.stringify(value); expandedLength += replacement.length - token.length;
    if (expandedLength > 2 * 1024 * 1024) throw new Error('Expanded Figma chunk exceeds 2 MiB');
    return replacement;
  });
  if (expandedLength > 2 * 1024 * 1024) throw new Error('Expanded Figma chunk exceeds 2 MiB');
  return JSON.parse(expanded);
}

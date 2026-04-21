/**
 * OpenCollection hosted documentation UI expects markdown as { content, type }.
 */
export const toOpenCollectionMarkdownDocs = (
  markdown: string | null | undefined
): { content: string; type: 'text/markdown' } | undefined => {
  if (markdown == null || typeof markdown !== 'string') {
    return undefined;
  }
  if (!markdown.trim()) {
    return undefined;
  }
  return { content: markdown, type: 'text/markdown' };
};

export const fromOpenCollectionMarkdownDocs = (
  docs: string | { content?: string } | null | undefined
): string => {
  if (docs == null) {
    return '';
  }
  if (typeof docs === 'string') {
    return docs;
  }
  if (typeof docs === 'object' && docs !== null && 'content' in docs) {
    const c = (docs as { content?: unknown }).content;
    return typeof c === 'string' ? c : '';
  }
  return '';
};

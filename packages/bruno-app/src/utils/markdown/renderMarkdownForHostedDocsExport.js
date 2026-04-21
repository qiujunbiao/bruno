import MarkdownIt from 'markdown-it';
import * as MarkdownItReplaceLink from 'markdown-it-replace-link';
import DOMPurify from 'dompurify';

/**
 * Match DocPage / MarkDown preview so exported hosted docs look the same as in Bruno.
 */
export const renderMarkdownForHostedDocsExport = (markdown, collectionPathname = '') => {
  const md = new MarkdownIt({
    html: true,
    breaks: true,
    linkify: true,
    replaceLink: function (link) {
      return link.replace(/^\./, collectionPathname || '.');
    }
  }).use(MarkdownItReplaceLink);

  const html = md.render(markdown || '');
  const safe = DOMPurify.sanitize(html);
  return `<div class="markdown-body">${safe}</div>`;
};

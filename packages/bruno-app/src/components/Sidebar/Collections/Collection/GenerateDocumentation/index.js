import React, { useCallback, useMemo } from 'react';
import { useSelector } from 'react-redux';
import { cloneDeep } from 'lodash';
import * as FileSaver from 'file-saver';
import jsyaml from 'js-yaml';
import jsesc from 'jsesc';
import toast from 'react-hot-toast';
import { IconBook, IconCheck, IconAlertTriangle, IconLoader2 } from '@tabler/icons';

import Modal from 'components/Modal';
import StyledWrapper from './StyledWrapper';
import demoImage from './demo.png';
import { useApp } from 'providers/App';
import { transformCollectionToSaveToExportAsFile, findCollectionByUid, areItemsLoading } from 'utils/collections/index';
import { brunoToOpenCollection } from '@usebruno/converters';
import { sanitizeName } from 'utils/common/regex';
import { escapeHtml } from 'utils/response';
import { renderMarkdownForHostedDocsExport } from 'utils/markdown/renderMarkdownForHostedDocsExport';

const CDN_BASE_URL = 'https://cdn.opencollection.com';
const GITHUB_MARKDOWN_CSS = 'https://cdn.jsdelivr.net/npm/github-markdown-css@5.2.0/github-markdown.min.css';

/**
 * Hosted docs.js does not support Bruno `doc` items. We map each doc page to a minimal
 * HTTP leaf so the sidebar treats it like a single entry (no folder chevron). The URL
 * is a non-callable placeholder; request `docs` carry the Markdown for the main panel.
 */
const normalizeDocPagesForHostedDocsViewer = (items, docHttpLeafNamesOut) => {
  if (!Array.isArray(items)) {
    return;
  }
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item?.info?.type === 'doc') {
      const seq = item.info?.seq;
      const docName = item.info?.name || 'Untitled';
      docHttpLeafNamesOut?.push(docName);
      items[i] = {
        ...(typeof item.id === 'string' && item.id.trim() ? { id: item.id.trim() } : {}),
        info: {
          name: docName,
          type: 'http',
          ...(typeof seq === 'number' ? { seq } : {})
        },
        http: {
          method: 'GET',
          url: 'about:blank#bruno-documentation-page'
        },
        settings: {
          encodeUrl: true,
          timeout: 0,
          followRedirects: true,
          maxRedirects: 5
        },
        ...(item.docs ? { docs: item.docs } : {})
      };
    } else if (items[i]?.items?.length) {
      normalizeDocPagesForHostedDocsViewer(items[i].items, docHttpLeafNamesOut);
    }
  }
};

const extractMarkdownDocsSource = (docs) => {
  if (docs == null) {
    return null;
  }
  if (typeof docs === 'string') {
    return { text: docs, mime: 'text/markdown' };
  }
  if (typeof docs === 'object') {
    const { content, type } = docs;
    if (typeof content !== 'string') {
      return null;
    }
    return { text: content, mime: type || 'text/markdown' };
  }
  return null;
};

/**
 * OpenCollection's hosted viewer uses a different Markdown pipeline than Bruno.
 * Pre-render Markdown the same way as DocPage / request docs preview, and ship HTML
 * plus GitHub Markdown CSS so tables, lists, and inline HTML match the app.
 */
const upgradeMarkdownDocsToHtmlForHostedExport = (openCollection, collectionPathname) => {
  const maybeConvert = (docs) => {
    const extracted = extractMarkdownDocsSource(docs);
    if (!extracted || !extracted.text.trim()) {
      return null;
    }
    if (extracted.mime === 'text/html') {
      return null;
    }
    if (extracted.mime !== 'text/markdown') {
      return null;
    }
    return {
      content: renderMarkdownForHostedDocsExport(extracted.text, collectionPathname || ''),
      type: 'text/html'
    };
  };

  if (openCollection.docs) {
    const next = maybeConvert(openCollection.docs);
    if (next) {
      openCollection.docs = next;
    }
  }

  const walk = (items) => {
    if (!Array.isArray(items)) {
      return;
    }
    for (const item of items) {
      if (item.docs) {
        const next = maybeConvert(item.docs);
        if (next) {
          item.docs = next;
        }
      }
      if (item.items?.length) {
        walk(item.items);
      }
    }
  };
  walk(openCollection.items || []);
};

const FEATURES = [
  'Standalone HTML file - no server required',
  'Interactive API playground',
  'Host on any static file server'
];

const encodeUtf8JsonForHtmlScript = (value) => {
  const json = JSON.stringify(value);
  try {
    return btoa(unescape(encodeURIComponent(json)));
  } catch {
    return btoa(json);
  }
};

const buildHtmlDocument = (collectionName, escapedYamlContent, docHttpLeafNamesB64) => `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${collectionName} - API Documentation</title>
    <style>
        body { margin: 0; padding: 0; }
        #opencollection-container { width: 100vw; height: 100vh; }
        /* OpenCollection folder detail header: hide the "Folder" type pill (icon + label). */
        #opencollection-container .item-type-badge.folder {
            display: none !important;
        }
        /* Keep doc title aligned with folder rows after method badge is hidden. */
        #opencollection-container .bruno-doc-sidebar-title {
            margin-left: 22px !important;
        }
        /* Hide hosted viewer branding/footer in exported doc page. */
        #opencollection-container a[href*="opencollection.com"],
        #opencollection-container [class*="powered"],
        #opencollection-container [class*="branding"] {
            display: none !important;
        }
        .bruno-theme-toggle {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            margin-left: 10px;
        }
        .bruno-theme-btn {
            width: 30px;
            height: 30px;
            border-radius: 8px;
            border: 1px solid var(--border-color, rgba(0, 0, 0, 0.15));
            background: var(--background-color, #fff);
            color: var(--text-primary, #111827);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.2s ease;
            font-size: 16px;
            line-height: 1;
        }
        .bruno-theme-btn:hover {
            transform: translateY(-1px);
        }
        .bruno-theme-btn.active {
            border-color: #f59e0b;
            box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.2);
        }
        #opencollection-container[data-bruno-theme="dark"] {
            /* Match Bruno built-in "Dark" palette (themes/dark/dark.js) */
            --background-color: #0f1115;
            --bg-primary: #0f1115;
            --bg-secondary: #171b22;
            --bg-elevated: #1e242d;
            --oc-sidebar-bg: #11141a;
            --oc-text-primary: #e4e7ec;
            --text-primary: #e4e7ec;
            --text-secondary: #b5bdc9;
            --text-tertiary: #8f9aaa;
            --border-color: #303744;
            --code-bg: #111827;
            --code-text: #dbeafe;
            --table-header-bg: #1e242d;
            --table-row-odd-bg: #0f1115;
            --table-row-even-bg: #151922;
            --input-bg: #151922;
            --badge-bg: #1e242d;
            --badge-text: #e4e7ec;
            --method-get-bg: #1f7a4d;
            --method-post-bg: #1f5a8a;
            --method-put-bg: #8a5a1f;
            --method-patch-bg: #5e3b9d;
            --method-delete-bg: #9d3b3b;
            --method-options-bg: #1f7a73;
            --bruno-method-get: hsl(140, 72%, 68%);
            --bruno-method-post: hsl(202, 88%, 72%);
            --bruno-method-put: hsl(24, 88%, 72%);
            --bruno-method-delete: hsl(8, 70%, 60%);
            --bruno-method-patch: hsl(24, 88%, 72%);
            --bruno-method-options: hsl(170, 70%, 60%);
            --bruno-method-head: hsl(190, 82%, 72%);
            --bruno-method-text: #10141c;
        }
        #opencollection-container[data-bruno-theme="dark"],
        #opencollection-container[data-bruno-theme="dark"] > div {
            background-color: #0f1115 !important;
            color: #e4e7ec !important;
        }
        #opencollection-container[data-bruno-theme="dark"] [class~="bg-white"],
        #opencollection-container[data-bruno-theme="dark"] [class~="bg-gray-50"],
        #opencollection-container[data-bruno-theme="dark"] [class~="bg-gray-100"],
        #opencollection-container[data-bruno-theme="dark"] [class~="bg-slate-50"],
        #opencollection-container[data-bruno-theme="dark"] [class~="bg-slate-100"],
        #opencollection-container[data-bruno-theme="dark"] [class~="bg-zinc-50"],
        #opencollection-container[data-bruno-theme="dark"] [class~="bg-zinc-100"],
        #opencollection-container[data-bruno-theme="dark"] [style*="background: white"],
        #opencollection-container[data-bruno-theme="dark"] [style*="background-color: white"],
        #opencollection-container[data-bruno-theme="dark"] [style*="background: #fff"],
        #opencollection-container[data-bruno-theme="dark"] [style*="background-color: #fff"],
        #opencollection-container[data-bruno-theme="dark"] [style*="background: rgb(255, 255, 255)"],
        #opencollection-container[data-bruno-theme="dark"] [style*="background-color: rgb(255, 255, 255)"] {
            background-color: #0f1115 !important;
            color: #e4e7ec !important;
        }
        #opencollection-container[data-bruno-theme="dark"] [class~="text-black"],
        #opencollection-container[data-bruno-theme="dark"] [class~="text-gray-950"],
        #opencollection-container[data-bruno-theme="dark"] [class~="text-gray-900"],
        #opencollection-container[data-bruno-theme="dark"] [class~="text-gray-800"],
        #opencollection-container[data-bruno-theme="dark"] [class~="text-slate-950"],
        #opencollection-container[data-bruno-theme="dark"] [class~="text-slate-900"],
        #opencollection-container[data-bruno-theme="dark"] [class~="text-slate-800"],
        #opencollection-container[data-bruno-theme="dark"] [class~="text-zinc-950"],
        #opencollection-container[data-bruno-theme="dark"] [class~="text-zinc-900"],
        #opencollection-container[data-bruno-theme="dark"] [class~="text-zinc-800"] {
            color: #edf0f4 !important;
            -webkit-text-fill-color: #edf0f4 !important;
        }
        #opencollection-container[data-bruno-theme="dark"] [class~="text-gray-700"],
        #opencollection-container[data-bruno-theme="dark"] [class~="text-gray-600"],
        #opencollection-container[data-bruno-theme="dark"] [class~="text-gray-500"],
        #opencollection-container[data-bruno-theme="dark"] [class~="text-slate-700"],
        #opencollection-container[data-bruno-theme="dark"] [class~="text-slate-600"],
        #opencollection-container[data-bruno-theme="dark"] [class~="text-slate-500"],
        #opencollection-container[data-bruno-theme="dark"] [class~="text-zinc-700"],
        #opencollection-container[data-bruno-theme="dark"] [class~="text-zinc-600"],
        #opencollection-container[data-bruno-theme="dark"] [class~="text-zinc-500"] {
            color: #b5bdc9 !important;
            -webkit-text-fill-color: #b5bdc9 !important;
        }
        #opencollection-container[data-bruno-theme="dark"] [class~="border-gray-100"],
        #opencollection-container[data-bruno-theme="dark"] [class~="border-gray-200"],
        #opencollection-container[data-bruno-theme="dark"] [class~="border-slate-100"],
        #opencollection-container[data-bruno-theme="dark"] [class~="border-slate-200"],
        #opencollection-container[data-bruno-theme="dark"] [class~="border-zinc-100"],
        #opencollection-container[data-bruno-theme="dark"] [class~="border-zinc-200"] {
            border-color: #303744 !important;
        }
        #opencollection-container[data-bruno-theme="dark"] .markdown-body {
            color: #e4e7ec !important;
            background: transparent !important;
        }
        #opencollection-container[data-bruno-theme="dark"] .playground-sidebar,
        #opencollection-container[data-bruno-theme="dark"] .playground-sidebar > div,
        #opencollection-container[data-bruno-theme="dark"] .playground-content,
        #opencollection-container[data-bruno-theme="dark"] .all-endpoints-view {
            background-color: #0f1115 !important;
            color: #e4e7ec !important;
        }
        #opencollection-container[data-bruno-theme="dark"] .playground-sidebar,
        #opencollection-container[data-bruno-theme="dark"] .playground-sidebar > div {
            background-color: #11141a !important;
        }
        #opencollection-container[data-bruno-theme="dark"] .playground-sidebar h1 {
            color: #edf0f4 !important;
        }
        #opencollection-container[data-bruno-theme="dark"] .playground-sidebar .active {
            background-color: #263241 !important;
            color: #ffffff !important;
            box-shadow: inset 3px 0 0 #d9a342;
            font-weight: 600;
        }
        #opencollection-container[data-bruno-theme="dark"] .playground-sidebar .truncate,
        #opencollection-container[data-bruno-theme="dark"] .playground-sidebar .item-title,
        #opencollection-container[data-bruno-theme="dark"] .playground-sidebar .item-subtitle,
        #opencollection-container[data-bruno-theme="dark"] .playground-sidebar .text-sm {
            color: #d7dce4 !important;
            -webkit-text-fill-color: #d7dce4 !important;
            opacity: 1 !important;
        }
        #opencollection-container[data-bruno-theme="dark"] .playground-sidebar [style*="padding-left"] {
            color: #d7dce4 !important;
            -webkit-text-fill-color: #d7dce4 !important;
        }
        #opencollection-container[data-bruno-theme="dark"] .playground-sidebar [style*="padding-left"] div:not(.method-badge):not(.bruno-method-badge),
        #opencollection-container[data-bruno-theme="dark"] .playground-sidebar [style*="padding-left"] span:not(.method-badge):not(.bruno-method-badge),
        #opencollection-container[data-bruno-theme="dark"] .playground-sidebar [style*="padding-left"] p,
        #opencollection-container[data-bruno-theme="dark"] .playground-sidebar [style*="padding-left"] a {
            -webkit-text-fill-color: #d7dce4 !important;
        }
        #opencollection-container[data-bruno-theme="dark"] .playground-sidebar [style*="padding-left"]:hover {
            background-color: #1a2029 !important;
        }
        #opencollection-container[data-bruno-theme="dark"] .playground-sidebar .method-badge,
        #opencollection-container[data-bruno-theme="dark"] .playground-sidebar .bruno-method-badge {
            background-color: var(--bruno-method-post) !important;
            border-color: transparent !important;
            color: var(--bruno-method-text) !important;
            -webkit-text-fill-color: var(--bruno-method-text) !important;
            font-weight: 800 !important;
            opacity: 1 !important;
        }
        #opencollection-container[data-bruno-theme="dark"] .playground-sidebar .method-badge,
        #opencollection-container[data-bruno-theme="dark"] .playground-sidebar .method-badge *,
        #opencollection-container[data-bruno-theme="dark"] .playground-sidebar .bruno-method-badge,
        #opencollection-container[data-bruno-theme="dark"] .playground-sidebar .bruno-method-badge * {
            text-shadow: none !important;
            filter: none !important;
        }
        #opencollection-container[data-bruno-theme="dark"] .bruno-method-badge {
            color: var(--bruno-method-text) !important;
            -webkit-text-fill-color: var(--bruno-method-text) !important;
            font-weight: 800 !important;
            opacity: 1 !important;
        }
        #opencollection-container[data-bruno-theme="dark"] .playground-sidebar,
        #opencollection-container[data-bruno-theme="dark"] .playground-sidebar * {
            opacity: 1 !important;
            filter: none !important;
        }
        #opencollection-container[data-bruno-theme="dark"] .bruno-sidebar-search input,
        #opencollection-container[data-bruno-theme="dark"] .bruno-sidebar-search input[type="search"] {
            background-color: #151922 !important;
            color: #edf0f4 !important;
            border-color: #414b5c !important;
        }
        #opencollection-container[data-bruno-theme="dark"] .bruno-sidebar-search input::placeholder {
            color: #96a0af !important;
            opacity: 1 !important;
        }
        #opencollection-container[data-bruno-theme="dark"] .badge-url {
            background-color: #171b22 !important;
            color: #edf0f4 !important;
            border: 1px solid #414b5c !important;
        }
        #opencollection-container[data-bruno-theme="dark"] .badge-try {
            background-color: #2a3e57 !important;
            color: #dbeafe !important;
            border: 1px solid #3f5b7a !important;
        }
        #opencollection-container[data-bruno-theme="dark"] .code-tabs .code-tab,
        #opencollection-container[data-bruno-theme="dark"] .tab-header button {
            color: #b5bdc9 !important;
            background-color: transparent !important;
            border-color: #303744 !important;
        }
        #opencollection-container[data-bruno-theme="dark"] .code-tabs .code-tab.active,
        #opencollection-container[data-bruno-theme="dark"] .tab-header button.active {
            color: #f3f4f6 !important;
            border-bottom-color: #d9a342 !important;
        }
        /* Try/response runtime panels in dark mode */
        #opencollection-container[data-bruno-theme="dark"] .request-details,
        #opencollection-container[data-bruno-theme="dark"] .item-content-grid,
        #opencollection-container[data-bruno-theme="dark"] .item-content-main,
        #opencollection-container[data-bruno-theme="dark"] .table-wrapper,
        #opencollection-container[data-bruno-theme="dark"] .minimal-table,
        #opencollection-container[data-bruno-theme="dark"] .scripts-card,
        #opencollection-container[data-bruno-theme="dark"] .compact-code-view,
        #opencollection-container[data-bruno-theme="dark"] .code-header,
        #opencollection-container[data-bruno-theme="dark"] .code-content {
            background-color: #0f1115 !important;
            color: #e4e7ec !important;
            border-color: #303744 !important;
        }
        #opencollection-container[data-bruno-theme="dark"] input,
        #opencollection-container[data-bruno-theme="dark"] select,
        #opencollection-container[data-bruno-theme="dark"] textarea {
            background-color: #151922 !important;
            color: #edf0f4 !important;
            border-color: #414b5c !important;
        }
        #opencollection-container[data-bruno-theme="dark"] input::placeholder,
        #opencollection-container[data-bruno-theme="dark"] textarea::placeholder {
            color: #96a0af !important;
            opacity: 1 !important;
        }
        #opencollection-container[data-bruno-theme="dark"] table tr,
        #opencollection-container[data-bruno-theme="dark"] table td,
        #opencollection-container[data-bruno-theme="dark"] table th {
            background-color: transparent !important;
            color: #e4e7ec !important;
            border-color: #303744 !important;
        }
        /* Environment / Global Variables table in Try mode */
        #opencollection-container[data-bruno-theme="dark"] .key-value-table-wrapper,
        #opencollection-container[data-bruno-theme="dark"] .key-value-table-container,
        #opencollection-container[data-bruno-theme="dark"] .key-value-table,
        #opencollection-container[data-bruno-theme="dark"] .key-value-table tbody,
        #opencollection-container[data-bruno-theme="dark"] .key-value-table tbody tr,
        #opencollection-container[data-bruno-theme="dark"] .key-value-table tbody td {
            background-color: #0f1115 !important;
            color: #e4e7ec !important;
            border-color: #303744 !important;
        }
        #opencollection-container[data-bruno-theme="dark"] .key-value-table thead,
        #opencollection-container[data-bruno-theme="dark"] .key-value-table thead th {
            background-color: #1e242d !important;
            color: #edf0f4 !important;
            border-color: #303744 !important;
        }
        #opencollection-container[data-bruno-theme="dark"] .key-value-table .text-input {
            background-color: transparent !important;
            color: #edf0f4 !important;
            border-color: transparent !important;
        }
        #opencollection-container[data-bruno-theme="dark"] .key-value-table .text-input::placeholder {
            color: #96a0af !important;
            opacity: 1 !important;
        }
        #opencollection-container[data-bruno-theme="dark"] .section-title,
        #opencollection-container[data-bruno-theme="dark"] .table-value {
            color: #edf0f4 !important;
        }
        #opencollection-container[data-bruno-theme="dark"] .tabs-header,
        #opencollection-container[data-bruno-theme="dark"] .tabs,
        #opencollection-container[data-bruno-theme="dark"] .tab-group .tab-header {
            background-color: #0f1115 !important;
            border-color: #303744 !important;
        }
        #opencollection-container[data-bruno-theme="dark"] .tabs .tab,
        #opencollection-container[data-bruno-theme="dark"] .tab-group .tab-button {
            color: #b5bdc9 !important;
            border-color: #303744 !important;
            opacity: 1 !important;
        }
        #opencollection-container[data-bruno-theme="dark"] .tabs .tab.active,
        #opencollection-container[data-bruno-theme="dark"] .tab-group .tab-button.active {
            color: #f5f5f5 !important;
            background-color: #1e242d !important;
            border-bottom-color: #d9a342 !important;
            box-shadow: inset 0 -2px 0 #d9a342;
        }
        /* Monaco editor area in Try mode */
        #opencollection-container[data-bruno-theme="dark"] .monaco-editor,
        #opencollection-container[data-bruno-theme="dark"] .monaco-editor-background,
        #opencollection-container[data-bruno-theme="dark"] .monaco-editor .margin,
        #opencollection-container[data-bruno-theme="dark"] .monaco-editor .margin-view-overlays,
        #opencollection-container[data-bruno-theme="dark"] .monaco-editor .monaco-scrollable-element,
        #opencollection-container[data-bruno-theme="dark"] .monaco-editor .view-lines {
            background-color: #0f1115 !important;
        }
        #opencollection-container[data-bruno-theme="dark"] .monaco-editor .view-line,
        #opencollection-container[data-bruno-theme="dark"] .monaco-editor .line-numbers {
            color: #dbeafe !important;
        }
        #opencollection-container[data-bruno-theme="dark"] .monaco-editor .cursor {
            background-color: #d9a342 !important;
            border-color: #d9a342 !important;
        }
        #opencollection-container[data-bruno-theme="dark"] .monaco-editor .current-line {
            border-color: #303744 !important;
        }
        #opencollection-container[data-bruno-theme="dark"] .markdown-body table tr,
        #opencollection-container[data-bruno-theme="dark"] .markdown-body table td,
        #opencollection-container[data-bruno-theme="dark"] .markdown-body table th {
            border-color: #303744 !important;
        }
        #opencollection-container[data-bruno-theme="dark"] .markdown-body table {
            background-color: transparent !important;
        }
        #opencollection-container[data-bruno-theme="dark"] .markdown-body table th {
            background-color: #1e242d !important;
            color: #edf0f4 !important;
        }
        #opencollection-container[data-bruno-theme="dark"] .markdown-body table td {
            background-color: #0f1115 !important;
            color: #e4e7ec !important;
        }
        #opencollection-container[data-bruno-theme="dark"] .markdown-body table tr:nth-child(2n) {
            background-color: #151922 !important;
        }
        #opencollection-container[data-bruno-theme="dark"] .markdown-body code,
        #opencollection-container[data-bruno-theme="dark"] .markdown-body pre {
            background-color: #111827 !important;
            color: #dbeafe !important;
        }
        #opencollection-container[data-bruno-theme="light"] {
            --background-color: #ffffff;
            --text-primary: #111827;
            --text-secondary: #6b7280;
            --border-color: #e5e7eb;
            --bruno-method-get: hsl(145, 50%, 36%);
            --bruno-method-post: #3b82f6;
            --bruno-method-put: hsl(35, 85%, 42%);
            --bruno-method-delete: hsl(8, 60%, 52%);
            --bruno-method-patch: hsl(35, 85%, 42%);
            --bruno-method-options: hsl(178, 50%, 36%);
            --bruno-method-head: hsl(195, 55%, 42%);
            --bruno-method-text: #ffffff;
        }
    </style>
    <link rel="stylesheet" href="${CDN_BASE_URL}/docs.css">
    <link rel="stylesheet" href="${GITHUB_MARKDOWN_CSS}">
    <script src="${CDN_BASE_URL}/docs.js"></script>
</head>
<body>
    <div id="opencollection-container"></div>
    <script>
        const THEME_STORAGE_KEY = 'bruno-docs-theme-preference';
        const collectionData = ${escapedYamlContent};
        const hostTarget = document.getElementById('opencollection-container');
        const systemThemeMedia = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

        const resolveTheme = (pref) => {
            if (pref === 'light' || pref === 'dark') {
                return pref;
            }
            return systemThemeMedia && systemThemeMedia.matches ? 'dark' : 'light';
        };

        const getThemePreference = () => {
            const saved = localStorage.getItem(THEME_STORAGE_KEY);
            if (saved === 'light' || saved === 'dark' || saved === 'system') {
                return saved;
            }
            return 'system';
        };

        const mountOpenCollection = (themePreference) => {
            const theme = resolveTheme(themePreference);
            hostTarget.setAttribute('data-bruno-theme', theme);
            hostTarget.innerHTML = '';
            new window.OpenCollection({
                target: hostTarget,
                opencollection: collectionData,
                theme
            });
        };
        window.__BRUNO_COLLECTION_DATA__ = collectionData;
        window.__BRUNO_THEME_SET__ = function (nextPreference) {
            const pref = nextPreference === 'light' || nextPreference === 'dark' || nextPreference === 'system'
                ? nextPreference
                : 'system';
            localStorage.setItem(THEME_STORAGE_KEY, pref);
            mountOpenCollection(pref);
        };
        window.__BRUNO_THEME_GET__ = function () {
            return getThemePreference();
        };

        if (systemThemeMedia && systemThemeMedia.addEventListener) {
            systemThemeMedia.addEventListener('change', () => {
                if (getThemePreference() === 'system') {
                    mountOpenCollection('system');
                }
            });
        }

        mountOpenCollection(getThemePreference());
    </script>
    <script>
        (function () {
            var MARKER = 'about:blank#bruno-documentation-page';
            var DOC_HTTP_NAMES = [];
            try {
                DOC_HTTP_NAMES = JSON.parse(decodeURIComponent(escape(atob('${docHttpLeafNamesB64}'))));
            } catch (e) {
                DOC_HTTP_NAMES = [];
            }
            if (!Array.isArray(DOC_HTTP_NAMES)) {
                DOC_HTTP_NAMES = [];
            }
            var root = document.getElementById('opencollection-container');
            if (!root) {
                return;
            }
            var rafScheduled = false;
            var scrollSyncBound = false;
            var activeSectionId = '';
            var sidebarSearchQuery = '';
            var sectionToSidebarRowMap = null;
            var folderToSectionMap = null;
            function mountThemeButtons() {
                var sidebar = root.querySelector('.playground-sidebar');
                if (!sidebar) {
                    return;
                }
                var title = sidebar.querySelector('h1');
                if (!title || !title.parentElement) {
                    return;
                }
                if (title.parentElement.querySelector('.bruno-theme-toggle')) {
                    return;
                }
                var wrap = document.createElement('div');
                wrap.className = 'bruno-theme-toggle';

                var btnLight = document.createElement('button');
                btnLight.type = 'button';
                btnLight.className = 'bruno-theme-btn';
                btnLight.title = '浅色模式';
                btnLight.setAttribute('aria-label', '浅色模式');
                btnLight.textContent = '☀';

                var btnDark = document.createElement('button');
                btnDark.type = 'button';
                btnDark.className = 'bruno-theme-btn';
                btnDark.title = '深色模式';
                btnDark.setAttribute('aria-label', '深色模式');
                btnDark.textContent = '☾';

                function updateState() {
                    var pref = window.__BRUNO_THEME_GET__ ? window.__BRUNO_THEME_GET__() : 'system';
                    btnLight.classList.toggle('active', pref === 'light');
                    btnDark.classList.toggle('active', pref === 'dark');
                    if (pref === 'system') {
                        var isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
                        btnLight.classList.toggle('active', !isDark);
                        btnDark.classList.toggle('active', isDark);
                    }
                }

                btnLight.onclick = function () {
                    if (window.__BRUNO_THEME_SET__) {
                        window.__BRUNO_THEME_SET__('light');
                    }
                    updateState();
                };
                btnDark.onclick = function () {
                    if (window.__BRUNO_THEME_SET__) {
                        window.__BRUNO_THEME_SET__('dark');
                    }
                    updateState();
                };

                wrap.appendChild(btnLight);
                wrap.appendChild(btnDark);
                title.parentElement.appendChild(wrap);
                updateState();
            }
            function hideDocRequestBar() {
                var sections = root.querySelectorAll('.endpoint-section');
                for (var i = 0; i < sections.length; i++) {
                    var section = sections[i];
                    var sectionText = (section.textContent || '').replace(/\s+/g, ' ').trim();
                    if (sectionText.indexOf(MARKER) === -1) {
                        continue;
                    }
                    var badges = section.querySelectorAll('.endpoint-badges');
                    for (var b = 0; b < badges.length; b++) {
                        badges[b].style.setProperty('display', 'none', 'important');
                    }
                    var snippets = section.querySelectorAll('.code-snippets-wrapper');
                    for (var s = 0; s < snippets.length; s++) {
                        snippets[s].style.setProperty('display', 'none', 'important');
                    }
                }
            }
            function hideDocSidebarMethodBadges() {
                if (!DOC_HTTP_NAMES.length) {
                    return;
                }
                var textNodes = root.querySelectorAll('span, div, p');
                for (var n = 0; n < DOC_HTTP_NAMES.length; n++) {
                    var docName = DOC_HTTP_NAMES[n];
                    if (!docName) {
                        continue;
                    }
                    for (var i = 0; i < textNodes.length; i++) {
                        var labelEl = textNodes[i];
                        if ((labelEl.textContent || '').trim() !== docName) {
                            continue;
                        }
                        if (labelEl.querySelector && labelEl.querySelector('*')) {
                            continue;
                        }
                        var row = labelEl.parentElement;
                        for (var up = 0; up < 7 && row; up++) {
                            var rowText = (row.textContent || '').replace(/\s+/g, ' ').trim();
                            if (rowText.indexOf(docName) !== -1 && rowText.length < 120) {
                                break;
                            }
                            row = row.parentElement;
                        }
                        if (!row) {
                            continue;
                        }
                        var rowLeafs = row.querySelectorAll('span, div, p');
                        var didHideDocMethodBadge = false;
                        for (var j = 0; j < rowLeafs.length; j++) {
                            var leaf = rowLeafs[j];
                            if (leaf.querySelector && leaf.querySelector('*')) {
                                continue;
                            }
                            if ((leaf.textContent || '').trim() === 'GET') {
                                leaf.style.setProperty('display', 'none', 'important');
                                didHideDocMethodBadge = true;
                            }
                        }
                        if (didHideDocMethodBadge) {
                            labelEl.classList.add('bruno-doc-sidebar-title');
                            labelEl.style.setProperty('margin-left', '22px', 'important');
                            labelEl.style.setProperty('display', 'inline-block', 'important');
                        }
                    }
                }
            }
            function applySidebarSearchFilter() {
                var sidebar = root.querySelector('.playground-sidebar');
                if (!sidebar) {
                    return;
                }
                var query = sidebarSearchQuery.trim().toLowerCase();
                var previouslyHiddenRows = sidebar.querySelectorAll('[data-bruno-search-hidden="1"]');
                for (var ph = 0; ph < previouslyHiddenRows.length; ph++) {
                    previouslyHiddenRows[ph].style.removeProperty('display');
                    previouslyHiddenRows[ph].removeAttribute('data-bruno-search-hidden');
                }
                var rows = sidebar.querySelectorAll('div[style*="padding-left"]');
                for (var i = 0; i < rows.length; i++) {
                    var row = rows[i];
                    var labelEl = row.querySelector('div.truncate.flex-1');
                    if (!labelEl) {
                        continue;
                    }
                    var label = (labelEl.textContent || '').trim().toLowerCase();
                    if (!query) {
                        row.style.removeProperty('display');
                    } else if (label.indexOf(query) !== -1) {
                        row.style.removeProperty('display');
                    } else {
                        row.style.setProperty('display', 'none', 'important');
                        row.setAttribute('data-bruno-search-hidden', '1');
                    }
                }
                var sections = root.querySelectorAll('.endpoint-section');
                for (var rs = 0; rs < sections.length; rs++) {
                    sections[rs].style.removeProperty('display');
                }
                for (var s = 0; s < sections.length; s++) {
                    var sec = sections[s];
                    var titleEl = sec.querySelector('.item-title');
                    var title = titleEl ? (titleEl.textContent || '').trim().toLowerCase() : '';
                    if (!query || title.indexOf(query) !== -1) {
                        sec.style.removeProperty('display');
                    } else {
                        sec.style.setProperty('display', 'none', 'important');
                    }
                }
            }
            function applyTryToolbarDarkTheme() {
                if (root.getAttribute('data-bruno-theme') !== 'dark') {
                    return;
                }
                function paintDark(el) {
                    if (!el || !el.style) {
                        return;
                    }
                    el.style.setProperty('background-color', '#0f1115', 'important');
                    el.style.setProperty('border-color', '#303744', 'important');
                    el.style.setProperty('color', '#e4e7ec', 'important');
                }
                var labels = root.querySelectorAll('span, a, button, div');
                var collapseNode = null;
                var closeNode = null;
                for (var i = 0; i < labels.length; i++) {
                    var txt = (labels[i].textContent || '').replace(/\s+/g, ' ').trim();
                    if (!collapseNode && txt === 'Collapse') {
                        collapseNode = labels[i];
                    }
                    if (!closeNode && txt === 'Close') {
                        closeNode = labels[i];
                    }
                    if (collapseNode && closeNode) {
                        break;
                    }
                }
                if (!collapseNode && !closeNode) {
                    return;
                }
                var anchor = collapseNode || closeNode;
                var toolbar = anchor;
                for (var up = 0; up < 10 && toolbar; up++) {
                    toolbar = toolbar.parentElement;
                    if (!toolbar) {
                        break;
                    }
                    var text = (toolbar.textContent || '').replace(/\s+/g, ' ');
                    if (text.indexOf('Collapse') !== -1 && text.indexOf('Close') !== -1) {
                        paintDark(toolbar);
                        var children = toolbar.querySelectorAll('*');
                        for (var c = 0; c < children.length; c++) {
                            children[c].style.setProperty('color', '#e4e7ec', 'important');
                            children[c].style.setProperty('border-color', '#303744', 'important');
                        }
                        if (toolbar.previousElementSibling) {
                            paintDark(toolbar.previousElementSibling);
                            var prevChildren = toolbar.previousElementSibling.querySelectorAll('*');
                            for (var pc = 0; pc < prevChildren.length; pc++) {
                                prevChildren[pc].style.setProperty('background-color', '#0f1115', 'important');
                                prevChildren[pc].style.setProperty('color', '#e4e7ec', 'important');
                            }
                        }
                        if (toolbar.parentElement) {
                            paintDark(toolbar.parentElement);
                        }
                        break;
                    }
                }
                var allDivs = root.querySelectorAll('div');
                for (var d = 0; d < allDivs.length; d++) {
                    var el = allDivs[d];
                    var cs = window.getComputedStyle ? window.getComputedStyle(el) : null;
                    if (!cs) {
                        continue;
                    }
                    var isResizer = cs.cursor === 'row-resize';
                    var isLightTopBar = (cs.backgroundColor === 'rgb(248, 249, 250)' || cs.backgroundColor === 'rgb(255, 255, 255)') && parseInt(cs.height || '0', 10) <= 60;
                    if (isResizer || isLightTopBar) {
                        paintDark(el);
                        var kids = el.querySelectorAll('*');
                        for (var k = 0; k < kids.length; k++) {
                            kids[k].style.setProperty('color', '#e4e7ec', 'important');
                            kids[k].style.setProperty('border-color', '#303744', 'important');
                        }
                    }
                }
            }
            function parseRgb(value) {
                var match = value && value.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/);
                if (!match || match[4] === '0') {
                    return null;
                }
                return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
            }
            function isLightColor(value, threshold) {
                var rgb = parseRgb(value);
                return !!rgb && rgb[0] >= threshold && rgb[1] >= threshold && rgb[2] >= threshold;
            }
            function isDarkColor(value, threshold) {
                var rgb = parseRgb(value);
                return !!rgb && rgb[0] <= threshold && rgb[1] <= threshold && rgb[2] <= threshold;
            }
            function applyTryDarkSurfaceOverrides() {
                if (root.getAttribute('data-bruno-theme') !== 'dark' || !window.getComputedStyle) {
                    return;
                }
                var nodes = [root];
                var descendants = root.querySelectorAll('*');
                for (var n = 0; n < descendants.length; n++) {
                    nodes.push(descendants[n]);
                }
                for (var i = 0; i < nodes.length; i++) {
                    var el = nodes[i];
                    if (!el || !el.style) {
                        continue;
                    }
                    var cs = window.getComputedStyle(el);
                    if (!cs || cs.display === 'none') {
                        continue;
                    }
                    var tagName = (el.tagName || '').toLowerCase();
                    var isFormControl = tagName === 'input' || tagName === 'textarea' || tagName === 'select';
                    var isTableHeader = tagName === 'th' || (el.closest && el.closest('thead'));
                    var isChrome = parseInt(cs.height || '0', 10) <= 70 && (cs.cursor === 'row-resize' || isLightColor(cs.backgroundColor, 236));
                    if (isLightColor(cs.backgroundColor, 232) && cs.backgroundImage === 'none') {
                        el.style.setProperty('background-color', isFormControl || isTableHeader || isChrome ? '#1e242d' : '#0f1115', 'important');
                    }
                    if (isLightColor(cs.borderTopColor, 180)) {
                        el.style.setProperty('border-color', '#303744', 'important');
                    }
                    var webkitTextFillColor = cs.webkitTextFillColor || cs.color;
                    if ((isDarkColor(cs.color, 96) || isDarkColor(webkitTextFillColor, 96)) && !(el.closest && el.closest('.method-badge, .bruno-method-badge'))) {
                        var textColor = tagName === 'small' || tagName === 'label' ? '#b5bdc9' : '#e4e7ec';
                        el.style.setProperty('color', textColor, 'important');
                        el.style.setProperty('-webkit-text-fill-color', textColor, 'important');
                    }
                }
            }
            function fixTryMethodBadgeVisibility() {
                var isDarkTheme = root.getAttribute('data-bruno-theme') === 'dark';
                var methodStyles = isDarkTheme
                    ? {
                        GET: { bg: 'hsl(140, 72%, 68%)' },
                        POST: { bg: 'hsl(202, 88%, 72%)' },
                        PUT: { bg: 'hsl(24, 88%, 72%)' },
                        PATCH: { bg: 'hsl(24, 88%, 72%)' },
                        DEL: { bg: 'hsl(8, 70%, 60%)' },
                        DELETE: { bg: 'hsl(8, 70%, 60%)' },
                        OPTIONS: { bg: 'hsl(170, 70%, 60%)' },
                        HEAD: { bg: 'hsl(190, 82%, 72%)' }
                    }
                    : {
                        GET: { bg: 'hsl(145, 50%, 36%)' },
                        POST: { bg: '#3b82f6' },
                        PUT: { bg: 'hsl(35, 85%, 42%)' },
                        PATCH: { bg: 'hsl(35, 85%, 42%)' },
                        DEL: { bg: 'hsl(8, 60%, 52%)' },
                        DELETE: { bg: 'hsl(8, 60%, 52%)' },
                        OPTIONS: { bg: 'hsl(178, 50%, 36%)' },
                        HEAD: { bg: 'hsl(195, 55%, 42%)' }
                    };
                var fallbackStyle = isDarkTheme ? { bg: 'hsl(202, 88%, 72%)' } : { bg: '#3b82f6' };
                var methodTextColor = isDarkTheme ? '#10141c' : '#ffffff';
                var methodBadges = [];
                var knownMethods = /^(GET|POST|PUT|PATCH|DEL|DELETE|OPTIONS|HEAD)$/;
                function addMethodBadge(el) {
                    if (el && methodBadges.indexOf(el) === -1) {
                        methodBadges.push(el);
                    }
                }
                function findBadgeContainer(el, row) {
                    var current = el;
                    for (var up = 0; up < 5 && current && current !== row && current !== root; up++) {
                        var text = (current.textContent || '').replace(/\s+/g, '').trim().toUpperCase();
                        var rect = current.getBoundingClientRect ? current.getBoundingClientRect() : null;
                        var looksLikeBadge = rect && rect.width <= 120 && rect.height <= 48;
                        if (knownMethods.test(text) && looksLikeBadge) {
                            return current;
                        }
                        current = current.parentElement;
                    }
                    return el;
                }
                var classBadges = root.querySelectorAll('.method-badge');
                for (var cb = 0; cb < classBadges.length; cb++) {
                    addMethodBadge(classBadges[cb]);
                }
                var methodLeaves = root.querySelectorAll('div, span, p, button');
                for (var ml = 0; ml < methodLeaves.length; ml++) {
                    var methodLeaf = methodLeaves[ml];
                    var methodLeafText = (methodLeaf.textContent || '').replace(/\s+/g, '').trim().toUpperCase();
                    if (!knownMethods.test(methodLeafText)) {
                        continue;
                    }
                    var methodRect = methodLeaf.getBoundingClientRect ? methodLeaf.getBoundingClientRect() : null;
                    if (!methodRect || methodRect.width > 140 || methodRect.height > 56) {
                        continue;
                    }
                    addMethodBadge(findBadgeContainer(methodLeaf, root));
                }
                var sidebar = root.querySelector('.playground-sidebar');
                if (sidebar) {
                    var rows = sidebar.querySelectorAll('div[style*="padding-left"]');
                    for (var r = 0; r < rows.length; r++) {
                        var leaves = rows[r].querySelectorAll('div, span, p');
                        for (var l = 0; l < leaves.length; l++) {
                            var leaf = leaves[l];
                            var leafText = (leaf.textContent || '').replace(/\s+/g, '').trim().toUpperCase();
                            if (knownMethods.test(leafText)) {
                                addMethodBadge(findBadgeContainer(leaf, rows[r]));
                            }
                        }
                    }
                }
                for (var i = 0; i < methodBadges.length; i++) {
                    var badge = methodBadges[i];
                    var method = (badge.textContent || '').replace(/\s+/g, '').trim().toUpperCase();
                    var style = methodStyles[method] || fallbackStyle;
                    badge.classList.add('bruno-method-badge');
                    badge.style.setProperty('background-color', style.bg, 'important');
                    badge.style.setProperty('border-color', 'transparent', 'important');
                    badge.style.setProperty('color', methodTextColor, 'important');
                    badge.style.setProperty('-webkit-text-fill-color', methodTextColor, 'important');
                    badge.style.setProperty('font-weight', '800', 'important');
                    badge.style.setProperty('opacity', '1', 'important');
                    var children = badge.querySelectorAll('*');
                    for (var c = 0; c < children.length; c++) {
                        children[c].style.setProperty('color', methodTextColor, 'important');
                        children[c].style.setProperty('-webkit-text-fill-color', methodTextColor, 'important');
                        children[c].style.setProperty('opacity', '1', 'important');
                    }
                }
            }
            function fixTrySidebarApiLabelVisibility() {
                if (root.getAttribute('data-bruno-theme') !== 'dark') {
                    return;
                }
                var sidebar = root.querySelector('.playground-sidebar');
                if (!sidebar) {
                    return;
                }
                var rows = sidebar.querySelectorAll('div[style*="padding-left"]');
                for (var i = 0; i < rows.length; i++) {
                    var row = rows[i];
                    if (!row.querySelector('.method-badge, .bruno-method-badge')) {
                        continue;
                    }
                    var textNodes = row.querySelectorAll('div, span, p, a');
                    for (var j = 0; j < textNodes.length; j++) {
                        var node = textNodes[j];
                        if (node.closest && node.closest('.method-badge, .bruno-method-badge')) {
                            continue;
                        }
                        var txt = (node.textContent || '').trim();
                        if (!txt) {
                            continue;
                        }
                        node.style.setProperty('color', '#edf0f4', 'important');
                        node.style.setProperty('-webkit-text-fill-color', '#edf0f4', 'important');
                        node.style.setProperty('opacity', '1', 'important');
                        node.style.setProperty('visibility', 'visible', 'important');
                    }
                }
            }
            function mountSidebarSearch() {
                var sidebar = root.querySelector('.playground-sidebar');
                if (!sidebar) {
                    return;
                }
                var sidebarInner = sidebar.firstElementChild || sidebar;
                if (!sidebarInner || sidebar.querySelector('.bruno-sidebar-search')) {
                    return;
                }
                var box = document.createElement('div');
                box.className = 'bruno-sidebar-search';
                box.style.padding = '8px 10px';
                box.style.borderBottom = '1px solid rgba(0, 0, 0, 0.08)';
                box.style.background = 'var(--background-color, #fff)';
                box.style.position = 'sticky';
                box.style.top = '0';
                box.style.zIndex = '4';

                var input = document.createElement('input');
                input.type = 'search';
                input.placeholder = '搜索接口/目录';
                input.value = sidebarSearchQuery;
                input.style.width = '100%';
                input.style.boxSizing = 'border-box';
                input.style.padding = '7px 10px';
                input.style.borderRadius = '6px';
                input.style.border = '1px solid rgba(0,0,0,.15)';
                input.style.fontSize = '12px';
                input.style.outline = 'none';
                input.oninput = function (e) {
                    sidebarSearchQuery = e && e.target && typeof e.target.value === 'string' ? e.target.value : '';
                    applySidebarSearchFilter();
                };
                input.onkeydown = function (e) {
                    if (e && e.key === 'Escape') {
                        e.preventDefault();
                        sidebarSearchQuery = '';
                        input.value = '';
                        applySidebarSearchFilter();
                    }
                };

                box.appendChild(input);
                var titleBlock = sidebarInner.firstElementChild;
                if (titleBlock && titleBlock.nextSibling) {
                    sidebarInner.insertBefore(box, titleBlock.nextSibling);
                } else {
                    sidebarInner.insertBefore(box, sidebarInner.firstChild || null);
                }
            }
            function patch() {
                mountThemeButtons();
                hideDocRequestBar();
                hideDocSidebarMethodBadges();
                mountSidebarSearch();
                applySidebarSearchFilter();
                applyTryToolbarDarkTheme();
                applyTryDarkSurfaceOverrides();
                fixTryMethodBadgeVisibility();
                fixTrySidebarApiLabelVisibility();
                bindScrollSync();
            }
            function getCurrentVisibleSectionId() {
                var content = root.querySelector('.playground-content');
                if (!content) {
                    return '';
                }
                var sections = content.querySelectorAll('.endpoint-section');
                if (!sections.length) {
                    return '';
                }
                var useWindowScroll = (content.scrollHeight - content.clientHeight) < 8;
                var viewportTop = useWindowScroll ? 0 : content.getBoundingClientRect().top;
                var bestId = '';
                var bestScore = Number.POSITIVE_INFINITY;
                for (var i = 0; i < sections.length; i++) {
                    var section = sections[i];
                    var rect = section.getBoundingClientRect();
                    var distance = Math.abs(rect.top - viewportTop - 24);
                    if (rect.bottom < viewportTop + 12) {
                        continue;
                    }
                    if (distance < bestScore) {
                        bestScore = distance;
                        bestId = section.getAttribute('data-bruno-section-key') || section.id || '';
                    }
                }
                return bestId;
            }
            function normalizeTitle(text) {
                return (text || '').replace(/\s+/g, ' ').trim().toLowerCase();
            }
            function getSidebarEndpointRows() {
                var sidebar = root.querySelector('.playground-sidebar');
                if (!sidebar) {
                    return [];
                }
                var rows = sidebar.querySelectorAll('div[style*="padding-left"]');
                var out = [];
                for (var i = 0; i < rows.length; i++) {
                    var row = rows[i];
                    var labelEl = row.querySelector('div.truncate.flex-1');
                    if (!labelEl) {
                        continue;
                    }
                    var label = normalizeTitle(labelEl.textContent || '');
                    if (!label) {
                        continue;
                    }
                    out.push({
                        row: row,
                        title: label
                    });
                }
                return out;
            }
            function getSidebarFolderRows() {
                var sidebar = root.querySelector('.playground-sidebar');
                if (!sidebar) {
                    return [];
                }
                var rows = sidebar.querySelectorAll('div[style*="padding-left"]');
                var out = [];
                for (var i = 0; i < rows.length; i++) {
                    var row = rows[i];
                    if (row.querySelector('.method-badge')) {
                        continue;
                    }
                    var labelEl = row.querySelector('div.truncate.flex-1');
                    if (!labelEl) {
                        continue;
                    }
                    var title = normalizeTitle(labelEl.textContent || '');
                    if (!title) {
                        continue;
                    }
                    out.push({
                        row: row,
                        title: title
                    });
                }
                return out;
            }
            function getFolderSectionsWithTitle() {
                var sections = root.querySelectorAll('.endpoint-section');
                var out = [];
                for (var i = 0; i < sections.length; i++) {
                    var section = sections[i];
                    if (!section.querySelector('.item-type-badge.folder')) {
                        continue;
                    }
                    var titleEl = section.querySelector('.item-title');
                    var title = normalizeTitle(titleEl ? titleEl.textContent : '');
                    if (!title) {
                        continue;
                    }
                    out.push({
                        section: section,
                        title: title
                    });
                }
                return out;
            }
            function buildFolderSectionMap() {
                var folderRows = getSidebarFolderRows();
                var folderSections = getFolderSectionsWithTitle();
                if (!folderRows.length || !folderSections.length) {
                    return new Map();
                }
                var sectionBuckets = new Map();
                for (var i = 0; i < folderSections.length; i++) {
                    var sectionEntry = folderSections[i];
                    if (!sectionBuckets.has(sectionEntry.title)) {
                        sectionBuckets.set(sectionEntry.title, []);
                    }
                    sectionBuckets.get(sectionEntry.title).push(sectionEntry.section);
                }
                var seenByTitle = new Map();
                var map = new Map();
                for (var r = 0; r < folderRows.length; r++) {
                    var rowEntry = folderRows[r];
                    var seen = (seenByTitle.get(rowEntry.title) || 0) + 1;
                    seenByTitle.set(rowEntry.title, seen);
                    var matchedSectionList = sectionBuckets.get(rowEntry.title) || [];
                    var matchedSection = matchedSectionList[seen - 1] || matchedSectionList[0] || null;
                    if (matchedSection) {
                        map.set(rowEntry.row, matchedSection);
                    }
                }
                return map;
            }
            function getEndpointSectionsWithTitle() {
                var sections = root.querySelectorAll('.endpoint-section');
                var out = [];
                for (var i = 0; i < sections.length; i++) {
                    var section = sections[i];
                    var titleEl = section.querySelector('.item-title');
                    var title = normalizeTitle(titleEl ? titleEl.textContent : '');
                    if (!title) {
                        continue;
                    }
                    var sectionKey = section.getAttribute('data-bruno-section-key');
                    if (!sectionKey) {
                        sectionKey = 'bruno-sec-' + i + '-' + title.replace(/[^a-z0-9_-]/g, '-');
                        section.setAttribute('data-bruno-section-key', sectionKey);
                    }
                    out.push({
                        section: section,
                        sectionId: sectionKey,
                        title: title
                    });
                }
                return out;
            }
            function buildSectionSidebarRowMap() {
                var sectionEntries = getEndpointSectionsWithTitle();
                var rowEntries = getSidebarEndpointRows();
                if (!sectionEntries.length || !rowEntries.length) {
                    return new Map();
                }
                var rowBuckets = new Map();
                for (var i = 0; i < rowEntries.length; i++) {
                    var rowEntry = rowEntries[i];
                    if (!rowBuckets.has(rowEntry.title)) {
                        rowBuckets.set(rowEntry.title, []);
                    }
                    rowBuckets.get(rowEntry.title).push(rowEntry.row);
                }
                var sectionSeenCount = new Map();
                var map = new Map();
                for (var s = 0; s < sectionEntries.length; s++) {
                    var sectionEntry = sectionEntries[s];
                    var seen = (sectionSeenCount.get(sectionEntry.title) || 0) + 1;
                    sectionSeenCount.set(sectionEntry.title, seen);
                    var rowList = rowBuckets.get(sectionEntry.title) || [];
                    var matchedRow = rowList[seen - 1] || rowList[0] || null;
                    if (sectionEntry.sectionId && matchedRow) {
                        map.set(sectionEntry.sectionId, matchedRow);
                    }
                }
                return map;
            }
            function clearScrollLinkedSidebarState() {
                var marked = root.querySelectorAll('.playground-sidebar [data-bruno-scroll-active="1"]');
                for (var i = 0; i < marked.length; i++) {
                    marked[i].removeAttribute('data-bruno-scroll-active');
                }
            }
            function syncSidebarForSection(sectionId) {
                if (!sectionId || sectionId === activeSectionId) {
                    return;
                }
                if (!sectionToSidebarRowMap || !sectionToSidebarRowMap.size) {
                    sectionToSidebarRowMap = buildSectionSidebarRowMap();
                }
                var row = sectionToSidebarRowMap.get(sectionId);
                if (!row || !root.contains(row)) {
                    sectionToSidebarRowMap = buildSectionSidebarRowMap();
                    row = sectionToSidebarRowMap.get(sectionId);
                }
                if (!row) {
                    return;
                }
                clearScrollLinkedSidebarState();
                if (typeof row.click === 'function') {
                    row.click();
                }
                if (typeof row.scrollIntoView === 'function') {
                    row.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
                }
                activeSectionId = sectionId;
            }
            function bindScrollSync() {
                if (scrollSyncBound) {
                    return;
                }
                var content = root.querySelector('.playground-content');
                if (!content) {
                    return;
                }
                scrollSyncBound = true;
                var ticking = false;
                var onScroll = function () {
                    if (ticking) {
                        return;
                    }
                    ticking = true;
                    requestAnimationFrame(function () {
                        ticking = false;
                        syncSidebarForSection(getCurrentVisibleSectionId());
                    });
                };
                content.addEventListener('scroll', onScroll, { passive: true });
                window.addEventListener('scroll', onScroll, { passive: true });
                setTimeout(onScroll, 250);
            }
            function schedulePatch() {
                if (rafScheduled) {
                    return;
                }
                rafScheduled = true;
                requestAnimationFrame(function () {
                    rafScheduled = false;
                    patch();
                });
            }
            var obs = new MutationObserver(schedulePatch);
            obs.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
            root.addEventListener('click', function (e) {
                var sidebar = root.querySelector('.playground-sidebar');
                if (!sidebar) {
                    return;
                }
                var target = e && e.target;
                if (!target || !target.closest) {
                    return;
                }
                var row = target.closest('div[style*="padding-left"]');
                if (!row || !sidebar.contains(row)) {
                    return;
                }
                sectionToSidebarRowMap = null;
                if (row.querySelector('.method-badge')) {
                    return;
                }
                var content = root.querySelector('.playground-content');
                var contentScrollTop = content ? content.scrollTop : 0;
                var pageScrollX = window.scrollX || window.pageXOffset || 0;
                var pageScrollY = window.scrollY || window.pageYOffset || 0;
                setTimeout(function () {
                    if (content) {
                        content.scrollTop = contentScrollTop;
                    }
                    if (typeof window.scrollTo === 'function') {
                        window.scrollTo(pageScrollX, pageScrollY);
                    }
                }, 0);
            }, true);
            schedulePatch();
            setTimeout(patch, 50);
            setTimeout(patch, 400);
            setTimeout(patch, 1200);
        })();
    </script>
</body>
</html>`;

const CollectionNotFound = ({ onClose }) => (
  <Modal size="md" title="Generate Documentation" confirmText="Close" handleConfirm={onClose} hideCancel>
    <StyledWrapper className="w-[500px]">
      <div className="flex items-center gap-2 text-warning">
        <IconAlertTriangle size={16} className="shrink-0" />
        <span>Collection not found. It may have been deleted or is no longer available.</span>
      </div>
    </StyledWrapper>
  </Modal>
);

const GenerateDocumentation = ({ onClose, collectionUid }) => {
  const { version } = useApp();
  const collection = useSelector((state) =>
    findCollectionByUid(state.collections.collections, collectionUid)
  );

  const isLoading = useMemo(
    () => (collection ? areItemsLoading(collection) : false),
    [collection]
  );

  const handleGenerate = useCallback(() => {
    try {
      const collectionCopy = cloneDeep(collection);
      const transformedCollection = transformCollectionToSaveToExportAsFile(collectionCopy);
      const openCollection = brunoToOpenCollection(transformedCollection);

      const docHttpLeafNames = [];
      normalizeDocPagesForHostedDocsViewer(openCollection.items || [], docHttpLeafNames);

      upgradeMarkdownDocsToHtmlForHostedExport(openCollection, collection.pathname || '');

      openCollection.extensions = {
        ...openCollection.extensions,
        bruno: {
          ...openCollection.extensions?.bruno,
          exportedAt: new Date().toISOString(),
          exportedUsing: version ? `Bruno/${version}` : 'Bruno'
        }
      };

      const yamlContent = jsyaml.dump(openCollection, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
        sortKeys: false
      });

      // jsesc handles all edge cases: Unicode, special chars, quotes, template literals, etc.
      let escapedYaml = jsesc(yamlContent, { quotes: 'double', wrap: true });

      // Escape closing tags to prevent HTML parser from breaking out of the script block
      escapedYaml = escapedYaml.replace(/<\//g, '<\\/');

      const htmlContent = buildHtmlDocument(
        escapeHtml(collection.name),
        escapedYaml,
        encodeUtf8JsonForHtmlScript(docHttpLeafNames)
      );

      const fileName = `${sanitizeName(collection.name)}-documentation.html`;
      FileSaver.saveAs(new Blob([htmlContent], { type: 'text/html' }), fileName);

      toast.success('Documentation generated successfully');
      onClose();
    } catch (error) {
      console.error('Error generating documentation:', error);
      toast.error('Failed to generate documentation');
    }
  }, [collection, version, onClose]);

  if (!collection) {
    return <CollectionNotFound onClose={onClose} />;
  }

  return (
    <Modal
      size="md"
      title="Generate Documentation"
      confirmText={isLoading ? 'Loading...' : 'Generate'}
      cancelText="Cancel"
      handleConfirm={isLoading ? undefined : handleGenerate}
      handleCancel={onClose}
      confirmDisabled={isLoading}
    >
      <StyledWrapper className="w-[500px]">
        {isLoading ? (
          <div className="flex items-center justify-center gap-3 py-8">
            <IconLoader2 size={20} className="animate-spin" />
            <span>Loading collection...</span>
          </div>
        ) : (
          <div className="content">
            <h3 className="title flex items-center gap-2 mt-2 font-medium">
              <IconBook size={18} />
              <span>Interactive API Documentation</span>
            </h3>
            <p className="description mb-4">
              Generate a standalone HTML file that can be hosted anywhere or shared with your team.
            </p>

            <div className="preview-container relative mb-4">
              <span className="preview-label absolute">Sample Output</span>
              <img src={demoImage} alt="Documentation preview" className="preview-image" />
            </div>

            <ul className="features flex flex-col list-none gap-2 p-0 mb-4">
              {FEATURES.map((feature) => (
                <li key={feature} className="flex items-center gap-2.5">
                  <IconCheck size={16} className="check-icon flex-shrink-0" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>

            <p className="note m-0">
              The generated file loads OpenCollection's JavaScript and CSS files from a CDN, which requires an internet connection.
            </p>
          </div>
        )}
      </StyledWrapper>
    </Modal>
  );
};

export default GenerateDocumentation;

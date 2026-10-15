/**
 * Browser half of the file-download bundle.
 *
 * Adds one compact Download control wherever the interface already shows a file
 * the conversation produced: a delivered-file card, the turn's change review,
 * and the right Sidebar's file preview (previewable or not). Each control
 * preflights its Host route with `HEAD` and then hands the `GET` to the
 * browser's own download manager, so nothing is buffered in the page.
 *
 * @module @local/dsh-file-download/client
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-file-download',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;

    /** Document-relative form of the Host's `/api/file.download` route. */
    const DOWNLOAD_ROUTE = 'api/file.download';

    /** Locale namespace owned by this plugin. */
    const NS = 'file-download';

    /** Simplified-Chinese copy. */
    const zh = {
      'action.download': '下载文件',
      'action.failed': '下载失败',
    };

    /** English copy. */
    const en = {
      'action.download': 'Download file',
      'action.failed': 'Download failed',
    };

    /** The compact icon-button styling the host uses for the same slot. */
    const CSS =
      '.dsh-fdd_action{box-sizing:border-box;flex:none;display:inline-flex;align-items:center;' +
      'justify-content:center;width:28px;height:28px;padding:6px;border:0;border-radius:var(--dsw-radius-sm);' +
      'background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit}' +
      '.dsh-fdd_action svg{display:block;width:15px;height:15px}' +
      '.dsh-fdd_action:hover:not(:disabled){color:var(--dsw-alias-label-primary);' +
      'background:var(--dsw-alias-interactive-bg-hover)}' +
      '.dsh-fdd_action:disabled{cursor:progress}' +
      '.dsh-fdd_action[data-state="failed"]{color:var(--dsw-alias-state-error-primary)}';

    /** The download glyph: an arrow into a tray, drawn in the control's own colour. */
    const ICON = h(
      'svg',
      { viewBox: '0 0 16 16', 'aria-hidden': true, focusable: 'false' },
      h('path', { d: 'M7 1h2v5.6l2.3-2.3 1.4 1.4L8 10.4 3.3 5.7l1.4-1.4L7 6.6V1z', fill: 'currentColor' }),
      h('path', { d: 'M2 12h12v2H2z', fill: 'currentColor' }),
    );

    /** Insert this plugin's stylesheet once, tagged so the module system owns it. */
    function insertStyles() {
      if (typeof document === 'undefined') return;
      const tagId = '@local/dsh-file-download/client.css';
      if (document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') !== null) return;
      const tag = document.createElement('style');
      tag.dataset.plugin = '@local/dsh-file-download';
      tag.dataset.pluginCss = tagId;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    /** Build the route for one set of file coordinates. */
    function downloadUrl(params) {
      const search = new URLSearchParams();
      for (const key of Object.keys(params)) {
        const value = params[key];
        if (value === undefined || value === null || value === '') continue;
        search.set(key, String(value));
      }
      return DOWNLOAD_ROUTE + '?' + search.toString();
    }

    /**
     * Re-address an existing authorized file action as a download.
     *
     * The record kind comes from the action's own route, never from the slot it
     * was rendered into: a delivered file is recorded by `present`, a changed
     * file by the turn's change summary, and only the route knows which.
     *
     * @param actionUrl - the delivered or changed file's own authorized route.
     * @param fallbackFrom - record kind to assume for an unrecognized route.
     * @returns the download route, or null when the route carries no coordinates.
     */
    function coordinatesUrl(actionUrl, fallbackFrom) {
      if (typeof actionUrl !== 'string' || actionUrl.length === 0) return null;
      try {
        const parsed = new URL(actionUrl, window.location.href);
        const sessionId = parsed.searchParams.get('sessionId');
        const seq = parsed.searchParams.get('seq');
        const index = parsed.searchParams.get('index');
        if (sessionId === null || seq === null || index === null) return null;
        const path = parsed.pathname;
        const from = path.endsWith('changes.open')
          ? 'changes'
          : path.endsWith('present.open')
            ? 'present'
            : fallbackFrom;
        return downloadUrl({ sessionId, seq, index, from });
      } catch (error) {
        return null;
      }
    }

    /** Hand one route to the browser download manager without loading it in the page. */
    function startDownload(url) {
      const link = document.createElement('a');
      link.href = url;
      link.rel = 'noopener';
      link.download = '';
      document.body.appendChild(link);
      link.click();
      link.remove();
    }

    /**
     * One compact Download control.
     * @param props - the resolved route and this entry's translate function.
     */
    function DownloadControl(props) {
      const { url, t } = props;
      const [state, setState] = React.useState('idle');
      const resetTimer = React.useRef(0);
      React.useEffect(
        () => () => {
          if (resetTimer.current !== 0) window.clearTimeout(resetTimer.current);
        },
        [],
      );
      if (url === null) return null;
      const label = state === 'failed' ? t('action.failed') : t('action.download');
      return h(
        'button',
        {
          type: 'button',
          className: 'dsh-fdd_action',
          'data-state': state,
          title: label,
          'aria-label': label,
          disabled: state === 'checking',
          onClick: (event) => {
            event.preventDefault();
            if (state === 'checking') return;
            setState('checking');
            fetch(url, { method: 'HEAD', credentials: 'same-origin', cache: 'no-store' })
              .then((response) => {
                if (!response.ok) throw new Error(String(response.status));
                setState('idle');
                startDownload(url);
              })
              .catch(() => {
                setState('failed');
                resetTimer.current = window.setTimeout(() => setState('idle'), 6000);
              });
          },
        },
        ICON,
      );
    }

    /** Download one file the turn delivered or changed, from the card or the review tab. */
    function RouteFileDownload(props) {
      return h(DownloadControl, { url: coordinatesUrl(props.actionUrl, 'present'), t: props.t });
    }

    /** Download the file a Sidebar preview is showing, previewable or not. */
    function PreviewedFileDownload(props) {
      const url =
        typeof props.absolutePath === 'string' && props.absolutePath.length > 0
          ? downloadUrl({ path: props.absolutePath, from: 'path' })
          : null;
      return h(DownloadControl, { url, t: props.t });
    }

    return {
      inject: ['slots', 'locale'],
      /**
       * Register the dictionaries and one Download control per file surface.
       * @param ctx - browser context carrying slots and the locale service.
       */
      apply(ctx) {
        insertStyles();
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'file-download: dictionaries');
        ctx.slots.inject('deliverables.file.actions', () =>
          ctx.slots.register(
            { name: 'deliverables.file.actions', id: 'file-download', order: 10, locale: NS },
            RouteFileDownload,
          ),
        );
        ctx.slots.inject('deliverables.review.file.actions', () =>
          ctx.slots.register(
            { name: 'deliverables.review.file.actions', id: 'file-download', order: 10, locale: NS },
            RouteFileDownload,
          ),
        );
        ctx.slots.inject('sidebar.right.tab.document.actions', () =>
          ctx.slots.register(
            { name: 'sidebar.right.tab.document.actions', id: 'file-download', order: 10, locale: NS },
            PreviewedFileDownload,
          ),
        );
        ctx.slots.inject('sidebar.right.tab.document.unpreviewable', () =>
          ctx.slots.register(
            {
              name: 'sidebar.right.tab.document.unpreviewable',
              id: 'file-download',
              order: 10,
              locale: NS,
            },
            PreviewedFileDownload,
          ),
        );
      },
    };
  },
});
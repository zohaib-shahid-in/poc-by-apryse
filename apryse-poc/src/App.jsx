import { useRef, useEffect, useState } from 'react';
import WebViewer from '@pdftron/webviewer';

import './App.css';

const SUPPORTED_EXTENSIONS = new Set(['pdf', 'docx', 'xlsx', 'xls', 'pptx', 'ppt']);
const SUPPORTED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
]);
const MIME_TO_EXTENSION = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.ms-powerpoint': 'ppt',
};
const WEBVIEWER_PATH = '/lib/webviewer';

const getFileExtension = (filename = '') => {
  const parts = filename.toLowerCase().split('.');
  return parts.length > 1 ? parts.pop() : '';
};

const getResolvedExtension = (file) => {
  const ext = getFileExtension(file?.name || '');
  if (ext) return ext;
  const mime = (file?.type || '').toLowerCase();
  return MIME_TO_EXTENSION[mime] || '';
};

const triggerDownload = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'document.pdf';
  a.click();
  URL.revokeObjectURL(url);
};

const parseXfdfAnnotations = (xfdfString) => {
  if (!xfdfString || !xfdfString.trim()) return [];
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xfdfString, 'text/xml');
    const annots = doc.querySelectorAll('annots > *');
    return Array.from(annots).map((el) => {
      const page = el.getAttribute('page') || '';
      const type = el.tagName?.toLowerCase() || 'unknown';
      const contents = el.querySelector('contents')?.textContent?.trim() || '';
      const id = el.getAttribute('id') || el.getAttribute('name') || '';
      return { page, type, contents, id };
    });
  } catch {
    return [];
  }
};

const compareAnnotations = (annotsA, annotsB) => {
  const key = (a) => `${a.page}|${a.type}|${(a.contents || '').slice(0, 50)}`;
  const mapA = new Map(annotsA.map((a) => [key(a), a]));
  const mapB = new Map(annotsB.map((a) => [key(a), a]));
  const onlyInA = annotsA.filter((a) => !mapB.has(key(a)));
  const onlyInB = annotsB.filter((a) => !mapA.has(key(a)));
  const inBoth = annotsA.filter((a) => mapB.has(key(a)));
  return { onlyInA, onlyInB, inBoth };
};

const setupViewerUI = async (instance) => {
  const { UI } = instance;

  // WebViewer versions expose readiness differently.
  if (UI?.initializedPromise && typeof UI.initializedPromise.then === 'function') {
    await UI.initializedPromise;
  } else {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  UI?.openElements?.(['notesPanel']);
  if (UI?.Feature?.MultiViewerMode) {
    UI.enableFeatures?.([UI.Feature.MultiViewerMode]);
  }
};

function App() {
  const viewer = useRef(null);
  const instanceRef = useRef(null);
  const fileInputRef = useRef(null);
  const compareFileARef = useRef(null);
  const compareFileBRef = useRef(null);
  const activeViewObjectUrlRef = useRef(null);
  const compareObjectUrlsRef = useRef([]);
  const [mode, setMode] = useState('view');
  const [isViewerReady, setIsViewerReady] = useState(false);
  const [isDocumentLoading, setIsDocumentLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [compareFileA, setCompareFileA] = useState(null);
  const [compareFileB, setCompareFileB] = useState(null);
  const [isComparing, setIsComparing] = useState(false);
  const [compareStatus, setCompareStatus] = useState('');
  const [annotationDiff, setAnnotationDiff] = useState(null);
  const [showAnnotationPanel, setShowAnnotationPanel] = useState(false);

  useEffect(() => {
    if (!viewer.current || instanceRef.current) return;
    let isDisposed = false;

    WebViewer(
      {
        path: WEBVIEWER_PATH,
        licenseKey:
          '1771159100768:609e95810300000000716850aaa6765e61788301c95176a2e1ff98cbd6',
        initialDoc: 'https://pdftron.s3.amazonaws.com/downloads/pl/demo-annotated.pdf',
        fullAPI: true,
        isReadOnly: false,
        enableFilePicker: true,
      },
      viewer.current
    )
      .then(async (instance) => {
        if (isDisposed) return;
        instanceRef.current = instance;
        try {
          await setupViewerUI(instance);
          if (!isDisposed) setIsViewerReady(true);
        } catch (error) {
          console.error('Viewer initialization failed:', error);
        }
      })
      .catch((error) => {
        console.error('WebViewer bootstrap failed:', error);
      });

    return () => {
      isDisposed = true;
      if (activeViewObjectUrlRef.current) {
        URL.revokeObjectURL(activeViewObjectUrlRef.current);
        activeViewObjectUrlRef.current = null;
      }
      compareObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      compareObjectUrlsRef.current = [];
      instanceRef.current?.Core?.documentViewer?.closeDocument?.();
      instanceRef.current = null;
    };
  }, []);

  const buildDocId = (file) =>
    `${file.name}__${file.size}_${file.lastModified}`.replace(/\s+/g, '_');

  const loadLocalDocument = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const extension = getFileExtension(file.name);
    const fileType = (file.type || '').toLowerCase();
    const isSupportedByExt = SUPPORTED_EXTENSIONS.has(extension);
    const isSupportedByType = SUPPORTED_MIME_TYPES.has(fileType);
    if (!isSupportedByExt && !isSupportedByType) {
      alert('Please select a valid PDF, DOCX, XLSX/XLS, or PPTX/PPT file.');
      e.target.value = '';
      return;
    }
    const resolvedExtension = extension || MIME_TO_EXTENSION[fileType];

    const instance = instanceRef.current;
    if (!instance || !isViewerReady) {
      console.warn('Viewer not ready yet, ignoring file selection.');
      e.target.value = '';
      return;
    }

    if (mode === 'compare') {
      instance.UI.exitMultiViewerMode?.();
      setMode('view');
    }

    setIsDocumentLoading(true);
    const docId = buildDocId(file);
    try {
      instance.Core.documentViewer.closeDocument();
      if (activeViewObjectUrlRef.current) {
        URL.revokeObjectURL(activeViewObjectUrlRef.current);
        activeViewObjectUrlRef.current = null;
      }

      const objectUrl = URL.createObjectURL(file);
      activeViewObjectUrlRef.current = objectUrl;

      await instance.UI.loadDocument(objectUrl, {
        filename: `${docId}.${resolvedExtension}`,
        extension: resolvedExtension,
      });
    } catch (firstError) {
      console.error('Local file load failed:', { firstError });
      alert('File load nahi ho saki.');
    } finally {
      e.target.value = '';
      setIsDocumentLoading(false);
    }
  };

  const handleCompareFileSelect = (side, e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = getFileExtension(file.name);
    const mime = (file.type || '').toLowerCase();
    const ok = SUPPORTED_EXTENSIONS.has(ext) || SUPPORTED_MIME_TYPES.has(mime);
    if (!ok) {
      alert('Please select a valid PDF, DOCX, XLSX/XLS, or PPTX/PPT file.');
      return;
    }
    if (side === 'A') setCompareFileA(file);
    else setCompareFileB(file);
    setCompareStatus('');
    setAnnotationDiff(null);
    setShowAnnotationPanel(false);
    e.target.value = '';
  };

  const runDocumentComparison = async () => {
    if (!instanceRef.current || !compareFileA || !compareFileB) {
      alert('Please select both Document A and Document B.');
      return;
    }

    const instance = instanceRef.current;
    const { UI, Core } = instance;

    setIsComparing(true);
    setCompareStatus('Preparing compare view...');
    setAnnotationDiff(null);
    setShowAnnotationPanel(false);

    try {
      if (!UI.enterMultiViewerMode) {
        alert('Multi-viewer mode not available. Ensure fullAPI and Compare package are enabled.');
        return;
      }

      UI.enterMultiViewerMode();

      const waitForMultiViewer = () =>
        new Promise((resolve, reject) => {
          const startedAt = Date.now();
          const timeoutMs = 8000;
          const check = () => {
            if ((Core.getDocumentViewers?.() || []).length >= 2) {
              resolve();
              return;
            }
            if (Date.now() - startedAt > timeoutMs) {
              reject(new Error('Compare viewer initialization timeout.'));
              return;
            }
            setTimeout(check, 150);
          };
          check();
        });

      await waitForMultiViewer();

      const viewers = Core.getDocumentViewers?.() || [];
      if (viewers.length < 2) {
        alert('Could not initialize compare view. Please try again.');
        return;
      }

      const [docViewer1, docViewer2] = viewers;
      const waitForPages = (dv) =>
        new Promise((resolve, reject) => {
          const startedAt = Date.now();
          const timeoutMs = 20000;
          const check = () => {
            const doc = dv.getDocument?.();
            const pages = doc?.getPageCount?.() || 0;
            if (pages > 0) {
              resolve(pages);
              return;
            }
            if (Date.now() - startedAt > timeoutMs) {
              reject(new Error('Document loaded but readable pages are not ready.'));
              return;
            }
            setTimeout(check, 150);
          };
          check();
        });

      const loadDoc = (dv, file, label) => {
        const url = URL.createObjectURL(file);
        compareObjectUrlsRef.current.push(url);
        const extension = getResolvedExtension(file);

        return new Promise((resolve, reject) => {
          const cleanup = () => {
            dv.removeEventListener('documentLoaded', onLoaded);
            dv.removeEventListener('documentLoadFailed', onFailed);
          };

          const onLoaded = () => {
            waitForPages(dv)
              .then((pages) => {
                cleanup();
                resolve({ pages, extension });
              })
              .catch((err) => {
                cleanup();
                reject(new Error(`${label}: ${err.message}`));
              });
          };

          const onFailed = (err) => {
            cleanup();
            reject(err || new Error(`${label}: documentLoadFailed`));
          };

          dv.addEventListener('documentLoaded', onLoaded);
          dv.addEventListener('documentLoadFailed', onFailed);

          if (dv.loadDocument) {
            dv
              .loadDocument(url, { filename: file.name, extension })
              .catch((err) => onFailed(err));
          } else {
            UI.loadDocument?.(url, { filename: file.name, extension }).catch((err) => onFailed(err));
          }
        });
      };

      UI.openElements?.('comparePanel');
      setCompareStatus('Loading Document A and Document B...');

      const [metaA, metaB] = await Promise.all([
        loadDoc(docViewer1, compareFileA, 'Document A'),
        loadDoc(docViewer2, compareFileB, 'Document B'),
      ]);

      setCompareStatus(`Loaded: A (${metaA.pages} pages), B (${metaB.pages} pages)`);

      const isPdfPair = metaA.extension === 'pdf' && metaB.extension === 'pdf';
      const isExcelPair =
        ['xlsx', 'xls'].includes(metaA.extension) &&
        ['xlsx', 'xls'].includes(metaB.extension);
      const canRunSemanticDiff =
        isPdfPair && typeof docViewer1.startSemanticDiff === 'function';

      if (canRunSemanticDiff) {
        setCompareStatus('Running semantic comparison...');
        try {
          await docViewer1.startSemanticDiff(docViewer2);
          setCompareStatus('PDF comparison completed successfully.');
        } catch (semanticErr) {
          console.warn('Semantic diff failed. Keeping side-by-side compare active.', semanticErr);
          setCompareStatus('Files loaded side-by-side. Semantic diff failed in current build.');
        }
      } else if (isExcelPair) {
        setCompareStatus('Excel files loaded side-by-side for comparison.');
      } else {
        setCompareStatus(
          `Documents loaded. Semantic diff skipped for ${metaA.extension || 'unknown'} vs ${metaB.extension || 'unknown'}.`
        );
      }
      setMode('compare');
    } catch (err) {
      console.error('Compare failed:', err);
      setCompareStatus('Compare failed.');
      alert('Comparison failed: ' + (err?.message || 'Unknown error'));
    } finally {
      setIsComparing(false);
    }
  };

  const runAnnotationComparison = async () => {
    const instance = instanceRef.current;
    if (!instance || mode !== 'compare') return;

    const viewers = instance.Core.getDocumentViewers?.() || [];
    if (viewers.length < 2) {
      alert('Load both documents first using Compare Documents.');
      return;
    }

    try {
      const [dv1, dv2] = viewers;
      const am1 = dv1.getAnnotationManager?.();
      const am2 = dv2.getAnnotationManager?.();

      if (!am1 || !am2) {
        alert('Annotation managers not ready.');
        return;
      }

      const [xfdf1, xfdf2] = await Promise.all([
        am1.exportAnnotations({ links: false, widgets: false }),
        am2.exportAnnotations({ links: false, widgets: false }),
      ]);

      const annotsA = parseXfdfAnnotations(xfdf1);
      const annotsB = parseXfdfAnnotations(xfdf2);
      const diff = compareAnnotations(annotsA, annotsB);

      setAnnotationDiff({
        ...diff,
        nameA: compareFileA?.name || 'Document A',
        nameB: compareFileB?.name || 'Document B',
        countA: annotsA.length,
        countB: annotsB.length,
      });
      setShowAnnotationPanel(true);
    } catch (err) {
      console.error('Annotation compare failed:', err);
      alert('Annotation comparison failed.');
    }
  };

  const exitCompareMode = () => {
    const instance = instanceRef.current;
    if (instance?.UI?.exitMultiViewerMode) {
      instance.UI.exitMultiViewerMode();
    }
    setMode('view');
    setCompareFileA(null);
    setCompareFileB(null);
    setAnnotationDiff(null);
    setShowAnnotationPanel(false);
    setCompareStatus('');
    compareObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    compareObjectUrlsRef.current = [];
  };

  const triggerFileSelect = () => {
    if (!isDocumentLoading && fileInputRef.current) fileInputRef.current.click();
  };

  const savePdfWithAnnotations = async () => {
    if (!instanceRef.current) return;
    const { documentViewer, annotationManager } = instanceRef.current.Core;
    const doc = documentViewer.getDocument();
    if (!doc) {
      alert('No document loaded.');
      return;
    }

    setIsSaving(true);
    try {
      const xfdfString = await annotationManager.exportAnnotations({
        links: false,
        widgets: false,
      });
      const data = await doc.getFileData({ xfdfString });
      const arr = new Uint8Array(data);
      const blob = new Blob([arr], { type: 'application/pdf' });
      const rawFilename = doc.getFilename() || 'document';
      const baseName = rawFilename.replace(/\.[^.]+$/, '') || 'document';
      const filename = baseName.endsWith('.pdf') ? baseName : `${baseName}.pdf`;
      triggerDownload(blob, filename);
      alert('PDF saved with annotations embedded!');
    } catch (err) {
      console.error('Save failed:', err);
      alert('Save nahi ho saka: ' + (err?.message || 'Unknown error'));
    } finally {
      setIsSaving(false);
    }
  };

  const fileAccept =
    '.pdf,.docx,.xlsx,.xls,.pptx,.ppt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-powerpoint';

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Document Viewer - Apryse WebViewer</h1>
        <div className="header-actions">
          <div className="mode-tabs">
            <button
              type="button"
              className={`mode-tab ${mode === 'view' ? 'active' : ''}`}
              onClick={() => mode === 'compare' && exitCompareMode()}
            >
              View
            </button>
            <button
              type="button"
              className={`mode-tab ${mode === 'compare' ? 'active' : ''}`}
              onClick={() => mode === 'view' && setMode('compare')}
            >
              Compare
            </button>
          </div>

          {mode === 'view' && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept={fileAccept}
                onChange={loadLocalDocument}
                style={{ display: 'none' }}
              />
              <button
                type="button"
                className="upload-btn"
                onClick={triggerFileSelect}
                disabled={isDocumentLoading}
              >
                {isDocumentLoading ? 'Loading...' : 'Open Local File'}
              </button>
              <button
                type="button"
                className="save-btn"
                onClick={savePdfWithAnnotations}
                disabled={!isViewerReady || isSaving}
              >
                {isSaving ? 'Saving...' : 'Save PDF with Annotations'}
              </button>
            </>
          )}

          {mode === 'compare' && (
            <>
              <div className="compare-inputs">
                <div className="compare-file">
                  <input
                    ref={compareFileARef}
                    type="file"
                    accept={fileAccept}
                    onChange={(e) => handleCompareFileSelect('A', e)}
                    style={{ display: 'none' }}
                  />
                  <button
                    type="button"
                    className="compare-file-btn"
                    onClick={() => compareFileARef.current?.click()}
                  >
                    {compareFileA ? compareFileA.name : 'Document A'}
                  </button>
                </div>
                <span className="compare-vs">vs</span>
                <div className="compare-file">
                  <input
                    ref={compareFileBRef}
                    type="file"
                    accept={fileAccept}
                    onChange={(e) => handleCompareFileSelect('B', e)}
                    style={{ display: 'none' }}
                  />
                  <button
                    type="button"
                    className="compare-file-btn"
                    onClick={() => compareFileBRef.current?.click()}
                  >
                    {compareFileB ? compareFileB.name : 'Document B'}
                  </button>
                </div>
              </div>
              <button
                type="button"
                className="compare-docs-btn"
                onClick={runDocumentComparison}
                disabled={!compareFileA || !compareFileB || isComparing}
              >
                {isComparing ? 'Comparing...' : 'Compare Documents'}
              </button>
              <button
                type="button"
                className="compare-annots-btn"
                onClick={runAnnotationComparison}
                disabled={isComparing}
              >
                Compare Comments
              </button>
              <button type="button" className="exit-compare-btn" onClick={exitCompareMode}>
                Exit Compare
              </button>
              {compareStatus && <span className="compare-status">{compareStatus}</span>}
            </>
          )}
        </div>
      </header>

      {showAnnotationPanel && annotationDiff && (
        <div className="annotation-diff-panel">
          <div className="annotation-diff-header">
            <h3>Annotation Comparison</h3>
            <button
              type="button"
              className="close-panel-btn"
              onClick={() => setShowAnnotationPanel(false)}
            >
              ×
            </button>
          </div>
          <div className="annotation-diff-content">
            <div className="diff-summary">
              <span>{annotationDiff.nameA}: {annotationDiff.countA} comments</span>
              <span>{annotationDiff.nameB}: {annotationDiff.countB} comments</span>
              <span>Only in A: {annotationDiff.onlyInA.length}</span>
              <span>Only in B: {annotationDiff.onlyInB.length}</span>
              <span>In both: {annotationDiff.inBoth.length}</span>
            </div>
            <div className="diff-lists">
              <div className="diff-list">
                <h4>Only in {annotationDiff.nameA}</h4>
                <ul>
                  {annotationDiff.onlyInA.map((a, i) => (
                    <li key={i}>
                      Page {a.page} | {a.type}: {(a.contents || '').slice(0, 60)}
                      {a.contents?.length > 60 ? '...' : ''}
                    </li>
                  ))}
                  {annotationDiff.onlyInA.length === 0 && <li className="muted">None</li>}
                </ul>
              </div>
              <div className="diff-list">
                <h4>Only in {annotationDiff.nameB}</h4>
                <ul>
                  {annotationDiff.onlyInB.map((a, i) => (
                    <li key={i}>
                      Page {a.page} | {a.type}: {(a.contents || '').slice(0, 60)}
                      {a.contents?.length > 60 ? '...' : ''}
                    </li>
                  ))}
                  {annotationDiff.onlyInB.length === 0 && <li className="muted">None</li>}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="webviewer" ref={viewer} />
    </div>
  );
}

export default App;

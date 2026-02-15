import { useRef, useEffect, useState } from 'react';
import WebViewer from '@pdftron/webviewer';

import './App.css';

const STORAGE_KEY_PREFIX = 'webviewer_annotations_';
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
const WEBVIEWER_PATH = '/webviewer-lib';

const safeSetLocalStorage = (key, value) => {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    // If quota is exceeded, clear only viewer keys and retry once.
    if (error?.name === 'QuotaExceededError' || error?.code === 22) {
      Object.keys(localStorage)
        .filter((itemKey) => itemKey.startsWith(STORAGE_KEY_PREFIX))
        .forEach((itemKey) => localStorage.removeItem(itemKey));
      try {
        localStorage.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
};

const getFileExtension = (filename = '') => {
  const parts = filename.toLowerCase().split('.');
  return parts.length > 1 ? parts.pop() : '';
};
const isValidXfdf = (value) => {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const parsed = new DOMParser().parseFromString(trimmed, 'application/xml');
    return !parsed.querySelector('parsererror');
  } catch {
    return false;
  }
};

function App() {
  const viewer = useRef(null);
  const instanceRef = useRef(null);
  const fileInputRef = useRef(null);
  const [isViewerReady, setIsViewerReady] = useState(false);
  const [isDocumentLoading, setIsDocumentLoading] = useState(false);

  useEffect(() => {
    if (!viewer.current) return;

    WebViewer(
      {
        path: WEBVIEWER_PATH,
        licenseKey:
          'demo:1771159100768:609e95810300000000716850aaa6765e61788301c95176a2e1ff98cbd6',
        initialDoc: 'https://pdftron.s3.amazonaws.com/downloads/pl/demo-annotated.pdf',
        fullAPI: true,
        isReadOnly: false,
        enableFilePicker: true,
      },
      viewer.current
    ).then((instance) => {
      instanceRef.current = instance;
      const { documentViewer, annotationManager } = instance.Core;

      documentViewer.addEventListener('documentLoadFailed', (error) => {
        console.error('Document load failed:', error);
      });

      // Load annotations from localStorage when document loads
      documentViewer.setDocumentXFDFRetriever(async () => {
        const doc = documentViewer.getDocument();
        if (!doc) return '';
        const filename = doc.getFilename() || 'default';
        const storageKey = `${STORAGE_KEY_PREFIX}${filename}`;
        const savedXfdf = localStorage.getItem(storageKey);
        if (isValidXfdf(savedXfdf)) return savedXfdf;
        if (savedXfdf) localStorage.removeItem(storageKey);
        return '';
      });

      // Save annotations to localStorage when they change
      annotationManager.addEventListener(
        'annotationChanged',
        async (annotations, action, { imported }) => {
          if (imported) return;
          const doc = documentViewer.getDocument();
          if (!doc) return;
          const filename = doc.getFilename() || 'default';
          const xfdfString = await annotationManager.exportAnnotations({
            links: false,
            widgets: false,
          });
          const storageKey = `${STORAGE_KEY_PREFIX}${filename}`;
          safeSetLocalStorage(storageKey, xfdfString);
        }
      );

      // Open Comments panel by default
      instance.UI.ready(() => {
        instance.UI.openElements(['notesPanel']);
        setIsViewerReady(true);
      });
    });
  }, []);

  const buildDocId = (file) =>
    `${file.name}__${file.size}_${file.lastModified}`.replace(/\s+/g, '_');

  const loadLocalDocument = async (e) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

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
    if (!instance) {
      alert('Viewer abhi ready nahi hua. Thoda wait karke dobara try karein.');
      e.target.value = '';
      return;
    }

    setIsDocumentLoading(true);
    const docId = buildDocId(file);
    try {
      instance.Core.documentViewer.closeDocument();
      await instance.UI.loadDocument(file, {
        filename: `${docId}.${resolvedExtension}`,
        extension: resolvedExtension,
      });
    } catch (firstError) {
      let objectUrl;
      try {
        instance.Core.documentViewer.closeDocument();
        objectUrl = URL.createObjectURL(file);
        await instance.UI.loadDocument(objectUrl, {
          filename: `${docId}.${resolvedExtension}`,
          extension: resolvedExtension,
        });
      } catch (secondError) {
        console.error('Local file load failed:', {
          firstError,
          secondError,
        });
        alert('File load nahi ho saki. Console me error details check karein.');
      } finally {
        if (objectUrl) {
          setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
        }
      }
    } finally {
      e.target.value = '';
      setIsDocumentLoading(false);
    }
  };

  const triggerFileSelect = () => {
    if (!isDocumentLoading && fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const saveAnnotations = async () => {
    if (!instanceRef.current) return;
    const { documentViewer, annotationManager } = instanceRef.current.Core;
    const doc = documentViewer.getDocument();
    if (!doc) return;
    const xfdfString = await annotationManager.exportAnnotations({
      links: false,
      widgets: false,
    });
    const filename = doc.getFilename() || 'document';
    const storageKey = `${STORAGE_KEY_PREFIX}${filename}`;
    const saved = safeSetLocalStorage(storageKey, xfdfString);
    alert(saved ? 'Comments saved locally!' : 'Storage full. Old local comments were cleared.');
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Document Viewer - Apryse WebViewer</h1>
        <div className="header-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.xlsx,.xls,.pptx,.ppt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-powerpoint"
            onChange={loadLocalDocument}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            className="upload-btn"
            onClick={triggerFileSelect}
            disabled={isDocumentLoading}
          >
            {isDocumentLoading ? 'Loading File...' : 'Open Local File'}
          </button>
          <button
            type="button"
            className="save-btn"
            onClick={saveAnnotations}
            disabled={!isViewerReady}
          >
            Save Comments
          </button>
        </div>
      </header>
      <div className="webviewer" ref={viewer} />
    </div>
  );
}

export default App;

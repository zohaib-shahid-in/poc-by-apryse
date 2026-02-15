import { useRef, useEffect, useState } from 'react';
import WebViewer from '@pdftron/webviewer';

import './App.css';

const STORAGE_KEY_PREFIX = 'webviewer_annotations_';
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
        path: '/lib/webviewer',
        licenseKey:
          '1771159100768:609e95810300000000716850aaa6765e61788301c95176a2e1ff98cbd6',
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
          localStorage.setItem(storageKey, xfdfString);
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

  const loadLocalPdf = async (e) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

    const isPdfByType = (file.type || '').toLowerCase() === 'application/pdf';
    const isPdfByName = file.name?.toLowerCase().endsWith('.pdf');
    if (!isPdfByType && !isPdfByName) {
      alert('Please select a valid PDF file.');
      e.target.value = '';
      return;
    }

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
      const bytes = new Uint8Array(await file.arrayBuffer());
      await instance.UI.loadDocument(bytes, {
        filename: docId,
        extension: 'pdf',
      });
    } catch (firstError) {
      let objectUrl;
      try {
        instance.Core.documentViewer.closeDocument();
        objectUrl = URL.createObjectURL(file);
        await instance.UI.loadDocument(objectUrl, {
          filename: docId,
          extension: 'pdf',
        });
      } catch (secondError) {
        console.error('Local PDF load failed:', {
          firstError,
          secondError,
        });
        alert('PDF load nahi ho saki. Console me error details check karein.');
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
    localStorage.setItem(storageKey, xfdfString);
    alert('Comments saved locally!');
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>PDF Viewer - Apryse WebViewer</h1>
        <div className="header-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            onChange={loadLocalPdf}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            className="upload-btn"
            onClick={triggerFileSelect}
            disabled={isDocumentLoading}
          >
            {isDocumentLoading ? 'Loading PDF...' : 'Open Local PDF'}
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

import { useRef, useEffect, useState } from 'react';
import WebViewer from '@pdftron/webviewer';

import './App.css';

const STORAGE_KEY_PREFIX = 'webviewer_annotations_';

function App() {
  const viewer = useRef(null);
  const instanceRef = useRef(null);
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

      // Load annotations from localStorage when document loads
      documentViewer.setDocumentXFDFRetriever(async () => {
        const doc = documentViewer.getDocument();
        if (!doc) return '';
        const filename = doc.getFilename() || 'default';
        const storageKey = `${STORAGE_KEY_PREFIX}${filename}`;
        const savedXfdf = localStorage.getItem(storageKey);
        return savedXfdf || '';
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

  const fileInputRef = useRef(null);

  const loadLocalPdf = async (e) => {
    const file = e.target.files?.[0];
    if (!file || file.type !== 'application/pdf') {
      if (file) alert('Please select a valid PDF file.');
      return;
    }

    const instance = instanceRef.current;
    if (!instance) {
      alert('Viewer abhi ready nahi hua. Thoda wait karke dobara try karein.');
      return;
    }

    setIsDocumentLoading(true);
    try {
      // ArrayBuffer approach - most reliable for local files in WebViewer
      const arrayBuffer = await file.arrayBuffer();
      const blob = new Blob([new Uint8Array(arrayBuffer)], {
        type: 'application/pdf',
      });
      await instance.UI.loadDocument(blob, {
        filename: file.name,
      });
    } catch (err) {
      console.error('Local PDF load failed:', err);
      alert('PDF load nahi ho saki. Error: ' + (err?.message || 'Unknown error'));
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

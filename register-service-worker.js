if ('serviceWorker' in navigator) {
  // Resolve next to this script so the app also works under a sub path.
  const workerUrl = new URL('service-worker.js', document.currentScript.src);
  const publish = (detail) => {
    window.__progressServiceWorkerStatus = detail;
    window.dispatchEvent(new CustomEvent('progress-service-worker-status', { detail }));
  };
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(workerUrl)
      .then(() => publish({ state: 'registered' }))
      .catch((error) => {
        const message = error instanceof Error ? error.message : 'Service Worker konnte nicht registriert werden';
        publish({ state: 'error', message });
        console.warn('Progress konnte den Offline-Modus nicht aktivieren.', error);
      });
  });
}

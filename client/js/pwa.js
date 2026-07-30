(function () {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

  window.nexusPwa = {
    isStandalone() {
      return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    },
    async showNotification(title, options = {}) {
      if (!('Notification' in window) || Notification.permission !== 'granted') return false;
      const registration = await navigator.serviceWorker?.ready.catch(() => null);
      if (registration?.showNotification) {
        await registration.showNotification(title, {
          badge: '/icons/nexus-maskable.svg',
          icon: '/icons/nexus-icon.svg',
          data: { url: '/', ...(options.data || {}) },
          ...options
        });
        return true;
      }
      new Notification(title, options);
      return true;
    }
  };
})();

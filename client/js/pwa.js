(function () {
  let registrationPromise = null;

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      registrationPromise = navigator.serviceWorker.register('/sw.js').catch(() => null);
    });
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
  }

  async function getRegistration() {
    if (!('serviceWorker' in navigator)) return null;
    if (!registrationPromise) registrationPromise = navigator.serviceWorker.register('/sw.js').catch(() => null);
    const registration = await registrationPromise;
    return registration || navigator.serviceWorker.ready.catch(() => null);
  }

  window.nexusPwa = {
    isStandalone() {
      return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    },
    isPushSupported() {
      return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    },
    async hasPushSubscription() {
      const registration = await getRegistration();
      return Boolean(await registration?.pushManager?.getSubscription());
    },
    async subscribePush() {
      if (!this.isPushSupported()) throw new Error('Браузер не поддерживает push-уведомления.');
      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Уведомления не разрешены.');

      const response = await fetch('/api/push/public-key', { credentials: 'include' });
      const data = await response.json();
      if (!response.ok || !data.enabled || !data.publicKey) throw new Error(data.error || 'Push-уведомления не настроены.');

      const registration = await getRegistration();
      if (!registration?.pushManager) throw new Error('Service worker не готов.');

      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(data.publicKey)
        });
      }

      const saveResponse = await fetch('/api/push/subscribe', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription)
      });
      const saveData = await saveResponse.json().catch(() => ({}));
      if (!saveResponse.ok) throw new Error(saveData.error || 'Не удалось сохранить push-подписку.');
      return true;
    },
    async unsubscribePush() {
      const registration = await getRegistration();
      const subscription = await registration?.pushManager?.getSubscription();
      if (!subscription) return true;
      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint })
      }).catch(() => {});
      await subscription.unsubscribe().catch(() => {});
      return true;
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

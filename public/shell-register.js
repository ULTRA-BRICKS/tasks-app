(() => {
  if (!('serviceWorker' in navigator) || document.querySelector('script[src*="/src/app/"]')) return;
  let requested = false,
    notice;
  const offer = (registration) => {
    if (!registration.waiting || notice) return;
    notice = document.createElement('aside');
    notice.className = 'shell-update-notice';
    notice.setAttribute('aria-label', 'Application update');
    const text = document.createElement('span');
    text.textContent = 'A new version of Tasks is ready.';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Reload to update';
    button.addEventListener('click', () => {
      if (!registration.waiting) return;
      requested = true;
      registration.waiting.postMessage({ type: 'ACTIVATE_TASKS_UPDATE' });
    });
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.textContent = 'Later';
    dismiss.addEventListener('click', () => {
      notice?.remove();
      notice = undefined;
    });
    notice.append(text, button, dismiss);
    document.body.append(notice);
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (requested) location.reload();
  });
  navigator.serviceWorker
    .register('/sw.js', { updateViaCache: 'none' })
    .then((registration) => {
      offer(registration);
      registration.addEventListener('updatefound', () =>
        registration.installing?.addEventListener('statechange', () => {
          if (registration.waiting && navigator.serviceWorker.controller) offer(registration);
        }),
      );
    })
    .catch(() => {
      /* An unavailable worker must never prevent an ordinary online startup. */
    });
})();

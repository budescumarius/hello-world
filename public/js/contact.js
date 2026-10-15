// Quote request forms ([data-contact]). On the estimator page the current configuration is attached.
(function () {
  // Show a confirmation, then take the visitor back to the home page.
  function confirmAndGoHome() {
    const home = `/?lang=${App.lang}`;
    const box = document.createElement('div');
    box.className = 'thanks-overlay';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.innerHTML = `
      <div class="thanks-box">
        <div class="check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg></div>
        <h2>${App.esc(App.t('form.thanks'))}</h2>
        <p>${App.esc(App.t('form.sent'))}</p>
        <p class="redirect">${App.esc(App.t('form.redirect'))}</p>
        <a class="btn btn-primary" href="${home}">${App.esc(App.t('form.home'))}</a>
      </div>`;
    document.body.appendChild(box);
    box.querySelector('.btn').focus();
    setTimeout(() => {
      // On the home page itself, go back to the top instead of reloading.
      if (location.pathname === '/' || location.pathname === '/index.html') {
        box.remove();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        location.href = home;
      }
    }, 5000);
  }

  function bind(form) {
    const status = form.querySelector('.form-status');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      data.lang = App.lang;
      if (window.Estimator) data.estimate = window.Estimator.current();
      status.className = 'form-status';
      if (!data.name.trim() || !(data.email.trim() || data.phone.trim()) || !data.message.trim()) {
        status.textContent = App.t('form.missing');
        status.classList.add('err');
        return;
      }
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        const res = await fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        if (!res.ok) throw new Error();
        form.reset();
        status.textContent = App.t('form.ok');
        status.classList.add('ok');
        confirmAndGoHome();
      } catch (err) {
        status.textContent = App.t('form.err');
        status.classList.add('err');
      } finally {
        btn.disabled = false;
      }
    });
  }
  document.addEventListener('DOMContentLoaded', () => document.querySelectorAll('[data-contact]').forEach(bind));
})();

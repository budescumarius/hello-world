// Quote request forms ([data-contact]). On the estimator page the current configuration is attached.
(function () {
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

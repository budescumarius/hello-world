// Full-screen photo viewer with keyboard and swipe, shared by project and article pages.
// Usage: Lightbox.open([{ url, caption }], startIndex, fallbackAlt)
(function () {
  let photos = [];
  let index = 0;
  let alt = '';
  let lastFocus = null;
  let lb, img, caption;

  function show(i) {
    const n = photos.length;
    index = (i + n) % n;
    const p = photos[index];
    const text = p.caption ? App.pick(p.caption) : '';
    img.src = p.url;
    img.alt = text || alt;
    caption.textContent = `${text ? text + ' · ' : ''}${index + 1} / ${n}`;
  }
  function open(list, i, fallbackAlt) {
    photos = list;
    alt = fallbackAlt || '';
    lastFocus = document.activeElement;
    lb.classList.add('open');
    document.body.style.overflow = 'hidden';
    show(i);
    lb.querySelector('.close').focus();
  }
  function close() {
    lb.classList.remove('open');
    document.body.style.overflow = '';
    if (lastFocus) lastFocus.focus();
  }

  document.addEventListener('DOMContentLoaded', () => {
    lb = document.getElementById('lightbox');
    if (!lb) return;
    img = lb.querySelector('img');
    caption = lb.querySelector('.lightbox-caption');
    lb.querySelector('.close').addEventListener('click', close);
    lb.querySelector('.prev').addEventListener('click', () => show(index - 1));
    lb.querySelector('.next').addEventListener('click', () => show(index + 1));
    lb.addEventListener('click', e => { if (e.target.classList.contains('lightbox-img')) close(); });
    document.addEventListener('keydown', e => {
      if (!lb.classList.contains('open')) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') show(index - 1);
      if (e.key === 'ArrowRight') show(index + 1);
    });
    let startX = null;
    lb.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive: true });
    lb.addEventListener('touchend', e => {
      if (startX === null) return;
      const dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) > 50) show(index + (dx < 0 ? 1 : -1));
      startX = null;
    });
  });

  window.Lightbox = { open };
})();

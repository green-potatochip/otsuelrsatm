export function initializeNavigation() {
  const navbar = document.querySelector<HTMLElement>('.navbar')!;
  const toggle = document.getElementById('nav-toggle')!;
  const menu = document.getElementById('nav-links')!;
  const progress = document.getElementById('reading-progress')!;
  const links = [...menu.querySelectorAll<HTMLAnchorElement>('a')];
  const sections = links.map(link => document.querySelector<HTMLElement>(link.hash)!);
  let frame = 0;

  function setOpen(open: boolean) {
    menu.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
  }
  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  links.forEach(link => link.addEventListener('click', () => setOpen(false)));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      setOpen(false); toggle.focus();
    }
  });
  document.addEventListener('click', event => {
    if (!navbar.contains(event.target as Node)) setOpen(false);
  });

  function update() {
    frame = 0;
    const extent = document.documentElement.scrollHeight - window.innerHeight;
    progress.style.transform = `scaleX(${extent > 0 ? Math.max(0, Math.min(1, window.scrollY / extent)) : 0})`;
    let active = -1;
    sections.forEach((section, index) => { if (section.getBoundingClientRect().top <= navbar.offsetHeight + 70) active = index; });
    if (extent > 0 && window.scrollY >= extent - 3) active = sections.length - 1;
    links.forEach((link, index) => {
      if (index === active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(update); }
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 760) setOpen(false);
    schedule();
  }, { passive: true });
  update();
  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener('scroll', schedule);
  };
}

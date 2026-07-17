const menuButton = document.querySelector('[data-menu-toggle]');
const mobileMenu = document.querySelector('[data-mobile-menu]');
const sectionLinks = document.querySelectorAll('[data-section-link]');

const closeMenu = () => {
  mobileMenu.hidden = true;
  menuButton.setAttribute('aria-expanded', 'false');
};

menuButton.addEventListener('click', () => {
  const willOpen = mobileMenu.hidden;
  mobileMenu.hidden = !willOpen;
  menuButton.setAttribute('aria-expanded', String(willOpen));
});

mobileMenu.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', closeMenu);
});

const sections = [...sectionLinks]
  .map((link) => document.getElementById(link.dataset.sectionLink))
  .filter(Boolean);

const sectionObserver = new IntersectionObserver(
  (entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];

    if (!visible) return;

    sectionLinks.forEach((link) => {
      if (link.dataset.sectionLink === visible.target.id) {
        link.setAttribute('aria-current', 'true');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  },
  { rootMargin: '-25% 0px -55%', threshold: [0.1, 0.5] },
);

sections.forEach((section) => sectionObserver.observe(section));
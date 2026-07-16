// XO staff panel toggle (About page)
const xoToggle   = document.getElementById('xoToggle');
const staffPanel = document.getElementById('staffPanel');
function toggleStaff() {
  const expanded = xoToggle.getAttribute('aria-expanded') === 'true';
  xoToggle.setAttribute('aria-expanded', !expanded);
  staffPanel.classList.toggle('open', !expanded);
}
xoToggle.addEventListener('click', toggleStaff);
xoToggle.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleStaff(); }
});

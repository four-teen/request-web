(() => {
  const gateway = document.getElementById('gateway');
  const sealButton = document.getElementById('sealButton');
  const form = document.getElementById('loginForm');
  const username = document.getElementById('username');
  const password = document.getElementById('password');
  const togglePassword = document.getElementById('togglePassword');
  const cancel = document.getElementById('cancelLogin');
  const submit = document.getElementById('loginButton');
  const message = document.getElementById('loginError');
  let csrfToken = '';
  let sessionPromise = null;
  let busy = false;

  function showMessage(text) {
    message.textContent = text;
    message.hidden = !text;
  }
  function setPasswordVisible(visible) {
    password.type = visible ? 'text' : 'password';
    togglePassword.setAttribute('aria-pressed', String(visible));
    togglePassword.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
  }
  function setOpen(open, focus = true) {
    if (busy) return;
    gateway.classList.toggle('is-open', open);
    form.inert = !open;
    sealButton.setAttribute('aria-expanded', String(open));
    sealButton.setAttribute('aria-label', open ? 'Close sign-in form' : 'Open sign-in form');
    if (!open) { username.value = ''; password.value = ''; setPasswordVisible(false); showMessage(''); }
    updateSealAccess();
    if (focus) (open ? form : sealButton).focus({ preventScroll: true });
  }
  function updateSealAccess() {
    sealButton.tabIndex = gateway.classList.contains('is-open') && window.innerWidth < 768 ? -1 : 0;
  }
  function updateViewport() {
    const viewport = window.visualViewport;
    if (viewport && Math.abs(viewport.scale - 1) > .01) return;
    const height = Math.round(viewport?.height ?? window.innerHeight);
    gateway.style.setProperty('--entry-height', `${height}px`);
    gateway.classList.toggle('is-compact', height < 560);
    updateSealAccess();
  }
  function setBusy(value) {
    busy = value;
    submit.disabled = value;
    sealButton.disabled = value;
    cancel.disabled = value;
    username.readOnly = value;
    password.readOnly = value;
    submit.querySelector('span').textContent = value ? 'Signing in...' : 'Sign in';
    form.setAttribute('aria-busy', String(value));
  }
  async function readResponse(response) {
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) throw new Error(data?.message || 'The records service is temporarily unavailable. Please try again.');
    return data;
  }
  function loadSession() {
    if (sessionPromise) return sessionPromise;
    sessionPromise = (async () => {
      const data = await readResponse(await fetch('/api/auth/session.php', { credentials: 'same-origin', cache: 'no-store' }));
      csrfToken = data.csrfToken;
      if (!csrfToken) throw new Error('Unable to start your sign-in session. Please try again.');
      return data;
    })().finally(() => { sessionPromise = null; });
    return sessionPromise;
  }
  function openWorkspace() { window.location.assign('/dashboard'); }

  setOpen(false, false);
  updateViewport();
  sealButton.addEventListener('click', () => setOpen(!gateway.classList.contains('is-open')));
  cancel.addEventListener('click', () => setOpen(false));
  togglePassword.addEventListener('click', () => setPasswordVisible(password.type === 'password'));
  form.addEventListener('keydown', event => {
    if (event.key === 'Escape') setOpen(false);
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    showMessage('');
    setBusy(true);
    try {
      if (!csrfToken) await loadSession();
      const body = new URLSearchParams({ username: username.value, password: password.value, csrf_token: csrfToken });
      const response = await fetch('/api/auth/login.php', { method: 'POST', credentials: 'same-origin', body });
      if (response.status === 419) csrfToken = '';
      await readResponse(response);
      password.value = '';
      openWorkspace();
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Unable to sign in. Please try again.');
      setBusy(false);
      password.focus();
    }
  });
  loadSession().then(data => { if (data.user) openWorkspace(); }).catch(error => {
    setOpen(true, false);
    showMessage(error.message);
  });
  window.visualViewport?.addEventListener('resize', updateViewport);
  window.addEventListener('resize', updateViewport);
  window.addEventListener('pageshow', event => {
    setBusy(false);
    if (event.persisted) {
      username.value = '';
      password.value = '';
      setPasswordVisible(false);
    }
  });
})();

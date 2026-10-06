// Login gate
//
// GitHub Pages has no server-side auth, so this only keeps casual visitors and
// search engines out. races.json is still publicly fetchable. See PLAN.md §4.
//
// Loaded synchronously in <head> so the page is locked before anything renders.
// app.js waits on window.authReady before loading any data.

(function () {
  // SHA-256 of "admin:grace" (username:password). Plaintext is never stored.
  const CREDENTIAL_HASH = '0ba24fc341147f3976df087a28832b97203d947d72a084daf23851e63b3700ae';
  const SESSION_KEY = 'ncGeneralGuideAuth';

  const root = document.documentElement;

  function readSession() {
    try {
      return sessionStorage.getItem(SESSION_KEY) === CREDENTIAL_HASH;
    } catch (e) {
      return false;
    }
  }

  function writeSession(value) {
    try {
      if (value) sessionStorage.setItem(SESSION_KEY, CREDENTIAL_HASH);
      else sessionStorage.removeItem(SESSION_KEY);
    } catch (e) {
      // Storage blocked (private mode, sandboxed iframe): gate re-prompts on reload
    }
  }

  async function sha256Hex(text) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  let resolveAuth;
  window.authReady = new Promise(resolve => { resolveAuth = resolve; });

  function unlock() {
    root.classList.add('auth-ok');
    resolveAuth();
  }

  if (readSession()) {
    unlock();
  }

  window.logout = function () {
    writeSession(false);
    window.location.reload();
  };

  function initGate() {
    const form = document.getElementById('authForm');
    if (!form) return;

    const userInput = document.getElementById('authUser');
    const passInput = document.getElementById('authPass');
    const errorEl = document.getElementById('authError');
    const submitBtn = form.querySelector('button[type="submit"]');

    if (!root.classList.contains('auth-ok')) {
      userInput.focus();
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.textContent = '';

      if (!window.crypto || !crypto.subtle) {
        errorEl.textContent = 'This browser can’t verify the password here. Open the page over https.';
        return;
      }

      submitBtn.disabled = true;
      try {
        const user = userInput.value.trim().toLowerCase();
        const hash = await sha256Hex(`${user}:${passInput.value}`);
        if (hash === CREDENTIAL_HASH) {
          writeSession(true);
          passInput.value = '';
          unlock();
        } else {
          errorEl.textContent = 'Incorrect username or password.';
          passInput.value = '';
          passInput.focus();
        }
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGate);
  } else {
    initGate();
  }
})();

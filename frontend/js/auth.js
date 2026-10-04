// Auth session helpers.
(function () {
  const USER_KEY = 'fh_user';

  function currentUser() { try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; } }
  function setSession(token, user) {
    window.API.setToken(token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
  function clearSession() { window.API.setToken(null); localStorage.removeItem(USER_KEY); }

  async function login(email, password) {
    const { token, user } = await window.API.post('/auth/login', { email, password });
    setSession(token, user);
    await window.Cart.mergeServerCart();
    return user;
  }

  async function register(name, email, password) {
    const { token, user } = await window.API.post('/auth/register', { name, email, password });
    setSession(token, user);
    return user;
  }

  async function googleLogin(credential) {
    const { token, user } = await window.API.post('/auth/google', { credential });
    setSession(token, user);
    await window.Cart.mergeServerCart();
    return user;
  }

  let googleScriptPromise;
  function loadGoogleIdentity() {
    if (window.google && window.google.accounts && window.google.accounts.id) return Promise.resolve();
    if (!googleScriptPromise) {
      googleScriptPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.onload = resolve;
        script.onerror = () => reject(new Error('Could not load Google sign-in. Check your internet connection.'));
        document.head.appendChild(script);
      });
    }
    return googleScriptPromise;
  }

  async function initGoogleButton(containerId, onSuccess) {
    const container = document.getElementById(containerId);
    const status = document.getElementById('google-auth-status');
    if (!container) return;

    try {
      const { clientId } = await window.API.get('/auth/google/config');
      if (!clientId) {
        if (status) status.textContent = 'Google sign-in needs a Google OAuth client ID in backend/.env.';
        return;
      }

      await loadGoogleIdentity();
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async ({ credential }) => {
          try {
            const user = await googleLogin(credential);
            if (onSuccess) await onSuccess(user);
          } catch (err) {
            window.toast(err.message, 'error');
          }
        },
      });
      window.google.accounts.id.renderButton(container, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'rectangular',
        width: Math.min(360, container.clientWidth || 360),
      });
      if (status) status.textContent = '';
    } catch (err) {
      if (status) status.textContent = err.message;
    }
  }

  async function logout() {
    try { await window.API.post('/auth/logout', {}, true); } catch {}
    clearSession();
  }

  // Redirect to login if not authenticated; returns the user or null.
  function requireAuth(redirect = true) {
    const u = currentUser();
    if (!u && redirect) {
      location.href = `login.html?next=${encodeURIComponent(location.pathname.split('/').pop() + location.search)}`;
    }
    return u;
  }

  window.Auth = { currentUser, login, register, googleLogin, initGoogleButton, logout, clearSession, requireAuth };
})();

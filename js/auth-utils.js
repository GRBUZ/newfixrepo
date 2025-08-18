// === JWT Auth Setup ===
let jwtToken = null;
// Utilitaire pour ajouter l'en-tête Authorization

async function fetchWithJWT(url, options = {}) {
  const token = localStorage.getItem('jwtToken');
  const headers = options.headers || {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(url, { ...options, headers });
}
// Récupération du token JWT (exemple à adapter selon votre backend)
async function fetchJwtToken() {
  try {
    const res = await fetch('/.netlify/functions/get-token');
    const data = await res.json();
    if (res.ok && data.token) {
      jwtToken = data.token;
      console.log('[JWT] Token reçu:', jwtToken);
    } else {
      console.error('[JWT] Erreur token:', data.error || res.statusText);
    }
  } catch (e) {
    console.error('[JWT] Exception lors de la récupération du token', e);
  }
}

// Appelle cette fonction au chargement
fetchJwtToken();

export { fetchWithJWT, fetchJwtToken };
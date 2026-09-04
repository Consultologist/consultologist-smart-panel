// #654 leg 2: the panel's Entra leg. To call the Consultologist API as the
// signed-in clinician (the #611 satellite pattern), the panel needs the
// clinician's Entra access_as_user token — separate from, and in addition
// to, its Epic SMART token. MSAL handles that leg in a popup, which keeps
// it clear of the SMART flow's redirect.
//
// Loaded as an ES module from a CDN: MSAL's UMD/global script-tag build was
// deprecated at v3.0.0, so a buildless static page consumes it as ESM.
import { PublicClientApplication } from "https://esm.sh/@azure/msal-browser@5";

let pca = null;
let account = null;
let pcaKey = null;   // the (authority|clientId) the current instance was built for
let signingIn = false;

// Build the PublicClientApplication ONCE per config (not per click): a fresh
// instance each click, while a prior popup's interaction lock still sits in
// sessionStorage, is what raised interaction_in_progress. initialize() +
// handleRedirectPromise() settle any half-finished interaction so the lock
// is cleared before we start a new one.
async function ensurePca(authority, clientId) {
  const key = authority + "|" + clientId;
  if (pca && pcaKey === key) {
    return pca;
  }
  pca = new PublicClientApplication({
    auth: { clientId, authority, redirectUri: window.location.origin + window.location.pathname },
    cache: { cacheLocation: "sessionStorage" } // per-tab, gone on close
  });
  await pca.initialize();
  await pca.handleRedirectPromise();  // clears any stale interaction state
  pcaKey = key;
  const existing = pca.getAllAccounts();
  if (existing.length > 0) {
    account = existing[0];
  }
  return pca;
}

// window.consultologistEntra — the classic app.js calls these.
window.consultologistEntra = {
  // Sign in interactively (popup), against the panel's own Entra
  // registration. authority = https://login.microsoftonline.com/<tenant>.
  async signIn(authority, clientId) {
    if (signingIn) {
      throw new Error("A sign-in is already in progress — finish or close that window first.");
    }
    signingIn = true;
    try {
      await ensurePca(authority, clientId);
      const result = await pca.loginPopup({ scopes: ["openid", "profile"] });
      account = result.account;
      return account?.username ?? account?.name ?? "signed in";
    } finally {
      signingIn = false;
    }
  },

  // A delegated access_as_user token for the API — silent when it can,
  // popup when consent/interaction is needed. apiScope is the full
  // api://<api-client-id>/access_as_user value.
  async getApiToken(apiScope) {
    if (!pca || !account) {
      throw new Error("Not signed in to Consultologist yet — use Sign in to Consultologist first.");
    }
    const request = { scopes: [apiScope], account };
    try {
      const silent = await pca.acquireTokenSilent(request);
      return silent.accessToken;
    } catch {
      const interactive = await pca.acquireTokenPopup(request);
      return interactive.accessToken;
    }
  }
};

window.dispatchEvent(new Event("consultologist-entra-ready"));

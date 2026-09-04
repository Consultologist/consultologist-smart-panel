// #654 leg 2: the panel's Entra leg. To call the Consultologist API as the
// signed-in clinician (the #611 satellite pattern), the panel needs the
// clinician's Entra access_as_user token — separate from, and in addition
// to, its Epic SMART token. MSAL handles that leg in a popup, which keeps
// it clear of the SMART flow's redirect.
//
// Loaded as an ES module from a CDN: MSAL's UMD/global script-tag build was
// deprecated at v3.0.0, so a buildless static page consumes it as ESM.
import { PublicClientApplication } from "https://esm.sh/@azure/msal-browser@5";

const CONFIG_KEY = "smart-panel-config"; // shared with app.js's persistence

let pca = null;
let account = null;
let pcaKey = null;   // the (authority|clientId) the current instance was built for
let signingIn = false;

// The panel's own Entra authority + client id, as saved by app.js. Read here
// too so the module can build MSAL at load — including when this page is the
// one MSAL opened in the popup, where there is no click to trigger it.
function savedEntraConfig() {
  try {
    const c = JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}");
    return { authority: c.entraAuthority, clientId: c.entraClientId };
  } catch {
    return {};
  }
}

// Build the PublicClientApplication ONCE per config (not per click): a fresh
// instance each click, while a prior popup's interaction lock still sits in
// storage, is what raised interaction_in_progress.
//
// cacheLocation is localStorage, not sessionStorage, on purpose: the popup
// MSAL opens is a separate window and does NOT share sessionStorage with the
// opener, so the interaction request the opener wrote would be invisible to
// the popup and the handshake could never complete — the popup would just
// re-render this app and never close. localStorage is shared same-origin, so
// the popup sees the request, finishes, and closes.
async function ensurePca(authority, clientId) {
  const key = authority + "|" + clientId;
  if (pca && pcaKey === key) {
    return pca;
  }
  pca = new PublicClientApplication({
    auth: {
      clientId, authority,
      redirectUri: window.location.origin + window.location.pathname,
      // Process the response hash in place; don't bounce back to the
      // request URL (which would double-navigate this static page).
      navigateToLoginRequestUrl: false
    },
    cache: { cacheLocation: "localStorage" }
  });
  await pca.initialize();
  // Settle the sign-in response on the load that follows the redirect back
  // from Entra: this consumes the #code= in the URL, completes the sign-in,
  // and populates the account. (Epic's SMART return uses ?code= in the query
  // string, so the two returns never collide.)
  await pca.handleRedirectPromise();
  pcaKey = key;
  const existing = pca.getAllAccounts();
  if (existing.length > 0) {
    account = existing[0];
  }
  return pca;
}

// window.consultologistEntra — the classic app.js calls these.
window.consultologistEntra = {
  // Sign in against the panel's own Entra registration via a FULL-PAGE
  // redirect (authority = https://login.microsoftonline.com/<tenant>). This
  // navigates the tab to Entra and back; the sign-in completes at load via
  // handleRedirectPromise (see below), which then fires the ready event so
  // app.js can reflect the signed-in state. Popup flow was abandoned: MSAL
  // could not reliably close the popup because the redirect page is this
  // whole app, not a minimal handler. The SMART launch tokens survive the
  // navigation in sessionStorage, so nothing is lost.
  async signIn(authority, clientId) {
    if (signingIn) {
      throw new Error("A sign-in is already in progress.");
    }
    signingIn = true;
    try {
      await ensurePca(authority, clientId);
      await pca.loginRedirect({ scopes: ["openid", "profile"] });
      // Control does not return here — the tab navigates to Entra.
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
      // Silent is expected to succeed: the panel's access_as_user permission
      // is admin-consented tenant-wide, so no interaction is needed once the
      // account is signed in.
      const silent = await pca.acquireTokenSilent(request);
      return silent.accessToken;
    } catch (error) {
      // Fall back to a redirect (never a popup — popups don't close on this
      // static page). This navigates away; on return the token is cached, so
      // clicking the action again completes silently.
      await pca.acquireTokenRedirect(request);
      throw new Error("Consent/interaction was needed — redirecting; click again when you return. (" + error + ")");
    }
  },

  // The signed-in account, if MSAL already holds one (cached from a prior
  // sign-in this browser). Lets app.js restore the signed-in UI after a
  // reload without a fresh popup.
  currentAccountName() {
    return account ? (account.username ?? account.name ?? "signed in") : null;
  }
};

// At load — in the main window AND in the popup MSAL opens — build MSAL from
// the saved config and settle any redirect response. In the popup this is
// what closes it; in the main window it rehydrates a cached account so the
// signed-in state survives a reload.
(async () => {
  const { authority, clientId } = savedEntraConfig();
  if (authority && clientId) {
    try {
      await ensurePca(authority, clientId);
    } catch (error) {
      console.warn("Entra init at load failed (will retry on Sign in):", error);
    }
  }
  window.dispatchEvent(new CustomEvent("consultologist-entra-ready", {
    detail: { account: window.consultologistEntra.currentAccountName() }
  }));
})();

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
    auth: { clientId, authority, redirectUri: window.location.origin + window.location.pathname },
    cache: { cacheLocation: "localStorage" }
  });
  await pca.initialize();
  // Settle any redirect/popup response present on this load. When this page
  // is the one loaded INSIDE the popup at the redirectUri, this is the call
  // that hands the code back to the opener and lets MSAL close the popup;
  // without it the popup just shows the app with #code= in the address bar.
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

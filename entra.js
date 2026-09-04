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

// window.consultologistEntra — the classic app.js calls these.
window.consultologistEntra = {
  // Sign in interactively (popup), against the panel's own Entra
  // registration. authority = https://login.microsoftonline.com/<tenant>.
  async signIn(authority, clientId) {
    pca = new PublicClientApplication({
      auth: { clientId, authority, redirectUri: window.location.origin + window.location.pathname },
      cache: { cacheLocation: "sessionStorage" } // per-tab, gone on close
    });
    await pca.initialize();
    const result = await pca.loginPopup({ scopes: ["openid", "profile"] });
    account = result.account;
    return account?.username ?? account?.name ?? "signed in";
  },

  // A delegated access_as_user token for the API — silent when it can,
  // popup when consent/interaction is needed. apiScope is the full
  // api://<api-client-id>/access_as_user value.
  async getApiToken(apiScope) {
    if (!pca || !account) {
      throw new Error("Not signed in to Consultologist yet.");
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

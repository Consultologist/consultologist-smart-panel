// Consultologist SMART panel — the #190 sandbox spike.
//
// Standalone SMART App Launch (authorization code + PKCE, public client),
// read-only. Everything the spike record needs is surfaced as SHAPES:
// decoded claims, granted scopes, context fields, resource listings.
// Access and id tokens live in this tab's memory only; the PKCE verifier
// and state ride sessionStorage across the redirect and are burned on use.

const $ = (id) => document.getElementById(id);
// Server-supplied strings never reach innerHTML unescaped — this repo
// seeds the real satellite, so the discipline starts now.
const esc = (value) => String(value ?? "").replace(/[&<>"']/g,
  (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const log = (line) => { $("log").textContent += line + "\n"; };

const CONFIG_KEY = "smart-panel-config";
const REDIRECT_URI = window.location.origin + window.location.pathname;

let smartConfig = null;
let accessToken = null;

// --- config persistence (convenience only) ---
for (const key of ["fhirBase", "clientId", "scopes"]) {
  const el = $(key);
  const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}");
  if (saved[key]) el.value = saved[key];
  el.addEventListener("change", () => {
    const next = JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}");
    next[key] = el.value.trim();
    localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
  });
}

const fhirBase = () => $("fhirBase").value.trim().replace(/\/$/, "");

// --- discovery ---
$("discoverBtn").addEventListener("click", async () => {
  try {
    const url = fhirBase() + "/.well-known/smart-configuration";
    log("GET " + url);
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    smartConfig = await response.json();
    $("discovery").hidden = false;
    $("discovery").textContent = JSON.stringify(smartConfig, null, 2);
    $("launchBtn").disabled = !(smartConfig.authorization_endpoint && smartConfig.token_endpoint);
    log("discovery ok: authorize=" + smartConfig.authorization_endpoint + " token=" + smartConfig.token_endpoint);
  } catch (error) {
    log("discovery FAILED: " + error);
  }
});

// --- PKCE helpers ---
const base64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function pkcePair() {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = base64url(verifierBytes);
  const challenge = base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return { verifier, challenge };
}

// --- launch ---
$("launchBtn").addEventListener("click", async () => {
  const { verifier, challenge } = await pkcePair();
  const state = base64url(crypto.getRandomValues(new Uint8Array(16)));
  sessionStorage.setItem("pkce-verifier", verifier);
  sessionStorage.setItem("oauth-state", state);
  sessionStorage.setItem("token-endpoint", smartConfig.token_endpoint);
  // The whole discovery document survives the redirect: the id_token's
  // JWKS check runs on the return, when smartConfig would otherwise be null.
  sessionStorage.setItem("smart-config", JSON.stringify(smartConfig));

  const authorize = new URL(smartConfig.authorization_endpoint);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", $("clientId").value.trim());
  authorize.searchParams.set("redirect_uri", REDIRECT_URI);
  authorize.searchParams.set("scope", $("scopes").value.trim());
  authorize.searchParams.set("state", state);
  // SMART requires aud = the FHIR base; Epic refuses without it.
  authorize.searchParams.set("aud", fhirBase());
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");

  log("redirecting to authorize…");
  window.location.assign(authorize.toString());
});

// --- redirect return: exchange the code ---
(async function handleReturn() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("code")) {
    if (params.has("error")) {
      log("authorize returned error=" + params.get("error") + " description=" + (params.get("error_description") || ""));
    }
    return;
  }

  const expectedState = sessionStorage.getItem("oauth-state");
  sessionStorage.removeItem("oauth-state");
  if (!expectedState || params.get("state") !== expectedState) {
    log("STATE MISMATCH — exchange refused.");
    return;
  }

  const verifier = sessionStorage.getItem("pkce-verifier");
  sessionStorage.removeItem("pkce-verifier");
  const tokenEndpoint = sessionStorage.getItem("token-endpoint");
  history.replaceState(null, "", REDIRECT_URI); // the code leaves the URL bar

  log("POST " + tokenEndpoint + " (authorization_code + PKCE)");
  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.get("code"),
      redirect_uri: REDIRECT_URI,
      client_id: $("clientId").value.trim(),
      code_verifier: verifier
    })
  });

  const token = await response.json();
  if (!token.access_token) {
    log("token exchange FAILED: " + JSON.stringify(token));
    return;
  }

  accessToken = token.access_token;

  // The SHAPE, never the tokens: field names, lengths, expiry, context.
  const shape = {};
  for (const [key, value] of Object.entries(token)) {
    shape[key] = (key === "access_token" || key === "id_token" || key === "refresh_token")
      ? `<${typeof value} length ${String(value).length}>`
      : value;
  }
  $("tokenSection").hidden = false;
  $("tokenShape").textContent = JSON.stringify(shape, null, 2);
  log("token exchange ok; granted scope: " + (token.scope || "(none reported)"));

  if (token.patient) {
    $("patientId").value = token.patient;
  }
  $("docsSection").hidden = false;

  if (token.id_token) {
    await showIdToken(token.id_token);
  } else {
    log("no id_token in the response (openid scope not granted?)");
  }
})();

// --- id_token: decode + JWKS verify ---
function decodeJwtPart(part) {
  const padded = part.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(padded + "=".repeat((4 - (padded.length % 4)) % 4)));
}

async function showIdToken(idToken) {
  const [headerPart, payloadPart] = idToken.split(".");
  const header = decodeJwtPart(headerPart);
  const claims = decodeJwtPart(payloadPart);
  $("idTokenSection").hidden = false;
  $("idTokenClaims").textContent = JSON.stringify({ header, claims }, null, 2);

  try {
    const jwksUri = smartConfig?.jwks_uri
      || JSON.parse(sessionStorage.getItem("smart-config") || "{}").jwks_uri;
    if (!jwksUri) { $("jwksResult").textContent = "No jwks_uri in discovery — signature not checked here."; return; }
    const jwks = await (await fetch(jwksUri)).json();
    const key = jwks.keys.find(k => k.kid === header.kid) || jwks.keys[0];
    const imported = await crypto.subtle.importKey(
      "jwk", key, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const data = new TextEncoder().encode(idToken.split(".").slice(0, 2).join("."));
    const signature = Uint8Array.from(
      atob(idToken.split(".")[2].replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", imported, signature, data);
    $("jwksResult").textContent = valid
      ? "Signature verified against " + jwksUri
      : "SIGNATURE INVALID against " + jwksUri;
  } catch (error) {
    $("jwksResult").textContent = "JWKS verification errored: " + error;
  }
}

// --- DocumentReference → Binary ---
$("listDocsBtn").addEventListener("click", async () => {
  const patient = $("patientId").value.trim();
  const url = fhirBase() + "/DocumentReference?patient=" + encodeURIComponent(patient);
  log("GET " + url);
  const response = await fetch(url, {
    headers: { Authorization: "Bearer " + accessToken, Accept: "application/fhir+json" }
  });
  if (!response.ok) {
    $("docsResult").innerHTML = `<p class="error">DocumentReference search: HTTP ${esc(response.status)}</p><pre></pre>`;
    $("docsResult").querySelector("pre").textContent = await response.text();
    return;
  }
  const bundle = await response.json();
  const entries = bundle.entry || [];
  log("DocumentReference bundle: total=" + (bundle.total ?? entries.length));

  const rows = entries.map((entry, index) => {
    const resource = entry.resource || {};
    const attachment = resource.content?.[0]?.attachment || {};
    return `<tr>
      <td>${esc(resource.id)}</td>
      <td>${esc(resource.type?.text || resource.type?.coding?.[0]?.display)}</td>
      <td>${esc(resource.date)}</td>
      <td>${esc(attachment.contentType)}</td>
      <td><button class="doc-fetch" data-index="${index}">Fetch</button></td>
    </tr>`;
  }).join("");
  $("docsResult").innerHTML = entries.length === 0
    ? '<p class="muted">No DocumentReferences for this patient.</p>'
    : `<table><tr><th>id</th><th>type</th><th>date</th><th>contentType</th><th></th></tr>${rows}</table><div id="fetchResult"></div>`;

  for (const button of $("docsResult").querySelectorAll(".doc-fetch")) {
    button.addEventListener("click", () => fetchAttachment(entries[Number(button.dataset.index)].resource));
  }
});

async function fetchAttachment(resource) {
  const attachment = resource.content?.[0]?.attachment || {};
  let url = attachment.url;
  if (!url) { $("fetchResult").innerHTML = '<p class="error">No attachment URL on that DocumentReference.</p>'; return; }
  if (!/^https?:/i.test(url)) { url = fhirBase() + "/" + url.replace(/^\//, ""); }

  log("GET " + url);
  const response = await fetch(url, {
    headers: { Authorization: "Bearer " + accessToken, Accept: attachment.contentType || "*/*" }
  });
  if (!response.ok) {
    $("fetchResult").innerHTML = `<p class="error">Attachment fetch: HTTP ${response.status}</p>`;
    return;
  }
  const bytes = await response.arrayBuffer();
  const contentType = response.headers.get("content-type") || attachment.contentType || "application/octet-stream";
  $("fetchResult").innerHTML =
    `<p>Fetched <strong>${esc(bytes.byteLength)}</strong> bytes, content-type <code>${esc(contentType)}</code>.</p>`;

  // Save for the E4 parser run — the engine's own DocumentExtraction over
  // exactly these bytes, outside this page.
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([bytes], { type: contentType }));
  link.download = "epic-document-" + (resource.id || "unknown");
  link.textContent = "Save the bytes";
  $("fetchResult").appendChild(link);
  log("attachment fetched: " + bytes.byteLength + " bytes, " + contentType);
}

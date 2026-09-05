# consultologist-smart-panel

The SMART on FHIR panel for Consultologist — seeded by the #190 sandbox
spike (Consultologist-Blazor#190; the spike record is
`docs/EPIC_SMART_INTAKE.md` in the engine repo). Today it is the spike's
instrument: a standalone SMART App Launch (authorization code + PKCE,
public client), read-only, that surfaces exactly the shapes the
exploration needs — the id_token's identity claims, the launch context,
and a patient's `DocumentReference` → `Binary` road. When
Consultologist-Blazor#654 fires, this repo grows into the real satellite
(the pattern: `docs/SATELLITE_CALLERS.md` there).

Since #662 the panel serves **two EHRs** — pick **Epic** or **Cerner
(Oracle Health)** from the provider selector in section 1. The SMART
discovery/launch/token/JWKS/document machinery is EHR-agnostic; the
selector only sets the field placeholders and the engine link route
(`Account/{provider}/Link`). Enter the chosen EHR's FHIR base and client
id and the rest is identical.

Nothing is stored beyond this browser tab and the config fields
(localStorage, convenience only). Access and id tokens live in tab
memory; the PKCE verifier and state ride sessionStorage across the
redirect and are burned on use. No `offline_access` is requested —
launch-bound access is the posture (#654's stated boundary).

## Registering on fhir.epic.com (once)

1. Create an account at <https://fhir.epic.com> and choose **Build Apps**.
2. New app → audience **Clinicians or Administrative Users**
   (provider-facing), application type such that a **non-production
   client ID** is issued for a public client (SMART on FHIR / OAuth 2.0).
3. Redirect URI: `http://localhost:4180/` (exactly — the page redirects
   to itself).
4. Select the APIs the scopes below name (DocumentReference read,
   Binary read) and enable the OpenID Connect / `fhirUser` option where
   offered.
5. Save; changes take up to **1 hour** to sync to the sandbox.

## Registering on code-console.cerner.com (once) — #662

1. Create a free **CernerCare** account and open the **code Console**
   (<https://code-console.cerner.com/console>, the Oracle Health Developer
   Program).
2. New app → **provider-facing**, **public** client (SMART on FHIR /
   OAuth 2.0 with PKCE); a **sandbox (non-production) client ID** is issued
   separately from production.
3. Redirect URI: `http://localhost:4180/` (exactly).
4. Select the DocumentReference read + Binary read scopes (Cerner has **no
   wildcard scopes** — enumerate them) and enable `openid`/`fhirUser`.
5. Save; config changes take ~**15 minutes** to propagate. The public
   provider sandbox FHIR base is
   `https://fhir-ehr-code.cerner.com/r4/ec2458f2-1e24-41c8-b71b-0e701af7583d`;
   confirm the exact OIDC issuer from that base's
   `.well-known/openid-configuration` for the engine's `Cerner__AllowedIssuers`.

## The Consultologist (Entra) leg — #654

To link the Epic identity and send a document to Consultologist, the panel
also signs the clinician into Consultologist (Entra) — a **second** sign-in
beside the Epic SMART one (the #611 satellite model: the panel presents the
clinician's own delegated `access_as_user` token; the Epic identity is
proof, never a bearer credential). The Entra leg uses MSAL in a popup,
loaded as an ES module from a CDN (MSAL's UMD/script-tag build was
deprecated at v3.0.0, so a buildless page consumes it as ESM).

**Operator step — the panel's own Entra registration (once, the #611
satellite recipe):** register a public-client app (SPA redirect
`http://localhost:4180/`), create its service principal, grant it the API's
delegated `access_as_user` tenant-wide, append it to the API registration's
`api.preAuthorizedApplications` (read-modify-write, never replace), and add
`http://localhost:4180` to the API's `Cors__AllowedOrigins`. All reversible.

Then, in section 5 of the panel: API base URL, the Entra authority
(`https://login.microsoftonline.com/<tenant>`), the panel's Entra client
id, and the API scope (`api://<api-client-id>/access_as_user`); **Sign in
to Consultologist**, then **Link this <provider> identity** (after a SMART
launch has produced an id_token). Each fetched document offers **Send to
Consultologist**, which posts its bytes to the API under the Entra bearer.

## Running

```bash
./serve.sh        # http://localhost:4180
```

Then in the page:

1. **FHIR base**: the sandbox R4 base fhir.epic.com documents
   (record the exact value in the spike record — E1).
2. **Client ID**: the non-production client id from the registration.
3. **Scopes** (prefilled):
   `openid fhirUser launch/patient patient/DocumentReference.rs patient/Binary.r`
   (SMART v2 scope grammar — the registration declares scope version v2)
4. **Discover** → **Launch** → sign in with the sandbox test credentials
   the portal documents → the panels fill: token shape, id_token claims
   (JWKS-verified), DocumentReferences, and a Binary fetch with a
   save-to-file for the parser experiment (E4).

If the launch lands without a patient in context, enter one of the
sandbox test patients' FHIR ids by hand — the portal's test-data page
lists them.

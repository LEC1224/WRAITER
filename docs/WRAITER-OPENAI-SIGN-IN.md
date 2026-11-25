# WRAITER: OpenAI sign-in proposal

Status on 2026-11-11: deferred by the operator. WRAITER has no approved OpenAI
OAuth client. Development and release continue with WRAITER's own email accounts
and users' own provider API keys at https://write.example.org. This
document preserves a possible future integration and an unsubmitted request.

## Availability

OpenAI supports ChatGPT identity sign-in and a separate, optional permission to
use an eligible user's ChatGPT plan. Website clients currently require OpenAI
approval and an issued client ID. The publicly documented dynamic registration
flow is for local open-source or personal tools; it uses a loopback callback on
the user's computer. OpenAI explicitly directs remotely hosted applications to
request access before offering this integration.

The hosted WRAITER service must therefore obtain approval for **both website
identity sign-in and ChatGPT plan use for AI requests**. An identity-only approval
does not establish permission or technical support for subscription inference.
Do not reuse another application's client ID, transfer the operator's Codex
credentials, or substitute the local-app registration flow for website approval.

Sources:

- [Website integration and required client configuration](https://developers.openai.com/siwc/website)
- [Identity and plan permission overview](https://developers.openai.com/siwc/quickstart)
- [Local versus remotely hosted availability](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt#usage-policy-and-terms)
- [Open-source host and registration boundaries](https://developers.openai.com/siwc/token-sharing-open-source)

## Proposed account and document design

1. The web sign-in page offers **Continue with ChatGPT**. OpenAI handles the user's
   credentials; WRAITER never receives their OpenAI password.
2. WRAITER's backend starts a short-lived OAuth transaction with fresh state,
   PKCE and nonce values, bound to a secure browser cookie. The proposed callback
   is `https://write.example.org/auth/openai/callback`; OpenAI must register
   its exact URL before activation.
3. The backend exchanges the code and verifies the identity token's signature,
   issuer, audience, expiration and nonce before accepting an identity.
4. A unique external-identity record maps the verified OpenAI issuer, registered
   client ID and subject (`sub`) to the document owner's internal account record.
   The internal ID remains a database relationship, not a separate password login.
   Email addresses and display names are not ownership keys.
5. Each linked account retains its server-hosted library, settings, 1 GB quota,
   revision checks and local backup. Raw identity tokens are discarded after
   validation unless a documented integration requirement calls for retention.
6. Existing WRAITER accounts can be linked only after proving control of both
   accounts. Matching email alone must never merge libraries. Switching identity
   requires finishing or preserving pending document saves first.
7. Desktop cloud access should use the same server identity through a browser
   sign-in and a separate, expiring device authorization transaction. The desktop
   must not accept an arbitrary OpenAI subject supplied by its renderer.

## Proposed AI behavior

Signing in and sharing ChatGPT plan usage are separate user choices. A signed-in
user who declines plan usage can still access their documents. The app must show
which funding method is active and provide access to ChatGPT's usage controls.
It must not silently switch to a paid API key when an allowance is exhausted.

Each inference request must belong to the consenting user. The publisher's Codex
session and allowance are never a shared fallback. The production service has
no publisher inference credentials configured.

The hosted request route, allowed scopes, model discovery, token handling and
runtime requirements must follow the partner contract supplied with approval.
The public local-app inference flow is not evidence that a shared WRAITER server
may proxy subscription requests. No hosted subscription transport has been
implemented or enabled on that assumption.

## Prepared access-request details

Application form: https://openai.com/form/sign-in-with-chatgpt-interest/

- Website: `https://write.example.org`
- Capabilities: **Sign in and ChatGPT plan use for AI requests**
- Product description draft:

  WRAITER is an independently developed writing application already distributed
  through the Microsoft Store, with a Windows desktop client and a mobile
  friendly browser version. Writers store private manuscripts and account
  settings on our own server, with a 1 GB quota per user. We would like to offer
  ChatGPT sign-in as the primary account identity and let each eligible user
  explicitly authorize their own ChatGPT plan for writing suggestions,
  proofreading, rewrites and a manuscript assistant. Usage would remain tied to
  the requesting user with clear consent and usage controls. We are requesting
  approval and implementation guidance for our remotely hosted browser service,
  including a supported way to use the same cloud library from desktop.

- Proposed callback: `https://write.example.org/auth/openai/callback`
- Current privacy page: `https://write.example.org/privacy.html`
- Repository: `https://github.com/LEC1224/WRAITER`
- Applicant name, work email, company/legal identity and job title: the operator
  must supply accurate details. This draft has not been submitted.

The interest form is the published entry point for an applicant without an
existing OpenAI representative. It currently asks for contact details, company,
website, the requested capability and a product description. Include the public
Microsoft Store listing in that description as evidence of the shipped product.
The checked documentation does not publish acceptance rates, a minimum app size,
a review rubric or a response deadline. Store distribution is useful application
context, not a documented approval guarantee.

Before switching the public beta, obtain the client configuration and hosted
plan-use contract, implement and test the approved flows, test explicit account
linking and ownership isolation, update the privacy notice, and run the normal
web and packaged desktop checks. Existing libraries and backups must survive the
account migration.

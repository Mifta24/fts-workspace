# 15 — Brief for the lawyer who reviews the privacy notice and terms

Hand this page to the reviewer together with https://workspace.fts-tech.co.id/en/privacy and `/en/terms` (also in Indonesian and Japanese). The wording was drafted by the engineer, not by a lawyer.

## What the service is
A team workspace (tasks, goals, chat, files, simple CRM, booking pages, forms) run by Fujiyama Technology Solution as a **pilot**, free, with no payment taken. Customers are small teams; their staff sign in. Visitors who fill a public form or book a time are third parties whose data the customer collects through us.

## Personal data held
- Accounts: name, email, password hash, sessions, two-step sign-in secret.
- Workspace content written by customers (tasks, messages, files). Never read by us; the operator console shows only counts and names.
- Customer's contacts and form or booking answers (name, email, phone, free text), with a consent history.
- Audit trail and server logs: identifiers and counts, no content.

## Who else touches it (sub-processors)
Cloudflare (traffic, including Turnstile captcha on public forms), the hosting provider (a Hostinger VPS in a shared server, location not named on the page), our own mail server on that VPS, Google only when a member connects a calendar. **AI is on (since 2026-11-04)** and uses a language model the owner runs on their own computer, reached through Cloudflare; no AI company receives the data. Only the request and the documents the member may see are sent.

## How long, and how it is deleted
- A workspace owner can ask for deletion; after 14 days the operator removes all workspace data (database and files).
- Backups are kept 14 days on the server, and 30 days on the owner's Mac; deleted data can sit in backups until they expire.
- Contacts can be erased one by one by the customer.
- The notice promises an answer to a request within 30 days and names Indonesian law (UU PDP No. 27/2022) as the reference.

## Questions for the reviewer
1. Is the notice enough under UU PDP, and does it need anything for users in Japan (APPI) or the EU (GDPR) given the Japanese and English pages?
2. Is the operator the controller or the processor for customer contact data? Which side needs a data-processing agreement, and what should it say?
3. Backups and cross-border transfer: the server location is not stated; what must be stated?
4. Is a 14-day wait and 14-day backup expiry acceptable wording, and is "within 30 days" a safe promise?
5. Breach notification: who is told and when; the contact today is one mailbox (`LEGAL_CONTACT_EMAIL`).
6. Terms of use for a free pilot: liability limits, acceptable use, and who may sign up.
7. Anything that must be on the sign-up form (consent text) or the public forms.

When the reviewer's changes are made, update the message catalogs (`Legal` in `messages/*.json`) and tick the lawyer item in `13-PRODUCTION-READINESS.md`.

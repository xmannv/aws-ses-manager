# AWS SES Suppression List Remover

Web tool to remove email addresses from your AWS SES **suppression list** in bulk.
Paste one or many addresses, unlock with a password, and each address is removed
from the SES suppression list.

Built with **TanStack Start** (React 19 + TypeScript), the **Astryx** design
system, and **aws4fetch** for signing AWS requests. Deploys to **Cloudflare Workers**.

## How it works

- The UI is gated by a password (lock screen). This is a UX gate only — the
  server re-verifies the password on every request.
- Removing addresses runs in a **TanStack server function** (on the Worker), so
  AWS credentials never reach the browser.
- Each address is deleted via the SES v2 REST API
  (`DELETE /v2/email/suppression/addresses/{email}`), signed with SigV4 by
  `aws4fetch`. Calls are throttled (~250ms apart) with retry-on-throttle, since
  the SES management API allows roughly 1 request/second.
- Per-request cap: **200 addresses** (keeps within Worker subrequest limits).

## Prerequisites

An AWS IAM user/role whose policy includes `ses:DeleteSuppressedDestination`.
This is **not** part of the default SES sending policy — add it explicitly:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ses:DeleteSuppressedDestination",
      "Resource": "*"
    }
  ]
}
```

## Environment variables

| Variable | Description |
| --- | --- |
| `AWS_ACCESS_KEY_ID` | IAM access key id |
| `AWS_SECRET_ACCESS_KEY` | IAM secret access key |
| `AWS_REGION` | SES region, e.g. `us-east-1` (suppression list is per-region) |
| `APP_PASSWORD` | Password that unlocks the UI |

## Local development

1. Copy the env template and fill in real values:
   ```bash
   cp .dev.vars.example .dev.vars
   ```
2. Install dependencies (already done if you scaffolded here):
   ```bash
   npm install
   ```
3. Start the dev server:
   ```bash
   npm run dev
   ```
   Open http://localhost:3000.

> `.dev.vars` is git-ignored. Never commit real credentials.

## Deploy to Cloudflare Workers

1. Build and deploy:
   ```bash
   npm run deploy
   ```
2. Set the environment variables/secrets. Either in the **Cloudflare dashboard**
   (Workers & Pages → your worker → Settings → Variables and Secrets — mark
   `AWS_SECRET_ACCESS_KEY` and `APP_PASSWORD` as encrypted **Secret**), or via CLI:
   ```bash
   npx wrangler secret put AWS_ACCESS_KEY_ID
   npx wrangler secret put AWS_SECRET_ACCESS_KEY
   npx wrangler secret put AWS_REGION
   npx wrangler secret put APP_PASSWORD
   ```

## Project structure

```
src/
├── routes/
│   ├── __root.tsx      # HTML shell + Astryx theme attributes
│   └── index.tsx       # Lock screen + feature screen
├── server/
│   └── suppression.ts  # Server fn: auth + SES delete (aws4fetch)
├── lib/
│   └── emails.ts       # Parse / validate / dedupe email input
└── styles.css          # Astryx CSS imports + dark theme
```

## Security notes

- The password is the only barrier between the public URL and your ability to
  modify the SES suppression list. Use a strong value, and consider putting the
  Worker behind **Cloudflare Access** for stronger auth.
- The app removes addresses only; it never lists or exports them.

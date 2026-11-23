# AHEAD Console API

AHEAD's own control plane: Console staff and partner accounts, plans and coupons, the businesses
AHEAD serves, their subscriptions, and the signed licences that open modules in the ERP. It has
its own database (`ahead_console`) and reaches an ERP installation only through the ERP's signed
provisioning API. Design: [docs/architecture/console-erp-split.md](../docs/architecture/console-erp-split.md).

## Run

```
npm install
cp .env.example .env        # fill in; LICENCE_PRIVATE_KEY and PROVISION_KEY match the ERP's
npm run dev                  # creates/migrates ahead_console, seeds plans, starts on :5100
```

The ERP (`backend/`) must be running for businesses to be set up and licences delivered; until
then those calls wait in the outbox and go out when it is back.

One-time move of the businesses, partners and Console people from the ERP database:

```
npm run import:erp
```

## How it talks to the ERP

| Console does | ERP call |
|---|---|
| Add a business | `POST /internal/v1/tenants` (workspace, owner login, licence) → owner setup link emailed |
| Any plan, trial, close, reopen or module change | a new licence, `PUT /internal/v1/tenants/:id/licence` |
| Resend the owner's link | `POST /internal/v1/tenants/:id/owner-link` |
| Open a business | `GET /internal/v1/tenants/:id/overview` (team, activity, usage) |

Calls go through the `deliveries` outbox (every 3 s, retried with growing waits up to 1 hour,
12 tries, then shown in System health). Licences are renewed hourly before half their life.

## Roles

Admin (everything) · Staff (businesses, plans on businesses) · Sales and Vendor (add businesses,
see their own) · Partner owner and Partner staff (their partner's businesses). Admin and Staff
must use two-step sign-in.

## Checks

```
npm run typecheck
npm test
PORT=5101 SMTP_HOST= npx tsx src/server.ts   # a second API with email off
npx tsx scripts/e2e.ts                         # sign-in, two-step, add a business, plan/close/reopen through the ERP
```

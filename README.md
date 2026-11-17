# Enterprise Procure-to-Pay (P2P) Platform

A monorepo with a **Node.js / Express / TypeScript / MongoDB** API (`backend/`) and a **React + Vite + TypeScript** client (`frontend/`). Together they cover the whole purchasing flow, from requisition to vendor payment.

```
Requisition → HOD approval → RFQ & live bidding → Award → PO + DoA approvals
           → Goods receipt & quality inspection (GRN) or service sign-off → 3-way match & booking → Tax clearance → Payment release
```

## Quick start

Prerequisite: Node 20+. **You don't need to install MongoDB.** `npm run dev` starts a local MongoDB on port 27017 and restarts it if it stops. Its data is in `~/.p2p-workflow/mongo-data` (change this with `LOCAL_MONGO_DBPATH`); keep that out of OneDrive and similar folders, because a sync client locking a file can crash MongoDB. The first run downloads the MongoDB binary, which takes about a minute, and copies any data from the old `backend/.mongo-data/` folder. If MongoDB is already running on 27017 (a local install or `docker compose up -d`), that one is used instead.

**If the database is down:** the API stays up and answers `503` with a clear message, `GET /api/health` reports `db: down`, and it reconnects by itself once MongoDB is back.

```bash
npm install                       # installs everything from the one root package.json
cp backend/.env.example backend/.env
npm run dev                       # local MongoDB + API on :5000 + web on :5173 (proxied /api)
npm run seed                      # in a second terminal, once the db is up: demo data (wipes P2P data!)
```

Open http://localhost:5173. Every seeded account uses the password `Password@123`, and the login page signs in to each one with a one-click chip, locally and on the deployed site. To hide the chips once real users sign in, set `VITE_HIDE_DEMO_LOGINS=true` in the build environment (on Vercel, under Environment Variables) and redeploy.

```bash
npm run test:e2e                  # sign-up, RBAC and the full P2P lifecycle, on a throwaway in-memory database
```

On every start the API runs `src/seed/migrate.ts`, which brings an existing database up to the current access model without deleting anything.

## Accounts and access

The login and sign-up pages use one role card per team. A selected card must match the account's role.

| Role card | Backend role | Demo email | Accounts allowed |
|---|---|---|---|
| Purchase Request / Business Unit | `REQUESTER` | `requester@p2p.local` | Many, each needs activation |
| Head of Department | `HOD` | `hod.it@p2p.local`, `hod.ops@p2p.local` | One per department |
| Procurement & Sourcing Team | `PROCUREMENT` | `procurement@p2p.local` | Many, each needs activation. One is enough: the Procurement approval level is taken when the vendor is selected |
| External Vendor / Supplier | `VENDOR` | `vendor1@p2p.local`, `vendor2@p2p.local` | Many, free sign-up |
| Store / Warehouse Team | `STORE` | `store@p2p.local` | One. Inspects quality at goods receipt |
| Finance Team | `FINANCE` | `finance@p2p.local` | One. Handles the match, booking, tax and payment release |
| Internal & External Auditor | `AUDITOR` | `auditor@p2p.local` | One |
| System Administrator / Owner | `ADMIN` | `admin@p2p.local` | One |

**Single Master Account Policy:** the single-account limits above are enforced by unique indexes on `User`, so concurrent sign-ups can't both succeed and an admin can't get around them. One account can hold any number of live sessions.

**Sign-up:**
- A vendor gives company name, contact person, email, password, phone, PAN and GSTIN, and is signed in straight away with status `PENDING`. To be approved they add bank details under **Company Profile**; bidding unlocks once Procurement approves them. A GSTIN can only be registered once.
- The first Admin is active immediately. Every other internal account stays inactive until an Admin activates it under **Administration**, so signing up alone grants no access.
- In production, internal self sign-up is off unless `INTERNAL_SIGNUP_CODE` is set, and then the code is required. Otherwise anyone could claim the Admin account on an empty database.

**Read-only auditor:** `authenticate` refuses every write by an `AUDITOR`, whatever a route allows, and `authorize` lets them read every module. The **Audit & Compliance** page shows the audit trail, 3-way match log, tax and payment records, and award decisions.

**Audit trail:** every state-changing API call is recorded in `AuditLog`, including refused attempts and failed logins, with the actor, document number and any remarks. Request bodies, and so passwords, are never stored. There is no route to change or delete entries.

**Admin:** passes every role check. An Admin who approved a payment can't also release it.

**Merged roles:** QC was merged into the Store, and AP and Treasury into Finance. On start, `seed/consolidateRoles.ts` removes accounts in those roles, logs each removal in the audit trail, keeps the releaser's name on past payments, moves pending approvals and DoA rule levels to Finance, and settles any goods left in quarantine: current stock goes into inventory, and expired stock is rejected.

**Separation of duties:** because one Finance account now matches, books, verifies tax and releases, nobody independent checks a payment unless a PAYMENT `DoaRule` covers its value. Add one before going live if you need that check. The audit trail still records every step.

## Folder structure

```
p2p_workflow/
├── package.json                 # the only package.json: all dependencies and scripts (dev, build, seed, typecheck)
├── vercel.json, api/index.ts    # Vercel: one project from the repo root; api/index.ts serves the backend
├── docker-compose.yml           # local MongoDB
├── backend/
│   └── src/
│       ├── server.ts / app.ts   # bootstrap, middleware, graceful shutdown
│       ├── config/              # env parsing, Mongo connection
│       ├── constants/           # roles, status enums, GST slabs
│       ├── middleware/          # JWT authenticate, role authorize, zod validate, error handler
│       ├── models/              # Mongoose schemas (see below)
│       ├── services/            # business rules: DoA, bid evaluation, 3-way match, tax, bank
│       ├── modules/             # one folder per module: *.routes.ts, *.controller.ts, *.validation.ts
│       │   ├── auth/  admin/  vendor/  audit/
│       │   ├── requisition/     # Module 1
│       │   ├── sourcing/        # Module 2
│       │   ├── purchase-order/  # Module 3
│       │   ├── grn/             # Module 4
│       │   ├── invoice/         # Module 5
│       │   └── treasury/        # Module 6
│       ├── routes/index.ts      # mounts all modules under /api
│       ├── seed/seed.ts
│       ├── types/  utils/
└── frontend/
    └── src/
        ├── api/                 # axios client (JWT interceptor) + typed service functions
        ├── context/AuthContext  # session + hasRole()
        ├── config/navigation.ts # role → menu mapping
        ├── components/          # Layout, ProtectedRoute, UI primitives
        ├── hooks/useApi.ts      # data loading + mutation helpers
        └── pages/               # requisitions, sourcing, purchase-orders, grn, invoices, treasury, vendors, audit, admin
```

## Data model

| Model | Purpose |
|---|---|
| `User` | Role, department, vendor link, personal **DoA limit** |
| `Department` | Fiscal-year budget: `allocated`, `committed` (approved PRs), `consumed` (payments) |
| `PurchaseRequisition` | Line items, estimate, status, `isActive` (deactivation), audit history |
| `Vendor` | KYC fields (GSTIN, PAN, bank details), default TDS section, rating, approval status |
| `RFQ` | Consolidated PR lines, invited vendors, bidding window, award decision and justification |
| `Bid` | One sealed bid per vendor per RFQ (revisable), quoted GST, lowest-price rank, technical review |
| `DoaRule` | Value bands mapped to an ordered approval chain of roles, for POs, PRs or payments |
| `PurchaseOrder` | Lines with `receivedQty` and `invoicedQty`, DoA approval steps, lifecycle status |
| `GoodsReceipt` | Invoice / challan number, box count, and per line: received, accepted, rejected and short quantities with reasons, and quality result |
| `QcInspection` | History only: QC decisions from before QC merged into the Store |
| `ReturnNote` | Rejected goods going back to the vendor, for replacement or credit |
| `ServiceEntry` | Sign-off that a service was done, or equipment was commissioned |
| `InventoryItem` | Accepted stock per item and warehouse, with batches, expiry and serials |
| `Invoice` | Vendor invoice, 3-way match result and exceptions, debit and credit notes, liability booking, tax verification |
| `Payment` | Gross, TDS and net amounts, beneficiary snapshot, approval chain, bank reference per attempt, UTR, who verified and released |
| `AuditLog` | Who did what to which document, including refused attempts |
| `Counter` | Atomic document numbering (`PR-2026-00001`, `PO-…`, `MW-GRN-…`) |

## Business rules implemented

**Module 1: Purchase Requisition** (`/api/requisitions`)
- On submit, the PR estimate must fit within the department's available budget (`allocated − committed`).
- When the HOD approves, the estimate is **committed** to the budget in one atomic update, so two approvals can't overspend it.
- Only Requesters raise PRs, and they can't approve their own.
- A PR names its department, which is mandatory and defaults to the requester's own. That department's HOD approves it and its budget is committed.
- Each line has an item type that decides how it is received later: general goods, batch, serial, equipment or service, plus Surgical Instruments, Capital Equipment / Medical Assets, Laboratory Reagents & Lab Supplies, IT & Electronics, and Maintenance & Facility Items. Lab reagents are received like drugs (batch and expiry), capital equipment like equipment (serials and commissioning), and the other new types as general goods.
- The description field suggests items from `GET /catalog/items?q=`, built from past POs, PRs and stock. Picking one fills in its item code, unit and price: the last PO price, or the last PR estimate for an item never ordered. There is no separate catalog to maintain.
- A PR `DoaRule` adds approval levels after the HOD by value. The budget commits at the final level.
- **Emergency purchases:** a PR flagged `isEmergency` with a written reason needs only the HOD. Procurement then buys directly from one approved vendor, up to `EMERGENCY_PO_CAP` before tax, with `POST /sourcing/emergency-purchases`. The PO skips approval so it can be issued at once, but Finance must ratify it (`POST /requisitions/:id/ratify`) before it can be paid.
- The requester can **edit** their PR until the HOD approves it; after that the API refuses edits. A rejected PR can be revised and resubmitted.
- The HOD or Admin can **cancel** a PR, which releases any committed budget.

**Module 2: Sourcing & live bidding** (`/api/sourcing`)
- An RFQ consolidates approved, active PRs from a single department. PRs are claimed with a conditional update, so two RFQs can't source the same PR.
- Bidding is **sealed**: vendors see only their own bid and, while bidding is open, their current rank and the total bid count.
- Vendors can revise or withdraw a bid until the RFQ closes.
- Bids are ranked automatically by lowest pre-tax total (L1, L2, …). Equal quotes rank by earlier submission. Vendors quote GST per line, shown as Actual + Tax = Total, but rank is on the pre-tax value because input GST is recoverable.
- **Technical evaluation:** a tender with `technicalEvaluation` is two-envelope. Nobody sees prices or ranks, including Procurement and the bidding dashboard, until bidding has closed and the financials are opened (`POST /sourcing/rfqs/:id/open-financials`). The technical review (`PATCH /sourcing/bids/:bidId/technical-review`) is optional and does not gate the financials. On any RFQ, a disqualified bid is left out of the ranking and can't be selected. Vendors never see the result.
- **Vendor licences:** vendors add documents with `POST /vendors/me/documents`, and Procurement verifies them with `POST /vendors/:id/documents/:docId/verify`. An RFQ can require licence types. A vendor can't bid or be awarded with a required licence missing, unverified or expired, or with any licence type on file that has no current document. Files aren't stored: a document holds its number, expiry and an optional link.
- **Budget re-check:** at award the commitment moves from the PR estimates to the quoted value. Above the estimate needs a written reason (`409 BUDGET_OVERRUN`). Beyond what is left of the budget is refused (`422 BUDGET_EXCEEDED`) until Procurement escalates (`POST /sourcing/rfqs/:id/budget-escalation`) and Finance raises the allocation (`POST .../decision`). Cancelling the PO undoes the change.
- Procurement (or an Admin as higher authority) can select any vendor. Selecting one other than L1 requires a written justification of at least 10 characters, which goes into the audit trail. A vendor who is no longer approved can't be selected.
- Selecting a vendor generates the PO in the same step. A missing DoA rule refuses the award before anything changes. Awards are claimed atomically, and a unique index allows one live PO per bid, so simultaneous requests can't produce two. If storing the PO fails after the award, **Create PO** retries it.
- An award is visible only to the winning vendor, who sees the RFQ as `AWARDED`, and its PO reference once issued. For every other vendor the RFQ reads `CLOSED` and their bid `SUBMITTED`, with the same response before and after the award. They aren't told they lost, or who won.
- The dashboard (`GET /sourcing/dashboard`) shows live, awaiting-award and awarded counts. For each RFQ it shows the total bids, the lowest quote, the live ranking and the awarded vendor.

**Module 3: PO & Delegation of Authority** (`/api/purchase-orders`)
- The PO's value picks the matching `DoaRule`, which sets the approval chain. A real install starts with no rules, so an Admin must add them under **Administration** before the first award.
- The Purchase Orders page has **Active**, **Past / completed** and **All** views (`GET /purchase-orders?view=active|past`). Past means closed, cancelled or rejected. Each row shows the invoiced and paid totals. A vendor sees only their own POs once issued, including any cancelled after that.
- `POST /from-bid/:bidId` retries PO creation for an awarded bid that has no live PO.
  - Seeded rules: up to ₹1L needs Procurement; up to ₹10L needs Procurement and HOD; above ₹10L needs Procurement, HOD and Finance.
- Each approval step is checked:
  - the approver holds the step's role, and an HOD must head the PO's department;
  - the **final approver's DoA limit is at least the PO value**;
  - the PO creator can't approve a HOD or Finance level, and no one approves two levels.
- Selecting the vendor generates the PO. Its Procurement level is approved at once by the user who selected the vendor, as long as that level comes first and, when it is the last level, their DoA limit covers the PO. A PO with nothing left to approve is **issued straight away**; otherwise the final HOD or Finance approval issues it. There is no separate issue step and no vendor acknowledgement: the Store can receive goods and the vendor can invoice once the PO is issued.
- Cancelling a PO (only possible before any goods are received) returns its PRs to the approved pool.
- Each PR has its own conversation (`GET|POST /requisitions/:id/messages`), open to everyone who can see the PR and reached from the PR itself or from **Start Chat** on its journey card. A sent message shows one tick, and a blue double tick once someone else has read it; hovering shows who. An auditor can read the thread without it showing as a read receipt. The Store joins a PR's conversation once it has a PO. The vendor whose PO is issued joins it too: they read the full history and can post, but see staff by team name only. A losing vendor never joins, and a vendor leaves it if their PO is cancelled. Staff see a notice in the conversation once the vendor can read it.
- Every journey card has a chat icon (💬) with the user's unread count for that card (`GET /chat/unread`): messages from others that they have not opened, each counted once, cleared for that user only when they read it.
  - Internal cards open the PR conversation. On a card with an RFQ, Procurement and Admin also get a tab per vendor (`GET /chat/rfqs/:rfqId/vendors`, `GET|POST /chat/rfqs/:rfqId/vendors/:vendorId/messages`), and the Auditor can read them.
  - Vendor cards open the vendor's private conversation with Procurement on that RFQ (`GET|POST /chat/rfqs/:rfqId/messages`). Once their PO is issued, the card also opens the order's PR/PO conversation, each with its own unread count. A vendor sees only their own conversations, and the buyer's team name, never a staff member's.
  - A message is never unread for the person who sent it.
- Rows, track steps and locked actions say who a document is waiting on (`pendingAt`). Staff names go to internal users only: a vendor sees just the team.
- The dashboard's Journey Path (`GET /journey`) ends each track with goods receipt and inspection as one Store step, the invoice, then one Finance stage: invoice verification and 3-way match (including booking), tax verification, any payment approval, and payment release. Locks only name active roles: an old record naming a merged role resolves to the role that does that work now.

**Module 4: Goods Receipt** (`/api/grn`)
- Each MW GRN records the PO, the invoice / challan number (required) and the box count. A box mismatch needs an explanation.
- Each line records received and accepted quantities and the quality result (passed, damaged or quality failed). Rejected and short quantities each need a reason.
- Accepted quantity can't exceed what is still outstanding on the PO.
- The Store's check at receipt is the quality inspection. Accepted goods update the PO's received quantities and status, enter inventory and become billable. Rejected goods stop counting as received, so a replacement can be taken.
- Batch items need a batch number and expiry date, serial and equipment items need one unique serial per accepted unit, and expired goods can only be rejected. A line takes one batch, so two batches of an item need two GRNs. Service lines can't be goods-received.
- `GET /grn/inventory/near-expiry?days=` lists batches expiring within the window (`NEAR_EXPIRY_DAYS`, default 90).
- **Returns** (`POST /grn/:id/returns`, `POST /grn/returns/:id/dispatch`): the Store sends back rejected goods, for replacement or credit. Released stock can't be returned this way yet.
- **Service and commissioning sign-off** (`POST /service-entries`, `POST /service-entries/:id/accept|reject`): the department records completed work and its HOD accepts, unless the HOD raised it. A service line becomes billable once accepted, and an equipment line once it is both accepted by the Store and commissioned.
- The PO uses optimistic concurrency, so two GRNs posted at the same time can't over-receive it.

**Module 5: 3-way match** (`/api/invoices`, Finance)
- The PO dropdown comes from `GET /purchase-orders/invoiceable` and leaves out fully billed POs. A vendor gets only their own POs, from the moment they are issued, and the API enforces the same rule on submission. Finance can also record an invoice against an issued PO.
- Duplicate invoice numbers from the same vendor are blocked, ignoring upper and lower case.
- A vendor can't submit an invoice until the Store has accepted, or a sign-off has cleared, something on the billed lines. Finance can key one early, and it stops at the match.
- The match runs automatically when an invoice is submitted, and Finance can re-run it after new GRNs. It checks every invoice line against the PO and the GRNs, using the PO prices:
  - the line exists on the PO and the vendor matches;
  - billed quantity ≤ ordered quantity not yet invoiced;
  - billed quantity ≤ quantity accepted or signed off and not yet invoiced;
  - unit price is within tolerance (`MATCH_PRICE_TOLERANCE_PCT`, default 2%);
  - GST rate matches the PO;
  - the printed total equals the sum of the lines, and the invoice total matches the PO-priced value.
- Liability can only be booked for a MATCHED invoice. The match is re-run at booking time to prevent double billing. Booking increments the PO's `invoicedQty`.
- **Exception decisions** (`POST /invoices/:id/exception-decision`): Finance can accept price, tax and total differences with a written reason, or reject the invoice. Quantity, vendor and line exceptions can't be accepted, because that would mean paying for goods not received or not ordered. A new or different exception stops the invoice again.
- **Debit and credit notes** (`POST /invoices/:id/debit-notes`, `/credit-notes`): Finance records them before tax verification. They reduce the payment, the TDS base and the actual budget use, and can't cover the whole invoice. A note after tax verification isn't supported.

**Module 6: Tax & payment** (`/api/treasury`, Finance)
- The tax check covers:
  - GSTIN format, and that the PAN inside the GSTIN matches the vendor's PAN;
  - that GST is only charged by GST-registered vendors;
  - valid GST slab rates;
  - CGST/SGST vs IGST, from the two GSTIN state codes;
  - TDS for the chosen section, at the individual or company rate, or at the no-PAN rate when no valid PAN is on file (Sec 206AA: 20%, or 5% for Sec 194Q). TDS is calculated on the value before GST. The Sec 194Q annual purchase threshold isn't modelled, so 0.1% applies from the first rupee.
- Passing the check stages a payment (gross − TDS = net).
- Finance verifies tax and then releases the payment. Whoever approved a payment can't also release it.
- A PAYMENT `DoaRule` adds approval levels before release (`POST /treasury/payments/:id/approve|reject`). Only HOD and Admin can be levels, because Finance already acts on every payment: this chain is the independent check on it.
- **Bank:** release moves the payment to `PROCESSING` in one atomic update before calling the bank, so two clicks can't pay twice. See [Bank integration](#bank-integration). A confirmed transfer marks the invoice PAID and adds its pre-GST value to the department's `consumed` budget.
- **Failed payments** wait in the Finance queue. `POST /treasury/payments/:id/retry` sends a new attempt with a new reference and the vendor's current bank details. A payment whose outcome is unknown stays `PROCESSING` and can't be retried, because that could pay twice: `POST /treasury/payments/:id/check-status` asks the bank.
- The PO closes when its last payment is released and every line is fully received and invoiced. A PO that stays short-delivered stays open.

## Bank integration

`services/bank.service.ts` is written against a generic REST contract, and **has not been tested against a real bank**, only a mock server in the test suite. A bank's actual API will differ, so map it in that one file and in the webhook handler.

| Variable | Purpose |
|---|---|
| `BANK_API_URL` | Base URL. Without it, payments are simulated outside production (with a `SIM-` UTR and a SIMULATED badge) and refused in production |
| `BANK_API_KEY` | Sent as `Authorization: Bearer` |
| `BANK_WEBHOOK_SECRET` | Signs webhooks. Without it, the webhook refuses everything |

- `POST {url}/payouts` with `Idempotency-Key: <reference>` and `{ reference, amount, currency, mode, beneficiary: { name, accountNumber, ifsc } }`. It answers `{ status: "SUCCESS", utr }`, `{ status: "FAILED", failureReason }`, or any other status to mean processing. A 4xx is a definite refusal. A 5xx or timeout means the outcome is unknown.
- `GET {url}/payouts/{reference}` answers the same way, for the status check.
- `POST /api/treasury/payments/webhook` takes `{ reference, status: "SUCCESS" | "FAILED", utr?, failureReason?, amount? }` with `X-Bank-Signature`, the hex HMAC-SHA256 of the raw body. It is safe to repeat. A report for an earlier attempt, or a success on a payment already marked failed, isn't applied and is logged for manual reconciliation.

## API overview

All routes are under `/api` and need `Authorization: Bearer <token>`, except `/auth/login`, `/auth/signup-options`, `/auth/register-vendor`, `/auth/register-internal` and `/health`.

```
POST /auth/login                    POST /auth/register-vendor          GET /auth/me
GET /auth/signup-options            POST /auth/register-internal        GET /audit/activity|matching|compliance|awards
GET|POST /admin/users               GET|POST|PATCH /admin/departments   GET|POST|PATCH /admin/doa-rules
GET|POST /vendors                   POST /vendors/:id/approve|suspend|blacklist     GET|PATCH /vendors/me
GET|POST /requisitions              PATCH /requisitions/:id
POST /requisitions/:id/submit|approve|reject|cancel|ratify       GET /chat/unread   GET|POST /chat/rfqs/:rfqId/messages|vendors/:vendorId/messages
GET /journey                        POST /vendors/me/documents          POST /vendors/:id/documents/:docId/verify
GET /sourcing/dashboard             GET|POST /sourcing/rfqs             POST /sourcing/rfqs/:id/publish|close|cancel|award|open-financials|budget-escalation
GET|POST /sourcing/rfqs/:id/bids    POST /sourcing/bids/:bidId/withdraw PATCH /sourcing/bids/:bidId/quality-score|technical-review
POST /sourcing/rfqs/:id/budget-escalation/decision                      POST /sourcing/emergency-purchases
GET /purchase-orders?view=          GET /purchase-orders/summary|invoiceable      POST /purchase-orders/from-bid/:bidId
POST /purchase-orders/:id/approve|reject|cancel    (issue: only for older POs approved but never issued)
GET|POST /grn                       GET /grn/inventory|inventory/near-expiry
GET /grn/returns                    POST /grn/:id/returns               POST /grn/returns/:id/dispatch
GET|POST /service-entries           POST /service-entries/:id/accept|reject
GET|POST /invoices                  POST /invoices/:id/match|book|reject|exception-decision|debit-notes|credit-notes
GET /treasury/queue                 POST /treasury/invoices/:id/verify-tax
GET /treasury/payments|payments/my-approvals
POST /treasury/payments/:id/approve|reject|release|retry|check-status   POST /treasury/payments/webhook
```

## Checking a deployment

Open `/api/health` on the deployed site. With `"db":"up"` the backend is connected. With `"db":"down"`, the `database` block tells you why:

- `mongoUriSet`: whether `MONGO_URI` is set in this environment. On Vercel, set it for both Production and Preview if you use previews, then redeploy.
- `host` and `database`: where the server is connecting, without credentials.
- `lastError.message` and `lastError.hint`: the driver's error and the most likely fix, such as Atlas Network Access not allowing `0.0.0.0/0`, a wrong password, or a host name that doesn't exist.

`jwtSecretSet: false` means `JWT_SECRET` is missing, so sign-in is refused. On Vercel the server never falls back to the local database or the development secret.

## Production notes / next steps

- **Transactions:** multi-document updates (GRN + PO + inventory, payment + invoice + budget) are done in a careful order, with conditional updates and optimistic concurrency. On a MongoDB replica set, wrap them in `session.withTransaction()`.
- **Tax tables:** TDS rates and thresholds change every year with the Finance Act. Move `TDS_SECTIONS` into the database, and validate GSTINs against the GST portal API.
- **Still to build:** file attachments (quotes, invoices, delivery challans, licences), notifications, scheduled auto-close of RFQs at `closeAt`, budget roll-over between fiscal years, the Sec 194Q annual threshold, a technical reviewer role for clinical users, returns of released stock, notes after tax verification, and pagination on list endpoints.

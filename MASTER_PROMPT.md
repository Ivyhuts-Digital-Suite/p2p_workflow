# Master Prompt: Hospital Procure-to-Pay (P2P) Platform

Build a full-stack enterprise Procure-to-Pay platform for a hospital. The phases below are in the order they were requested, starting 29 Oct 2026. New requests are added at the end as new phases. Later phases override earlier ones. Where an early instruction was later replaced, it is marked **[Replaced in Phase N]**; build the later version only.

**Rules that apply throughout:**
- Do not add features that are not asked for.
- Every change must keep existing working features, database flows and permissions intact and stable.
- Real users must work, not only seeded demo data.

---

## Phase 1: Architecture and core modules

**Stack**
- Backend: Node.js, Express, TypeScript, MongoDB (Mongoose), JWT authentication.
- Frontend: React with Vite, organised in modules.
- Repo: monorepo with `backend/` and `frontend/` at the root.

**Deliverables**
- The full folder structure.
- Mongoose models for Users, Purchase Requisitions, Vendors, Bids, Purchase Orders, GRNs and Invoices.
- The server and API route files for each module.

**Modules**
1. **Purchase Requisition (PR).** Users create, update and submit PRs against department budgets. The HOD or Admin can cancel a PR. **[Deactivate removed in Phase 23.]**
2. **Vendor sourcing and live bidding.**
   - Procurement creates an RFQ or tender from an approved PR, and vendors submit bids.
   - A bidding dashboard shows the RFQ status, the number of bids and the top-ranked vendor, ranked on quality and price.
3. **Purchase Order and Delegation of Authority (DoA).** The winning bid becomes a PO. DoA approval limits are enforced.
4. **Goods Receipt Note (GRN).** Store checks the physical goods and creates a GRN, which updates inventory.
5. **3-way match.** The PO, GRN and vendor invoice must match before the liability is booked.
6. **Finance clearance.** Finance checks tax compliance (TDS and GST) and releases the bank payment.

## Phase 2: Local setup and signup must work

- Run the site locally, seed it with `npm run seed`, and make sure signup works for a new user. Fix whatever blocks it.
- Document the terminal commands that start the site locally.

## Phase 3: Roles, authentication and the end-to-end workflow

**Login and signup screens**
- Show a grid of role cards. Each card gives the role's full name:

  | Role | Full name on the card |
  |---|---|
  | Requester | Purchase Request / Business Unit |
  | HOD | Head of Department |
  | Procurement | Procurement & Sourcing Team |
  | Vendor | External Vendor / Supplier |
  | Store | Store / Warehouse Team |
  | Finance | Finance & Treasury Team |
  | Auditor | Internal & External Auditor |
  | Admin | System Administrator / Owner |

  The Accounts Payable card was in the original list. **[Removed in Phase 9: AP merged into Finance.]**
- Add a side panel, the "Quick Reference Guide", that says in one or two plain sentences what each role does.
- The signup form changes with the selected role card. For a vendor it asks for company name, contact person, email, password, phone, PAN and GSTIN.

**Account rules**
- Vendors can sign up freely and create many accounts.
- Each internal role has a single master account, so a second signup for that role is rejected. The master account can be logged into many times.

**Access control**
- Strict route guards on the frontend and role middleware on the backend. Each role sees only its own modules.
- Auditor: read-only access to every module, the audit trail, match logs and compliance records. An auditor can never approve or pay.
- Admin: oversees the whole system, manages users and changes configuration.

**Workflow**
1. **PR and budget lock.** The requester raises a PR. The HOD checks the department budget and approves or rejects it. Approval locks the funds.
2. **Sourcing and selection.**
   - Procurement publishes an RFQ, and vendors bid.
   - Bids are ranked automatically, lowest price first.
   - Procurement may pick a vendor other than the cheapest (L1), but must then write a justification, which is logged.
   - The PO is generated within DoA limits.
3. **GRN with physical inspection.** Store counts boxes and cartons and inspects for damage. The GRN is linked to the PO and records the invoice or challan number, the received quantities, and the reasons for any shortage or rejection.
4. **3-way match.** PO, GRN and invoice must agree, with a 2% price tolerance. Duplicate invoices are blocked.
5. **Tax compliance and payment.**
   - Finance verifies GSTIN, PAN and TDS (Section 194Q).
   - Maker-checker: the person who verifies tax cannot release the payment.
   - Payment is made by bank transfer, which closes the PO.

**Demo**
- One-click demo chips on the login page for every role. All demo accounts use the password `Password@123`.
- Final demo accounts: `requester`, `hod.it`, `hod.ops`, `procurement`, `store`, `finance`, `auditor`, `admin`, `vendor1`, `vendor2`. **[`procurement2` removed in Phase 23.]**

## Phase 4: Database resilience

- The backend must never crash with `MongoServerSelectionError` / `ECONNREFUSED 127.0.0.1:27017`.
- It must start even when MongoDB is down, and connect to the local instance correctly when it is up.
- When the database is unavailable, reconnect automatically and return a clear error (503) instead of an unhandled 500.
- Explain why this error happens in local Node.js and Mongoose setups.

## Phase 5: Production audit

- **Live dropdowns.** `/api/auth/signup-options` reads departments from MongoDB, so real users never see an empty list or an "Internal Server Error". The invoice "Select PO" dropdown reads live PO records.
- **Vendor PO filter.** When a vendor submits an invoice, the PO dropdown lists only POs awarded to and accepted by that vendor. A vendor never sees another vendor's POs.
- **Active and past POs.** The PO dashboard has Active and Completed/Past tabs or filters, covering completed, closed and fully paid POs. This is for Procurement, Finance and Vendors.
- **Award to PO.** Audit the RFQ award end to end. A genuine PO must be saved in MongoDB and appear immediately on the right dashboards.

## Phase 6: Vendor privacy

- Only the winning vendor sees that an RFQ was awarded, and only they see the PO reference.
- Losing vendors never see who won, that the RFQ was awarded, or the PO. They see their own bid history and that the RFQ has closed, with no competitor data.

## Phase 7: Workflow completeness review

Check that the flow is complete:

> requester raises the request → HOD approves → Procurement creates the RFQ → vendors bid → evaluation and PO → delivery and invoice → Finance verifies and pays

Fill in any missing enterprise steps, such as the GRN, quality inspection, partial shipments and multi-level financial approvals. Phase 8 builds these.

## Phase 8: Hospital go-live

**UI clarity**
- Procurement pages and all relevant tables show the vendor's name and the item name from their bid.
- Wherever a PO is chosen (GRN and elsewhere), the dropdown label reads `PO Number | Vendor Name | Company Name | Product/Item | Date/Time`.
- Procurement, vendor quote, order and invoice views show the price as `Actual Amount + Tax Amount = Total Amount`.
- Replace blocking pop-up alerts, such as the one shown when a vendor is selected, with toasts or inline confirmations.

**Journey path with blocking**
- A journey path at the top of each dashboard. It depends on the role: vendors see their RFQ-to-payment milestones, and internal staff see their approval tracks.
- Each step shows where work is stuck, e.g. "Pending at [Department / User]".
- If an action depends on another authority, its buttons are locked for everyone else and a banner says: *"Action locked: Process/Approval pending at [Department / User Name]. Please wait until completion."*

**Hospital features**
- **Batch, expiry and serial numbers.**
  - Captured on GRN lines (`POST /grn`) and in inventory.
  - Expired items are blocked, and there is a near-expiry report.
- **QC and quarantine.**
  - Endpoints: `GET /qc/inspections` and `POST /qc/inspections/:id/decision`.
  - Goods can be invoiced only after QC approves them.
  - QC is done by Store. [Changed in Phase 9.]
- **Technical evaluation.**
  - Endpoints: `PATCH /sourcing/bids/:bidId/technical-review` and `POST /sourcing/rfqs/:id/open-financials`.
  - Only technically qualified bids are ranked. **[Phase 23: review is optional; only disqualified bids are left out.]**
- **Budget re-check at award.** `POST /sourcing/rfqs/:id/award` refuses an award that exceeds the budget, or escalates it with a warning dialog.
- **[Removed in Phase 23]** Short-close a PO.
- **Vendor licences.**
  - Endpoints: `POST /vendors/me/documents` plus verification endpoints.
  - Expired licences block bids and awards, and vendors get expiry alerts.
  - **[The licence section on RFQs is removed in Phase 11.]**
- **Bank payments.**
  - A real bank integration in `bank.service.ts`.
  - A `POST /treasury/payments/webhook` endpoint and a queue of failed payments.
- **Further workflows:**
  - Returns (`POST /grn/:id/returns`)
  - Debit and credit notes (`POST /invoices/:id/debit-notes`)
  - Exception decisions
  - Service and commissioning sign-off
  - PR and payment approval chains under DoA
  - Emergency purchases (`isEmergency`)

## Phase 9: Role consolidation

- Remove the separate Quality Control, Accounts Payable and Treasury accounts, profiles and dashboards.
- Keep their responsibilities and move them:
  - QC inspection is done by **Store** during the GRN.
  - The 3-way match, payment approvals, tax checks and payment release are done by **Finance**.
- Final roles: Requester, HOD, Procurement, Store, Finance, Auditor, Admin, Vendor. Leave their workflows, buttons, permissions and dashboards exactly as they are.
- Keep all earlier UI work: rich PO dropdowns, price breakdowns, toasts, and journey paths with locks.

## Phase 10: Journey matches the merged roles

- Remove every journey step, stage or blocker that belongs to QC, AP or Treasury.
- Goods receipt and inspection becomes a single step owned by Store.
- Invoice verification, the 3-way match, tax checks and payment release are grouped under one Finance stage.
- Every lock and "pending at" message names an active role only.

## Phase 11: Twelve UI and workflow changes

1. **Journey colours:** completed steps blue, pending steps yellow.
2. **Popup forms:** New PR and the other core forms open as popups over the current page instead of on a separate page.
3. **Your action:** keep the "Your action" text on the journey and put a **"Go to task"** button next to it.
4. **[Removed in Phase 14]** A message box after an action, for notifying the next person.
5. **No licence section:** remove "Licences a vendor must hold, verified and current" from all RFQ and tender pages.
6. **[Replaced in Phase 13]** A "Start Bidding" button on approved PRs.
7. **Mandatory department:** a PR must have a department, so it routes to that department's HOD.
8. **Item types:** keep General goods, Drug / consumable (batch & expiry), Device (serial numbers), Equipment (serials & commissioning) and Service. Add:
   - Surgical Instruments
   - Capital Equipment / Medical Assets
   - Laboratory Reagents & Lab Supplies
   - IT & Electronics
   - Maintenance & Facility Items
9. **Item autocomplete:** typing an item description suggests matching items from the master catalog or inventory.
10. **Auto-fill:** picking a suggestion fills in its UOM (e.g. EA) and standard estimated unit price. **[Item Code removed in Phase 29.]**
11. **Justification dropdown:** common reasons such as "Urgent stock restock", "Monthly consumption items" and "Emergency clinical requirement", plus a custom text option.
12. **Font:** Poppins on every page, component, button and modal.

## Phase 12: Explain the workflow

Give a short plain-bullet explanation of the updated flow. It should cover:
- Live PR submission, with no drafts.
- Pending and completed journey statuses.
- The PR chat and its read receipts.
- Starting an RFQ from a PR, and the two bidding options.
- That completion popups have been removed.

## Phase 13: Journey, drafts, RFQ start and access

1. **Full journey.** Every PR shows its whole journey from the start; future steps are not hidden. Step text is specific: a pending step reads like "Waiting for HOD review", a finished one like "HOD approval completed".
2. **No drafts.**
   - Remove "Save as Draft". A submitted PR goes live straight away.
   - Each PR gets **Edit** and **Cancel** buttons after submission.
3. **PR chat.** Each PR has its own message thread. Every authorised user involved can post and see the full history. Read status uses WhatsApp-style ticks.
4. **Initiate RFQ.**
   - The PR tab lists every PR, each with its own working **"Initiate RFQ"** button.
   - Remove the standalone "New RFQ" form entirely.
   - "Initiate RFQ" opens the RFQ form pre-filled with that one PR's details only.
5. **Two ways to open bidding:**
   - **Publish to all vendors:** the RFQ appears under open RFQs for every registered vendor.
   - **Invite past vendors:** a list of past vendors to tick, and only those vendors receive the private invitation. Nothing is broadcast.
6. **Access.** Fix every routing and role-check bug. Every role should reach its own dashboards, modules and PR or RFQ actions: Requester, both HODs (IT and Ops), Procurement, Finance and Vendor. Authorised users must never hit an unexpected "Access Denied" page or a blank or false permission block.

## Phase 14: No popups, Start Chat, exact step labels (final)

1. **No completion popups.**
   - Remove every automatic completion message, reminder card and forced prompt that appears after a step such as HOD approval or a status change.
   - This includes the "message the next person" dialog and the Messages card.
   - Actions complete directly, with no interruptions, for every role.
2. **Start Chat.**
   - Every PR journey card on the dashboard has a **"Start Chat"** button placed **directly below "Go to task"**.
   - It opens a shared chat for that PR alone, and the same thread also appears in the PR view (`PrDetail.tsx`, `Workflow.tsx`).
   - Requesters, IT and Ops HODs, Procurement, Finance and Admin collaborate there in real time.
   - Read receipts: a single ✓ means sent and a blue ✓✓ means read. Hovering shows who read it.
   - Messages and read receipts are stored by the `PrMessage` model (`PrMessage.ts`) and handled in `requisition.controller.ts`.
3. **One exact label per step.**
   - A pending step shows a single, exact status, such as "HOD approval pending: waiting for HOD review", with no duplicate tags.
   - It changes to the completed text, such as "HOD approval completed", only after the step has actually been done.

## Phase 15: Resume, check and fix only what is broken (7 Nov)

**This phase adds no new features.** It confirms Phase 14 and tells the builder how to work:
- Do not rewrite features that already work, and do not regenerate code that already exists.
- Look at the current state of the work and find the tests that still fail and any unfinished edge cases, such as cancelling a PR.
- Fix only what is broken. All database flows and tests must pass cleanly.

It restates the Phase 14 requirements:
1. No task-completion popups, reminder cards or forced prompts after a step.
2. Every journey card keeps its PR chat, with ✓ for sent and a blue ✓✓ for read, and who read it shown on hover.
3. Step labels clearly separate pending from completed.

Also: when a confirm dialog has its own Cancel button for closing it, the confirm button must have a different name. For example, cancelling a PR asks the user to confirm with **"Cancel PR"**.

## Phase 16: Deploy on Vercel (12 Nov)

**[Removed in Phase 17: all Vercel-specific setup was taken out. Do not build this phase.]**

Build the project for Vercel and list the environment variables it needs.

**Deployment shape**
- Use one Vercel project with two services: the Vite frontend and the Express backend.
- `/api/*` goes to the backend. Every other path serves the frontend.
- Client routes such as `/requisitions` fall back to `index.html`, so reloading or opening a deep link works.

**Backend entry for Vercel**
- The backend gets its own serverless entry file, `backend/src/vercel.ts`.
- It exports the Express app and connects to MongoDB on the first request, reusing that connection afterwards.
- It runs the startup migrations once per instance.
- If MongoDB can't be reached, the request gets the usual 503 and the next request tries to connect again.
- Local development and `npm start` keep using `server.ts`, unchanged.

**Build**
- On Vercel, the backend's build step only typechecks.
- That way Vercel bundles from the serverless entry instead of picking up a compiled `dist/app.js`.

**Environment variables**
- `MONGO_URI` must point at a hosted MongoDB, such as MongoDB Atlas, that accepts connections from Vercel.
- `JWT_SECRET` is required.
- `INTERNAL_SIGNUP_CODE` allows staff signups in production.
- `BANK_API_URL`, `BANK_API_KEY` and `BANK_WEBHOOK_SECRET` enable real payments; without them, payment release is refused in production.
- `CLIENT_ORIGIN` should be the site's address.
- The rest are optional and have defaults.

## Phase 17: Remove the Vercel setup (12 Nov)

- Remove only the Vercel deployment files: `vercel.json`, `backend/src/vercel.ts`, and any build overrides or build output added for Vercel.
- Do not change core backend logic, frontend routing, database connections or workflow files.
- The project must stay clean and fully working for local development (`npm run dev`).

## Phase 18: One root directory for Vercel (12 Nov)

- Vercel's Git import must detect a single deployable directory, the repository root, instead of separate `frontend` and `backend` ones.
- Use one `package.json` at the root with every dependency and script. `backend/` and `frontend/` keep their code but have no `package.json` of their own.
- Local commands stay the same: `npm run dev`, `seed`, `build`, `typecheck` and `test:e2e`.
- Deploy from the root as one Vercel project:
  - `vercel.json` builds the frontend.
  - `api/index.ts` serves the backend under `/api`, connecting to MongoDB on the first request.
  - Client routes fall back to `index.html`.
- Do not change backend logic, frontend routing or database code.

## Phase 19: Demo accounts on the live database, and push to main (12 Nov)

- Check the seed script and make sure every demo test account works on the live (hosted) database. These are requester, hod.it, hod.ops, procurement, procurement2, store, finance, auditor, admin, vendor1 and vendor2, all with password `Password@123`.
- The seed script wipes all P2P data before recreating the demo data, and it refuses to run with `NODE_ENV=production`. To seed a hosted database, run `npm run seed` locally with `MONGO_URI` pointing at it. Do this only when its existing data may be lost.
- Check git status, commit all the latest changes and fixes with a clean message, and push to `main`.

## Phase 20: Demo login chips on the live site (12 Nov)

- The one-click demo chips (requester, hod.it, hod.ops, procurement, procurement2, store, finance, auditor, vendor1, vendor2, admin; password `Password@123`) must appear on the deployed Vercel site, not only locally.
- They were hidden because they rendered only in development builds. Production builds must include them too.
- Optional: setting `VITE_HIDE_DEMO_LOGINS=true` at build time hides them once real users go live.
- Push the fix to GitHub (`main`) so Vercel redeploys.

## Phase 21: Debug "The database is temporarily unavailable" on Vercel (12 Nov)

- Check the backend's connection error handling and how `MONGO_URI` is read from the environment.
- Make `/api/health` report database connectivity in enough detail to debug a live deployment:
  - the connection state;
  - whether `MONGO_URI` is set;
  - the host and database, without credentials;
  - the last connection error, with a hint for the likely fix;
  - whether `JWT_SECRET` is set.
- Read `MONGO_URI` safely: trim spaces, line breaks and wrapping quotes.
- On Vercel, never fall back to the local database address or the development JWT secret. Report a missing value instead.
- Push the fix to `main`.

## Phase 22: Analyse 12 changes before building (13 Nov)

- Inspect the codebase and explain, for each of 12 changes: what was understood, how it works today, what will change, the workflow afterwards, and what stays untouched.
- Do not edit anything until the plan is approved. Ask only questions that genuinely need a decision.

## Phase 23: Simplified PR-to-GRN workflow, universal chat and display changes (13 Nov)

1. **PR edit until HOD approval.** The requester can edit their PR only until the HOD approves it. Enforced in the UI and the API. A rejected PR stays editable for resubmission.
2. **RFQ Initiated.** Once a PR has an RFQ, "Initiate RFQ" is replaced by an **RFQ Initiated** label and a **View RFQ** button that opens that exact RFQ, expanded, under RFQs & Bids. Duplicate RFQs stay blocked.
3. **[Replaced in Phase 27: the two-envelope tender and technical review are removed entirely]** **No mandatory Qualify/Disqualify gate.** Procurement can open the financials of a two-envelope tender without reviewing every bid. Technical review stays optional; disqualified bids are still not ranked or awarded. Prices stay sealed until opened, and vendors never see rival prices.
4. **One Procurement user.** Remove the `procurement2` demo account from the seed, login chips and tests (never delete it from a live database). The journey no longer has separate "PO approval" and "PO issued" stages: one **"PO generated"** step, which waits on HOD/Finance only when the PO is above Procurement's authority.
5. **Automatic PO.** Selecting the winning vendor generates the PO. If its Procurement approval level is within the Procurement user's DoA authority, it is approved automatically, and a PO with no further levels is issued at once. HOD/Finance levels, budget checks and escalations still apply, and the final approval issues the PO automatically.
6. **No vendor acknowledgement.** PO generated → Store GRN. Vendors can invoice as soon as the PO is issued. Vendors still see their POs.
7. **Remove Short-close and Deactivate.** Remove the PO short-close action and the PR deactivate action completely (buttons, endpoints and UI). Leave the Admin user and DoA-rule activate/deactivate toggles untouched.
8. **[Icon placement replaced in Phase 24]** **Universal chat icon.** A chat icon with an unread badge for every role (Requester, HODs, Procurement, Store, Finance, Auditor, Vendor, Admin). Counts are per user, exclude the user's own messages, and update on reading. Read receipts: ✓ sent, blue ✓✓ read, hover shows who read it and when. Each role sees only the conversations it is allowed to see.
9. **[Replaced in Phase 29: one Item / Product Name field per line]** **Product title × quantity.** Item lines get an optional product title, shown as "Product title × quantity" in tables, with the description still available. Older lines fall back to the description.
10. **Journey cards.** The PR/PO number in blue, then a labelled Title and a labelled Description. A PO's title is its RFQ title; a PR's description is its justification.
11. **GRN PO dropdown.** Each option: PO number | PO title | vendor name | company | product | description | date and time. The value stays the PO ID.
12. **Live bids first** on the Bidding Dashboard.

## Phase 24: Chat icon on every journey card (13 Nov)

1. Remove the chat icon and central inbox from the sidebar completely.
2. On every PR and PO journey card, replace the "Start Chat" button with a compact chat icon (💬) and a per-user unread badge for that card's conversation.
3. The icon appears on every role's journey cards: Requester, HODs, Procurement, Store, Finance, Auditor, Admin and Vendor.
   - Internal cards open the PR conversation.
   - Vendor cards open the vendor's private conversation with Procurement on that RFQ, which continues once it becomes their PO. Only that vendor, Procurement and Admin take part; the Auditor reads it.
   - **[Replaced in Phase 26: the awarded vendor joins the PR/PO conversation]** Internal PR conversations stay internal. On a card with an RFQ, Procurement, Admin and the Auditor also see a tab per vendor conversation.
   - A vendor sees the buyer's team name, never staff names.
4. Keep the WhatsApp-style read receipts (✓, blue ✓✓, who read it and when on hover) and per-user unread tracking.

## Phase 25: Unread badge missing on the journey chat icons (13 Nov)

- The 💬 icon showed on PR/PO journey cards but its unread badge never appeared. Each icon must show the user's unread count for that card's conversation (1, 2, 3 …) and update as soon as it is read.
- Cause: the API dev server had not reloaded the new chat routes (its file watcher missed the changes in the OneDrive folder), so `/api/chat/unread` returned 404 and the card treated the failure as zero. Restart `npm run dev` after backend changes if the API does not reload by itself.
- A failed unread request must never look like "no unread messages": the journey card says the counts could not be loaded and keeps the last badges shown.

## Phase 26: The awarded vendor joins the PR/PO conversation (13 Nov)

**[Partly replaced in Phase 27: the vendor joins from the moment they are selected, not once the PO is issued.]**

1. **Vendor chat access.** The vendor a PO is awarded and issued to can read the full history of that PR/PO conversation, see replies from internal users, and post in it, with per-user unread badges and WhatsApp-style read receipts.
   - Only for their own live PO: never a losing vendor, never before the PO is issued, and not after their PO is cancelled and the PR sourced again.
   - The vendor sees internal senders and readers by team ("Procurement", "Finance"), never by staff name.
   - The vendor's journey card shows the order conversation and their private conversation with the buyer, each with its own unread count.
2. **Never count your own messages.** A message is unread only for users other than its sender, in every kind of conversation.
3. Run the typechecks and tests afterwards.

## Phase 27: No envelopes, direct vendor selection, vendor chat from the RFQ stage (20 Nov)

1. **Remove the two-envelope and Qualify/Disqualify workflow completely**, backend and frontend:
   - Remove the technical evaluation gate, the Qualify/Disqualify buttons, the technical review scores and remarks, and the "Open financials" step and button.
   - Remove it from the RFQ creation form, the RFQs & Bids panel and the bidding dashboard.
   - Show every submitted bid, with its details and prices, in the bids list as soon as it is submitted. There are no sealed envelopes, and the list refreshes while bidding is open.
   - Put a **Select vendor** button next to every submitted bid. It works during bidding (selecting then closes bidding for every vendor) or after it.
   - Selection still runs the existing checks and generates the PO automatically: a non-L1 justification, licences, the budget re-check and escalation, and DoA.
   - Vendors still never see each other's bids, and a losing vendor never learns of the award.
2. **Vendor chat from the RFQ stage.**
   - An invited vendor has their private conversation with the buyer (Procurement and Admin; the Auditor reads it) from the moment they receive the RFQ, through bidding, selection and the PO stage. It shows the full history and internal replies by team name, lets the vendor send messages, and has per-user unread badges and ✓ / blue ✓✓ read receipts.
   - The selected vendor also joins the shared PR/PO conversation **from the moment they are selected**, not when the PO is issued. They can post there. **[Replaced in Phase 28: they see only messages from their selection on.]**
   - A losing vendor never joins it, and the vendor leaves it if their PO is cancelled.
   - A user's own messages are never unread for them, in any conversation.
3. Update the end-to-end tests, run the typechecks, and make sure every test passes.

## Phase 28: Hide earlier PR messages from the selected vendor, then push (20 Nov)

- In the shared PR/PO conversation, a selected vendor sees **only messages sent at or after their selection** (the RFQ's `awardedAt`).
- Their unread counts exclude everything sent before it, and reading the conversation leaves no read receipt on the hidden messages.
- Every internal message sent on that PR before the selection stays completely hidden from the vendor.
- Internal staff (Requester, HOD, Procurement, Finance, Store, Admin, Auditor) keep the full history.
- Once all tests pass, commit everything, including the Phase 27 changes, and push to `main`.

## Phase 29: Remove Item Code; one Item / Product Name per line (20 Nov)

**Strict constraints**
- Do not change any P2P workflow logic, approval flows, status transitions, permissions or business rules.
- Leave the New Purchase Requisition header fields exactly as they are: Title, Department, Priority, Business justification and the Emergency purchase checkbox.
- Make no other UI, styling or feature changes.

**Changes**
1. **Remove Item Code completely**, in the frontend and backend:
   - Pages, modals and line-item tables for PRs, RFQs and bids, POs, GRN and service sign-off, and invoices and the 3-way match.
   - Mongoose schemas, controllers, validation, catalog suggestions, seed data and API payloads.
   - Item codes already stored on existing lines are removed on start-up.
   - Stock is keyed by the item name, as items without a code already were.
2. **One Item / Product Name field per line**:
   - The New PR line-item table becomes Item / Product Name (with the catalog autocomplete), Type, Qty, UoM, Est. unit price and Line total. The separate Item Code, Product title and Description columns are gone.
   - Downstream RFQ, vendor bid, PO, GRN and invoice tables show that single name, with no description line under it.
   - An older line with a separate product title shows, and edits as, that one name.
3. Run the typechecks and update and run the existing tests.

## Phase 30: Clear "Your action" labels and Close Bid & Select Vendor (20 Nov)

**Strict constraints**
- Do not commit or push.
- Do not change workflow logic, validation, status transitions, permissions or business rules.
- Change only labels and wording.

**Changes**
1. **Procurement's journey card during bidding:**
   - RFQ open with 0 bids: "Waiting for vendor bids". This is a passive wait, so it is not shown as Procurement's action.
   - RFQ open with 1 or more bids: "Your action: Close bid & select vendor".
   - Bidding closed and no vendor awarded yet: "Your action: Select vendor".
2. **RfqBidsPanel:**
   - While bidding is open, the button next to each bid reads **"Close Bid & Select Vendor"**. The confirmation dialog says that confirming closes bidding for all vendors and awards that vendor immediately.
   - Once bidding has closed, the button stays "Select vendor".
3. **Audit "Your action" for every role and stage:**
   - "Your action" names what the user actually does: Submit PR, Approve PR, Initiate/Publish RFQ, Close bid & select vendor, Select vendor, Approve the budget escalation, Create PO, Approve PO, Submit bid, Record GRN, Sign off the service/commissioning, Submit invoice, Verify invoice, Ratify the emergency purchase, Verify tax, Approve payment, Release payment, Invoice the rest of the PO.
   - A passive wait is never shown as the user's action; the card shows what it is waiting for instead.
   - Every other role sees the existing "pending at …" message.
4. Update the journey-card and end-to-end tests, run the typechecks, and make sure every test passes. Leave the changes uncommitted.

## Phase 31: "Your action" labels must show on the live dashboard (20 Nov)

- The dashboard still showed raw step names ("Your action: Bidding", "Vendor selected", "Bid submitted").
- Cause: the local API dev server was still running code from before Phase 27, because `tsx watch` misses file changes in the OneDrive folder. The card then fell back to the step name.
- Fixes:
  - The only place that renders "Your action" is the journey card (`TrackView`), used by the dashboard and the PR view. It never shows a raw step name: without an instruction from the server, it shows the card's waiting message instead.
  - When bidding closes with 0 bids (by time or closed manually), Procurement sees "No bids received" as a wait, not "Select vendor".
  - Restart or reload the dev servers so `localhost:5173` serves the latest code. Re-saving `backend/src/server.ts` makes `tsx watch` reload.
- Verify with tests and typechecks, and against the running API. Do not commit or push.

## Phase 32: Remove "Re-run match" from Finance's invoice list (20 Nov)

- On the Invoices page (`/invoices`), remove the **Re-run match** button from the invoice action column.
- Keep **Book liability**, **Reject** and **Add note**.
- Do not change the backend 3-way match, the invoice approval workflow or any business rule.
- Update the tests if needed, run the typechecks, and leave the changes uncommitted.

## Phase 33: Remove "Add note" from Finance's invoice list (20 Nov)

- On the Invoices page (`/invoices`), also remove the **Add note** button (debit/credit notes) from the invoice action column. Only **Book liability** and **Reject** remain.
- Its dialog is then unused in the UI, so it goes too.
- Do not change the backend invoice workflow, the 3-way match, the debit/credit note endpoints or any business rule.
- Update the tests if needed, run the typechecks, and leave the changes uncommitted.


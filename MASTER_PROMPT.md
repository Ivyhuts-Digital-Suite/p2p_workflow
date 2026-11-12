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
1. **Purchase Requisition (PR).** Users create, update and submit PRs against department budgets. The HOD or Admin can deactivate or cancel a PR.
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
- Final demo accounts: `requester`, `hod.it`, `hod.ops`, `procurement`, `procurement2`, `store`, `finance`, `auditor`, `admin`, `vendor1`, `vendor2`.

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
  - Only technically qualified bids are ranked.
- **Budget re-check at award.** `POST /sourcing/rfqs/:id/award` refuses an award that exceeds the budget, or escalates it with a warning dialog.
- **Short-close a PO.** `POST /purchase-orders/:id/short-close`, with a reason, releases the unused budget.
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
10. **Auto-fill:** picking a suggestion fills in its Item Code, UOM (e.g. EA) and standard estimated unit price.
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


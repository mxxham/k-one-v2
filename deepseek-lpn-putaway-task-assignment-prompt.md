# DeepSeek V4 Prompt — LPN-Based Putaway with Task Assignment (extends S42)

Paste into opencode-ai with DeepSeek V4 Flash. This is an EXTENSION of the S42
"Auto on Goods Received" deferred-write design — not a replacement. Read the note below
before starting.

## ⚠️ Scope decision reversal — record this in todo.md

An earlier phase (S24-S28 planning) explicitly excluded labor/task management:
*"Labor/task management — no picker assignment, no per-user productivity tracking...
leave it unassigned/open-pool."* That decision is now REVERSED by the user for this
specific workflow (putaway task assignment only — this does NOT reopen productivity
tracking or picking/outbound task assignment, which remain out of scope unless the user
says otherwise). Your todo.md entry for this phase MUST note this reversal explicitly,
quoting both the original exclusion and the new decision, so the history stays honest
about what changed and why — don't just silently add the feature as if it was always
planned.

---

## The full target workflow (confirm your build matches this exactly)

```
1. Trailer arrives → inbound staff scan the SKU (existing stock::scan flow)
2. System auto-generates an LPN (License Plate Number — a unique code per physical
   pallet/unit-load) and staff print a label via browser (HTML print) for now —
   built behind a swappable interface so real Zebra network printer hardware can be
   added later as a second implementation, once available                     [NEW]
3. Staff physically stick the LPN label onto the pallet                       [manual]
4. System auto-calculates putaway suggestion — FEFO + bulk(reserve)/pick-fast split
   — creates a Pending putaway task exactly per the existing S42 design        [existing]
5. Inbound operator (desktop/laptop) assigns the Pending task to a 2-person team:
   a Forklift Operator (physical mover) and a Checklist Partner (device/scanner)
                                                                                 [NEW]
6. The Checklist Partner opens their task list on phone/tablet (mobile-friendly
   web view)                                                                   [NEW]
7. At the bin, Checklist Partner scans the LPN, then scans the destination bin
   barcode. If both match the assigned task, it completes — stock_locations gets
   written at THIS moment (same completion trigger as S42, now fired by the
   dual-scan instead of a manual "Confirm" button)                             [NEW]
```

**Note on hardware:** the LPN print step uses HTML/browser printing for now, not a
dedicated Zebra thermal printer — no hardware has been approved/confirmed available yet.
The `LabelPrinterService` abstraction in Step 1 exists specifically so upgrading to real
network label-printer hardware later is a config + one new file change, not a rewrite of
receiving/putaway logic. Don't skip building that abstraction just because the interim
implementation is simple — it's what makes the future upgrade cheap.

---

## System / Context Block

```
You are working on k-one-v2, a warehouse management system.

STACK:
- Monorepo: apps/api (NestJS + TypeScript), apps/web (React + Vite + TS + Tailwind)
- Routing: single gateway/dispatcher pattern — actions registered via
  registerActions('module', {...}).
- CRITICAL: an earlier phase (referred to as "S42" in prior work) already built:
  - Deferred putaway writes: recommendLocations() suggestions are NOT written to
    stock_locations immediately at scan/Goods-Received time. Instead they create a
    Pending putaway task record.
  - Inbound completion is BLOCKED while any linked putaway task is still Pending.
  - A manual confirm/override action on that task writes the bins and records who
    completed it + when.
  SHOW ME the actual current implementation of this — the task table name, its columns,
  the service/actions file, and the manual confirm action — BEFORE writing any code.
  Do not assume field names from this prompt's description; confirm them from the real
  source first. This entire phase is an EXTENSION of that table/flow, not a new
  parallel system — reuse the existing Pending-task record, add columns/actions to it.

RULES:
- Give me COMPLETE replacement files, not diffs or partial snippets.
- Migration SQL first, before any TypeScript, for schema changes.
- Before writing code, list every file you will create or modify.
- Show me the CURRENT full contents of any file you're about to modify before proposing
  changes — especially the S42 putaway-task table/service, which this whole phase
  builds on top of.
- Add e2e test coverage for new write actions, matching apps/api/test/*.e2e-spec.ts.
- Update todo.md (new S-numbered entry — check the current highest S-number first, don't
  guess) and session.md's Decision log, only after typecheck+build+tests pass. Include
  the scope-reversal note from above in the todo.md entry. Show me both diffs before
  finishing.
```

---

## Step 1 — LPN generation + label printing (HTML fallback, swappable to Zebra ZPL later)

```
GOAL: Generate a unique LPN per pallet at the point of SKU scan during receiving, and
print a physical barcode label for it — for now using a browser-printable HTML label
(no dedicated label printer hardware available yet), but built so switching to a real
Zebra network printer later is a small config/adapter change, not a rewrite.

REQUIREMENTS:
1. LPN format: a short, scannable unique code, e.g. `LPN-YYYYMMDD-#####` (confirm
   against your existing number-generation helper in apps/api/src/common/number-gen.ts
   — reuse its race-safe retry pattern rather than writing a new one).
2. New column on whatever table represents a single pallet/putaway-line (confirm from
   the S42 task table you were shown) — `lpn_code TEXT UNIQUE`, generated at the moment
   the line is created (i.e. at Goods Received time, same moment the Pending putaway
   task is created per S42).
3. Design the print step behind a small abstraction so the backend doesn't need to
   change when real hardware arrives later:
   - A `LabelPrinterService` interface/class with one method, e.g.
     `printLpnLabel(data: LpnLabelData): Promise<{success, message}>`.
   - For THIS phase, implement an `HtmlLabelPrinterService` — it does NOT print
     anything server-side; instead it just confirms the LPN exists and returns the data
     needed to render a printable label in the browser (this keeps the "print" action
     itself client-side, which is the only real option without dedicated hardware).
   - Leave a clear comment/marker (e.g. `// TODO: swap to ZebraLabelPrinterService once
     network printer hardware is available — same interface, see LabelPrinterService`)
     so a future phase can drop in a TCP/ZPL implementation without touching any
     calling code.
4. New backend action `putaway::get_lpn_label_data` — returns everything needed to
   render the label: LPN code, product name, batch, qty, expiry, suggested location,
   as structured JSON (not pre-rendered HTML — rendering happens on the frontend so the
   print layout can be iterated on without backend changes).
5. Frontend: an LPN label component (new, e.g. `components/LpnLabel.tsx`) styled for
   actual label printing — needs a print-specific CSS layout (correct physical
   dimensions, high-contrast barcode, avoid browser print headers/footers via
   `@media print` rules) rather than just reusing your existing on-screen HTML print
   pattern used for picklist/putaway/surat-jalan (those are read documents, not scanned
   barcodes — this one needs to actually scan reliably, so pay attention to barcode
   size/contrast in the CSS).
   - Use a barcode-rendering library already common in this kind of stack (e.g.
     `jsbarcode` or similar lightweight option) to render the LPN as an actual Code128
     barcode client-side, not just printed as text.
   - "Cetak Label LPN" (Print LPN Label) button triggers `window.print()` scoped to
     just the label via print CSS, plus a "Cetak Ulang" (reprint) option for
     damaged/lost labels — same data fetch, just triggered again.
6. Note in your todo.md entry: this is the HTML-print interim solution; the
   LabelPrinterService abstraction exists specifically so a later phase can add Zebra
   ZPL/network printing (raw ZPL over TCP port 9100) as a second implementation of the
   same interface, once real hardware is confirmed available, without any change to how
   receiving/putaway calls it.

Show me the S42 task creation code path in full before deciding exactly where the LPN
generation call should be hooked in.
```

---

## Step 2 — Putaway task assignment (2-person team)

```
GOAL: Let an inbound operator assign a Pending putaway task to a specific 2-person
team: a Forklift Operator (physically moves the pallet, no device interaction required)
and a Checklist Partner (uses the phone/web app to scan and confirm).

REQUIREMENTS:
1. Add two nullable columns to the S42 putaway-task table (confirm exact table name
   from what you were shown): `forklift_operator_id BIGINT REFERENCES users(id)` and
   `checklist_partner_id BIGINT REFERENCES users(id)`.
2. New action `putaway::assign_task` (permission: write, likely department 'inbound' —
   confirm against how other inbound write actions are department-scoped) — accepts
   task id + forklift_operator_id + checklist_partner_id, validates both users exist and
   are active, updates the task, logs to activity_log.
3. New action `putaway::unassign_task` — clears both assignee fields (e.g. reassigning
   after a shift change), write permission.
4. Frontend — on the inbound operator's task list view (wherever S42's Pending tasks are
   currently shown — confirm the exact page), add an "Assign" action per task: a modal
   with two user pickers (Forklift Operator, Checklist Partner), filtered to active users
   (confirm whether you should filter by department — likely inbound + inventory staff
   are the realistic pool, but ASK ME rather than guessing a specific filter).
5. Show unassigned tasks distinctly from assigned ones (e.g. a filter/tab) so the
   inbound operator can see at a glance what still needs a team.

Show me the current Pending-task list UI (whatever page renders S42's task list) before
adding the assignment modal — match its existing table/card style, don't introduce a
new visual pattern.
```

---

## Step 3 — Mobile task view + dual-scan confirmation

```
GOAL: The Checklist Partner needs a phone-friendly view of tasks assigned to THEM
specifically, and a scan-LPN-then-scan-bin confirmation flow that completes the task
(triggering the S42 write-to-stock_locations behavior) only when both scans match.

REQUIREMENTS:
1. New action `putaway::my_tasks` — returns Pending/Assigned tasks where
   checklist_partner_id = the logged-in user's id (read permission, any authenticated
   user can see their own). Also expose the forklift_operator's name on each task so the
   partner knows who they're paired with.
2. New frontend route (mobile-optimized — check your existing scan-input component
   pattern, likely components/ScanInput.tsx, and REUSE it rather than building a new
   input) — a simple task list, tap a task to open its confirm screen.
3. Confirm screen: TWO sequential scan steps —
   a. Scan LPN — validates against the task's lpn_code. Mismatch → red error, same
      pattern as your existing scan-mismatch handling elsewhere (require typed reason +
      override, logged to activity_log) — confirm this pattern from ScanInput's existing
      usage before reimplementing it differently here.
   b. Scan destination bin — validates against the task's suggested/assigned location.
      Same mismatch-override pattern.
4. When BOTH scans succeed (or are overridden with logged reasons), call whatever the
   EXISTING S42 manual-confirm action is (show me this action first — reuse it, don't
   duplicate its stock_locations-writing logic in a new function) — but now also record
   which user (the checklist_partner) performed the confirmation and when, on the task
   row, for the labour-tracking purpose S42 already established.
5. After completion, show a clear success state and return to the task list.

Show me ScanInput.tsx's current props/usage and the S42 manual-confirm action's full
implementation before writing this screen — this step must not reimplement either of
those, only orchestrate them in sequence.
```

---

**Order:** Step 1 (LPN + printing) and Step 2 (assignment) don't depend on each other —
either can go first. Step 3 (mobile confirm) depends on both, since it needs a real LPN
to scan and a real assignment to check "is this my task" — do it last.

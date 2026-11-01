# Security Specification (`security_spec.md`)

## 1. Access Model, Data Invariants & Relationship Mapping

- **Explicit User Requirement (Shared Account + Password Data Isolation)**: Users register or log in with a username (`usernameKey`) and password. Anyone logging in with the **same account and password** shares the exact same saved quotations (`Tệp lưu` / `Báo giá đã lưu`), catalog products (`Bảng giá`), and store settings (`Thông tin tiệm`), while different accounts are cryptographically isolated from one another.
- **Zero-Secret Account Registry (`/accounts/{usernameKey}`)**:
  - Stores only `{ usernameKey, displayName, verifierHash, createdAt, updatedAt }` where `verifierHash` (`^[a-f0-9]{64}$`) is derived client-side via PBKDF2-HMAC-SHA256 (`100,000` iterations, domain `"atdcolor-auth-verifier-v1"`).
  - `allow list: if false;` prevents username enumeration. `allow update, delete: if false;` prevents account takeover or password overwrite once created.
  - The workspace capability key `workspaceId` (`^ws_[a-f0-9]{64}$`, length `67`) is derived via a separate domain-separated PBKDF2-HMAC-SHA256 derivation (`"atdcolor-workspace-cap-v1"`) and is **never** stored in `/accounts/{usernameKey}`.
- **Workspace Master Source of Truth (`/workspaces/{workspaceId}/...`)**:
  - `/workspaces/{workspaceId}` itself cannot be listed (`allow read, write: if false;` via global catch-all). Knowledge of the 256-bit `workspaceId` requires knowing both `usernameKey` and `password`.
  - Every `WorkspaceInvoice`, `WorkspaceSettings`, and `WorkspaceProduct` document must include `workspaceId == path.workspaceId` and `accountUsername` referencing an existing `/accounts/{accountUsername}` document (`exists(...)` verified on `create`).
- **Relational Subcollection Sync & Atomic Batch Guarantee (Master Gate + Pillar 7)**:
  - `/workspaces/{workspaceId}/invoices/{invoiceId}/items/{itemId}` stores individual line items (never unbounded arrays on the parent document).
  - On `create` and `update` of a `WorkspaceInvoiceItem`, `isParentWorkspaceInvoiceMatchingAfter(workspaceId, invoiceId)` verifies via `existsAfter(...)` and `getAfter(...)` that the parent `WorkspaceInvoice` exists after the batch commits and `parent.workspaceId == workspaceId`.
  - On `get` and `delete` of a `WorkspaceInvoiceItem`, `isParentWorkspaceInvoiceMatching(workspaceId, invoiceId)` verifies via `exists(...)` and `get(...)` that the parent `WorkspaceInvoice` exists and `parent.workspaceId == workspaceId`.
- **Query Enforcement (`allow list` — Pillar 8)**:
  - `/workspaces/{workspaceId}/invoices/{invoiceId}`: `allow list` enforces `isValidWorkspaceId(workspaceId) && existing().workspaceId == workspaceId` (zero `get()`/`exists()` calls, single-field index safe, no `isValidId(invoiceId)` on `list`).
  - `/workspaces/{workspaceId}/invoices/{invoiceId}/items/{itemId}`: `allow list` enforces `isValidWorkspaceId(workspaceId) && isValidId(invoiceId) && existing().invoiceId == invoiceId`.
  - `/workspaces/{workspaceId}/products/{productId}`: `allow list` enforces `isValidWorkspaceId(workspaceId) && existing().workspaceId == workspaceId`.
  - `/workspaces/{workspaceId}/voucherBudgets/{monthKey}`: `allow list` enforces `isValidWorkspaceId(workspaceId) && existing().workspaceId == workspaceId`; single-doc path enforces `isValidMonthKey(monthKey)` (`^[0-9]{4}-(0[1-9]|1[0-2])$`).
  - `/workspaces/{workspaceId}/customers/{customerId}`: `allow list` enforces `isValidWorkspaceId(workspaceId) && existing().workspaceId == workspaceId`; PII (`name`, `phone`) is strictly isolated inside the 256-bit `workspaceId` capability boundary.
  - `/workspaces/{workspaceId}/inventory/{itemId}`: `allow list` enforces `isValidWorkspaceId(workspaceId) && existing().workspaceId == workspaceId` with zero `get()` calls; `quantity` (`0..1,000,000`), `minThreshold` (`0..1,000,000`), `packSize` (`1..100,000`), and `sortIndex` (`0..500`) are strictly bounded.
  - `/workspaces/{workspaceId}/revenueEntries/{entryId}`: `allow list` enforces `isValidWorkspaceId(workspaceId) && existing().workspaceId == workspaceId` with zero `get()` calls; `orderDate` (`YYYY-MM-DD`), `monthKey` (`YYYY-MM` matching `orderDate[0:7]`), `designAmount` (`0..10,000,000,000`), `printAmount` (`0..10,000,000,000`), and `totalRevenue == designAmount + printAmount` are strictly enforced, with immutable `workspaceId`, `accountUsername`, `invoiceId`, and `createdAt`.
  - `/workspaces/{workspaceId}/settings/{settingId}`: `allow list: if false;` (accessed strictly via single-document `doc(..., 'settings', 'store')`).
- **Legacy Read-Only Archive (`/invoices/{invoiceId}`)**:
  - Retained read-only (`allow create, update, delete: if false;`) with strict query boundaries so pre-account quotations can be optionally imported into an account without loss.

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Account Enumeration (`list /accounts`)**: Attacker attempts `getDocs(collection(db, 'accounts'))` to scrape usernames and verifier hashes. -> **DENIED** (`allow list: if false`).
2. **Account Overwrite / Takeover (`update` or `delete` `/accounts/{usernameKey}`)**: Attacker attempts to overwrite `verifierHash` on an existing `/accounts/atdcolor` doc. -> **DENIED** (`allow update, delete: if false`, and `create` fails when document already exists).
3. **Malformed Verifier Hash / Username Mismatch on Account Create**: Client attempts to create `/accounts/atdcolor` with `usernameKey: "other"` or non-64-hex `verifierHash`. -> **DENIED** (`isValidAccount` enforces `data.usernameKey == usernameKey` and `^[a-f0-9]{64}$`).
4. **Weak / Guessed Workspace ID Injection**: Attacker attempts to create `/workspaces/ws_123/invoices/inv_1` with a non-256-bit workspace ID. -> **DENIED** (`isValidWorkspaceId` enforces exact length `67` and `^ws_[a-f0-9]{64}$`).
5. **Unregistered Account Reference on Workspace Create**: Client attempts to create `/workspaces/{wsId}/invoices/inv_1` with `accountUsername: "ghost_user"` that does not exist in `/accounts`. -> **DENIED** (`exists(/databases/$(database)/documents/accounts/$(incoming().accountUsername))` rejects orphaned workspace writes).
6. **Shadow Field Injection on Create**: Payload for `WorkspaceInvoice` includes all required keys plus `"isAdmin": true`. -> **DENIED** (`data.keys().hasOnly(...)` rejects extra keys).
7. **Update-Gap / Value Poisoning**: Client updates allowed key `customerName` with a 500-char string or non-string value, or tampers with `totalRevenue != designAmount + printAmount` on `WorkspaceRevenueEntry`. -> **DENIED** (`isValidWorkspaceInvoice` / `isValidWorkspaceRevenueEntry` wrap the entire `allow update` block and enforce bounds + arithmetic invariants).
8. **Immutable Field Mutation**: Client updates `workspaceId`, `accountUsername`, `code` / `invoiceId`, or `createdAt` on an existing `WorkspaceInvoice` or `WorkspaceRevenueEntry`. -> **DENIED** (`affectedKeys().hasOnly(...)` excludes immutable fields and edit-action helpers enforce equality).
9. **Client Timestamp Forgery**: Client sends a forged `createdAt` or `updatedAt` timestamp instead of `serverTimestamp()`. -> **DENIED** (`incoming().createdAt == request.time` and `incoming().updatedAt == request.time`).
10. **Unfiltered List Scraping (`list` without query boundary)**: Client queries `workspaces/{wsId}/invoices` or `workspaces/{wsId}/revenueEntries` without `where('workspaceId', '==', wsId)`. -> **DENIED** (`allow list` checks `existing().workspaceId == workspaceId`).
11. **Orphaned Subcollection Item Create**: Client attempts to create `/workspaces/{wsId}/invoices/missing_inv/items/item_0` without creating the parent invoice in the batch. -> **DENIED** (`isParentWorkspaceInvoiceMatchingAfter` checks `existsAfter(...)`).
12. **Legacy Unauthenticated Write Bypass**: Client attempts to create or mutate `/invoices/inv_legacy` bypassing account authentication. -> **DENIED** (`allow create, update, delete: if false` on legacy `/invoices` and `/invoices/{invoiceId}/items`).

## 3. Red Team Audit & Conflict Report

- **Collection `/accounts/{usernameKey}`**:
  - *Enumeration & PII*: Blocked (`allow list: if false`; zero PII fields allowed by `hasOnly`).
  - *Account Takeover*: Blocked (`allow update, delete: if false`; `create` is atomic create-only).
- **Collection `/workspaces/{workspaceId}/invoices/{invoiceId}` & Subcollection `items/{itemId}`**:
  - *Cross-Account Isolation*: Enforced via 256-bit `workspaceId` (`^ws_[a-f0-9]{64}$`) never stored on `/accounts`.
  - *Shadow Update & Value Poisoning*: Blocked (`isValidWorkspaceInvoice` / `isValidWorkspaceInvoiceItem` wrap `allow update` + `affectedKeys().hasOnly(...)`; optional `reportStage` strictly constrained to `size() <= 30` and allowlisted enum `['', 'bao_gia', 'cham_soc', 'coc', 'chot_in', 'chot_thiet_ke', 'hoan_thanh']`).
  - *Master Gate & Atomic Batch Sync*: Enforced via `existsAfter` + `getAfter` on item `create`/`update` and `exists` + `get` on item `get`/`delete` AFTER static checks.
- **Collections `/workspaces/{workspaceId}/settings/{settingId}`, `/workspaces/{workspaceId}/products/{productId}`, `/workspaces/{workspaceId}/voucherBudgets/{monthKey}`, `/workspaces/{workspaceId}/customers/{customerId}`, `/workspaces/{workspaceId}/inventory/{itemId}`, & `/workspaces/{workspaceId}/revenueEntries/{entryId}`**:
  - *List Discipline*: `settings` forbids `list` (`allow list: if false`); `products`, `voucherBudgets`, `customers`, `inventory`, and `revenueEntries` enforce `existing().workspaceId == workspaceId` with zero `get()` calls.
  - *Schema, PII & Size Bounds*: Every string and numeric field has strict bounds synchronized with `firebase-blueprint.json`; `settings` restricts optional `logoVersion` and `signatureVersion` strictly to `^[a-zA-Z0-9_\-]*$` (`<= 40` chars, rejecting raw base64 blobs); `voucherBudgets` enforces `monthKey` (`YYYY-MM`) immutability and `0 <= budgetAmount <= 10,000,000,000`; `customers` isolates `name` (`1..120`) and `phone` (`1..30`) strictly within the workspace capability path; `inventory` enforces non-negative `quantity`/`minThreshold`, positive `packSize`, and immutable `workspaceId`/`accountUsername`/`createdAt`; `revenueEntries` enforces `orderDate` (`YYYY-MM-DD`), `monthKey == orderDate[0:7]`, `totalRevenue == designAmount + printAmount`, and immutable `workspaceId`/`accountUsername`/`invoiceId`/`createdAt`.

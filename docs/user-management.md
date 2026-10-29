# User management: list, filter, page and delete

This documents the work across two repos:

- **Backend** `jwt-pizza-service` (Express, MySQL, Jest + Supertest)
- **Frontend** `jwt-pizza` (React, Preline, Playwright)

We worked test-first: write a test, watch it fail (or note when it already passed), then implement.

## How a request flows

```
Admin clicks "Users"
  -> adminDashboard.tsx  openUserList()
  -> pizzaService.getUsers(page, limit, filter)         (service layer)
  -> httpPizzaService  GET /api/user?page=&limit=&name=
  -> userRouter.js     authenticateToken, then DB.getUsers
  -> database.js       SELECT ... LIMIT ? OFFSET ?
  <- { users: [...], more: true|false }
  -> table rendered in the overlay
```

Delete follows the same path with `DELETE /api/user/:id` and `DB.deleteUser`.

---

## Backend changes

### 1. `DB.getUsers(page, limit, name)` in `src/database/database.js`

Returns `[users, more]`.

- **Why it works:** it asks MySQL for `limit + 1` rows. If an extra row comes back, a next page exists (`more = true`) and the extra row is dropped. This avoids a separate `COUNT(*)` query.
- **Paging:** 1-based. `offset = (page - 1) * limit`. Franchises are 0-based; users are not.
- **Filter:** `*` in the name is replaced with `%` for SQL `LIKE`, so `*bob*` means "contains bob" and `*` means everyone.
- **Safety:** all values go through bound `?` parameters. Page and limit must be safe integers and name must be a string, otherwise a 400 is returned.
- **Roles:** each user is returned with their roles from `userRole`, and the password is never selected.

### 2. `GET /api/user` in `src/routes/userRouter.js`

- Wrapped in `authenticateToken`, so no token gives 401.
- Reads `page`, `limit` and `name` from the query string and returns `{ users, more }`.
- **Why it works:** the route only translates HTTP to a DB call. All SQL lives in `database.js`.

### 3. `DB.deleteUser(userId)` in `src/database/database.js`

Deletes exactly one user inside a transaction.

- Order is `auth` rows, then `userRole` rows, then the `user` row. Children go first so foreign keys never block the delete.
- If no `user` row was deleted (`affectedRows === 0`), it rolls back and throws a 404.
- **Why a transaction:** either everything for that user disappears or nothing does.

### 4. `DELETE /api/user/:userId` in `src/routes/userRouter.js`

- Rejects a non-integer id with 400.
- **Authorization:** allowed if the caller is that same user or has the admin role, otherwise 403.
- Calls `DB.deleteUser` and returns a success message.

### 5. Jest tests in `src/routes/userRouter.test.js`

- `jest.mock('../database/database.js', ...)` replaces the DB with fakes. Without it, importing the app opens a MySQL connection, which caused the "Cannot log after tests are done" error.
- The mock includes `addUser`, `loginUser` and `isLoggedIn` so that registering produces a real signed JWT that passes the auth middleware.
- Seven tests: list unauthorized (401), list, pagination options, name filter, delete unauthorized (401), delete own account, and 403 when deleting someone else without admin.

### 6. `.vscode/extensions.json`

Recommends the Jest extension so the tests appear in the VS Code Test pane.

---

## Frontend changes

### 7. Service layer: `pizzaService.ts` and `httpPizzaService.ts`

- `UserList` type: `{ users: User[]; more: boolean }`.
- `getUsers(page, limit, nameFilter)` calls `GET /api/user` with the filter URL-encoded.
- `deleteUser(user)` calls `DELETE /api/user/:id`.
- **Why two files:** `pizzaService.ts` defines the interface, `httpPizzaService.ts` implements it against the real API. Components only talk to the interface.

### 8. `src/views/adminDashboard.tsx`

- **Users button:** placed in a `flex justify-between` row with the Franchises title, so it sits on the same line, right-aligned.
- **Overlay:** a Preline modal (`hs-overlay hidden`). `HSOverlay.open()` shows it, and the X button uses `data-hs-overlay` to close it.
- **State:** `userList`, `userPage` (1-based), `userFilter` (applied filter), `filterUserRef` (input) and `userToDelete` (pending confirmation).
- **Paging:** `«` and `»` call `loadUsers(page ± 1, userFilter)`. `»` is disabled when `more` is false, `«` when on page 1.
- **Filter:** Submit wraps the text as `*text*`, resets to page 1 and reloads. Empty text means `*`.
- **Delete:** each row's Delete button only sets `userToDelete`. An inline panel above the list asks for confirmation. Confirm calls the API, hides the panel and reloads (stepping back a page if the last row of a later page was removed). Cancel just clears the state.
- **Why inline and not a new page:** navigating away would close the overlay.
- **Why the panel sits above the list:** the list is limited to `max-h-60` so the confirmation is visible without scrolling.

### 9. The `HSOverlay.autoInit()` fix

`app.tsx` initializes Preline only when the route changes. The modal is rendered after the admin user loads, so Preline never saw it and the button did nothing. An effect on `props.user` calls `HSOverlay.autoInit()` after the modal exists.

### 10. Playwright tests in `tests/user.spec.ts`

- `basicInit` mocks the franchise, auth and `/user/me` calls so no backend is needed.
- `openUserListAsAdmin(page)` mocks 13 users and behaves like the backend (page, limit, wildcard name). It also records requests and deleted ids so tests can assert on what the UI sent.
- Tests: `listUsersAsAdmin`, `listUsersPaging`, `listUsersNameFilter`, `deleteUser` (cancel sends nothing, confirm sends one DELETE).
- `mockUserService(page)` is an in-memory register, login, update and logout service used by `updateUser` and `updatePasswordAndEmail`, so those tests no longer need the real API.

---

## Running the tests

```
# backend
cd jwt-pizza-service && npm test -- --runInBand

# frontend
cd jwt-pizza && npx playwright test --reporter=line
```

Restart the real backend after pulling these changes. A server started earlier still runs the old code and returns an empty list.

## Known concerns (not changed)

- Any logged-in user can call `GET /api/user`. Only the frontend hides the button. Consider restricting the route to admins.
- Deleting a user leaves their `dinerOrder` rows behind.
- `DB.updateUser` builds SQL by string concatenation, which is a SQL injection risk.
- `config.js` holds plaintext secrets. Don't publish them.

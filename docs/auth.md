### Authentication in Unity ERP (Supabase + Next.js App Router)

This app uses Supabase Auth on the client with a thin provider that manages session state and navigation for public/protected routes.

- **Supabase client**: `lib/supabase.ts`
  - `persistSession: true`, `autoRefreshToken: true`, `detectSessionInUrl: true`.
- **Auth context/provider**: `components/common/auth-provider.tsx`
  - Exposes `{ user, loading }` via `useAuth()`.
  - Initializes session with `supabase.auth.getSession()` and subscribes to `onAuthStateChange`.
  - Redirects based on route type and user state.
- **App wiring**: `app/providers.tsx` wraps the app with `AuthProvider`.
- **Layout behavior**: `components/layout/root-layout.tsx` chooses sidebar vs. public navbar based on auth state.

### Routes: public vs. protected

- **Public routes** (no auth required): `/`, `/login`, `/forgot-password`, `/reset-password`, `/bypass`, `/bypass/orders`.
- **Protected routes**: everything else (e.g., `/dashboard`, `/staff`, `/inventory`, etc.).
- **Dev bypass (development only)**: certain routes are accessible without auth to speed development (e.g., `/orders`, `/quotes`, including some dynamic variants). This is controlled in `AuthProvider` and only active when `NODE_ENV=development`.

Update the allowlists in `components/common/auth-provider.tsx`:
- `publicRoutes`
- `devBypassRoutes` (regex-matched patterns for dynamic segments)

### Session lifecycle and UI states

1. **Initial load**
   - `AuthProvider` calls `supabase.auth.getSession()`.
   - `loading` starts as `true`; turns `false` when session resolves or after a 5s safety timeout.
   - `user` is set to the current session's user or `null`.

2. **Token refresh**
   - Supabase automatically refreshes tokens (`autoRefreshToken: true`).
   - When refresh occurs, `onAuthStateChange` fires (`TOKEN_REFRESHED`). `user` stays populated; UI remains authenticated.

3. **Auth state changes**
   - `onAuthStateChange` listens for: `SIGNED_IN`, `SIGNED_OUT`, `TOKEN_REFRESHED`, `USER_UPDATED`, etc.
   - The provider updates `user` from the new session and ensures `loading` is `false`.

### What happens if you are logged out while still in the app?

There are two common scenarios: manual sign-out and involuntary sign-out (token expiry/revocation).

- **Manual sign-out**
  - Triggered from the navbar: `supabase.auth.signOut()` (see `components/layout/navbar.tsx`).
  - The app immediately navigates to `/login` and `onAuthStateChange` sets `user` to `null`.
  - On protected pages, the `AuthProvider` redirect effect also pushes to `/login` if needed.

- **Token expiry or server-side revocation**
  - Supabase emits `SIGNED_OUT` when refresh fails or the session becomes invalid.
  - `AuthProvider` receives the event, sets `user` to `null`, and stops loading.
  - If you’re on a protected route, it redirects you to `/login`.
  - The layout switches from the sidebar app shell to the public navbar layout.

- **Dev bypass routes (development only)**
  - On routes included in `devBypassRoutes`, the provider skips auth checks entirely.
  - If you’re logged out mid-session on these routes, there is no auto-redirect. UI stays visible, but any API calls that require auth/valid RLS will fail.

### How redirects work

- After `loading` is `false`, a redirect effect runs in `AuthProvider`:
  - **Unauthenticated + protected route** → push to `/login`.
  - **Authenticated + on `/`, `/login`, `/forgot-password`, `/reset-password`** → push to `/dashboard`.
  - A guard (`hasRedirected`) prevents double-redirects.

### Layout and navigation shape

- `RootLayout` uses `useAuth()` to decide the chrome:
  - Authenticated (or a direct session check succeeds) → sidebar + app shell.
  - Unauthenticated → public navbar + page content.
- There’s a debug fallback that can “force show” the sidebar in development for troubleshooting.

### Troubleshooting mid-session issues

- If stuck on the “Loading…” screen, try:
  - Clear browser cookies for the domain
  - Visit the debug endpoint linked in the UI, or use the bypass page:
    - `GET /bypass` (clears local storage and signs out)
  - Try a private/incognito window
- Ensure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set; otherwise the provider disables auth gracefully.

### Adding new protected pages

- Just create your page in `app/`. The `AuthProvider` will handle redirects globally.
- In components, call `const { user, loading } = useAuth()` if you need to conditionally render while waiting for auth.

### Key files

- `lib/supabase.ts`: Supabase client configuration (persist/refresh).
- `components/common/auth-provider.tsx`: Session load, event subscription, and redirect rules.
- `app/providers.tsx`: Registers the provider app-wide.
- `components/layout/navbar.tsx`: Sign-out control and post-sign-out navigation.
- `components/layout/root-layout.tsx`: Chooses sidebar vs. public layout based on auth.

### Redirect expectations

- Unauthenticated on any protected route → redirect to `/login`.
- Authenticated on `/`, `/login`, `/forgot-password`, `/reset-password` → redirect to `/dashboard`.
- Optional: also `router.push('/login')` immediately on `SIGNED_OUT` to eliminate timing windows.

### Observed issue: can browse while logged out

Likely contributing factors:
- **Dev bypass enabled**: `devBypassRoutes` allows unauthenticated access to pages like `/orders`, `/quotes` in development.
- **Service-role APIs**: API routes using `supabaseAdmin` return data without verifying a user (e.g., `/api/quotes`).
- **Auth disabled by env**: Missing `NEXT_PUBLIC_SUPABASE_*` causes `AuthProvider` to skip checks entirely.
- **Layout masking**: `RootLayout` may show the sidebar via `forceShowSidebar`/`debug-show-sidebar` even when `user` is null.
- **Public routes**: Landing on a truly public path will not redirect.

### Hardening plan (no-code outline)

- **Disable or gate dev bypass**: Remove `devBypassRoutes` by default; if needed, guard behind an explicit env flag off by default and never enabled in production.
- **Enforce server-side redirects**: Add Next.js Middleware to check session cookies and redirect unauthenticated users away from protected paths to `/login`.
- **Stop unauthenticated service-role reads**: Prefer anon client + RLS for reads. If `supabaseAdmin` is required, validate a real user session/JWT in the handler before querying.
- **Tighten the app shell**: Only show the sidebar when `user` exists; remove `forceShowSidebar` and the `debug-show-sidebar` backdoor in non-development builds.
- **Guarantee provider runs**: Ensure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are present in client envs so the `AuthProvider` can enforce redirects.
- **Audit API routes**: Catalog all handlers using `supabaseAdmin` and add authentication checks or switch to RLS-backed anon queries.
- **Monitoring**: Log and alert on unauthenticated access to protected APIs; add CI checks that fail if service-role is used without a session gate.

# Auth Flow & Landing Page UI Improvements

**Date:** 2025-01-17

## Summary

Fixed visual inconsistencies on the landing and login pages, improved the login/logout flow to eliminate flashing and race conditions, and ensured sign out properly clears all auth state.

---

## Changes Made

### 1. Background Color Uniformity

**File:** `components/ui/background-paths.tsx`

**Problem:** The landing page and login page had a visible two-tone effect - a darker black content area framed by a lighter charcoal border. This was caused by `BackgroundPaths` using hardcoded `bg-neutral-950` while the rest of the app uses the `bg-background` CSS variable.

**Solution:** Changed `BackgroundPaths` to use the `bg-background` CSS variable instead of hardcoded colors.

```diff
- <div className={`... bg-white dark:bg-neutral-950 ${className}`}>
+ <div className={`... bg-background ${className}`}>

- <div className="absolute inset-0 bg-white/60 dark:bg-neutral-950/60" />
+ <div className="absolute inset-0 bg-background/60" />
```

---

### 2. Full-Bleed Route Handling

**File:** `components/layout/root-layout.tsx`

**Problem:** The landing page (`/`) and login page (`/login`) were wrapped in a container with padding, causing a visible edge even though `BackgroundPaths` uses `fixed inset-0`.

**Solution:** Added these routes as "full-bleed" routes that render without the container wrapper.

```typescript
// Full-bleed routes - have navbar but no container wrapper
const fullBleedRoutes = ['/', '/login'];

// Check if this is a full-bleed route
const isFullBleedRoute = fullBleedRoutes.includes(pathname);

// Full-bleed routes render with minimal wrapper
if (isFullBleedRoute) {
  return (
    <div className="h-screen w-screen overflow-hidden">
      <Navbar />
      {children}
    </div>
  );
}
```

Also updated sidebar logic to not show sidebar on full-bleed routes even if user is authenticated:

```typescript
const shouldShowSidebar = (!!user || forceShowSidebar) && !isFullBleedRoute;
```

---

### 3. Improved Login Flow

**File:** `app/(auth)/login/page.tsx`

**Problem:** After signing in, users experienced:
1. Screen flash
2. Brief blank screen
3. Login page showing again with empty inputs but sidebar visible
4. Finally redirecting to dashboard after 3-5 seconds

This was caused by a race condition between auth state updating and the redirect.

**Solution:**

1. Added `useAuth` hook to detect auth state changes:
```typescript
const { user, loading: authLoading } = useAuth();
```

2. Added `useEffect` to handle redirects when auth state changes:
```typescript
useEffect(() => {
  if (user && !authLoading) {
    setIsRedirecting(true);
    router.replace('/dashboard');
  }
}, [user, authLoading, router]);
```

3. Simplified submit handler (useEffect now handles redirect):
```typescript
console.log('Login successful, waiting for auth state to update');
setIsRedirecting(true);
// The useEffect will handle the redirect when auth state updates
```

4. Loading overlay now shows when redirecting OR when user is authenticated:
```typescript
const showLoadingOverlay = isRedirecting || (user && !authLoading);
```

5. Loading overlay uses consistent colors and high z-index:
```typescript
<div className="fixed inset-0 z-[100] flex items-center justify-center bg-background">
```

---

### 4. Fixed Sign Out Flow

**File:** `components/layout/navbar.tsx`

**Problem:** Clicking "Sign out" would immediately sign the user back in. This was caused by:
1. `forceShowSidebar` state in root-layout persisting after sign out
2. `hasRedirected` ref in auth-provider not resetting
3. Supabase session potentially not being fully cleared

**Solution:** Complete sign out with manual localStorage cleanup and hard redirect:

```typescript
<button
  onClick={async () => {
    try {
      // Sign out from Supabase (use global scope to invalidate all sessions)
      await supabase.auth.signOut({ scope: 'global' });
    } catch (error) {
      console.error('Sign out error:', error);
    }

    // Manually clear all Supabase-related localStorage keys
    if (typeof window !== 'undefined') {
      const keysToRemove = Object.keys(localStorage).filter(
        key => key.startsWith('sb-') || key === 'returnTo'
      );
      keysToRemove.forEach(key => localStorage.removeItem(key));
    }

    // Hard redirect to fully reset app state
    window.location.href = '/login';
  }}
>
  Sign out
</button>
```

Key improvements:
- Uses `scope: 'global'` to invalidate session on server
- Manually clears all `sb-*` localStorage keys (Supabase's storage prefix)
- Uses `window.location.href` instead of `router.push` to force full page reload and reset all React state

---

## Files Modified

| File | Change |
|------|--------|
| `components/ui/background-paths.tsx` | Use `bg-background` CSS variable instead of hardcoded colors |
| `components/layout/root-layout.tsx` | Add full-bleed route handling, prevent sidebar on auth pages |
| `app/(auth)/login/page.tsx` | Add auth state detection, improve loading overlay |
| `components/layout/navbar.tsx` | Thorough sign out with localStorage cleanup |

---

## Testing

1. **Landing page:** Should have uniform background color with no visible border/frame
2. **Login page:** Should have uniform background color
3. **Sign in:** Should show loading spinner immediately, smooth transition to dashboard
4. **Sign out:** Should redirect to login page and stay signed out (no auto-signin)
5. **Refresh after sign out:** Should remain on login page, not auto-signin

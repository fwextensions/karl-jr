# Plan: Zustand State Management for Karl Jr. Side Panel

## Problem Summary

The side panel's state is currently managed in two places:

1. `useSfGovPage` hook — returns 10+ values to `App.tsx`
2. `App.tsx` local state — holds `categorizedLinks`, `isLoadingLinks`, `missingAltTextUrls`

`App.tsx` then drills these down as props to cards. The clearest pain points:

| Prop | Flows to |
|---|---|
| `currentUrl` / `pagePath` | FeedbackCard, LinksCard → LinkChecker, A11yCard → A11yChecker, FormConfirmationCard |
| `categorizedLinks`, `isLoadingLinks` | MediaAssetsCard, LinksCard |
| `missingAltTextUrls` (as callback) | A11yCard → A11yChecker (writes), then App holds it and passes to MediaAssetsCard (reads) |
| `pageData.*` fields | PageHeader, MediaAssetsCard, MetadataCard, FormConfirmationCard, A11yCard |

The callback chain for `missingAltTextUrls` is the most awkward: A11yChecker calls `onMissingAltTextUrls` → App's `setMissingAltTextUrls` → MediaAssetsCard reads the result.

## Chosen Library: Zustand

Zustand is the right choice here over plain React Context because:

- **No provider boilerplate** — stores are plain modules, not component trees
- **Selector subscriptions** — each card subscribes only to what it needs, preventing unnecessary re-renders
- **Works outside React** — could be called from the `useSfGovPage` hook without being inside a component
- **Minimal bundle impact** — ~1 KB gzipped
- **TypeScript-first** — excellent type inference with no extra ceremony

## Proposed Store Architecture

The side panel has two distinct operating modes with very different state — public page metadata vs. admin preview iframe — plus shared navigation state that determines which mode is active. Mixing them into one store makes each mode harder to reason about and extend independently.

### Store 1: `useNavigationStore` (`stores/navigationStore.ts`)

The "routing" layer. Both modes depend on this to know where the browser is, but neither mode's logic belongs here.

```ts
interface NavigationState {
  currentUrl: string;
  isOnSfGov: boolean;
  isAdminPage: boolean;
  // Actions
  setCurrentUrl: (url: string) => void;
  setIsOnSfGov: (val: boolean) => void;
  setIsAdminPage: (val: boolean) => void;
}
```

### Store 2: `usePageDataStore` (`stores/pageDataStore.ts`)

Public page mode. Active when `isAdminPage === false`. Owns all Wagtail API fetch state.

```ts
interface PageDataState {
  pageData: WagtailPage | null;
  error: ApiError | null;
  isLoading: boolean;
  // Derived
  pagePath: string;   // strip query/hash from currentUrl — computed from navigationStore
  // Actions
  setPageData: (data: WagtailPage | null) => void;
  setError: (error: ApiError | null) => void;
  setIsLoading: (loading: boolean) => void;
  retry: () => void;   // registered by usePageData on init (closes over fetch fn)
}
```

`pagePath` is derived from `useNavigationStore`'s `currentUrl`; the simplest approach is to compute it in the hook that writes to this store, or as a plain selector used at call sites.

### Store 3: `useAdminPreviewStore` (`stores/adminPreviewStore.ts`)

Admin preview mode. Active when `isAdminPage === true`. Driven entirely by Chrome messages from the content script — no Wagtail API calls.

```ts
interface AdminPreviewState {
  isPreviewMode: boolean;
  previewUrl: string | null;
  previewTimestamp: number;
  // Actions
  setPreviewState: (state: { isPreviewMode: boolean; previewUrl: string | null; previewTimestamp: number }) => void;
  clearPreview: () => void;
}
```

The data source separation is meaningful: `usePageDataStore` is populated by `fetch` calls, while `useAdminPreviewStore` is populated by `chrome.runtime.onMessage`. Keeping them separate makes each independently testable and eliminates any risk of cross-contamination between modes.

### Store 4: `usePageLinksStore` (`stores/pageLinksStore.ts`)

Holds the links-related state currently split between App.tsx local state and the A11yChecker callback:

```ts
interface PageLinksState {
  categorizedLinks: CategorizedLinks | null;
  isLoadingLinks: boolean;
  missingAltTextUrls: Set<string>;
  // Actions
  setCategorizedLinks: (links: CategorizedLinks | null) => void;
  setIsLoadingLinks: (val: boolean) => void;
  setMissingAltTextUrls: (urls: Set<string>) => void;
}
```

## Migration Plan

### Step 1 — Install Zustand

```bash
npm install zustand --workspace=@sf-gov/extension
```

### Step 2 — Create `stores/` directory and stores

Create `packages/extension/src/sidepanel/stores/` with:

- `navigationStore.ts` — defines and exports `useNavigationStore`
- `pageDataStore.ts` — defines and exports `usePageDataStore`
- `adminPreviewStore.ts` — defines and exports `useAdminPreviewStore`
- `pageLinksStore.ts` — defines and exports `usePageLinksStore`

### Step 3 — Split `useSfGovPage` into focused hooks

The current `useSfGovPage` hook manages Chrome tab events, Wagtail API fetching, and preview message handling all at once. Split it into three hooks that each own one concern:

**`hooks/useNavigation.ts`** — subscribes to `chrome.tabs.onUpdated` and `chrome.tabs.onActivated`, derives `isOnSfGov`/`isAdminPage` from the URL, writes to `useNavigationStore`. Returns nothing (side-effects only).

**`hooks/usePageData.ts`** — watches `useNavigationStore` for URL changes, fetches from the Wagtail API when on a public SF.gov page, writes to `usePageDataStore`. Registers `retry` in the store on init since it closes over the fetch function. Returns nothing.

**`hooks/useAdminPreview.ts`** — listens for `chrome.runtime.onMessage` events of type `PREVIEW_URL_UPDATE` and `PREVIEW_UNAVAILABLE`, writes to `useAdminPreviewStore`. Clears preview state when navigating away from admin pages (by subscribing to `useNavigationStore`). Returns nothing.

Caching logic (refs in the current `useSfGovPage`) stays in `usePageData` since it's specific to API call deduplication.

### Step 4 — Extract links fetching from App.tsx

Move the `useEffect` that calls `chrome.scripting.executeScript(extractCategorizedLinks)` from `App.tsx` into a new hook:

**`hooks/usePageLinks.ts`** — subscribes to `pageData` from `useSfGovPageStore`, extracts links when it changes, and writes results to `usePageLinksStore`.

This gives App.tsx one less concern and makes the links logic independently testable.

### Step 5 — Simplify App.tsx

After the above, `App.tsx`:

- Calls `useNavigation()`, `usePageData()`, `useAdminPreview()` (for Chrome listener side effects)
- Calls `usePageLinks()` (for link extraction side effects)
- Reads `isOnSfGov`, `isAdminPage` from `useNavigationStore` to decide what to render
- Reads `isLoading`, `error`, `pageData` from `usePageDataStore` for the loading/error states
- Reads `isPreviewMode`, `previewUrl`, `previewTimestamp` from `useAdminPreviewStore` for the iframe branch
- Passes **no data props** to cards (only layout/structural concerns remain)
- Analytics effects remain (they read from the relevant stores)

### Step 6 — Update each card component

Remove props that are now sourced from stores. Each component calls the appropriate store with a selector for exactly what it needs.

| Component | Props removed | Store(s) used |
|---|---|---|
| `PageHeader` | `pageData`, `currentUrl` | `useNavigationStore`, `usePageDataStore` |
| `FeedbackCard` | `pagePath` | `useNavigationStore` (derives `pagePath` from `currentUrl`) |
| `MediaAssetsCard` | `images`, `files`, `categorizedLinks`, `isLoadingLinks`, `missingAltTextUrls` | `usePageDataStore`, `usePageLinksStore` |
| `LinksCard` | `pageUrl`, `categorizedLinks`, `isLoadingLinks` | `useNavigationStore`, `usePageLinksStore` |
| `A11yCard` | `pageUrl`, `images`, `onMissingAltTextUrls` | `useNavigationStore`, `usePageDataStore`; child writes to `usePageLinksStore` |
| `A11yChecker` | `pageUrl`, `images`, `onMissingAltTextUrls` | `useNavigationStore`, `usePageDataStore`, `usePageLinksStore` (writes `missingAltTextUrls`) |
| `FormConfirmationCard` | `formConfirmation`, `currentUrl` | `useNavigationStore`, `usePageDataStore` |
| `MetadataCard` | `pageId`, `translations`, `primaryAgency`, `contentType`, `schema` | `usePageDataStore` |

`A11yChecker` is the most significant change: instead of calling `onMissingAltTextUrls(urls)`, it calls `usePageLinksStore.getState().setMissingAltTextUrls(urls)` directly. This removes the callback chain entirely.

### Step 7 — Run type-check and fix errors

```bash
npm run type-check
```

Fix any TypeScript errors from changed prop interfaces.

## File Changeset

```
packages/extension/
  package.json                              # add zustand dependency
  src/sidepanel/
    stores/
      navigationStore.ts                    # NEW: currentUrl, isOnSfGov, isAdminPage
      pageDataStore.ts                      # NEW: pageData, error, isLoading, retry
      adminPreviewStore.ts                  # NEW: isPreviewMode, previewUrl, previewTimestamp
      pageLinksStore.ts                     # NEW: categorizedLinks, missingAltTextUrls
    hooks/
      useNavigation.ts                      # NEW (split from useSfGovPage): tab event listeners
      usePageData.ts                        # NEW (split from useSfGovPage): Wagtail API fetch
      useAdminPreview.ts                    # NEW (split from useSfGovPage): preview messages
      useSfGovPage.ts                       # DELETED (replaced by the three hooks above)
      usePageLinks.ts                       # NEW: extracted from App.tsx
    App.tsx                                 # simplify: remove local state + most props
    components/
      PageHeader.tsx                        # remove props, read from stores
      FeedbackCard.tsx                      # remove pagePath prop, read from store
      MediaAssetsCard.tsx                   # remove 5 props, read from stores
      LinksCard.tsx                         # remove 3 props, read from stores
      A11yCard.tsx                          # remove 3 props (pass-through removed)
      A11yChecker.tsx                       # remove onMissingAltTextUrls, write to store
      FormConfirmationCard.tsx              # remove 2 props, read from stores
      MetadataCard.tsx                      # remove 5 props, read from store
```

## What Stays Unchanged

- All caching logic (refs in `useSfGovPage`, `link-checker-cache.ts`)
- Chrome message passing architecture
- Card-level local state (`FeedbackCard`'s fetch state, `LinkChecker`'s results state) — these are genuinely component-local and don't need to be global
- `Card.tsx` expand/collapse with localStorage persistence
- Analytics tracking locations

## What Gets Simpler

- `App.tsx` drops from ~250 lines to ~120 lines (removes all local state and most JSX props)
- A11yChecker's awkward `onMissingAltTextUrls` callback is eliminated
- Adding new shared state in future requires touching only the store + the relevant component, not App.tsx
- Cards become independently readable — each file is self-contained about what data it needs
- The two side panel modes (public page vs. admin preview) are isolated: `usePageData` and `useAdminPreview` can be reasoned about, tested, and extended without touching each other
- The data source for each store is explicit: `useNavigationStore` ← Chrome tab events; `usePageDataStore` ← Wagtail API fetch; `useAdminPreviewStore` ← Chrome runtime messages; `usePageLinksStore` ← scripting API

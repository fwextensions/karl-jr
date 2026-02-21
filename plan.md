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

### Store 1: `useSfGovPageStore` (`stores/sfGovPageStore.ts`)

Holds all state currently returned by `useSfGovPage`:

```ts
interface SfGovPageState {
  pageData: WagtailPage | null;
  error: ApiError | null;
  isLoading: boolean;
  currentUrl: string;
  isOnSfGov: boolean;
  isAdminPage: boolean;
  isPreviewMode: boolean;
  previewUrl: string | null;
  previewTimestamp: number;
  // Derived (computed in store or from selectors)
  pagePath: string;
  // Actions
  setPageData: (data: WagtailPage | null) => void;
  setError: (error: ApiError | null) => void;
  setIsLoading: (loading: boolean) => void;
  setCurrentUrl: (url: string) => void;
  setIsOnSfGov: (val: boolean) => void;
  setIsAdminPage: (val: boolean) => void;
  setPreviewState: (state: { isPreviewMode: boolean; previewUrl: string | null; previewTimestamp: number }) => void;
  retry: () => void;        // set by useSfGovPage on init
}
```

`pagePath` can be a derived getter in the store (strip query string and hash from `currentUrl`), keeping the derivation in one place.

### Store 2: `usePageLinksStore` (`stores/pageLinksStore.ts`)

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

- `sfGovPageStore.ts` — defines and exports `useSfGovPageStore`
- `pageLinksStore.ts` — defines and exports `usePageLinksStore`

### Step 3 — Refactor `useSfGovPage`

The hook currently manages all state with `useState`/`useRef` and returns it. After refactoring:

- All `useState` calls for page data are replaced with calls to `useSfGovPageStore` actions
- The hook still owns all Chrome API subscriptions (`chrome.tabs.onUpdated`, `chrome.tabs.onActivated`, `chrome.runtime.onMessage`) and caching logic (refs are still appropriate here)
- The hook returns only a `retry` callback (or nothing — components can read state directly from the store)

The `retry` action is registered into the store on hook initialization, since it needs to close over the fetch function.

### Step 4 — Extract links fetching from App.tsx

Move the `useEffect` that calls `chrome.scripting.executeScript(extractCategorizedLinks)` from `App.tsx` into a new hook:

**`hooks/usePageLinks.ts`** — subscribes to `pageData` from `useSfGovPageStore`, extracts links when it changes, and writes results to `usePageLinksStore`.

This gives App.tsx one less concern and makes the links logic independently testable.

### Step 5 — Simplify App.tsx

After the above, `App.tsx`:

- Calls `useSfGovPage()` (for Chrome listener side effects)
- Calls `usePageLinks()` (for link extraction side effects)
- Reads `isLoading`, `error`, `isOnSfGov`, `isAdminPage`, `isPreviewMode`, `previewUrl`, `previewTimestamp`, `pageData`, `currentUrl` directly from `useSfGovPageStore`
- Passes **no data props** to cards (only layout/structural concerns remain)
- Analytics effects remain (they read from the store or keep their own subscriptions)

### Step 6 — Update each card component

Remove props that are now sourced from stores. Each component calls `useSfGovPageStore` or `usePageLinksStore` with a selector for exactly what it needs.

| Component | Props removed | Store(s) used |
|---|---|---|
| `PageHeader` | `pageData`, `currentUrl` | `useSfGovPageStore` |
| `FeedbackCard` | `pagePath` | `useSfGovPageStore` (derives `pagePath`) |
| `MediaAssetsCard` | `images`, `files`, `categorizedLinks`, `isLoadingLinks`, `missingAltTextUrls` | both stores |
| `LinksCard` | `pageUrl`, `categorizedLinks`, `isLoadingLinks` | both stores |
| `A11yCard` | `pageUrl`, `images`, `onMissingAltTextUrls` | `useSfGovPageStore`; child writes to `usePageLinksStore` |
| `A11yChecker` | `pageUrl`, `images`, `onMissingAltTextUrls` | both stores (writes `missingAltTextUrls`) |
| `FormConfirmationCard` | `formConfirmation`, `currentUrl` | `useSfGovPageStore` |
| `MetadataCard` | `pageId`, `translations`, `primaryAgency`, `contentType`, `schema` | `useSfGovPageStore` |

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
      sfGovPageStore.ts                     # NEW
      pageLinksStore.ts                     # NEW
    hooks/
      useSfGovPage.ts                       # refactor: setState → store actions
      usePageLinks.ts                       # NEW: extracted from App.tsx
    App.tsx                                 # simplify: remove local state + most props
    components/
      PageHeader.tsx                        # remove props, read from store
      FeedbackCard.tsx                      # remove pagePath prop, read from store
      MediaAssetsCard.tsx                   # remove 5 props, read from stores
      LinksCard.tsx                         # remove 3 props, read from stores
      A11yCard.tsx                          # remove 3 props (pass-through removed)
      A11yChecker.tsx                       # remove onMissingAltTextUrls, write to store
      FormConfirmationCard.tsx              # remove 2 props, read from store
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

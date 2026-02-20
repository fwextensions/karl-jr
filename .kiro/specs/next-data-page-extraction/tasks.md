# Implementation Plan: Next Data Page Extraction

## Overview

Implement DOM-based page data extraction from `__NEXT_DATA__` script tags on SF.gov pages, replacing the Wagtail API call for public pages. The implementation proceeds bottom-up: pure transformer logic first, then content script, then service worker wiring, then side panel integration.

## Tasks

- [ ] 1. Implement the page data transformer
  - [x] 1.1 Create `packages/extension/src/api/page-data-transformer.ts`
    - Extract shared helper functions (`extractImages`, `extractFiles`, `getAdminBaseUrl`) from `wagtail-client.ts` into importable utilities, or re-implement the necessary logic in the transformer
    - Implement `transformNextDataToWagtailPage(rawPageData, currentUrl)` that maps raw `__NEXT_DATA__` page props to the `WagtailPage` interface
    - Handle `primaryAgency`, `schema`, `formConfirmation`, `images`, `files`, `translations`, `editUrl`, and `meta` fields
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 1.2 Write property tests for the transformer
    - **Property 2: Transformer produces complete WagtailPage with correct field mapping**
    - **Property 3: Media asset extraction preserves all assets**
    - **Property 4: Translation extraction preserves all locales**
    - Install `fast-check` as a dev dependency if not already present
    - Create test file at `packages/extension/src/api/page-data-transformer.test.ts`
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6**

  - [x] 1.3 Write unit tests for transformer edge cases
    - Test with minimal valid input (only required fields)
    - Test with `primary_agency` present and absent
    - Test with `schema` and `formConfirmation` fields
    - Test editUrl generation for production vs staging URLs
    - _Requirements: 2.1, 2.2, 2.6_

- [ ] 2. Implement the content script extractor
  - [x] 2.1 Create `packages/extension/src/content/next-data-extractor.ts`
    - Implement `extractNextDataPage()` function that locates `#__NEXT_DATA__`, parses JSON, and extracts `props.pageProps.page`
    - Import and use `transformNextDataToWagtailPage` from the transformer module
    - Send `PAGE_DATA_EXTRACTED` message on success with the WagtailPage data and timestamp
    - Send `PAGE_DATA_EXTRACTION_FAILED` message on any failure (missing tag, invalid JSON, missing path, transformer error) with a reason string and timestamp
    - Listen for `REQUEST_PAGE_DATA` messages and re-run extraction
    - Run extraction on script load (auto-extract at `document_idle`)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 3.1, 3.2_

  - [x] 2.2 Write property test for JSON path extraction
    - **Property 1: JSON path extraction produces page object**
    - Test that for any valid JSON with the expected structure, the extraction function returns the correct page object
    - **Validates: Requirements 1.2**

  - [x] 2.3 Write unit tests for extraction error cases
    - Test missing `__NEXT_DATA__` element
    - Test invalid JSON content
    - Test valid JSON but missing `props.pageProps.page` path
    - _Requirements: 1.3, 1.4, 1.5_

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Update manifest and service worker
  - [x] 4.1 Register the content script in the manifest
    - Add new content script entry in `packages/extension/manifest.config.ts`
    - Match pattern: `*://*.sf.gov/*` excluding `*://api.sf.gov/*` and `*://api.staging.dev.sf.gov/*`
    - Set `run_at: "document_idle"`
    - Exclude admin page patterns already covered by `admin-preview-monitor.ts`
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 4.2 Update the service worker to forward extraction messages
    - Add `PAGE_DATA_EXTRACTED` and `PAGE_DATA_EXTRACTION_FAILED` to the message forwarding logic in `packages/extension/src/background/service-worker.ts`
    - _Requirements: 3.3_

- [ ] 5. Integrate extraction into the side panel hook
  - [x] 5.1 Update `useSfGovPage` to consume DOM-extracted data
    - Add message listener for `PAGE_DATA_EXTRACTED` — set page data directly from the message
    - Add message listener for `PAGE_DATA_EXTRACTION_FAILED` — trigger existing API fallback
    - On tab change/mount for SF.gov (non-admin) pages, send `REQUEST_PAGE_DATA` to the content script on the active tab
    - Skip DOM extraction for admin pages (keep existing `findPageById` path)
    - Handle message staleness (ignore messages older than 5 seconds)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 6. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- The transformer is implemented first because it's pure logic with no browser dependencies, making it the easiest to test
- The existing `wagtail-client.ts` is not modified — it remains as the fallback path
- Property tests use `fast-check` and validate universal correctness properties
- Unit tests cover specific edge cases and error conditions

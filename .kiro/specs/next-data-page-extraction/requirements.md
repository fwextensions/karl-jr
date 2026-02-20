# Requirements Document

## Introduction

SF.gov pages are built with Next.js and include a `__NEXT_DATA__` script tag containing hydration data, which includes the same page information currently fetched via the Wagtail API. This feature replaces the Wagtail API call for public SF.gov pages with direct extraction of page data from the `__NEXT_DATA__` script tag in the page DOM. A content script injected into SF.gov pages will extract the data and send it to the side panel via Chrome extension messaging, eliminating the network round-trip to the Wagtail API and providing faster page data loading.

## Glossary

- **Content_Script**: A Chrome extension script injected into SF.gov web pages that has access to the page DOM
- **Side_Panel**: The React-based extension UI that displays page metadata, translations, and media assets
- **Service_Worker**: The background script that manages extension lifecycle and message routing
- **Next_Data_Extractor**: The content script module responsible for locating and parsing the `__NEXT_DATA__` script tag
- **Page_Data_Transformer**: The module that converts raw `__NEXT_DATA__` page props into the WagtailPage interface used by the extension
- **WagtailPage**: The shared TypeScript interface representing a page with id, title, slug, contentType, translations, images, files, editUrl, and meta fields
- **Wagtail_API_Client**: The existing module that fetches page data from the Wagtail CMS REST API

## Requirements

### Requirement 1: Extract Page Data from DOM

**User Story:** As a content manager, I want the extension to load page data instantly from the page DOM, so that I can see page metadata without waiting for an API call.

#### Acceptance Criteria

1. WHEN an SF.gov page finishes loading, THE Next_Data_Extractor SHALL locate the script tag with id `__NEXT_DATA__` in the page DOM
2. WHEN the `__NEXT_DATA__` script tag is found, THE Next_Data_Extractor SHALL parse its text content as JSON and extract the page object at `props.pageProps.page`
3. IF the `__NEXT_DATA__` script tag is missing from the page, THEN THE Next_Data_Extractor SHALL send an extraction-failed message to the Service_Worker
4. IF the `__NEXT_DATA__` script tag contains invalid JSON, THEN THE Next_Data_Extractor SHALL send an extraction-failed message to the Service_Worker
5. IF the parsed JSON does not contain a page object at the expected path, THEN THE Next_Data_Extractor SHALL send an extraction-failed message to the Service_Worker

### Requirement 2: Transform Extracted Data to WagtailPage Format

**User Story:** As a developer, I want the extracted `__NEXT_DATA__` page object to be transformed into the same WagtailPage interface the UI already consumes, so that no UI components need to change.

#### Acceptance Criteria

1. WHEN raw page data is extracted from `__NEXT_DATA__`, THE Page_Data_Transformer SHALL produce a WagtailPage object with all required fields: id, title, slug, contentType, translations, images, files, editUrl, and meta
2. WHEN the raw page data contains a `primary_agency` object, THE Page_Data_Transformer SHALL map it to the WagtailPage primaryAgency field
3. WHEN the raw page data contains image references, THE Page_Data_Transformer SHALL extract them into the WagtailPage images array as MediaAsset objects
4. WHEN the raw page data contains document references, THE Page_Data_Transformer SHALL extract them into the WagtailPage files array as MediaAsset objects
5. WHEN the raw page data contains locale information and translation siblings, THE Page_Data_Transformer SHALL extract them into the WagtailPage translations array
6. THE Page_Data_Transformer SHALL compute the editUrl by combining the admin base URL with the page id in the format `{adminBaseUrl}pages/{pageId}/edit/`

### Requirement 3: Deliver Extracted Data via Chrome Messaging

**User Story:** As a developer, I want the content script to send extracted page data to the side panel through Chrome extension messaging, so that the side panel receives data without making API calls.

#### Acceptance Criteria

1. WHEN the Next_Data_Extractor successfully extracts and transforms page data, THE Content_Script SHALL send a message of type `PAGE_DATA_EXTRACTED` containing the WagtailPage object to the extension runtime
2. WHEN the Next_Data_Extractor fails to extract page data, THE Content_Script SHALL send a message of type `PAGE_DATA_EXTRACTION_FAILED` to the extension runtime
3. WHEN the Service_Worker receives a `PAGE_DATA_EXTRACTED` or `PAGE_DATA_EXTRACTION_FAILED` message from a content script, THE Service_Worker SHALL forward the message to the Side_Panel

### Requirement 4: Integrate Extracted Data into Side Panel

**User Story:** As a content manager, I want the side panel to use DOM-extracted data when available and fall back to the API when it is not, so that I always see page information regardless of extraction success.

#### Acceptance Criteria

1. WHEN the Side_Panel receives a `PAGE_DATA_EXTRACTED` message for the current tab, THE Side_Panel SHALL use the contained WagtailPage data to populate the UI
2. WHEN the Side_Panel receives a `PAGE_DATA_EXTRACTION_FAILED` message, THE Side_Panel SHALL fall back to fetching page data from the Wagtail_API_Client
3. WHEN the Side_Panel opens on an SF.gov page and no `PAGE_DATA_EXTRACTED` message has been received, THE Side_Panel SHALL request extraction by sending a message to the Content_Script on the active tab
4. WHILE the Side_Panel is waiting for extracted data or an API response, THE Side_Panel SHALL display a loading indicator
5. WHEN the user is on a Wagtail admin edit page, THE Side_Panel SHALL continue using the Wagtail_API_Client directly, since admin pages do not contain `__NEXT_DATA__`

### Requirement 5: Register Content Script for SF.gov Pages

**User Story:** As a developer, I want the content script to be automatically injected into SF.gov pages, so that data extraction happens without manual intervention.

#### Acceptance Criteria

1. THE extension manifest SHALL register the Next_Data_Extractor content script to run on all `*.sf.gov` pages excluding `api.sf.gov` subdomains
2. THE extension manifest SHALL configure the content script to run at `document_idle` to ensure the DOM is fully loaded before extraction
3. THE extension manifest SHALL not register the content script on Wagtail admin pages (`api.sf.gov/admin/*` and `api.staging.dev.sf.gov/admin/*`)

# Chrome Web Store Submission Documentation

## Store Listing Information

### Extension Name
Karl Jr.

### Category
Productivity

### Language
English (United States)

### Short Description (132 characters max)
Content management companion for SF.gov pages. View page metadata, check links, and access editing tools directly from your browser.

### Detailed Description

Karl Jr. is a browser extension designed for content editors and administrators of SF.gov websites. It provides instant access to page information and content management tools while browsing SF.gov pages.

**Key Features:**

- **Page Metadata**: View content type, primary agency, and structured data schema for any SF.gov page
- **Quick Edit Access**: One-click access to edit pages in the Karl CMS (Wagtail)
- **Media Assets**: See all images and documents attached to a page, with direct links to edit or view them
- **Link Checker**: Automatically scan pages for broken links and accessibility issues
- **Accessibility Checker**: Run automated accessibility checks to ensure content meets WCAG standards
- **Translation Management**: View available translations and language versions of pages
- **Form Confirmation Pages**: Quickly access form confirmation pages with pre-filled parameters
- **PDF Link Detection**: Identify all PDF files linked from a page
- **Preview Mode**: Monitor and access preview versions of pages being edited in the CMS
- **Feedback Integration**: Submit feedback about pages directly to the content team

The extension displays information in a convenient side panel that appears when you click the toolbar icon while on any SF.gov page. All data is retrieved in real-time from the Wagtail CMS API.

**Who is this for?**

This extension is designed for SF.gov content editors, web administrators, and digital service teams who need quick access to page information and editing tools while reviewing or managing content on SF.gov websites.

### Screenshots Required
At least one screenshot showing the extension's side panel with page information displayed on an SF.gov page.

### Icon
The extension already has icons defined in the manifest at:
- `src/img/favicon-16.png`
- `src/img/favicon-32.png`
- `src/img/favicon-48.png`
- `src/img/favicon-128.png`

---

## Privacy Practices

### Single Purpose Description

This extension provides content management information and tools for SF.gov website editors and administrators. It displays page metadata, media assets, and administrative links in a side panel when browsing SF.gov pages, and allows quick access to the Karl CMS for editing content.

### Permission Justifications

#### contextMenus
**Justification**: Used to add an "Edit on Karl" option to the right-click context menu on SF.gov pages. This provides a convenient way for content editors to quickly navigate to the CMS editing interface for the current page. The context menu only appears on SF.gov domains and does not collect or transmit any user data.

#### cookies
**Justification**: Required to read authentication cookies from api.sf.gov to verify that users are logged into the Karl CMS. This allows the extension to provide authenticated access to the Wagtail API for retrieving page metadata and to enable the feedback submission feature. The extension only reads cookies from SF.gov domains and does not modify, store, or transmit cookies to any third parties.

#### host_permissions (*://*.sf.gov/*, https://api.sf.gov/*, https://api.staging.dev.sf.gov/*)
**Justification**: Required to:
1. Detect when users are browsing SF.gov pages to enable the side panel
2. Make API requests to the Wagtail CMS (api.sf.gov) to retrieve page metadata, images, documents, and other content information
3. Extract page content for link checking and accessibility analysis
4. Monitor preview button state in the CMS admin interface

All host permissions are limited to SF.gov domains only. The extension does not access any other websites or transmit data to external services beyond SF.gov infrastructure.

#### scripting
**Justification**: Used to:
1. Extract PDF links and other content from SF.gov pages for the link checker feature
2. Monitor the preview button state in the CMS admin interface to enable preview mode
3. Perform accessibility checks by analyzing page structure and content

All scripts are executed only on SF.gov domains and are used solely to analyze page content for display in the side panel. No user data is collected or transmitted through these scripts.

#### sidePanel
**Justification**: The core interface of the extension. The side panel displays page information, metadata, and administrative tools when users click the toolbar button while on SF.gov pages. This provides a non-intrusive way to access content management information without navigating away from the page being reviewed.

#### storage
**Justification**: Used to store a persistent anonymous device ID for usage analytics. This ID is generated locally using a UUID and stored in chrome.storage.local to be available in the service worker. The device ID contains no personal information and is used solely to track aggregate extension usage patterns. No other data is stored using this permission.

#### tabs
**Justification**: Required to:
1. Detect which tab is currently active to display relevant page information in the side panel
2. Detect when users navigate to different SF.gov pages to update the side panel content
3. Open new tabs for editing pages in the CMS or viewing media assets

The extension only monitors tabs for SF.gov URLs and does not track browsing history or access tabs from other websites.

### Remote Code

**Justification**: This extension does not use remote code. All code is bundled with the extension at installation time. The extension retrieves data from the Wagtail CMS API (api.sf.gov) but does not execute any remotely hosted code.

### Data Usage Certification

**Data Collection**: This extension does not collect, store, or transmit any personal user data. 

**Data Accessed**:
- Page metadata from SF.gov Wagtail CMS API (page titles, content types, agency information, etc.)
- Authentication status from SF.gov cookies (read-only, to verify CMS access)
- Page content for link checking and accessibility analysis (processed locally, not transmitted)

**Data Transmission**:
- API requests to api.sf.gov to retrieve page information
- Optional feedback submissions to an Airtable database (only when users explicitly submit feedback through the extension)

All data access and transmission is limited to SF.gov infrastructure and services. No data is shared with third parties or used for advertising, analytics, or any purpose beyond providing content management tools to SF.gov editors.

**Compliance**: This extension complies with Chrome Web Store Developer Program Policies. It is designed for a specific professional use case (SF.gov content management) and does not engage in any data collection, tracking, or monetization activities.

---

## Distribution Notes

### Target Audience
This extension is intended for SF.gov content editors, web administrators, and digital service team members. It may be distributed internally within the City and County of San Francisco or made available to authorized content contributors.

### Support
For issues or questions, users should contact the SF.gov digital services team or file issues in the project repository.

### Updates
The extension will be updated as needed to support new features in the Karl CMS and to maintain compatibility with SF.gov infrastructure changes.

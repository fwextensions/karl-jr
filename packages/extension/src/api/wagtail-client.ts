/**
 * Wagtail API Client
 * Handles communication with the SF.gov Wagtail CMS API
 */

import type { WagtailPage, ApiError, MediaAsset, Translation } from '@sf-gov/shared';

/**
 * Determines the appropriate API base URL based on the current page URL
 * @param currentUrl - Optional current URL to determine which API to use
 * @returns The base API URL (production or staging)
 */
function getBaseApiUrl(currentUrl?: string): string {
	if (currentUrl) {
		try {
			const urlObj = new URL(currentUrl);
			if (urlObj.hostname.includes('staging.dev.sf.gov')) {
				return 'https://api.staging.dev.sf.gov/api/v2/';
			}
		} catch (e) {
			// invalid URL, fall through to default
		}
	}
	return 'https://api.sf.gov/api/v2/';
}

/**
 * Determines the appropriate admin base URL based on the current page URL
 * @param currentUrl - Optional current URL to determine which admin to use
 * @returns The admin base URL (production or staging)
 */
function getAdminBaseUrl(currentUrl?: string): string {
	if (currentUrl) {
		try {
			const urlObj = new URL(currentUrl);
			if (urlObj.hostname.includes('staging.dev.sf.gov')) {
				return 'https://api.staging.dev.sf.gov/admin/';
			}
		} catch (e) {
			// invalid URL, fall through to default
		}
	}
	return 'https://api.sf.gov/admin/';
}

/**
 * Default timeout for API requests in milliseconds
 */
const DEFAULT_TIMEOUT = 10000;

/**
 * Fetches a URL with a timeout using AbortController
 * @param url - The URL to fetch
 * @param timeout - Timeout in milliseconds (default: 10000)
 * @returns Promise resolving to the Response
 * @throws ApiError if the request times out or fails
 */
async function fetchWithTimeout(url: string, timeout: number = DEFAULT_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "SF-Gov-Companion-Extension/1.0",
        "X-SF-Gov-Extension": "companion",
      },
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === 'AbortError') {
      throw createApiError('timeout', 'Request timed out after 10 seconds');
    }

    throw error;
  }
}

/**
 * Finds a Wagtail page by its ID
 * @param pageId - The page ID to fetch
 * @param currentUrl - Optional current URL to determine which API to use
 * @returns Promise resolving to WagtailPage or null if not found
 * @throws ApiError for network errors, timeouts, or server errors
 */
export async function findPageById(pageId: number, currentUrl?: string): Promise<WagtailPage | null> {
	try {
		const baseApiUrl = getBaseApiUrl(currentUrl);
		const detailUrl = `${baseApiUrl}pages/${pageId}/?fields=*`;
		console.log('Fetching page by ID from:', detailUrl);
		const response = await fetchWithTimeout(detailUrl);

		// Handle HTTP error status codes
		if (response.status === 404) {
			throw createApiError('not_found', 'This page is not found in the CMS', 404);
		}

		if (response.status === 500) {
			throw createApiError('server_error', 'CMS server error. Please try again later.', 500);
		}

		if (!response.ok) {
			throw createApiError('network', `HTTP error ${response.status}`, response.status);
		}

		const pageData = await response.json();

		// Fetch translations by slug
		const slug = pageData.meta?.slug || pageData.slug;
		if (!slug) {
			// If no slug, return page without translations
			return parsePageDataWithTranslations(pageData, [pageData], currentUrl);
		}

		// Fetch all translations for this slug
		const translationsUrl = `${baseApiUrl}pages/?slug=${encodeURIComponent(slug)}&fields=*`;
		const translationsResponse = await fetchWithTimeout(translationsUrl);

		if (translationsResponse.ok) {
			const translationsData = await translationsResponse.json();
			return parsePageDataWithTranslations(pageData, translationsData.items || [pageData], currentUrl);
		}

		// If translations fetch fails, return page without translations
		return parsePageDataWithTranslations(pageData, [pageData], currentUrl);
	} catch (error) {
		// Re-throw ApiErrors as-is
		if (isApiError(error)) {
			throw error;
		}

		// Handle network errors
		if (error instanceof TypeError) {
			throw createApiError('network', 'Unable to connect to Wagtail API. Check your network connection.');
		}

		// Handle unexpected errors
		throw createApiError('network', 'An unexpected error occurred');
	}
}

/**
 * Finds a Wagtail page by its slug
 * @param slug - The page slug to search for
 * @param currentUrl - Optional current URL to determine which locale version to use
 * @returns Promise resolving to WagtailPage or null if not found
 * @throws ApiError for network errors, timeouts, or server errors
 */
export async function findPageBySlug(slug: string, currentUrl?: string): Promise<WagtailPage | null> {
  try {
    const baseApiUrl = getBaseApiUrl(currentUrl);
    const url = `${baseApiUrl}pages/?slug=${encodeURIComponent(slug)}&fields=*`;
    const response = await fetchWithTimeout(url);

    // Handle HTTP error status codes
    if (response.status === 404) {
      throw createApiError('not_found', 'This page is not found in the CMS', 404);
    }

    if (response.status === 500) {
      throw createApiError('server_error', 'CMS server error. Please try again later.', 500);
    }

    if (!response.ok) {
      throw createApiError('network', `HTTP error ${response.status}`, response.status);
    }

    const data = await response.json();

    // Check if any pages were returned
    if (!data.items || data.items.length === 0) {
      return null;
    }

    // If multiple items returned (translations), determine which one matches the current URL
    let currentPageData = data.items[0];

    if (data.items.length > 1 && currentUrl) {
      // Try to match based on the URL path
      const matchedPage = data.items.find((item: any) => {
        const htmlUrl = item.meta?.html_url;
        if (htmlUrl) {
          try {
            const apiUrlObj = new URL(htmlUrl);
            const currentUrlObj = new URL(currentUrl);
            // Compare the pathname (which includes locale prefix like /fil/)
            return apiUrlObj.pathname === currentUrlObj.pathname;
          } catch (e) {
            return false;
          }
        }
        return false;
      });

      if (matchedPage) {
        currentPageData = matchedPage;
      }
    }

    // Fetch full page details from the detail URL
    const detailUrl = currentPageData.meta?.detail_url;
    if (!detailUrl) {
      throw createApiError('network', 'Page detail URL not found in API response');
    }

    console.log('Fetching full page details from:', detailUrl);
    const detailResponse = await fetchWithTimeout(detailUrl);

    if (!detailResponse.ok) {
      throw createApiError('network', `Failed to fetch page details: HTTP ${detailResponse.status}`, detailResponse.status);
    }

    const fullPageData = await detailResponse.json();

    // Parse the full page data with all translations
    return parsePageDataWithTranslations(fullPageData, data.items, currentUrl);
  } catch (error) {
    // Re-throw ApiErrors as-is
    if (isApiError(error)) {
      throw error;
    }

    // Handle network errors
    if (error instanceof TypeError) {
      throw createApiError('network', 'Unable to connect to Wagtail API. Check your network connection.');
    }

    // Handle unexpected errors
    throw createApiError('network', 'An unexpected error occurred');
  }
}

/**
 * Parses API response data into a WagtailPage object with translations from all items
 * @param pageData - Raw page data from the API for the current page
 * @param allItems - All items returned from the API (including translations)
 * @param currentUrl - Optional current URL to determine which admin URL to use
 * @returns Parsed WagtailPage object
 */
function parsePageDataWithTranslations(pageData: any, allItems: any[], currentUrl?: string): WagtailPage {
  const pageId = pageData.id;
  const adminBaseUrl = getAdminBaseUrl(currentUrl);
  const editUrl = `${adminBaseUrl}pages/${pageId}/edit/`;

  // Extract primary agency information
  let primaryAgency = undefined;
  if (pageData.primary_agency && typeof pageData.primary_agency === 'object') {
    primaryAgency = {
      id: pageData.primary_agency.id,
      title: pageData.primary_agency.title || '',
      url: pageData.primary_agency.meta?.html_url || ''
    };
  }

  // Extract form schema information for sf.Form pages
  let schema = undefined;
  if (pageData.schema && typeof pageData.schema === 'object') {
    schema = {
      _id: pageData.schema._id || '',
      title: pageData.schema.title || '',
      project: pageData.schema.project || ''
    };
  }

  // Extract form confirmation information for sf.Form pages
  let formConfirmation = undefined;
  if (pageData.confirmation_title || pageData.confirmation_body) {
    let bodyHtml = '';
    
    // confirmation_body is an array of items, find the one with type "text"
    if (Array.isArray(pageData.confirmation_body)) {
      const textBlock = pageData.confirmation_body.find((item: any) => item.type === 'text');
      if (textBlock && textBlock.value) {
        bodyHtml = textBlock.value;
      }
    }
    
    formConfirmation = {
      title: pageData.confirmation_title || '',
      body: bodyHtml
    };
  }

  return {
    id: pageId,
    title: pageData.title || '',
    slug: pageData.meta?.slug || pageData.slug || '',
    contentType: pageData.meta?.type || '',
    primaryAgency,
    schema,
    formConfirmation,
    translations: extractTranslationsFromItems(allItems, currentUrl),
    images: extractImages(pageData),
    files: extractFiles(pageData),
    editUrl,
    meta: {
      type: pageData.meta?.type || '',
      detailUrl: pageData.meta?.detail_url || '',
      htmlUrl: pageData.meta?.html_url || ''
    }
  };
}

/**
 * Extracts image data from page content
 * @param pageData - Raw page data from the API
 * @returns Array of MediaAsset objects for images
 */
function extractImages(pageData: any): MediaAsset[] {
  const images: MediaAsset[] = [];

  // Helper function to recursively search for images in nested objects
  function findImages(obj: any): void {
    if (!obj || typeof obj !== 'object') return;

    // Check if this object represents an image
    if (obj.type === 'image' && obj.value) {
      const imageData = obj.value;
      if (imageData.id) {
        console.log('Image data fields:', Object.keys(imageData));
        console.log('Image data:', imageData);
        images.push({
          id: imageData.id,
          title: imageData.title || imageData.alt || '',
          url: imageData.url || imageData.full_url || imageData.meta?.download_url || imageData.src || '',
          type: 'image',
          filename: imageData.filename
        });
      }
    }

    // Check for image fields in the object
    if (obj.image && typeof obj.image === 'object') {
      if (obj.image.id) {
        console.log('Image field data:', Object.keys(obj.image));
        console.log('Image field:', obj.image);
        images.push({
          id: obj.image.id,
          title: obj.image.title || obj.image.alt || '',
          url: obj.image.url || obj.image.full_url || obj.image.meta?.download_url || obj.image.src || '',
          type: 'image',
          filename: obj.image.filename
        });
      }
    }

    // Recursively search arrays and objects
    if (Array.isArray(obj)) {
      obj.forEach(item => findImages(item));
    } else {
      Object.values(obj).forEach(value => findImages(value));
    }
  }

  findImages(pageData);

  // Remove duplicates based on ID
  const uniqueImages = Array.from(
    new Map(images.map(img => [img.id, img])).values()
  );

  return uniqueImages;
}

/**
 * Extracts file/document data from page content
 * @param pageData - Raw page data from the API
 * @returns Array of MediaAsset objects for files
 */
function extractFiles(pageData: any): MediaAsset[] {
  const files: MediaAsset[] = [];

  // Helper function to recursively search for documents in nested objects
  function findFiles(obj: any): void {
    if (!obj || typeof obj !== 'object') return;

    // Check if this object represents a document
    if (obj.type === 'document' && obj.value) {
      const docData = obj.value;
      if (docData.id) {
        files.push({
          id: docData.id,
          title: docData.title || docData.filename || '',
          url: docData.file || docData.url || docData.download_url || '',
          type: 'document',
          filename: docData.filename
        });
      }
    }

    // Check for document fields in the object
    if (obj.document && typeof obj.document === 'object') {
      if (obj.document.id) {
        files.push({
          id: obj.document.id,
          title: obj.document.title || obj.document.filename || '',
          url: obj.document.file || obj.document.url || obj.document.download_url || '',
          type: 'document',
          filename: obj.document.filename
        });
      }
    }

    // Recursively search arrays and objects
    if (Array.isArray(obj)) {
      obj.forEach(item => findFiles(item));
    } else {
      Object.values(obj).forEach(value => findFiles(value));
    }
  }

  findFiles(pageData);

  // Remove duplicates based on ID
  const uniqueFiles = Array.from(
    new Map(files.map(file => [file.id, file])).values()
  );

  return uniqueFiles;
}

/**
 * Extracts translation information from all items returned by the API
 * @param allItems - All page items from the API response (same slug, different locales)
 * @param currentUrl - Optional current URL to determine which admin URL to use
 * @returns Array of Translation objects
 */
function extractTranslationsFromItems(allItems: any[], currentUrl?: string): Translation[] {
  const translations: Translation[] = [];
  const seenPageIds = new Set<number>();

  // Map of locale codes to language names
  const localeNames: Record<string, string> = {
    'en': 'English',
    'es': 'Español',
    'zh': '中文',
    'fil': 'Filipino',
    'vi': 'Tiếng Việt',
  };

  const adminBaseUrl = getAdminBaseUrl(currentUrl);

  // Process each item as a translation
  allItems.forEach((item: any) => {
    if (item.id && !seenPageIds.has(item.id)) {
      const locale = item.meta?.locale || 'en';
      const languageCode = typeof locale === 'string' ? locale : locale.language_code || 'en';
      const languageName = localeNames[languageCode] || languageCode.toUpperCase();

      translations.push({
        language: languageName,
        languageCode: languageCode,
        pageId: item.id,
        editUrl: `${adminBaseUrl}pages/${item.id}/edit/`,
        title: item.title || ''
      });
      seenPageIds.add(item.id);
    }
  });

  // Sort translations: English first, then alphabetically by language code
  translations.sort((a, b) => {
    if (a.languageCode === 'en') return -1;
    if (b.languageCode === 'en') return 1;
    return a.languageCode.localeCompare(b.languageCode);
  });

  return translations;
}

/**
 * Creates an ApiError object with the specified properties
 * @param type - The error type
 * @param message - The error message
 * @param statusCode - Optional HTTP status code
 * @returns ApiError object
 */
function createApiError(
  type: 'network' | 'timeout' | 'not_found' | 'server_error',
  message: string,
  statusCode?: number
): ApiError {
  return {
    type,
    message,
    statusCode,
    retryable: type !== 'not_found' // All errors except 404 are retryable
  };
}

/**
 * Type guard to check if an error is an ApiError
 * @param error - The error to check
 * @returns True if the error is an ApiError
 */
function isApiError(error: any): error is ApiError {
  return (
    error &&
    typeof error === 'object' &&
    'type' in error &&
    'message' in error &&
    'retryable' in error
  );
}

/**
 * Fetches the current authenticated user's information from Wagtail
 * Requires a valid Wagtail session cookie
 * @param currentUrl - Optional current URL to determine which admin API to use
 * @returns Promise resolving to user object with id, or null if not authenticated
 */
export async function getCurrentUser(currentUrl?: string): Promise<{ id: number; username: string } | null> {
	try {
		// get session ID from cookies
		let cookies = await chrome.cookies.getAll({
			domain: "api.sf.gov",
			name: "sessionid",
		});

		if (cookies.length === 0) {
			cookies = await chrome.cookies.getAll({
				domain: ".sf.gov",
				name: "sessionid",
			});
		}

		if (cookies.length === 0) {
			console.log("[WagtailClient] No session cookie found");
			return null;
		}

		const sessionId = cookies[0].value;
		const adminBaseUrl = getAdminBaseUrl(currentUrl);

		// try the userbar API endpoint which returns current user info
		const userbarUrl = `${adminBaseUrl}api/userbar/${sessionId}/`;
		console.log("[WagtailClient] Fetching current user from:", userbarUrl);

		const response = await fetchWithTimeout(userbarUrl, 5000);

		if (!response.ok) {
			console.log("[WagtailClient] Failed to fetch user info:", response.status);
			return null;
		}

		const data = await response.json();

		// userbar API returns { user_id, username, ... }
		if (data.user_id) {
			return {
				id: data.user_id,
				username: data.username || 'unknown'
			};
		}

		console.log("[WagtailClient] No user_id in response");
		return null;
	} catch (error) {
		console.error("[WagtailClient] Error fetching current user:", error);
		return null;
	}
}

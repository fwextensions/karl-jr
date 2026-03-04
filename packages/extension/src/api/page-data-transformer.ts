/**
 * Page Data Transformer
 * Transforms raw __NEXT_DATA__ page props into WagtailPage objects
 */

import type { WagtailPage, MediaAsset, Translation, Agency, FormSchema, FormConfirmation } from '@sf-gov/shared';

/**
 * Determines the appropriate admin base URL based on the current page URL
 * @param currentUrl - The current page URL
 * @returns The admin base URL (production or staging)
 */
export function getAdminBaseUrl(currentUrl: string): string {
	try {
		const urlObj = new URL(currentUrl);
		if (urlObj.hostname.includes('staging.dev.sf.gov')) {
			return 'https://api.staging.dev.sf.gov/admin/';
		}
	} catch (e) {
		// invalid URL, fall through to default
	}
	return 'https://api.sf.gov/admin/';
}

/**
 * Extracts image data from page content
 * @param pageData - Raw page data from __NEXT_DATA__
 * @returns Array of MediaAsset objects for images
 */
export function extractImages(pageData: any): MediaAsset[] {
	const images: MediaAsset[] = [];

	// map raw image data to a MediaAsset
	function imageDataToAsset(data: any): MediaAsset {
		const url = data.file || data.url || data.full_url || data.meta?.download_url || data.src || '';
		return {
			id: data.id,
			title: data.title || data.alt || '',
			url,
			type: 'image',
			filename: data.filename || (data.file ? data.file.split('/').pop() : undefined),
			isDecorative: data.is_decorative === true,
		};
	}

	// helper function to recursively search for images in nested objects
	function findImages(obj: any): void {
		if (!obj || typeof obj !== 'object') return;

		// check if this object represents an image
		if (obj.type === 'image' && obj.value?.id) {
			images.push(imageDataToAsset(obj.value));
		}

		// check for image fields in the object
		if (obj.image && typeof obj.image === 'object' && obj.image.id) {
			images.push(imageDataToAsset(obj.image));
		}

		// recursively search arrays and objects
		if (Array.isArray(obj)) {
			obj.forEach(item => findImages(item));
		} else {
			Object.values(obj).forEach(value => findImages(value));
		}
	}

	// extract background_header_image from the top level before recursive search
	if (pageData?.background_header_image?.id) {
		images.push(imageDataToAsset(pageData.background_header_image));
	}

	findImages(pageData);

	// remove duplicates based on ID
	const uniqueImages = Array.from(
		new Map(images.map(img => [img.id, img])).values()
	);

	return uniqueImages;
}

/**
 * Extracts file/document data from page content
 * @param pageData - Raw page data from __NEXT_DATA__
 * @returns Array of MediaAsset objects for files
 */
export function extractFiles(pageData: any): MediaAsset[] {
	const files: MediaAsset[] = [];

	// helper function to recursively search for documents in nested objects
	function findFiles(obj: any): void {
		if (!obj || typeof obj !== 'object') return;

		// check if this object represents a document
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

		// check for document fields in the object
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

		// recursively search arrays and objects
		if (Array.isArray(obj)) {
			obj.forEach(item => findFiles(item));
		} else {
			Object.values(obj).forEach(value => findFiles(value));
		}
	}

	findFiles(pageData);

	// remove duplicates based on ID
	const uniqueFiles = Array.from(
		new Map(files.map(file => [file.id, file])).values()
	);

	return uniqueFiles;
}

/**
 * Extracts translation information from raw page data
 * @param rawPageData - Raw page data from __NEXT_DATA__
 * @param currentUrl - The current page URL
 * @returns Array of Translation objects
 */
function extractTranslations(rawPageData: any, currentUrl: string): Translation[] {
	const translations: Translation[] = [];
	const adminBaseUrl = getAdminBaseUrl(currentUrl);

	// map of locale codes to language names
	const localeNames: Record<string, string> = {
		'en': 'English',
		'es': 'Español',
		'zh': '中文',
		'fil': 'Filipino',
		'vi': 'Tiếng Việt',
	};

	// check if the page has translation data
	// __NEXT_DATA__ may include translation siblings in various formats
	// we'll look for common patterns in the meta or translations field
	const locale = rawPageData.meta?.locale || 'en';
	const languageCode = typeof locale === 'string' ? locale : locale.language_code || 'en';
	const languageName = localeNames[languageCode] || languageCode.toUpperCase();

	// add the current page as a translation
	translations.push({
		language: languageName,
		languageCode: languageCode,
		pageId: rawPageData.id,
		editUrl: `${adminBaseUrl}pages/${rawPageData.id}/edit/`,
		title: rawPageData.title || ''
	});

	// look for translation siblings if available
	// this may be in rawPageData.translations or rawPageData.translation_siblings
	const translationSiblings = rawPageData.translations || rawPageData.translation_siblings || [];
	
	if (Array.isArray(translationSiblings)) {
		translationSiblings.forEach((sibling: any) => {
			if (sibling.id && sibling.id !== rawPageData.id) {
				const siblingLocale = sibling.meta?.locale || sibling.locale || 'en';
				const siblingLanguageCode = typeof siblingLocale === 'string' ? siblingLocale : siblingLocale.language_code || 'en';
				const siblingLanguageName = localeNames[siblingLanguageCode] || siblingLanguageCode.toUpperCase();

				translations.push({
					language: siblingLanguageName,
					languageCode: siblingLanguageCode,
					pageId: sibling.id,
					editUrl: `${adminBaseUrl}pages/${sibling.id}/edit/`,
					title: sibling.title || ''
				});
			}
		});
	}

	// sort translations: English first, then alphabetically by language code
	translations.sort((a, b) => {
		if (a.languageCode === 'en') return -1;
		if (b.languageCode === 'en') return 1;
		return a.languageCode.localeCompare(b.languageCode);
	});

	return translations;
}

/**
 * Transforms raw __NEXT_DATA__ page props into a WagtailPage object
 * @param rawPageData - The page object from props.pageProps.page
 * @param currentUrl - The current page URL for determining admin base URL
 * @returns A WagtailPage object matching the shared interface
 */
export function transformNextDataToWagtailPage(
	rawPageData: Record<string, unknown>,
	currentUrl: string
): WagtailPage {
	const pageId = rawPageData.id as number;
	const adminBaseUrl = getAdminBaseUrl(currentUrl);
	const editUrl = `${adminBaseUrl}pages/${pageId}/edit/`;

	// extract primary agency information
	let primaryAgency: Agency | undefined = undefined;
	if (rawPageData.primary_agency && typeof rawPageData.primary_agency === 'object') {
		const agency = rawPageData.primary_agency as any;
		primaryAgency = {
			id: agency.id,
			title: agency.title || '',
			url: agency.meta?.html_url || ''
		};
	}

	// extract form schema information for sf.Form pages
	let schema: FormSchema | undefined = undefined;
	if (rawPageData.schema && typeof rawPageData.schema === 'object') {
		const schemaData = rawPageData.schema as any;
		schema = {
			_id: schemaData._id || '',
			title: schemaData.title || '',
			project: schemaData.project || ''
		};
	}

	// extract form confirmation information for sf.Form pages
	let formConfirmation: FormConfirmation | undefined = undefined;
	if (rawPageData.confirmation_title || rawPageData.confirmation_body) {
		let bodyHtml = '';
		
		// confirmation_body is an array of items, find the one with type "text"
		if (Array.isArray(rawPageData.confirmation_body)) {
			const textBlock = (rawPageData.confirmation_body as any[]).find((item: any) => item.type === 'text');
			if (textBlock && textBlock.value) {
				bodyHtml = textBlock.value;
			}
		}
		
		formConfirmation = {
			title: (rawPageData.confirmation_title as string) || '',
			body: bodyHtml
		};
	}

	// extract meta information
	const meta = rawPageData.meta as any;
	
	return {
		id: pageId,
		title: (rawPageData.title as string) || '',
		slug: meta?.slug || '',
		contentType: meta?.type || '',
		primaryAgency,
		schema,
		formConfirmation,
		translations: extractTranslations(rawPageData, currentUrl),
		images: extractImages(rawPageData),
		files: extractFiles(rawPageData),
		editUrl,
		meta: {
			type: meta?.type || '',
			detailUrl: meta?.detail_url || '',
			htmlUrl: meta?.html_url || ''
		}
	};
}

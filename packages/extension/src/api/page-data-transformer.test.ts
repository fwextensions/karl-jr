/**
 * Property-Based Tests for Page Data Transformer
 * 
 * These tests validate universal properties that should hold across all valid inputs
 * using fast-check for property-based testing.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { transformNextDataToWagtailPage } from './page-data-transformer';

describe('Page Data Transformer - Property Tests', () => {
	/**
	 * Property 2: Transformer produces complete WagtailPage with correct field mapping
	 * 
	 * **Validates: Requirements 2.1, 2.2, 2.6**
	 * 
	 * For any raw page data object with required fields (id, title, meta.slug, meta.type)
	 * and a valid current URL, the transformer SHALL produce a WagtailPage where:
	 * - id matches the input id
	 * - title matches the input title
	 * - slug matches the input meta.slug
	 * - contentType matches the input meta.type
	 * - editUrl equals {adminBaseUrl}pages/{id}/edit/
	 * - translations is an array
	 * - images is an array
	 * - files is an array
	 * - meta.type, meta.detailUrl, and meta.htmlUrl are present
	 * - When primary_agency is present in the input, primaryAgency is present in the output
	 */
	it('Property 2: Transformer produces complete WagtailPage with correct field mapping', () => {
		// generator for raw page data with required fields
		const rawPageDataArbitrary = fc.record({
			id: fc.integer({ min: 1, max: 999999 }),
			title: fc.string({ minLength: 1, maxLength: 200 }),
			meta: fc.record({
				slug: fc.string({ minLength: 1, maxLength: 100 }).map(s => s.replace(/\s/g, '-').toLowerCase()),
				type: fc.constantFrom('sf.InformationPage', 'sf.ServicePage', 'sf.Form', 'sf.DepartmentPage'),
				detail_url: fc.webUrl(),
				html_url: fc.webUrl(),
				locale: fc.constantFrom('en', 'es', 'zh', 'fil', 'vi'),
			}),
			// optionally include primary_agency
			primary_agency: fc.option(fc.record({
				id: fc.integer({ min: 1, max: 999 }),
				title: fc.string({ minLength: 1, maxLength: 100 }),
				meta: fc.record({
					html_url: fc.webUrl(),
				}),
			}), { nil: undefined }),
		});

		const currentUrlArbitrary = fc.constantFrom(
			'https://sf.gov/some-page',
			'https://staging.dev.sf.gov/some-page'
		);

		fc.assert(
			fc.property(rawPageDataArbitrary, currentUrlArbitrary, (rawPageData, currentUrl) => {
				const result = transformNextDataToWagtailPage(rawPageData, currentUrl);

				// verify required field mappings
				expect(result.id).toBe(rawPageData.id);
				expect(result.title).toBe(rawPageData.title);
				expect(result.slug).toBe(rawPageData.meta.slug);
				expect(result.contentType).toBe(rawPageData.meta.type);

				// verify editUrl format
				const expectedAdminBase = currentUrl.includes('staging.dev.sf.gov')
					? 'https://api.staging.dev.sf.gov/admin/'
					: 'https://api.sf.gov/admin/';
				expect(result.editUrl).toBe(`${expectedAdminBase}pages/${rawPageData.id}/edit/`);

				// verify array fields exist
				expect(Array.isArray(result.translations)).toBe(true);
				expect(Array.isArray(result.images)).toBe(true);
				expect(Array.isArray(result.files)).toBe(true);

				// verify meta fields are present
				expect(result.meta.type).toBe(rawPageData.meta.type);
				expect(result.meta.detailUrl).toBe(rawPageData.meta.detail_url);
				expect(result.meta.htmlUrl).toBe(rawPageData.meta.html_url);

				// verify primary_agency mapping when present
				if (rawPageData.primary_agency) {
					expect(result.primaryAgency).toBeDefined();
					expect(result.primaryAgency?.id).toBe(rawPageData.primary_agency.id);
					expect(result.primaryAgency?.title).toBe(rawPageData.primary_agency.title);
					expect(result.primaryAgency?.url).toBe(rawPageData.primary_agency.meta.html_url);
				}
			}),
			{ numRuns: 100 }
		);
	});

	/**
	 * Property 3: Media asset extraction preserves all assets
	 * 
	 * **Validates: Requirements 2.3, 2.4**
	 * 
	 * For any raw page data containing embedded image blocks (with type: "image" and a value.id)
	 * and document blocks (with type: "document" and a value.id), the transformer SHALL produce
	 * a WagtailPage where every unique image id appears in the images array and every unique
	 * document id appears in the files array.
	 */
	it('Property 3: Media asset extraction preserves all assets', () => {
		// generator for image blocks
		const imageBlockArbitrary = fc.record({
			type: fc.constant('image'),
			value: fc.record({
				id: fc.integer({ min: 1, max: 999999 }),
				title: fc.string({ minLength: 0, maxLength: 100 }),
				url: fc.webUrl(),
				filename: fc.string({ minLength: 1, maxLength: 50 }).map(s => `${s}.jpg`),
			}),
		});

		// generator for document blocks
		const documentBlockArbitrary = fc.record({
			type: fc.constant('document'),
			value: fc.record({
				id: fc.integer({ min: 1, max: 999999 }),
				title: fc.string({ minLength: 0, maxLength: 100 }),
				file: fc.webUrl(),
				filename: fc.string({ minLength: 1, maxLength: 50 }).map(s => `${s}.pdf`),
			}),
		});

		// generator for raw page data with embedded media assets
		const rawPageDataWithMediaArbitrary = fc.record({
			id: fc.integer({ min: 1, max: 999999 }),
			title: fc.string({ minLength: 1, maxLength: 200 }),
			meta: fc.record({
				slug: fc.string({ minLength: 1, maxLength: 100 }),
				type: fc.constant('sf.InformationPage'),
				detail_url: fc.webUrl(),
				html_url: fc.webUrl(),
				locale: fc.constant('en'),
			}),
			// nested content with images and documents
			body: fc.array(
				fc.oneof(
					imageBlockArbitrary,
					documentBlockArbitrary,
					fc.record({ type: fc.constant('text'), value: fc.string() })
				),
				{ minLength: 1, maxLength: 20 }
			),
		});

		fc.assert(
			fc.property(rawPageDataWithMediaArbitrary, (rawPageData) => {
				const result = transformNextDataToWagtailPage(rawPageData, 'https://sf.gov/test');

				// collect expected image and document IDs from the input
				const expectedImageIds = new Set<number>();
				const expectedDocumentIds = new Set<number>();

				rawPageData.body.forEach((block: any) => {
					if (block.type === 'image' && block.value?.id) {
						expectedImageIds.add(block.value.id);
					}
					if (block.type === 'document' && block.value?.id) {
						expectedDocumentIds.add(block.value.id);
					}
				});

				// verify all expected image IDs are in the result
				const resultImageIds = new Set(result.images.map(img => img.id));
				expectedImageIds.forEach(id => {
					expect(resultImageIds.has(id)).toBe(true);
				});

				// verify all expected document IDs are in the result
				const resultDocumentIds = new Set(result.files.map(file => file.id));
				expectedDocumentIds.forEach(id => {
					expect(resultDocumentIds.has(id)).toBe(true);
				});
			}),
			{ numRuns: 100 }
		);
	});

	/**
	 * Property 4: Translation extraction preserves all locales
	 * 
	 * **Validates: Requirements 2.5**
	 * 
	 * For any raw page data containing translation entries with distinct locale codes,
	 * the transformer SHALL produce a WagtailPage where the translations array contains
	 * one entry per unique locale, each with a valid languageCode, pageId, and editUrl.
	 */
	it('Property 4: Translation extraction preserves all locales', () => {
		// generator for translation siblings with unique IDs and varying locales
		// ensure siblings have different IDs from the main page
		const translationSiblingArbitrary = (mainPageId: number) => fc.record({
			id: fc.integer({ min: 1, max: 999999 }).filter(id => id !== mainPageId),
			title: fc.string({ minLength: 1, maxLength: 200 }),
			meta: fc.record({
				locale: fc.constantFrom('en', 'es', 'zh', 'fil', 'vi'),
			}),
		});

		// generator for raw page data with translations
		// use uniqueArray to ensure each sibling has a unique combination of id and locale
		const rawPageDataWithTranslationsArbitrary = fc.integer({ min: 1, max: 999999 }).chain(mainPageId =>
			fc.record({
				id: fc.constant(mainPageId),
				title: fc.string({ minLength: 1, maxLength: 200 }),
				meta: fc.record({
					slug: fc.string({ minLength: 1, maxLength: 100 }),
					type: fc.constant('sf.InformationPage'),
					detail_url: fc.webUrl(),
					html_url: fc.webUrl(),
					locale: fc.constantFrom('en', 'es', 'zh', 'fil', 'vi'),
				}),
				// use uniqueArray to ensure no duplicate id+locale combinations
				translations: fc.uniqueArray(
					translationSiblingArbitrary(mainPageId),
					{
						minLength: 0,
						maxLength: 5,
						selector: (sibling: any) => `${sibling.id}-${sibling.meta.locale}`,
					}
				),
			})
		);

		fc.assert(
			fc.property(rawPageDataWithTranslationsArbitrary, (rawPageData) => {
				const result = transformNextDataToWagtailPage(rawPageData, 'https://sf.gov/test');

				// collect expected locale codes (including the current page's locale)
				const expectedLocales = new Set<string>();
				expectedLocales.add(rawPageData.meta.locale);
				
				rawPageData.translations.forEach((sibling: any) => {
					if (sibling.id !== rawPageData.id && sibling.meta?.locale) {
						expectedLocales.add(sibling.meta.locale);
					}
				});

				// verify all expected locales are in the result
				const resultLocales = new Set(result.translations.map(t => t.languageCode));
				expectedLocales.forEach(locale => {
					expect(resultLocales.has(locale)).toBe(true);
				});

				// verify each translation has required fields
				result.translations.forEach(translation => {
					expect(translation.languageCode).toBeTruthy();
					expect(translation.pageId).toBeGreaterThan(0);
					expect(translation.editUrl).toContain('/pages/');
					expect(translation.editUrl).toContain('/edit/');
				});

				// verify the current page is always included in translations
				const currentPageInTranslations = result.translations.find(t => t.pageId === rawPageData.id);
				expect(currentPageInTranslations).toBeDefined();
				expect(currentPageInTranslations?.languageCode).toBe(rawPageData.meta.locale);
			}),
			{ numRuns: 100 }
		);
	});
});

describe('Page Data Transformer - Unit Tests for Edge Cases', () => {
	/**
	 * Test with minimal valid input (only required fields)
	 * Validates: Requirements 2.1, 2.2, 2.6
	 */
	it('should transform minimal valid input with only required fields', () => {
		const minimalPageData = {
			id: 12345,
			title: 'Test Page',
			meta: {
				slug: 'test-page',
				type: 'sf.InformationPage',
				detail_url: 'https://api.sf.gov/api/v2/pages/12345/',
				html_url: 'https://sf.gov/test-page',
				locale: 'en',
			},
		};

		const result = transformNextDataToWagtailPage(minimalPageData, 'https://sf.gov/test-page');

		expect(result.id).toBe(12345);
		expect(result.title).toBe('Test Page');
		expect(result.slug).toBe('test-page');
		expect(result.contentType).toBe('sf.InformationPage');
		expect(result.editUrl).toBe('https://api.sf.gov/admin/pages/12345/edit/');
		expect(result.translations).toHaveLength(1);
		expect(result.translations[0].languageCode).toBe('en');
		expect(result.images).toEqual([]);
		expect(result.files).toEqual([]);
		expect(result.meta.type).toBe('sf.InformationPage');
		expect(result.meta.detailUrl).toBe('https://api.sf.gov/api/v2/pages/12345/');
		expect(result.meta.htmlUrl).toBe('https://sf.gov/test-page');
		expect(result.primaryAgency).toBeUndefined();
		expect(result.schema).toBeUndefined();
		expect(result.formConfirmation).toBeUndefined();
	});

	/**
	 * Test with primary_agency present
	 * Validates: Requirements 2.2
	 */
	it('should include primaryAgency when primary_agency is present', () => {
		const pageDataWithAgency = {
			id: 12345,
			title: 'Test Page',
			meta: {
				slug: 'test-page',
				type: 'sf.ServicePage',
				detail_url: 'https://api.sf.gov/api/v2/pages/12345/',
				html_url: 'https://sf.gov/test-page',
				locale: 'en',
			},
			primary_agency: {
				id: 42,
				title: 'Department of Technology',
				meta: {
					html_url: 'https://sf.gov/departments/technology',
				},
			},
		};

		const result = transformNextDataToWagtailPage(pageDataWithAgency, 'https://sf.gov/test-page');

		expect(result.primaryAgency).toBeDefined();
		expect(result.primaryAgency?.id).toBe(42);
		expect(result.primaryAgency?.title).toBe('Department of Technology');
		expect(result.primaryAgency?.url).toBe('https://sf.gov/departments/technology');
	});

	/**
	 * Test with primary_agency absent
	 * Validates: Requirements 2.2
	 */
	it('should have undefined primaryAgency when primary_agency is absent', () => {
		const pageDataWithoutAgency = {
			id: 12345,
			title: 'Test Page',
			meta: {
				slug: 'test-page',
				type: 'sf.InformationPage',
				detail_url: 'https://api.sf.gov/api/v2/pages/12345/',
				html_url: 'https://sf.gov/test-page',
				locale: 'en',
			},
		};

		const result = transformNextDataToWagtailPage(pageDataWithoutAgency, 'https://sf.gov/test-page');

		expect(result.primaryAgency).toBeUndefined();
	});

	/**
	 * Test with schema field (for sf.Form pages)
	 * Validates: Requirements 2.1
	 */
	it('should include schema when present on form pages', () => {
		const formPageWithSchema = {
			id: 12345,
			title: 'Contact Form',
			meta: {
				slug: 'contact-form',
				type: 'sf.Form',
				detail_url: 'https://api.sf.gov/api/v2/pages/12345/',
				html_url: 'https://sf.gov/contact-form',
				locale: 'en',
			},
			schema: {
				_id: 'schema-abc-123',
				title: 'Contact Form Schema',
				project: 'sf-gov-forms',
			},
		};

		const result = transformNextDataToWagtailPage(formPageWithSchema, 'https://sf.gov/contact-form');

		expect(result.schema).toBeDefined();
		expect(result.schema?._id).toBe('schema-abc-123');
		expect(result.schema?.title).toBe('Contact Form Schema');
		expect(result.schema?.project).toBe('sf-gov-forms');
	});

	/**
	 * Test with formConfirmation field (for sf.Form pages)
	 * Validates: Requirements 2.1
	 */
	it('should include formConfirmation when present on form pages', () => {
		const formPageWithConfirmation = {
			id: 12345,
			title: 'Contact Form',
			meta: {
				slug: 'contact-form',
				type: 'sf.Form',
				detail_url: 'https://api.sf.gov/api/v2/pages/12345/',
				html_url: 'https://sf.gov/contact-form',
				locale: 'en',
			},
			confirmation_title: 'Thank you!',
			confirmation_body: [
				{ type: 'text', value: '<p>Your form has been submitted successfully.</p>' },
			],
		};

		const result = transformNextDataToWagtailPage(formPageWithConfirmation, 'https://sf.gov/contact-form');

		expect(result.formConfirmation).toBeDefined();
		expect(result.formConfirmation?.title).toBe('Thank you!');
		expect(result.formConfirmation?.body).toBe('<p>Your form has been submitted successfully.</p>');
	});

	/**
	 * Test with both schema and formConfirmation fields
	 * Validates: Requirements 2.1
	 */
	it('should include both schema and formConfirmation when both are present', () => {
		const formPageWithBoth = {
			id: 12345,
			title: 'Contact Form',
			meta: {
				slug: 'contact-form',
				type: 'sf.Form',
				detail_url: 'https://api.sf.gov/api/v2/pages/12345/',
				html_url: 'https://sf.gov/contact-form',
				locale: 'en',
			},
			schema: {
				_id: 'schema-abc-123',
				title: 'Contact Form Schema',
				project: 'sf-gov-forms',
			},
			confirmation_title: 'Thank you!',
			confirmation_body: [
				{ type: 'text', value: '<p>Your form has been submitted successfully.</p>' },
			],
		};

		const result = transformNextDataToWagtailPage(formPageWithBoth, 'https://sf.gov/contact-form');

		expect(result.schema).toBeDefined();
		expect(result.schema?._id).toBe('schema-abc-123');
		expect(result.formConfirmation).toBeDefined();
		expect(result.formConfirmation?.title).toBe('Thank you!');
	});

	/**
	 * Test editUrl generation for production URL
	 * Validates: Requirements 2.6
	 */
	it('should generate production editUrl for production URLs', () => {
		const pageData = {
			id: 12345,
			title: 'Test Page',
			meta: {
				slug: 'test-page',
				type: 'sf.InformationPage',
				detail_url: 'https://api.sf.gov/api/v2/pages/12345/',
				html_url: 'https://sf.gov/test-page',
				locale: 'en',
			},
		};

		const result = transformNextDataToWagtailPage(pageData, 'https://sf.gov/test-page');

		expect(result.editUrl).toBe('https://api.sf.gov/admin/pages/12345/edit/');
	});

	/**
	 * Test editUrl generation for staging URL
	 * Validates: Requirements 2.6
	 */
	it('should generate staging editUrl for staging URLs', () => {
		const pageData = {
			id: 12345,
			title: 'Test Page',
			meta: {
				slug: 'test-page',
				type: 'sf.InformationPage',
				detail_url: 'https://api.staging.dev.sf.gov/api/v2/pages/12345/',
				html_url: 'https://staging.dev.sf.gov/test-page',
				locale: 'en',
			},
		};

		const result = transformNextDataToWagtailPage(pageData, 'https://staging.dev.sf.gov/test-page');

		expect(result.editUrl).toBe('https://api.staging.dev.sf.gov/admin/pages/12345/edit/');
	});

	/**
	 * Test editUrl generation with various staging URL formats
	 * Validates: Requirements 2.6
	 */
	it('should correctly detect staging URLs with different paths', () => {
		const pageData = {
			id: 67890,
			title: 'Another Test Page',
			meta: {
				slug: 'another-test',
				type: 'sf.ServicePage',
				detail_url: 'https://api.staging.dev.sf.gov/api/v2/pages/67890/',
				html_url: 'https://staging.dev.sf.gov/another-test',
				locale: 'en',
			},
		};

		const result = transformNextDataToWagtailPage(pageData, 'https://staging.dev.sf.gov/some/nested/path');

		expect(result.editUrl).toBe('https://api.staging.dev.sf.gov/admin/pages/67890/edit/');
	});
});

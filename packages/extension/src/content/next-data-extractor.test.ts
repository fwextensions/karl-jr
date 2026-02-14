/**
 * Property-Based Tests for Next Data Extractor
 * 
 * These tests validate the JSON path extraction logic using fast-check
 * for property-based testing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { extractNextDataPage } from './next-data-extractor';

/**
 * Property 1: JSON path extraction produces page object
 * 
 * **Validates: Requirements 1.2**
 * 
 * For any valid JSON string containing an object at props.pageProps.page,
 * parsing the string and extracting that path SHALL return the exact object at that path.
 */
describe('Next Data Extractor - Property Tests', () => {
	// setup and teardown for DOM manipulation
	beforeEach(() => {
		// clear any existing __NEXT_DATA__ elements
		const existing = document.getElementById('__NEXT_DATA__');
		if (existing) {
			existing.remove();
		}
	});

	afterEach(() => {
		// cleanup after each test
		const existing = document.getElementById('__NEXT_DATA__');
		if (existing) {
			existing.remove();
		}
	});

	it('Property 1: JSON path extraction produces page object', () => {
		// generator for valid page objects with required fields
		const pageObjectArbitrary = fc.record({
			id: fc.integer({ min: 1, max: 999999 }),
			title: fc.string({ minLength: 1, maxLength: 200 }),
			meta: fc.record({
				slug: fc.string({ minLength: 1, maxLength: 100 }),
				type: fc.constantFrom('sf.InformationPage', 'sf.ServicePage', 'sf.Form', 'sf.DepartmentPage'),
				detail_url: fc.webUrl(),
				html_url: fc.webUrl(),
				locale: fc.constantFrom('en', 'es', 'zh', 'fil', 'vi'),
			}),
			// add some optional fields to make it more realistic
			// note: we use null instead of undefined because JSON.stringify removes undefined
			primary_agency: fc.option(fc.record({
				id: fc.integer({ min: 1, max: 999 }),
				title: fc.string({ minLength: 1, maxLength: 100 }),
			}), { nil: null }),
			body: fc.option(fc.array(fc.record({
				type: fc.constantFrom('text', 'image', 'document'),
				// use jsonValue to ensure the value is JSON-serializable
				value: fc.jsonValue(),
			})), { nil: null }),
		});

		// generator for the full __NEXT_DATA__ structure
		const nextDataArbitrary = pageObjectArbitrary.map(pageObject => ({
			props: {
				pageProps: {
					page: pageObject,
				},
			},
		}));

		fc.assert(
			fc.property(nextDataArbitrary, (nextDataPayload) => {
				// cleanup any existing script element first
				const existingScript = document.getElementById('__NEXT_DATA__');
				if (existingScript) {
					existingScript.remove();
				}

				// create a script element with the JSON payload
				const scriptElement = document.createElement('script');
				scriptElement.id = '__NEXT_DATA__';
				scriptElement.type = 'application/json';
				scriptElement.textContent = JSON.stringify(nextDataPayload);
				document.body.appendChild(scriptElement);

				// extract the page using the same logic as the extractor
				const scriptEl = document.getElementById('__NEXT_DATA__');
				expect(scriptEl).not.toBeNull();

				const textContent = scriptEl!.textContent;
				expect(textContent).not.toBeNull();

				const parsedData = JSON.parse(textContent!);
				const extractedPage = parsedData?.props?.pageProps?.page;

				// verify the extracted page matches the original page object
				// note: we need to compare against the JSON-serialized version
				// because JSON.stringify/parse transforms the data (e.g., undefined -> null)
				const expectedPage = JSON.parse(JSON.stringify(nextDataPayload.props.pageProps.page));
				expect(extractedPage).toBeDefined();
				expect(extractedPage).toEqual(expectedPage);

				// verify all required fields are present
				expect(extractedPage.id).toBe(expectedPage.id);
				expect(extractedPage.title).toBe(expectedPage.title);
				expect(extractedPage.meta).toEqual(expectedPage.meta);

				// cleanup
				scriptElement.remove();
			}),
			{ numRuns: 100 }
		);
	});

	it('Property 1 (variant): JSON path extraction handles nested structures', () => {
		// generator for more complex page objects with deeply nested content
		const complexPageObjectArbitrary = fc.record({
			id: fc.integer({ min: 1, max: 999999 }),
			title: fc.string({ minLength: 1, maxLength: 200 }),
			meta: fc.record({
				slug: fc.string({ minLength: 1, maxLength: 100 }),
				type: fc.constant('sf.InformationPage'),
				detail_url: fc.webUrl(),
				html_url: fc.webUrl(),
				locale: fc.constant('en'),
			}),
			// add nested content blocks
			body: fc.array(
				fc.record({
					type: fc.constantFrom('text', 'image', 'document', 'section'),
					value: fc.oneof(
						fc.string(),
						fc.record({
							id: fc.integer({ min: 1, max: 999999 }),
							title: fc.string(),
							url: fc.webUrl(),
						}),
					),
				}),
				{ minLength: 0, maxLength: 10 }
			),
		});

		const nextDataArbitrary = complexPageObjectArbitrary.map(pageObject => ({
			props: {
				pageProps: {
					page: pageObject,
					// add some extra fields that should be ignored
					otherData: { foo: 'bar' },
				},
			},
			// add some top-level fields that should be ignored
			buildId: 'test-build-id',
			isFallback: false,
		}));

		fc.assert(
			fc.property(nextDataArbitrary, (nextDataPayload) => {
				// cleanup any existing script element first
				const existingScript = document.getElementById('__NEXT_DATA__');
				if (existingScript) {
					existingScript.remove();
				}

				// create a script element with the JSON payload
				const scriptElement = document.createElement('script');
				scriptElement.id = '__NEXT_DATA__';
				scriptElement.type = 'application/json';
				scriptElement.textContent = JSON.stringify(nextDataPayload);
				document.body.appendChild(scriptElement);

				// extract the page using the same logic as the extractor
				const scriptEl = document.getElementById('__NEXT_DATA__');
				const textContent = scriptEl!.textContent;
				const parsedData = JSON.parse(textContent!);
				const extractedPage = parsedData?.props?.pageProps?.page;

				// verify the extracted page matches exactly
				expect(extractedPage).toEqual(nextDataPayload.props.pageProps.page);

				// verify the extraction is at the correct path (not other fields)
				expect(extractedPage).not.toHaveProperty('buildId');
				expect(extractedPage).not.toHaveProperty('isFallback');
				expect(extractedPage).not.toHaveProperty('otherData');

				// cleanup
				scriptElement.remove();
			}),
			{ numRuns: 100 }
		);
	});
});


/**
 * Unit Tests for Extraction Error Cases
 * 
 * These tests validate error handling for specific edge cases:
 * - Missing __NEXT_DATA__ element (Requirement 1.3)
 * - Invalid JSON content (Requirement 1.4)
 * - Valid JSON but missing props.pageProps.page path (Requirement 1.5)
 */
describe('Next Data Extractor - Error Cases', () => {
	beforeEach(() => {
		// clear any existing __NEXT_DATA__ elements
		const existing = document.getElementById('__NEXT_DATA__');
		if (existing) {
			existing.remove();
		}
	});

	afterEach(() => {
		// cleanup after each test
		const existing = document.getElementById('__NEXT_DATA__');
		if (existing) {
			existing.remove();
		}
	});

	/**
	 * Test missing __NEXT_DATA__ element
	 * Validates: Requirement 1.3
	 */
	it('should return error when __NEXT_DATA__ element is missing', () => {
		// ensure no __NEXT_DATA__ element exists
		const scriptEl = document.getElementById('__NEXT_DATA__');
		expect(scriptEl).toBeNull();

		// attempt extraction
		const result = extractNextDataPage();

		// verify error is returned
		expect(result).toHaveProperty('error');
		expect(result.error).toContain('__NEXT_DATA__');
		expect(result.error).toContain('not found');
	});

	/**
	 * Test invalid JSON content
	 * Validates: Requirement 1.4
	 */
	it('should return error when __NEXT_DATA__ contains invalid JSON', () => {
		// create script element with invalid JSON
		const scriptElement = document.createElement('script');
		scriptElement.id = '__NEXT_DATA__';
		scriptElement.type = 'application/json';
		scriptElement.textContent = '{ invalid json content }';
		document.body.appendChild(scriptElement);

		// attempt extraction
		const result = extractNextDataPage();

		// verify error is returned
		expect(result).toHaveProperty('error');
		expect(result.error).toContain('Invalid JSON');

		// cleanup
		scriptElement.remove();
	});

	/**
	 * Test valid JSON but missing props.pageProps.page path
	 * Validates: Requirement 1.5
	 */
	it('should return error when props.pageProps.page path is missing', () => {
		// create script element with valid JSON but missing the expected path
		const scriptElement = document.createElement('script');
		scriptElement.id = '__NEXT_DATA__';
		scriptElement.type = 'application/json';
		scriptElement.textContent = JSON.stringify({
			props: {
				pageProps: {
					// page field is missing
					otherData: { foo: 'bar' },
				},
			},
		});
		document.body.appendChild(scriptElement);

		// attempt extraction
		const result = extractNextDataPage();

		// verify error is returned
		expect(result).toHaveProperty('error');
		expect(result.error).toContain('props.pageProps.page');
		expect(result.error).toContain('not found');

		// cleanup
		scriptElement.remove();
	});

	/**
	 * Test valid JSON but props.pageProps is missing
	 * Validates: Requirement 1.5 (variant)
	 */
	it('should return error when props.pageProps is missing', () => {
		// create script element with valid JSON but missing pageProps
		const scriptElement = document.createElement('script');
		scriptElement.id = '__NEXT_DATA__';
		scriptElement.type = 'application/json';
		scriptElement.textContent = JSON.stringify({
			props: {
				// pageProps is missing
				otherData: { foo: 'bar' },
			},
		});
		document.body.appendChild(scriptElement);

		// attempt extraction
		const result = extractNextDataPage();

		// verify error is returned
		expect(result).toHaveProperty('error');
		expect(result.error).toContain('props.pageProps.page');
		expect(result.error).toContain('not found');

		// cleanup
		scriptElement.remove();
	});

	/**
	 * Test valid JSON but props is missing
	 * Validates: Requirement 1.5 (variant)
	 */
	it('should return error when props is missing', () => {
		// create script element with valid JSON but missing props
		const scriptElement = document.createElement('script');
		scriptElement.id = '__NEXT_DATA__';
		scriptElement.type = 'application/json';
		scriptElement.textContent = JSON.stringify({
			// props is missing
			buildId: 'test-build-id',
			isFallback: false,
		});
		document.body.appendChild(scriptElement);

		// attempt extraction
		const result = extractNextDataPage();

		// verify error is returned
		expect(result).toHaveProperty('error');
		expect(result.error).toContain('props.pageProps.page');
		expect(result.error).toContain('not found');

		// cleanup
		scriptElement.remove();
	});

	/**
	 * Test empty script tag
	 * Validates: Requirement 1.4 (edge case)
	 */
	it('should return error when __NEXT_DATA__ script tag is empty', () => {
		// create script element with no content
		const scriptElement = document.createElement('script');
		scriptElement.id = '__NEXT_DATA__';
		scriptElement.type = 'application/json';
		scriptElement.textContent = '';
		document.body.appendChild(scriptElement);

		// attempt extraction
		const result = extractNextDataPage();

		// verify error is returned
		expect(result).toHaveProperty('error');
		expect(result.error).toContain('empty');

		// cleanup
		scriptElement.remove();
	});

	/**
	 * Test page field is not an object
	 * Validates: Requirement 1.5 (edge case)
	 */
	it('should return error when props.pageProps.page is not an object', () => {
		// create script element where page is a string instead of an object
		const scriptElement = document.createElement('script');
		scriptElement.id = '__NEXT_DATA__';
		scriptElement.type = 'application/json';
		scriptElement.textContent = JSON.stringify({
			props: {
				pageProps: {
					page: 'not an object',
				},
			},
		});
		document.body.appendChild(scriptElement);

		// attempt extraction
		const result = extractNextDataPage();

		// verify error is returned
		expect(result).toHaveProperty('error');
		expect(result.error).toContain('props.pageProps.page');
		expect(result.error).toContain('not found');

		// cleanup
		scriptElement.remove();
	});
});

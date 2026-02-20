import type { VercelRequest, VercelResponse } from "@vercel/node";
import type {
	LinkCheckRequest,
	LinkCheckResultEvent,
	LinkCheckCompleteEvent,
	LinkCheckErrorEvent,
} from "@sf-gov/shared";
import { authenticateRequest, handleCors } from "../lib/auth.js";
import {
	logAuthFailure,
	logLinkCheckError,
	logClientDisconnection,
	logValidationError,
	logLinkCheckComplete,
	logRetryAttempt,
	logError,
	logInfo,
} from "../lib/logger.js";

/**
 * Server-side link checking endpoint
 * 
 * This endpoint validates HTTP/HTTPS links and streams results via Server-Sent Events (SSE).
 * It requires Wagtail authentication to prevent abuse.
 * 
 * Requirements: 8.1, 8.2, 8.3
 */

interface LinkCheckEnv {
	WAGTAIL_API_URL: string;
	TOKEN_SIGNING_SECRET: string;
}

function validateEnv(): LinkCheckEnv {
	const env = {
		WAGTAIL_API_URL: process.env.WAGTAIL_API_URL,
		TOKEN_SIGNING_SECRET: process.env.TOKEN_SIGNING_SECRET,
	};

	if (!env.WAGTAIL_API_URL) {
		throw new Error("Missing required environment variable: WAGTAIL_API_URL");
	}

	if (!env.TOKEN_SIGNING_SECRET) {
		throw new Error("Missing required environment variable: TOKEN_SIGNING_SECRET");
	}

	return env as LinkCheckEnv;
}

/**
 * Validation error with details about what failed
 */
interface ValidationError {
	field: string;
	message: string;
}

/**
 * Result of request validation
 */
interface ValidationResult {
	valid: boolean;
	errors: ValidationError[];
	data?: LinkCheckRequest;
}

/**
 * Sends a Server-Sent Event (SSE) to the client
 * Requirements: 3.1, 3.2, 8.4, 8.5, 8.6, 8.7
 * 
 * @param res - The Vercel response object
 * @param data - The data to send as JSON
 */
function sendSSE(res: VercelResponse, data: LinkCheckResultEvent | LinkCheckCompleteEvent | LinkCheckErrorEvent): void {
	// format: data: <JSON>\n\n
	// Requirement: 8.5, 8.6, 8.7
	const jsonData = JSON.stringify(data);
	res.write(`data: ${jsonData}\n\n`);
}

/**
 * Initializes the SSE stream with appropriate headers
 * Requirements: 3.1, 8.4
 * 
 * @param res - The Vercel response object
 */
function initSSE(res: VercelResponse): void {
	// set SSE headers
	// Requirement: 8.4
	res.setHeader("Content-Type", "text/event-stream");
	res.setHeader("Cache-Control", "no-cache");
	res.setHeader("Connection", "keep-alive");
	
	// disable response buffering for immediate streaming
	res.flushHeaders();
}

/**
 * Sets up client disconnection detection
 * Requirements: 6.6, 6.7
 * 
 * @param res - The Vercel response object
 * @returns Object with isDisconnected flag and cleanup function
 */
function setupDisconnectionDetection(res: VercelResponse): {
	isDisconnected: () => boolean;
	cleanup: () => void;
} {
	let disconnected = false;

	// listen for client disconnection
	// Requirement: 6.6
	const onClose = () => {
		disconnected = true;
	};

	res.on("close", onClose);

	return {
		// check if client has disconnected
		isDisconnected: () => disconnected,
		// cleanup function to remove event listener
		// Requirement: 6.7
		cleanup: () => {
			res.off("close", onClose);
		},
	};
}

/**
 * Properly closes the SSE stream
 * Requirements: 3.1, 3.2
 * 
 * @param res - The Vercel response object
 */
function closeSSE(res: VercelResponse): void {
	res.end();
}

/**
 * Validates that a string is a valid HTTP or HTTPS URL
 * Requirements: 1.4
 */
function isValidHttpUrl(urlString: string): boolean {
	try {
		const url = new URL(urlString);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

/**
 * Normalizes URLs for domain-specific handling
 * Requirements: 5.3, 5.4
 * 
 * @param url - The URL to normalize
 * @returns Normalized URL
 */
function normalizeUrl(url: string): string {
	try {
		const urlObj = new URL(url);
		
		// normalize bare https://sf.gov to https://www.sf.gov
		// Requirement: 5.3
		if (urlObj.hostname === "sf.gov" && urlObj.pathname === "/" && !urlObj.search && !urlObj.hash) {
			urlObj.hostname = "www.sf.gov";
			return urlObj.toString();
		}
		
		return url;
	} catch {
		// if URL parsing fails, return original
		return url;
	}
}

/**
 * Checks if a URL is a twitter.com or x.com domain
 * Requirements: 5.4
 * 
 * @param url - The URL to check
 * @returns true if the URL is twitter.com or x.com
 */
function isTwitterOrXDomain(url: string): boolean {
	try {
		const urlObj = new URL(url);
		const hostname = urlObj.hostname.toLowerCase();
		return hostname === "twitter.com" || hostname === "www.twitter.com" || 
		       hostname === "x.com" || hostname === "www.x.com";
	} catch {
		return false;
	}
}

/**
 * Checks a single link with retry logic and exponential backoff
 * Requirements: 6.2, 6.3
 * 
 * @param url - The URL to check
 * @param pageUrl - The source page URL (for mixed content detection)
 * @param requestId - Optional request ID for logging context
 * @returns LinkCheckResultEvent with validation results
 */
async function checkLinkWithRetry(url: string, pageUrl: string, requestId?: string): Promise<LinkCheckResultEvent> {
	// normalize URL for domain-specific handling
	// Requirement: 5.3
	const normalizedUrl = normalizeUrl(url);
	
	const maxRetries = 2;
	const backoffDelays = [100, 200]; // exponential backoff: 100ms, 200ms
	
	let lastError: Error | null = null;

	// try initial request + retries
	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			const result = await checkLink(normalizedUrl, pageUrl);
			
			// handle twitter.com/x.com domains: attempt validation, skip only if fails
			// Requirement: 5.4
			if (isTwitterOrXDomain(normalizedUrl) && (result.status === "error" || result.status === "timeout")) {
				// twitter/x validation failed, return the error but don't retry further
				logLinkCheckError(url, result.error || "Twitter/X domain validation failed", { requestId });
				return {
					url, // return original URL, not normalized
					status: result.status,
					error: result.error || "Twitter/X domain validation failed",
				};
			}
			
			// if the result is an error or timeout, retry
			// Requirement: 6.2
			if (result.status === "error" || result.status === "timeout") {
				lastError = new Error(result.error || "Request failed");
				
				// if we have retries left, wait and retry
				if (attempt < maxRetries) {
					// log retry attempt
					// Requirement: 6.4
					logRetryAttempt(url, attempt + 1, lastError.message, { requestId });
					await sleep(backoffDelays[attempt]);
					continue;
				}
			}
			
			// success or non-retryable status (ok, broken, redirect, insecure)
			// return with original URL, not normalized
			return {
				...result,
				url, // preserve original URL in response
			};
		} catch (error) {
			lastError = error instanceof Error ? error : new Error("Unknown error");
			
			// if we have retries left, wait and retry
			// Requirement: 6.2, 6.3
			if (attempt < maxRetries) {
				// log retry attempt
				// Requirement: 6.4
				logRetryAttempt(url, attempt + 1, lastError.message, { requestId });
				await sleep(backoffDelays[attempt]);
				continue;
			}
		}
	}

	// all retries exhausted, return error status
	// Requirement: 6.3, 6.4
	const errorMessage = lastError?.message || "Request failed after all retries";
	logLinkCheckError(url, errorMessage, { requestId, retryCount: maxRetries });
	return {
		url, // return original URL, not normalized
		status: "error",
		error: errorMessage,
	};
}

/**
 * Sleeps for the specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Extracts the domain from a URL
 * 
 * @param url - The URL to extract domain from
 * @returns The domain (hostname) or empty string if invalid
 */
function extractDomain(url: string): string {
	try {
		const urlObj = new URL(url);
		return urlObj.hostname.toLowerCase();
	} catch {
		return "";
	}
}

/**
 * Processes links with concurrency control and rate limiting
 * Requirements: 5.1, 5.2, 3.2
 * 
 * @param urls - Array of URLs to check
 * @param pageUrl - The source page URL (for mixed content detection)
 * @param onResult - Callback for each completed link check
 * @param isDisconnected - Function to check if client has disconnected
 * @param requestId - Optional request ID for logging context
 * @param maxExecutionTime - Maximum execution time in milliseconds (default: 60000ms = 60s)
 * @returns Promise that resolves when all links are checked, time limit reached, or client disconnects
 */
async function processLinksWithRateLimiting(
	urls: string[],
	pageUrl: string,
	onResult: (result: LinkCheckResultEvent) => void,
	isDisconnected: () => boolean,
	requestId?: string,
	maxExecutionTime: number = 60000 // Requirement: 5.5 - 60 second maximum
): Promise<{ checked: number; timedOut: boolean }> {
	const maxConcurrent = 10; // Requirement: 5.1
	const domainDelay = 100; // Requirement: 5.2 - 100ms delay between requests to same domain
	
	// track last request time per domain
	const domainLastRequest = new Map<string, number>();
	
	// track active requests
	let activeRequests = 0;
	let checkedCount = 0;
	let timedOut = false;
	
	// track start time for execution time limit
	// Requirement: 5.5
	const startTime = Date.now();
	
	// queue of pending URLs to process
	const queue = [...urls];
	
	// promise that resolves when all links are processed or client disconnects
	return new Promise((resolve) => {
		// function to check if execution time limit has been reached
		// Requirement: 5.5
		const isTimedOut = () => {
			return Date.now() - startTime >= maxExecutionTime;
		};
		
		// function to process next URL from queue
		const processNext = async () => {
			// check if client disconnected
			// Requirement: 6.6, 6.7
			if (isDisconnected()) {
				// client disconnected, stop processing
				// Requirement: 6.4
				logClientDisconnection({ requestId, checked: checkedCount, total: urls.length });
				resolve({ checked: checkedCount, timedOut: false });
				return;
			}
			
			// check if execution time limit reached
			// Requirement: 5.5
			if (isTimedOut()) {
				timedOut = true;
				// time limit reached, stop processing new requests
				// wait for active requests to complete
				if (activeRequests === 0) {
					resolve({ checked: checkedCount, timedOut: true });
				}
				return;
			}
			
			// check if queue is empty
			if (queue.length === 0) {
				// if no active requests, we're done
				if (activeRequests === 0) {
					resolve({ checked: checkedCount, timedOut: false });
				}
				return;
			}
			
			// check if we've reached max concurrent requests
			// Requirement: 5.1
			if (activeRequests >= maxConcurrent) {
				return;
			}
			
			// get next URL from queue
			const url = queue.shift()!;
			const domain = extractDomain(url);
			
			// check if we need to delay for this domain
			// Requirement: 5.2
			const lastRequestTime = domainLastRequest.get(domain) || 0;
			const timeSinceLastRequest = Date.now() - lastRequestTime;
			const delayNeeded = Math.max(0, domainDelay - timeSinceLastRequest);
			
			// if delay needed, wait before processing
			if (delayNeeded > 0) {
				await sleep(delayNeeded);
			}
			
			// check again if timed out after delay
			if (isTimedOut()) {
				timedOut = true;
				// put URL back in queue (won't be processed)
				queue.unshift(url);
				if (activeRequests === 0) {
					resolve({ checked: checkedCount, timedOut: true });
				}
				return;
			}
			
			// update domain last request time
			domainLastRequest.set(domain, Date.now());
			
			// increment active requests
			activeRequests++;
			
			// process the link
			checkLinkWithRetry(url, pageUrl, requestId)
				.then((result) => {
					// check if client disconnected before sending result
					if (!isDisconnected()) {
						// stream result to client
						// Requirement: 3.2
						onResult(result);
						checkedCount++;
					}
				})
				.catch((error) => {
					// handle unexpected errors
					// Requirement: 6.4
					logLinkCheckError(url, error instanceof Error ? error.message : "Unknown error", { requestId });
					if (!isDisconnected()) {
						onResult({
							url,
							status: "error",
							error: error instanceof Error ? error.message : "Unknown error",
						});
						checkedCount++;
					}
				})
				.finally(() => {
					// decrement active requests
					activeRequests--;
					
					// check if we should resolve (timed out and no active requests)
					if (timedOut && activeRequests === 0) {
						resolve({ checked: checkedCount, timedOut: true });
						return;
					}
					
					// process next URL
					processNext();
				});
			
			// try to process another URL immediately (up to max concurrent)
			processNext();
		};
		
		// start processing with initial batch
		// start up to maxConcurrent requests
		for (let i = 0; i < Math.min(maxConcurrent, urls.length); i++) {
			processNext();
		}
	});
}

/**
 * Checks a single link and returns its validation result
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7
 * 
 * @param url - The URL to check
 * @param pageUrl - The source page URL (for mixed content detection)
 * @returns LinkCheckResultEvent with validation results
 */
async function checkLink(url: string, pageUrl: string): Promise<LinkCheckResultEvent> {
	let sslError = false;
	
	try {
		// detect mixed content (HTTP on HTTPS page)
		// Requirement: 4.6
		const pageProtocol = new URL(pageUrl).protocol;
		const linkProtocol = new URL(url).protocol;
		
		if (pageProtocol === "https:" && linkProtocol === "http:") {
			return {
				url,
				status: "insecure",
				statusCode: undefined,
				error: "HTTP link on HTTPS page (mixed content)",
			};
		}

		// try HEAD first, fall back to GET if HEAD fails
		// some servers block HEAD requests
		const methods = ["HEAD", "GET"] as const;
		let lastError: Error | null = null;

		for (const method of methods) {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 10000);

			try {
				// follow redirects up to 5 hops
				// Requirement: 4.1
				const fetchOptions: RequestInit & { follow?: number } = {
					method,
					redirect: "follow",
					signal: controller.signal,
					headers: {
						// use a realistic browser User-Agent to avoid bot detection
						"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
						"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
						"Accept-Language": "en-US,en;q=0.9",
						"Cache-Control": "no-cache",
					},
					follow: 5,
				};

				const response = await fetch(url, fetchOptions);

				clearTimeout(timeoutId);

				const statusCode = response.status;
				const finalUrl = response.url;

				// map HTTP status codes to link statuses
				// Requirements: 4.2, 4.3, 4.4
				if (statusCode >= 200 && statusCode < 300) {
					// 2xx status = ok
					// Requirement: 4.2
					return {
						url,
						status: "ok",
						statusCode,
						finalUrl: finalUrl !== url ? finalUrl : undefined,
					};
				} else if (statusCode >= 300 && statusCode < 400) {
					// 3xx status after following redirects = redirect
					// Requirement: 4.3
					return {
						url,
						status: "redirect",
						statusCode,
						finalUrl,
					};
				} else if (statusCode === 405 && method === "HEAD") {
					// method not allowed for HEAD, try GET
					continue;
				} else {
					// 4xx/5xx status = broken
					// Requirement: 4.4
					return {
						url,
						status: "broken",
						statusCode,
					};
				}
			} catch (fetchError) {
				clearTimeout(timeoutId);

				// check if it was a timeout
				// Requirement: 4.5
				if (fetchError instanceof Error && fetchError.name === "AbortError") {
					return {
						url,
						status: "timeout",
						error: "Request timed out after 10 seconds",
					};
				}

				// capture error details for better debugging
				lastError = fetchError instanceof Error ? fetchError : new Error("Unknown fetch error");
				
				// check for SSL certificate errors
				if (lastError.cause && typeof lastError.cause === "object" && "code" in lastError.cause) {
					const errorCode = (lastError.cause as { code: string }).code;
					if (errorCode === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || 
						errorCode === "CERT_HAS_EXPIRED" ||
						errorCode === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
						errorCode === "SELF_SIGNED_CERT_IN_CHAIN" ||
						errorCode.startsWith("CERT_") || 
						errorCode.startsWith("SSL_")) {
						sslError = true;
					}
				}
				
				// if HEAD failed, try GET before giving up
				if (method === "HEAD") {
					continue;
				}

				// GET also failed, throw the error
				throw lastError;
			}
		}

		// shouldn't reach here, but handle it
		throw lastError || new Error("All request methods failed");
	} catch (error) {
		// network errors, DNS failures, SSL/TLS errors, etc.
		// Requirement: 4.7
		let errorMessage = "Unknown error";
		let errorCode = "";
		if (error instanceof Error) {
			errorMessage = error.message;
			if (error.cause && typeof error.cause === "object" && "code" in error.cause) {
				errorCode = (error.cause as { code: string }).code;
				errorMessage = `${error.message} (${errorCode})`;
			}
		}
		
		// for SSL errors, report as warning rather than hard failure
		// the link may still work in browsers which are more lenient
		if (sslError || errorCode.startsWith("CERT_") || errorCode.startsWith("SSL_") || 
			errorCode === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") {
			return {
				url,
				status: "ok",
				statusCode: undefined,
				error: `SSL certificate issue: ${errorCode || "verification failed"} (link may still work in browser)`,
			};
		}
		
		return {
			url,
			status: "error",
			error: errorMessage,
		};
	}
}

/**
 * Validates the request payload for link checking
 * Requirements: 1.2, 1.4, 1.5
 * 
 * @param body - The request body to validate
 * @returns ValidationResult with valid flag, errors array, and parsed data if valid
 */
function validateRequestPayload(body: unknown): ValidationResult {
	const errors: ValidationError[] = [];

	// check if body is an object
	if (!body || typeof body !== "object") {
		return {
			valid: false,
			errors: [{ field: "body", message: "Request body must be a JSON object" }],
		};
	}

	const payload = body as Record<string, unknown>;

	// validate urls field exists and is an array
	if (!payload.urls) {
		errors.push({ field: "urls", message: "Missing required field: urls" });
	} else if (!Array.isArray(payload.urls)) {
		errors.push({ field: "urls", message: "Field 'urls' must be an array" });
	} else {
		// validate urls array length (max 200)
		// Requirement: 1.2
		if (payload.urls.length > 200) {
			errors.push({
				field: "urls",
				message: `Batch size exceeds maximum: ${payload.urls.length} URLs provided, maximum is 200`,
			});
		}

		// validate each URL is a valid HTTP/HTTPS URL
		// Requirement: 1.4
		const invalidUrls: string[] = [];
		payload.urls.forEach((url, index) => {
			if (typeof url !== "string") {
				invalidUrls.push(`Index ${index}: not a string`);
			} else if (!isValidHttpUrl(url)) {
				invalidUrls.push(`Index ${index}: "${url}" is not a valid HTTP/HTTPS URL`);
			}
		});

		if (invalidUrls.length > 0) {
			errors.push({
				field: "urls",
				message: `Invalid URLs found: ${invalidUrls.join(", ")}`,
			});
		}
	}

	// validate pageUrl field exists and is a valid URL
	if (!payload.pageUrl) {
		errors.push({ field: "pageUrl", message: "Missing required field: pageUrl" });
	} else if (typeof payload.pageUrl !== "string") {
		errors.push({ field: "pageUrl", message: "Field 'pageUrl' must be a string" });
	} else if (!isValidHttpUrl(payload.pageUrl)) {
		errors.push({
			field: "pageUrl",
			message: `Invalid pageUrl: "${payload.pageUrl}" is not a valid HTTP/HTTPS URL`,
		});
	}

	// if there are any errors, return invalid result
	if (errors.length > 0) {
		return { valid: false, errors };
	}

	// all validation passed, return valid result with typed data
	return {
		valid: true,
		errors: [],
		data: {
			urls: payload.urls as string[],
			pageUrl: payload.pageUrl as string,
		},
	};
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
	// generate request ID for logging context
	const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;

	// handle CORS, preflight, method, and origin validation
	if (handleCors(req, res, "POST")) return;

	try {
		// validate environment variables
		const env = validateEnv();

		// authenticate via token or legacy session
		// Requirements: 5.1, 5.2, 5.3, 8.3, 8.4
		const auth = await authenticateRequest(req, env.TOKEN_SIGNING_SECRET, env.WAGTAIL_API_URL);
		if (!auth.ok) {
			logAuthFailure(auth.error, { requestId });
			return res.status(auth.status).json({ error: `Unauthorized: ${auth.error}` });
		}
		const { sessionFingerprint } = auth;

		// validate request payload
		// Requirements: 1.2, 1.4, 1.5, 3.3
		const validation = validateRequestPayload(req.body);
		if (!validation.valid || !validation.data) {
			// log validation error
			// Requirement: 6.4
			logValidationError(validation.errors, { requestId });
			return res.status(400).json({
				error: "Invalid request payload",
				details: validation.errors,
			});
		}

		// at this point, validation.data is guaranteed to be a valid LinkCheckRequest
		const request: LinkCheckRequest = validation.data;

		// log request start
		logInfo("Link check started", {
			requestId,
			total: request.urls.length,
			pageUrl: request.pageUrl,
			sessionFingerprint: sessionFingerprint?.substring(0, 8),
		});

		// open SSE stream
		// Requirements: 3.1, 3.3, 8.4
		initSSE(res);

		// set up client disconnection detection
		// Requirements: 6.6, 6.7
		const { isDisconnected, cleanup } = setupDisconnectionDetection(res);

		try {
			// process links with rate limiting and concurrency control
			// Requirements: 5.1, 5.2, 3.2, 5.5, 5.6
			const { checked, timedOut } = await processLinksWithRateLimiting(
				request.urls,
				request.pageUrl,
				(result) => {
					// send results incrementally via SSE
					// Requirements: 3.2, 3.4, 8.5
					sendSSE(res, result);
				},
				isDisconnected,
				requestId
			);

			// check if client disconnected during processing
			if (isDisconnected()) {
				// client disconnected, clean up and exit
				// Requirement: 6.7
				cleanup();
				return;
			}

			// send completion event when done
			// Requirements: 3.4, 8.6
			const completeEvent: LinkCheckCompleteEvent = {
				type: "complete",
				total: request.urls.length,
				checked,
			};
			sendSSE(res, completeEvent);

			// log completion
			// Requirement: 6.4
			logLinkCheckComplete(checked, request.urls.length, timedOut, { requestId });

		} catch (error) {
			// handle errors and send error events
			// Requirements: 6.1, 6.4, 8.7
			const errorMessage = error instanceof Error ? error.message : "Unknown error during link checking";
			logError("Error during link checking", { requestId, error: errorMessage });
			
			// only send error event if client is still connected
			if (!isDisconnected()) {
				const errorEvent: LinkCheckErrorEvent = {
					type: "error",
					message: errorMessage,
				};
				sendSSE(res, errorEvent);
			}
		} finally {
			// close stream properly
			// Requirements: 3.1, 3.2
			cleanup();
			closeSSE(res);
		}

	} catch (error) {
		// handle top-level errors (env validation, auth, etc.)
		// Requirement: 6.4
		const errorMessage = error instanceof Error ? error.message : "Unknown error";
		logError("Link check handler error", { requestId, error: errorMessage });
		
		// if headers not sent yet, send JSON error
		if (!res.headersSent) {
			return res.status(500).json({ 
				error: "Internal server error",
				message: errorMessage,
			});
		}
		
		// if headers already sent (SSE stream started), send error event
		try {
			const errorEvent: LinkCheckErrorEvent = {
				type: "error",
				message: errorMessage,
			};
			sendSSE(res, errorEvent);
			closeSSE(res);
		} catch {
			// if we can't send error event, just close the stream
			res.end();
		}
	}
}

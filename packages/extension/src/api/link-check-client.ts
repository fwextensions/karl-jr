/**
 * Link Check API Client
 * Handles communication with the server-side link checking endpoint via SSE
 */

import type {
	LinkCheckRequest,
	LinkCheckResultEvent,
	LinkCheckCompleteEvent,
	LinkCheckErrorEvent,
} from "@sf-gov/shared";
import { getAuthToken, clearAuthToken } from "./auth";

/**
 * API Base URL
 * Defaults to production, can be overridden by VITE_API_BASE_URL
 */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://sfgov-companion-api.vercel.app";

/**
 * Link check endpoint URL
 */
const API_LINK_CHECK_URL = `${API_BASE_URL}/api/link-check`;

/**
 * Options for starting a link check
 */
export interface LinkCheckClientOptions {
	urls: string[];
	pageUrl: string;
	onResult: (result: LinkCheckResultEvent) => void;
	onComplete: (summary: LinkCheckCompleteEvent, results: LinkCheckResultEvent[]) => void;
	onError: (error: string) => void;
}

/**
 * Client for server-side link checking with SSE streaming
 */
export class LinkCheckClient {
	private eventSource: EventSource | null = null;
	private abortController: AbortController | null = null;

	/**
	 * Starts a link check operation
	 * @param options - Configuration options including URLs and callbacks
	 * @throws Error if authentication fails or request cannot be initiated
	 */
	async startCheck(options: LinkCheckClientOptions): Promise<void> {
		return this.startCheckInternal(options, false);
	}

	/**
	 * Internal implementation of startCheck with retry logic
	 * @param options - Configuration options including URLs and callbacks
	 * @param isRetry - Whether this is a retry after 401
	 */
	private async startCheckInternal(options: LinkCheckClientOptions, isRetry: boolean): Promise<void> {
		const { urls, pageUrl, onResult, onComplete, onError } = options;

		// abort any existing check
		this.abort();

		// get auth token
		let token: string;
		try {
			token = await getAuthToken();
			console.log("LinkCheckClient: Starting check with token");
		} catch (error) {
			console.log("LinkCheckClient: Failed to get auth token", error);
			onError(error instanceof Error ? error.message : "Authentication failed");
			return;
		}

		// create abort controller for cleanup
		this.abortController = new AbortController();

		// prepare request payload
		const payload: LinkCheckRequest = {
			urls,
			pageUrl,
		};

		try {
			// make POST request to initiate link check
			const response = await fetch(API_LINK_CHECK_URL, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Authorization": `Bearer ${token}`,
					"X-SF-Gov-Extension": "companion",
				},
				body: JSON.stringify(payload),
				signal: this.abortController.signal,
			});

			// handle authentication errors with retry
			if (response.status === 401) {
				if (!isRetry) {
					console.log("LinkCheckClient: Got 401, clearing token and retrying");
					await clearAuthToken();
					return this.startCheckInternal(options, true);
				}
				onError("Authentication failed. Please log in to Wagtail.");
				return;
			}

			// handle validation errors
			if (response.status === 400) {
				const errorData = await response.json().catch(() => ({ error: "Invalid request" }));
				onError(errorData.error || "Invalid request. Please check your input.");
				return;
			}

			// handle server errors
			if (!response.ok) {
				onError(`Server error: ${response.status}. Please try again later.`);
				return;
			}

			// check that response is SSE stream
			const contentType = response.headers.get("content-type");
			if (!contentType || !contentType.includes("text/event-stream")) {
				onError("Invalid response format from server.");
				return;
			}

			// set up EventSource for SSE streaming
			// note: EventSource doesn't support POST, so we use the response body directly
			this.setupStreamReader(response.body!, onResult, onComplete, onError);
		} catch (error) {
			if (error instanceof Error) {
				if (error.name === "AbortError") {
					// check was aborted, don't call onError
					return;
				}
				onError(`Connection error: ${error.message}`);
			} else {
				onError("An unexpected error occurred.");
			}
		}
	}

	/**
	 * Sets up a stream reader for SSE events from the response body
	 * @param body - ReadableStream from the fetch response
	 * @param onResult - Callback for result events
	 * @param onComplete - Callback for completion event (includes accumulated results)
	 * @param onError - Callback for error events
	 */
	private setupStreamReader(
		body: ReadableStream<Uint8Array>,
		onResult: (result: LinkCheckResultEvent) => void,
		onComplete: (summary: LinkCheckCompleteEvent, results: LinkCheckResultEvent[]) => void,
		onError: (error: string) => void
	): void {
		const reader = body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		const accumulatedResults: LinkCheckResultEvent[] = [];

		const processStream = async () => {
			try {
				while (true) {
					const { done, value } = await reader.read();

					if (done) {
						break;
					}

					// decode chunk and add to buffer
					buffer += decoder.decode(value, { stream: true });

					// process complete SSE messages (separated by \n\n)
					const messages = buffer.split("\n\n");
					buffer = messages.pop() || ""; // keep incomplete message in buffer

					for (const message of messages) {
						if (!message.trim()) continue;

						// parse SSE message (format: "data: <JSON>\n")
						const dataMatch = message.match(/^data: (.+)$/m);
						if (!dataMatch) continue;

						try {
							const data = JSON.parse(dataMatch[1]);

							// handle different event types
							if (data.type === "complete") {
								onComplete(data as LinkCheckCompleteEvent, accumulatedResults);
							} else if (data.type === "error") {
								onError((data as LinkCheckErrorEvent).message);
							} else if (data.url && data.status) {
								const result = data as LinkCheckResultEvent;
								accumulatedResults.push(result);
								onResult(result);
							}
						} catch (parseError) {
							console.error("Failed to parse SSE message:", parseError);
						}
					}
				}
			} catch (error) {
				if (error instanceof Error && error.name !== "AbortError") {
					onError(`Stream error: ${error.message}`);
				}
			} finally {
				reader.releaseLock();
			}
		};

		processStream();
	}

	/**
	 * Aborts an in-progress link check
	 */
	abort(): void {
		if (this.abortController) {
			this.abortController.abort();
			this.abortController = null;
		}

		if (this.eventSource) {
			this.eventSource.close();
			this.eventSource = null;
		}
	}
}

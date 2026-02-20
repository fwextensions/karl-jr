// vitest setup file for mocking Chrome extension APIs

import { vi } from 'vitest';

// mock Chrome extension API
globalThis.chrome = {
	runtime: {
		onMessage: {
			addListener: vi.fn(),
			removeListener: vi.fn(),
		},
		sendMessage: vi.fn(),
	},
} as any;

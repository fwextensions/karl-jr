/**
 * TypeScript types and interfaces for Wagtail API integration
 */

/**
 * Represents a media asset (image or document) from Wagtail
 */
export interface MediaAsset {
  id: number;
  title: string;
  url: string;
  type: 'image' | 'document';
  filename?: string;
  altText?: string;
  isDecorative?: boolean;
}

/**
 * Represents a translated version of a page
 */
export interface Translation {
  language: string;
  languageCode: string;
  pageId: number;
  editUrl: string;
  title: string;
}

/**
 * Represents an agency associated with a page
 */
export interface Agency {
  id: number;
  title: string;
  url: string;
}

/**
 * Represents a form schema for sf.Form pages
 */
export interface FormSchema {
  _id: string;
  title: string;
  project: string;
}

/**
 * Represents form confirmation data for sf.Form pages
 */
export interface FormConfirmation {
  title: string;
  body: string;
}

/**
 * Represents a Wagtail page with all relevant metadata
 */
export interface WagtailPage {
  id: number;
  title: string;
  slug: string;
  contentType: string;
  primaryAgency?: Agency;
  schema?: FormSchema;
  formConfirmation?: FormConfirmation;
  translations: Translation[];
  images: MediaAsset[];
  files: MediaAsset[];
  editUrl: string;
  meta: {
    type: string;
    detailUrl: string;
    htmlUrl: string;
  };
}

/**
 * Represents an API error with type and retry information
 */
export interface ApiError {
  type: 'network' | 'timeout' | 'not_found' | 'server_error';
  message: string;
  statusCode?: number;
  retryable: boolean;
}

/**
 * Represents a cached entry for page data
 */
export interface CacheEntry {
  data: WagtailPage | null;
  error?: ApiError;
  timestamp: number;
}

/**
 * Represents preview parameters for Wagtail API requests
 */
export interface PreviewParams {
  preview: boolean;
  ts: string;
}

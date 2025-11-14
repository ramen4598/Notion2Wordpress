// Description: Service to interact with Notion API
// Reference: https://developers.notion.com/reference/

import { Client } from '@notionhq/client';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { retryWithBackoff } from '../lib/retry.js';
import { isRecord } from '../lib/utils.js';
import { NotionToMarkdown } from 'notion-to-md';
import { marked } from 'marked';
import { MdBlock } from 'notion-to-md/build/types/index.js';
import { NotionPageStatus } from '../enums/notion.enums.js';
import { asError } from '../lib/utils.js';

export interface NotionPage {
  id: string;
  title: string;
  status: NotionPageStatus;
  lastEditedTime: string;
  createdTime: string;
  properties: Record<string, unknown>;
}

export interface NotionBlock {
  id: string;
  type: string;
  [key: string]: unknown; // Index Signature. Allow flexible structure.
}

export interface QueryPagesOptions {
  lastSyncTimestamp?: string;
  statusFilter?: NotionPageStatus;
}

export interface ImageReference {
  blockId: string;
  url: string;
  altText?: string;
  placeholder: string; // notion url -> placeholder -> uploaded wp url
}

interface pageQueryResponse {
  results: unknown[];
  has_more: boolean;
  next_cursor: string | null;
};

export interface getPageHTMLResponse {
  html: string;
  images: ImageReference[];
}

class NotionService {
  private n2m: NotionToMarkdown;
  private client: Client;

  constructor() {
    this.client = new Client({ auth: config.notionApiToken });
    this.n2m = new NotionToMarkdown({ notionClient: this.client });
  }

  /**
   * Query Notion pages from the configured datasource with optional filters.
   * Handles pagination to retrieve all matching pages.
   * @param options - Query options including lastSyncTimestamp and statusFilter.
   * @returns A promise that resolves to an array of NotionPage objects.
   * @throws Error if the query fails after retries.
   */
  async queryPages(options: QueryPagesOptions = {}): Promise<NotionPage[]> {
    type NotionRawPage = {
      id: string;
      last_edited_time: string;
      created_time: string;
      properties: Record<string, unknown>;
    };

    const filter = this.makeFilter(options);
    const sorts = this.makeSorts();

    const fn = async (has_more: boolean, start_cursor: string | null) => {
      let body: Record<string, unknown> = {
        filter: filter,
        sorts: sorts,
        page_size: 100, // min 1, max 100. See notion API docs for details.
      };
      if (has_more && start_cursor) {
        body['start_cursor'] = start_cursor;
      }
      return await this.client.request<pageQueryResponse>({
        path: `data_sources/${config.notionDatasourceId}/query`,
        method: 'post',
        body: body,
      });
    };

    const onRetryFn = (error: Error, attempt: number) => {
      logger.warn(`Retrying Notion query (attempt ${attempt})`, { error: error.message });
    };

    try {
      let hasMore = false;
      let nextCursor: string | null = null;
      const pages: NotionPage[] = [];
      do {
        const response = await retryWithBackoff(() => fn(hasMore, nextCursor), {
          onRetry: onRetryFn,
        });
        pages.push(
          ...(response.results as NotionRawPage[]).map((page) => ({
            id: page.id,
            title: this.extractTitle(page),
            status: this.extractStatus(page),
            lastEditedTime: page.last_edited_time,
            createdTime: page.created_time,
            properties: page.properties,
          }))
        );

        hasMore = response.has_more;
        nextCursor = response.next_cursor;
        logger.debug(
          `queryPages: fetched ${response.results.length} pages, hasMore: ${hasMore}, nextCursor: ${nextCursor}`
        );
      } while (hasMore); // Repeat until all pages are fetched

      return pages;
    } catch (error: unknown) {
      const message = asError(error).message;
      logger.error('Failed to query Notion pages', { error: message });
      throw new Error(`Notion query failed: ${message}`);
    }
  }

  /**
   * Get the HTML content of a Notion page by its ID.
   * Converts the page content to Markdown and then to HTML.
   * Also extracts image references from the content.
   * After extraction, replaces image URLs with placeholders in the HTML.
   * @param pageId - The ID of the Notion page.
   * @returns A promise that resolves to an object containing HTML content and image references.
   * @throws Error if the conversion fails after retries.
   */
  async getPageHTML(pageId: string): Promise<getPageHTMLResponse> {
    const onRetryFn = (error: Error, attempt: number) => {
      logger.warn(`Get Notion page HTML (attempt ${attempt})`, { error: error.message });
    };

    try {
      // Get MdBlock
      let mdBlocks = await retryWithBackoff(() => this.n2m.pageToMarkdown(pageId), {
        onRetry: onRetryFn,
      });

      // Handle callout blocks
      mdBlocks = this.handleCalloutRecursively(mdBlocks);
      // Extract images and replace urls with placeholders
      const images = this.extractImagesRecursively(mdBlocks);

      // Get HTML
      const mdString = this.n2m.toMarkdownString(mdBlocks);
      const markdownContent = mdString.parent ?? ''; // Handle empty pages gracefully
      const html = marked.parse(markdownContent) as string;

      logger.info(`Converted page ${pageId} to HTML with ${images.length} images`);
      return { html: html, images: images };
    } catch (error: unknown) {
      logger.error(`Failed to get html for page ${pageId}`, error);
      const message = asError(error).message;
      throw new Error(`Failed to get page html: ${message}`);
    }
  }

  /**
   * Update the status property of a Notion page.
   * @param pageId - The ID of the Notion page to update.
   * @param updateStatus - The new status to set (done or error).
   * @returns A promise that resolves to an object indicating success and the updated time.
   * @throws Error if the update fails after retries.
   */
  async updatePageStatus(
    pageId: string,
    updateStatus: NotionPageStatus.Done | NotionPageStatus.Error
  ): Promise<{ success: boolean; updatedTime: string }> {
    const fn = async () => {
      return await this.client.pages.update({
        page_id: pageId,
        properties: {
          [config.notionPageStatusProperty]: {
            status: {
              name: updateStatus,
            },
          },
        },
      });
    };

    const onRetryFn = (error: Error, attempt: number) => {
      logger.warn(`Retrying update page status (attempt ${attempt})`, {
        pageId,
        status: updateStatus,
        error: error.message,
      });
    };

    try {
      const response = await retryWithBackoff(fn, { onRetry: onRetryFn });
      logger.info(`Updated page ${pageId} status to: ${updateStatus}`);
      type UpdatePageResponse = { last_edited_time: string };
      return {
        success: true,
        updatedTime: (response as UpdatePageResponse).last_edited_time,
      };
    } catch (error: unknown) {
      logger.error(`Failed to update page ${pageId} status`, error);
      const message = asError(error).message;
      throw new Error(`Failed to update page status: ${message}`);
    }
  }

  /**
   * Extract plain text from Notion rich text array.
   * @param arr - The Notion rich text array.
   * @returns The extracted plain text.
   */
  private extractPlainText(arr: unknown): string {
    if (!Array.isArray(arr)) return '';
    return arr
      .map((t) => {
        if (!isRecord(t)) return '';
        if (typeof t.plain_text !== 'string') return '';
        return t.plain_text;
      })
      .join('');
  }

  /**
   * Extract the title from a Notion page properties.
   * @param page - The Notion page object.
   * @returns The extracted title or 'Untitled' if not found.
   */
  private extractTitle(page: { properties?: Record<string, unknown> } | unknown): string {
    // Notion title property can be in different formats
    if (!isRecord(page)) return 'Untitled';
    const props = page.properties as Record<string, unknown> | undefined;
    if (!props) return 'Untitled';
    const candidate = (props['title'] ?? props['Title'] ?? props['Name']) as unknown;
    if (!isRecord(candidate)) return 'Untitled';

    // Notion title property has 'title' array according to API spec
    // https://developers.notion.com/reference/property-object#title
    const titleArray = candidate['title'];
    if (!Array.isArray(titleArray)) return 'Untitled';

    const text = this.extractPlainText(titleArray);
    return text || 'Untitled';
  }

  /**
   * Extract the status from a Notion page properties.
   * @param page - The Notion page object.
   * @returns The extracted NotionPageStatus or NotionPageStatus.Writing if not found.
   */
  private extractStatus(
    page: { properties?: Record<string, unknown> } | unknown
  ): NotionPageStatus {
    if (!isRecord(page)) return NotionPageStatus.Writing;
    const props = page.properties as Record<string, unknown> | undefined;
    if (!props) return NotionPageStatus.Writing;
    const statusProp = props[config.notionPageStatusProperty] as unknown;
    if (!isRecord(statusProp)) return NotionPageStatus.Writing;
    const select = statusProp['select'];
    if (!isRecord(select)) return NotionPageStatus.Writing;
    const name = select['name'];
    if (typeof name !== 'string') return NotionPageStatus.Writing;
    if (Object.values(NotionPageStatus).includes(name as NotionPageStatus)) {
      return name as NotionPageStatus;
    }
    return NotionPageStatus.Writing;
  }

  /**
   * Handle callout blocks recursively in MdBlock array.
   * notion-to-md library handles callback blocks in an incomprehensible way.
   * Converts callout blocks to paragraph blocks with cleaned content.
   * Moves children of callout blocks to same level.
   * @param mdBlocks - The array of MdBlock objects.
   * @returns The updated array of MdBlock objects with callouts handled.
   */
  private handleCalloutRecursively(mdBlocks: MdBlock[]): MdBlock[] {
    // 2025.11.12 notion-to-md version 3.1.9
    // notion-to-md converts parent of callout block to html,
    // but does not handle children blocks separately.
    // So we convert callout blocks to paragraph blocks,
    // and move children blocks to the same level.

    // Deep copy to avoid mutating original blocks
    let updatedBlocks: MdBlock[] = [];
    if (!Array.isArray(mdBlocks) || mdBlocks.length === 0) return updatedBlocks;

    for (const block of mdBlocks) {
      if (block.type === 'callout') {
        // Remove image markdown syntax from callout content
        const callout = block as { parent: string; blockId: string; type: string };
        const urlRegex = /!\[.*?\]\((.*?)\)/g;
        const ctitle = callout.parent.split('\n')[0].replace(urlRegex, '');
        const updatedBlock = {
          parent: ctitle,
          blockId: callout.blockId,
          type: 'paragraph',
          children: [],
        };
        updatedBlocks.push(updatedBlock);
        // Move children to the same level
        updatedBlocks.push(...this.handleCalloutRecursively(block.children));
      } else {
        const updatedBlock: MdBlock = { ...block, children: [] };
        updatedBlock.children = this.handleCalloutRecursively(block.children);
        updatedBlocks.push(updatedBlock);
      }
    }
    return updatedBlocks;
  }

  /**
   * Extract image references recursively from MdBlock array.
   * Replaces image URLs in the block content with placeholders.
   * @param mdBlocks - The array of MdBlock objects.
   * @returns An array of ImageReference objects extracted from the blocks.
   */
  private extractImagesRecursively(mdBlocks: MdBlock[]): ImageReference[] {
    let images: ImageReference[] = [];

    if (!Array.isArray(mdBlocks) || mdBlocks.length === 0) return images;

    for (const block of mdBlocks) {
      if (block.type === 'image') {
        const b = block as { parent: string; blockId: string };
        const p = b.parent;
        const placeholder = `image-${b.blockId}`;

        // Extract altText and url from markdown syntax ![alt](url)
        const imageRegex = /!\[.*?\]\((.*?)\)/g;
        let match = imageRegex.exec(p);
        if (!match)
          throw new Error(
            `Failed to extract image url from markdown block: ${JSON.stringify(block)}`
          );
        const altText = match[0].slice(2, match[0].indexOf('](')); // 2 is length of '!['
        const url = match[1];

        // Replace url with placeholder at here!
        block.parent = block.parent.replace(url, placeholder);
        images.push({ blockId: b.blockId, url, altText, placeholder });
        logger.debug(
          `extractImagesRecursively: extracted image - blockId: ${b.blockId}, placeholder: ${placeholder}`
        );
      }

      images.push(...this.extractImagesRecursively(block.children));
    }

    return images;
  }

  /**
   * Create a filter object for querying Notion pages.
   * Filters by status property.
   * if lastSyncTimestamp is provided, adds a last_edited_time filter.
   * @param options - Query options including lastSyncTimestamp and statusFilter.
   * @returns The filter object for Notion API query.
   */
  private makeFilter(options: QueryPagesOptions): Record<string, unknown> {
    const { lastSyncTimestamp, statusFilter = NotionPageStatus.Adding } = options;

    const propertyFilter = {
      property: config.notionPageStatusProperty,
      status: { equals: statusFilter },
    };
    if (!lastSyncTimestamp) return propertyFilter;

    // If you've ever synced before, add the last edited time filter
    const lastSyncDate = new Date(lastSyncTimestamp);
    const adjustedTime = new Date(lastSyncDate.getTime() - 900000); // -15 minutes margin
    const queryTime = adjustedTime.toISOString();

    const timestampFilter = {
      timestamp: 'last_edited_time',
      last_edited_time: { after: queryTime },
    };

    return {
      and: [propertyFilter, timestampFilter],
    };
  }

  /**
   * Create sort criteria for querying Notion pages.
   * Sorts by created_time in ascending order.
   * @returns The sorts array for Notion API query.
   */
  private makeSorts(): Record<string, unknown>[] {
    return [
      {
        timestamp: 'created_time',
        direction: 'ascending',
      },
    ];
  }
}

export const notionService = new NotionService();

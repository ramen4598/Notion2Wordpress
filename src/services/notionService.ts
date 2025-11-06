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

export interface NotionPage {
  id: string;
  title: string;
  status: 'writing' | 'adding' | 'complete' | 'error';
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
  statusFilter?: 'adding';
}

export interface ImageReference {
  blockId: string;
  url: string;
  altText?: string;
  placeholder: string;
}

export interface getPageHTMLResponse {
  html: string;
  images: ImageReference[];
}

// TODO: Refactor to reduce duplication with logging code.
class NotionService {
  private n2m: NotionToMarkdown;
  private client: Client;

  constructor() {
    this.client = new Client({ auth: config.notionApiToken });
    this.n2m = new NotionToMarkdown({ notionClient: this.client });
  }

  private extractPlainText(arr: unknown): string {
    if (!Array.isArray(arr)) return '';
    return arr.map((t) => {
        if (!isRecord(t)) return '';
        if (typeof t.plain_text !== 'string') return '';
        return t.plain_text;
      }).join('');
  }

  async queryPages(options: QueryPagesOptions = {}): Promise<NotionPage[]> {
    const { lastSyncTimestamp, statusFilter = 'adding' } = options;

    const statusFilterObj = {
      property: 'status',
      status: { equals: statusFilter },
    } as const;

    let filter: Record<string, unknown> = statusFilterObj;
    // If you've ever synced before, add the last edited time filter
    if (lastSyncTimestamp) {
      filter = {
        and: [
          statusFilterObj,
          {
            timestamp: 'last_edited_time',
            last_edited_time: { after: lastSyncTimestamp },
          },
        ],
      };
    }

    // TODO: Follow official Notion docs. https://developers.notion.com/reference/query-a-data-source
    // TODO: Add sorting option. sort by created_time, ascending.
    // TODO: has_more, next_cursor 처리. Refer getPageBlocks method.
    const fn = async () => {
      type NotionQueryResponse = {
        results: unknown[];
        has_more: boolean;
        next_cursor: string | null;
      };

      return await this.client.request<NotionQueryResponse>({
        path: `data_sources/${config.notionDatasourceId}/query`,
        method: 'post',
        body: { filter },
      });
    };

    const onRetryFn = (error: Error, attempt: number) => {
      logger.warn(`Retrying Notion query (attempt ${attempt})`, { error: error.message });
    };

    try {
      const response = await retryWithBackoff( fn, { onRetry: onRetryFn });

      type NotionRawPage = {
        id: string;
        last_edited_time: string;
        created_time: string;
        properties: Record<string, unknown>;
      };

      const pages: NotionPage[] = (response.results as NotionRawPage[]).map((page) => ({
        id: page.id,
        title: this.extractTitle(page),
        status: this.extractStatus(page),
        lastEditedTime: page.last_edited_time,
        createdTime: page.created_time,
        properties: page.properties,
      }));

      // TODO: has_more, next_cursor 제거
      return {
        pages,
        hasMore: response.has_more,
        nextCursor: response.next_cursor || undefined,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to query Notion pages', { error: message });
      throw new Error(`Notion query failed: ${message}`);
    }
  }

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
        if (!match) throw new Error(`Failed to extract image url from markdown block: ${JSON.stringify(block)}`);
        const altText = match[0].slice(2, match[0].indexOf('](')); // 2 is length of '!['
        const url = match[1];

        // Replace url with placeholder at here!
        block.parent = block.parent.replace(url, placeholder); 
        images.push({ blockId: b.blockId, url, altText, placeholder });
        logger.debug(`extractImagesRecursively: extracted image - blockId: ${b.blockId}, url: ${url}, placeholder: ${placeholder}`);
      }

      const children: MdBlock[] = (block as { children?: MdBlock[] }).children || [];
      images.push(...this.extractImagesRecursively(children));
    }

    return images;
  }

  async getPageHTML(pageId: string): Promise<getPageHTMLResponse> {
    try{
      // Get MdBlock
      const mdBlocks = await this.n2m.pageToMarkdown(pageId);
      // Extract images and replace urls with placeholders
      const images = this.extractImagesRecursively(mdBlocks);
      logger.debug(`getPageHTML: mdBlocks: ${JSON.stringify(mdBlocks)}`);
      logger.debug(`getPageHTML: images: ${JSON.stringify(images)}`);
      // Get HTML
      const mdString = this.n2m.toMarkdownString(mdBlocks);
      const markdownContent = mdString.parent ?? ''; // Handle empty pages gracefully
      const html = marked.parse(markdownContent) as string;
      logger.debug(`getPageHTML: html: ${JSON.stringify(html)}`);

      logger.info(`Retrieved HTML for page ${pageId} and images ${images.length}`);
      return {html: html, images: images};
    } catch (error: unknown) {
      logger.error(`Failed to get html for page ${pageId}`, error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get page html: ${message}`);
    }
  }

  async updatePageStatus(
    pageId: string,
    status: 'complete' | 'error'
  ): Promise<{ success: boolean; updatedTime: string }> {

    const fn = async () => {
      return await this.client.pages.update({
        page_id: pageId,
        properties: {
          status: { // status property
            status: {
              name: status, // 'complete' or 'error'
            },
          },
        },
      });
    };
    
    const onRetryFn = (error: Error, attempt: number) => {
      logger.warn(`Retrying update page status (attempt ${attempt})`, {
        pageId,
        status,
        error: error.message,
      });
    };

    try {
      const response = await retryWithBackoff(fn, {onRetry: onRetryFn});
      logger.info(`Updated page ${pageId} status to: ${status}`);
      type UpdatePageResponse = { last_edited_time: string };
      return {
        success: true,
        updatedTime: (response as UpdatePageResponse).last_edited_time,
      };
    } catch (error: unknown) {
      logger.error(`Failed to update page ${pageId} status`, error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to update page status: ${message}`);
    }
  }

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

  private extractStatus(page: { properties?: Record<string, unknown> } | unknown): 'writing' | 'adding' | 'complete' | 'error' {
    if (!isRecord(page)) return 'writing';
    const props = page.properties as Record<string, unknown> | undefined;
    if (!props) return 'writing';
    const statusProp = (props['status'] ?? props['Status']) as unknown;
    if (!isRecord(statusProp)) return 'writing';
    const select = statusProp['select'];
    if (!isRecord(select)) return 'writing';
    const name = select['name'];
    if (typeof name !== 'string') return 'writing';
    if (name === 'writing' || name === 'adding' || name === 'complete' || name === 'error') return name;
    return 'writing';
  }
}

export const notionService = new NotionService();

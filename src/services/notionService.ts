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
  placeholder: string;
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
        page_size: 100,
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
        const response = await retryWithBackoff( 
          () => fn(hasMore, nextCursor),
          { onRetry: onRetryFn }
        );
        pages.push(...(response.results as NotionRawPage[]).map((page) => ({
          id: page.id,
          title: this.extractTitle(page),
          status: this.extractStatus(page),
          lastEditedTime: page.last_edited_time,
          createdTime: page.created_time,
          properties: page.properties,
        })));

        hasMore = response.has_more;
        nextCursor = response.next_cursor;
        logger.debug(`queryPages: fetched ${response.results.length} pages, hasMore: ${hasMore}, nextCursor: ${nextCursor}`);
      } while (hasMore);

      return pages;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to query Notion pages', { error: message });
      throw new Error(`Notion query failed: ${message}`);
    }
  }

  async getPageHTML(pageId: string): Promise<getPageHTMLResponse> {

    const onRetryFn = (error: Error, attempt: number) => {
      logger.warn(`Get Notion page HTML (attempt ${attempt})`, { error: error.message });
    };

    try{
      // Get MdBlock
      const mdBlocks = await retryWithBackoff(
        () => this.n2m.pageToMarkdown(pageId),
        { onRetry: onRetryFn }
      );

      // Extract images and replace urls with placeholders
      const images = this.extractImagesRecursively(mdBlocks);

      // Get HTML
      const mdString = this.n2m.toMarkdownString(mdBlocks);
      const markdownContent = mdString.parent ?? ''; // Handle empty pages gracefully
      const html = marked.parse(markdownContent) as string;

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

  private extractPlainText(arr: unknown): string {
    if (!Array.isArray(arr)) return '';
    return arr.map((t) => {
        if (!isRecord(t)) return '';
        if (typeof t.plain_text !== 'string') return '';
        return t.plain_text;
      }).join('');
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

  // TODO: notion property name status 환경변수로 관리하도록 수정
  private extractStatus(page: { properties?: Record<string, unknown> } | unknown): NotionPageStatus {
    if (!isRecord(page)) return NotionPageStatus.Writing;
    const props = page.properties as Record<string, unknown> | undefined;
    if (!props) return NotionPageStatus.Writing;
    const statusProp = (props['status'] ?? props['Status']) as unknown;
    if (!isRecord(statusProp)) return NotionPageStatus.Writing;
    const select = statusProp['select'];
    if (!isRecord(select)) return NotionPageStatus.Writing;
    const name = select['name'];
    if (typeof name !== 'string') return NotionPageStatus.Writing;
    // if (name === 'writing' || name === 'adding' || name === 'complete' || name === 'error') return name;
    if (Object.values(NotionPageStatus).includes(name as NotionPageStatus)) {
      return name as NotionPageStatus;
    }
    return NotionPageStatus.Writing;
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

  // TODO: notion property name status 환경변수로 관리하도록 수정
  private makeFilter(options: QueryPagesOptions): Record<string, unknown> {
    const { lastSyncTimestamp, statusFilter = NotionPageStatus.Adding } = options;

    const propertyFilter = {
      "property": "status",
      "status": { "equals": statusFilter },
    };
    const timestampFilter = {
      "timestamp": "last_edited_time",
      "last_edited_time": { "after": lastSyncTimestamp },
    };

    let filter: Record<string, unknown> = propertyFilter;
    // If you've ever synced before, add the last edited time filter
    if (lastSyncTimestamp) {
      filter = {
        "and": [
          propertyFilter,
          timestampFilter,
        ],
      };
    }

    return filter;
  }

  private makeSorts(): Record<string, unknown>[] {
    return [
      {
        "timestamp": "created_time",
        "direction": "ascending",
      },
    ];
  }
}

export const notionService = new NotionService();

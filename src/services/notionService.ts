// Description: Service to interact with Notion API
// Reference: https://developers.notion.com/reference/

import { Client } from '@notionhq/client';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { retryWithBackoff } from '../lib/retry.js';

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

// TODO: has_more, next_cursor 제거, api-contracts.md 수정
export interface QueryPagesResponse {
  pages: NotionPage[];
  hasMore: boolean;
  nextCursor?: string;
}

// TODO: Refactor to reduce duplication with logging code.
class NotionService {
  private client: Client;

  constructor() {
    this.client = new Client({ auth: config.notionApiToken });
  }

  // TODO: 리팩토링 필요. utils로 이동 고려
  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private extractPlainText(arr: unknown): string {
    if (!Array.isArray(arr)) return '';
    return arr.map((t) => {
        if (!this.isRecord(t)) return '';
        if (typeof t.plain_text !== 'string') return '';
        return t.plain_text;
      }).join('');
  }

  async queryPages(options: QueryPagesOptions = {}): Promise<QueryPagesResponse> {
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

  private async fetchBlocksRecursively(blockId: string): Promise<NotionBlock[]> {
    const blocks: NotionBlock[] = [];
    let cursor: string | undefined;

    do {
      const response = await retryWithBackoff(
        async () => {
          return await this.client.blocks.children.list({
            block_id: blockId,
            start_cursor: cursor,
          });
        },
        {
          onRetry: (error, attempt) => {
            logger.warn(`Retrying get blocks (attempt ${attempt})`, {
              blockId,
              error: error.message,
            });
          },
        }
      );

      const fetchedBlocks = response.results as NotionBlock[];
      blocks.push(...fetchedBlocks);
      cursor = response.has_more ? response.next_cursor || undefined : undefined;
    } while (cursor);

    // Recursively fetch children for blocks that have children
    // Common parent blocks: column_list, column, toggle, synced_block, table, bulleted_list_item, etc.
    for (const block of blocks) {
      const hasChildren = (block as { has_children?: boolean }).has_children;
      if (hasChildren) {
        const children = await this.fetchBlocksRecursively(block.id);
        // Attach children to the block for easier processing
        (block as { children?: NotionBlock[] }).children = children;
      }
    }

    return blocks;
  }

  async getPageBlocks(pageId: string): Promise<NotionBlock[]> {
    try {
      const allBlocks: NotionBlock[] = await this.fetchBlocksRecursively(pageId);
      logger.info(`Retrieved ${allBlocks.length} blocks from page ${pageId} (including nested)`);
      return allBlocks;
    } catch (error: unknown) {
      logger.error(`Failed to get blocks for page ${pageId}`, error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get page blocks: ${message}`);
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
    if (!this.isRecord(page)) return 'Untitled';
    const props = page.properties as Record<string, unknown> | undefined;
    if (!props) return 'Untitled';
    const candidate = (props['title'] ?? props['Title'] ?? props['Name']) as unknown;
    if (!this.isRecord(candidate)) return 'Untitled';
      
    // Notion title property has 'title' array according to API spec
    // https://developers.notion.com/reference/property-object#title
    const titleArray = candidate['title'];
    if (!Array.isArray(titleArray)) return 'Untitled';
      
    const text = this.extractPlainText(titleArray);
    return text || 'Untitled';
  }

  private extractStatus(page: { properties?: Record<string, unknown> } | unknown): 'writing' | 'adding' | 'complete' | 'error' {
    if (!this.isRecord(page)) return 'writing';
    const props = page.properties as Record<string, unknown> | undefined;
    if (!props) return 'writing';
    const statusProp = (props['status'] ?? props['Status']) as unknown;
    if (!this.isRecord(statusProp)) return 'writing';
    const select = statusProp['select'];
    if (!this.isRecord(select)) return 'writing';
    const name = select['name'];
    if (typeof name !== 'string') return 'writing';
    if (name === 'writing' || name === 'adding' || name === 'complete' || name === 'error') return name;
    return 'writing';
  }
}

export const notionService = new NotionService();

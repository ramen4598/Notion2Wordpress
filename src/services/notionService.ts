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
  [key: string]: unknown;
}

export interface QueryPagesOptions {
  lastSyncTimestamp?: string;
  statusFilter?: 'adding';
}

export interface QueryPagesResponse {
  pages: NotionPage[];
  hasMore: boolean;
  nextCursor?: string;
}

class NotionService {
  private client: Client;

  constructor() {
    this.client = new Client({ auth: config.notionApiToken });
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private extractPlainText(arr: unknown): string {
    if (!Array.isArray(arr)) return '';
    return arr
      .map((t) => (this.isRecord(t) && typeof t.plain_text === 'string' ? (t.plain_text as string) : ''))
      .join('');
  }

  async queryPages(options: QueryPagesOptions = {}): Promise<QueryPagesResponse> {
    const { lastSyncTimestamp, statusFilter = 'adding' } = options;
    // Build filter (Notion API expects either a property filter or a compound filter)
    // Use 'status' type instead of 'select' for Notion status properties
    const statusFilterObj = {
      property: 'status',
      status: { equals: statusFilter },
    } as const;

    // If incremental timestamp provided, use compound AND filter
    const filter: Record<string, unknown> = lastSyncTimestamp
      ? {
          and: [
            statusFilterObj,
            {
              timestamp: 'last_edited_time',
              last_edited_time: { after: lastSyncTimestamp },
            },
          ],
        }
      : statusFilterObj;

    try {
      const response = await retryWithBackoff(
          async () => {
            return await this.client.request<{ results: unknown[]; has_more: boolean; next_cursor: string | null }>({
              path: `data_sources/${config.notionDatabaseId}/query`,
              method: 'post',
              body: { filter },
            });
          },
        {
          onRetry: (error, attempt) => {
            logger.warn(`Retrying Notion query (attempt ${attempt})`, { error: error.message });
          },
        }
      );

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

  async getPageBlocks(pageId: string): Promise<NotionBlock[]> {
    try {
      const blocks: NotionBlock[] = [];
      let cursor: string | undefined;

      do {
        const response = await retryWithBackoff(
          async () => {
            return await this.client.blocks.children.list({
              block_id: pageId,
              start_cursor: cursor,
            });
          },
          {
            onRetry: (error, attempt) => {
              logger.warn(`Retrying get page blocks (attempt ${attempt})`, {
                pageId,
                error: error.message,
              });
            },
          }
        );

        blocks.push(...(response.results as NotionBlock[]));
        cursor = response.has_more ? response.next_cursor || undefined : undefined;
      } while (cursor);

      logger.info(`Retrieved ${blocks.length} blocks from page ${pageId}`);
      return blocks;
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
    try {
      const response = await retryWithBackoff(
        async () => {
          return await this.client.pages.update({
            page_id: pageId,
            properties: {
              status: {
                status: {
                  name: status,
                },
              },
            },
          });
        },
        {
          onRetry: (error, attempt) => {
            logger.warn(`Retrying update page status (attempt ${attempt})`, {
              pageId,
              status,
              error: error.message,
            });
          },
        }
      );

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
    const arr = candidate['title'];
    const text = this.extractPlainText(arr);
    if (text) return text;
    return 'Untitled';
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

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
  properties: Record<string, any>;
}

export interface NotionBlock {
  id: string;
  type: string;
  [key: string]: any;
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

  async queryPages(options: QueryPagesOptions = {}): Promise<QueryPagesResponse> {
    const { lastSyncTimestamp, statusFilter = 'adding' } = options;

    const filter: any = {
      property: 'status',
      select: {
        equals: statusFilter,
      },
    };

    // Add incremental scan filter if timestamp provided
    if (lastSyncTimestamp) {
      filter.and = [
        filter,
        {
          timestamp: 'last_edited_time',
          last_edited_time: {
            after: lastSyncTimestamp,
          },
        },
      ];
    }

    try {
      const response = await retryWithBackoff(
        async () => {
          return await (this.client.databases as any).query({
            database_id: config.notionDatabaseId,
            filter,
          });
        },
        {
          onRetry: (error, attempt) => {
            logger.warn(`Retrying Notion query (attempt ${attempt})`, { error: error.message });
          },
        }
      );

      const pages: NotionPage[] = response.results.map((page: any) => ({
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
    } catch (error: any) {
      logger.error('Failed to query Notion pages', error);
      throw new Error(`Notion query failed: ${error.message}`);
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
    } catch (error: any) {
      logger.error(`Failed to get blocks for page ${pageId}`, error);
      throw new Error(`Failed to get page blocks: ${error.message}`);
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
                select: {
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
      return {
        success: true,
        updatedTime: (response as any).last_edited_time,
      };
    } catch (error: any) {
      logger.error(`Failed to update page ${pageId} status`, error);
      throw new Error(`Failed to update page status: ${error.message}`);
    }
  }

  private extractTitle(page: any): string {
    // Notion title property can be in different formats
    const titleProp = page.properties.title || page.properties.Title || page.properties.Name;
    if (!titleProp) return 'Untitled';

    if (titleProp.title && Array.isArray(titleProp.title) && titleProp.title.length > 0) {
      return titleProp.title.map((t: any) => t.plain_text).join('');
    }

    return 'Untitled';
  }

  private extractStatus(page: any): 'writing' | 'adding' | 'complete' | 'error' {
    const statusProp = page.properties.status || page.properties.Status;
    if (!statusProp || !statusProp.select) return 'writing';
    return statusProp.select.name as 'writing' | 'adding' | 'complete' | 'error';
  }
}

export const notionService = new NotionService();

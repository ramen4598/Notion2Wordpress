import { Client } from '@notionhq/client';
import { NotionToMarkdown } from 'notion-to-md';
import { marked } from 'marked';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { NotionBlock } from '../services/notionService.js';

export interface ImageReference {
  blockId: string;
  url: string;
  altText?: string;
}

export interface ConvertToHTMLResponse {
  html: string;
  images: ImageReference[];
}

class ContentConverter {
  private n2m: NotionToMarkdown;
  private notion: Client;

  constructor() {
    this.notion = new Client({ auth: config.notionApiToken });
    this.n2m = new NotionToMarkdown({ notionClient: this.notion });
  }

  async convertToHTML(pageId: string, blocks: NotionBlock[]): Promise<ConvertToHTMLResponse> {
    try {
      // Log block types for debugging
      logger.debug(`Page ${pageId} block types:`, { 
        types: blocks.map(b => b.type),
        blockCount: blocks.length 
      });

      // Extract image references before conversion
      const images = this.extractImages(blocks);

      // Convert to Markdown
      const mdBlocks = await this.n2m.pageToMarkdown(pageId);
      const mdString = this.n2m.toMarkdownString(mdBlocks);

      // Handle empty pages gracefully
      const markdownContent = mdString.parent ?? '';
      logger.debug(`Converted page ${pageId} to Markdown`, { length: markdownContent.length });

      // Convert Markdown to HTML
      const html = marked.parse(markdownContent) as string;

      logger.info(`Converted page ${pageId} to HTML`, {
        htmlLength: html.length,
        imageCount: images.length,
      });

      return { html, images };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to convert page ${pageId} to HTML`, { error: message });
      throw new Error(`Content conversion failed: ${message}`);
    }
  }

  private extractImages(blocks: NotionBlock[]): ImageReference[] {
    const images: ImageReference[] = [];

    type NotionRichText = { plain_text: string };
    type NotionImage =
      | { type: 'external'; external?: { url?: string }; caption?: NotionRichText[] }
      | { type: 'file'; file?: { url?: string }; caption?: NotionRichText[] };

    const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
    const isNotionImage = (v: unknown): v is NotionImage => {
      if (!isRecord(v) || typeof v.type !== 'string') return false;
      if (v.type === 'external') return true;
      if (v.type === 'file') return true;
      return false;
    };
    const toAltText = (arr?: NotionRichText[]) =>
      Array.isArray(arr) && arr.length > 0 ? arr.map((c) => c.plain_text || '').join('') : undefined;

    const extractFromBlock = (block: NotionBlock): void => {
      // Extract image from current block
      const img = (block as { image?: unknown }).image;
      if (block.type === 'image' && isRecord(img) && isNotionImage(img)) {
        const imageBlock = img;
        const url = imageBlock.type === 'external' ? imageBlock.external?.url : imageBlock.file?.url;
        const altText = toAltText(imageBlock.caption);

        if (url) images.push({ blockId: block.id, url, altText });
      }

      // Recursively extract from children blocks (for column_list, column, toggle, etc.)
      const childrenKey = block.type === 'column_list' ? 'children' : 
                          block.type === 'column' ? 'children' :
                          block.type === 'toggle' ? 'children' :
                          block.type === 'synced_block' ? 'children' :
                          block.type === 'table' ? 'children' : null;

      if (childrenKey && isRecord(block)) {
        const children = (block as { children?: unknown }).children;
        if (Array.isArray(children)) {
          for (const child of children) {
            if (isRecord(child) && typeof (child as { type?: unknown }).type === 'string') {
              extractFromBlock(child as NotionBlock);
            }
          }
        }
      }
    };

    for (const block of blocks) {
      extractFromBlock(block);
    }

    logger.debug(`Extracted ${images.length} images from ${blocks.length} blocks`);
    return images;
  }
}

export const contentConverter = new ContentConverter();

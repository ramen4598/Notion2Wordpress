// Description: Converts Notion page content to HTML and extracts image references.

import { Client } from '@notionhq/client';
import { NotionToMarkdown } from 'notion-to-md';
import { marked } from 'marked';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { NotionBlock } from '../services/notionService.js';
import { isRecord } from '../lib/utils.js';

export interface ImageReference {
  blockId: string;
  url: string;
  altText?: string;
}

export interface ConvertToHTMLResponse {
  html: string;
  images: ImageReference[];
}

type NotionRichText = { plain_text: string };
type NotionImage =
  | { type: 'external'; external?: { url?: string }; caption?: NotionRichText[] }
  | { type: 'file'; file?: { url?: string }; caption?: NotionRichText[] };

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
      // TODO: 매개변수로 받은 block를 사용하지 않고 있음. blocks와 mdBlocks 둘 중 하나로 통일 필요
      // const mdBlocks = await this.n2m.blocksToMarkdown(blocks); // 가능?
      const mdBlocks = await this.n2m.pageToMarkdown(pageId);
      const mdString = this.n2m.toMarkdownString(mdBlocks);

      const markdownContent = mdString.parent ?? ''; // Handle empty pages gracefully
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
    for (const block of blocks) {
      this.extractFromBlock(block, images);
    }
    logger.debug(`Extracted ${images.length} images from ${blocks.length} blocks`);
    return images;
  }

  private isNotionImage(v: unknown): v is NotionImage {
    if (!isRecord(v) || typeof v.type !== 'string') return false;
    return v.type === 'external' || v.type === 'file';
  }

  private toAltText(arr?: NotionRichText[]): string | undefined {
    if (Array.isArray(arr) && arr.length > 0) {
      return arr.map((c) => c.plain_text || '').join('');
    } else {
      return undefined;
    }
  }

  private extractFromBlock(block: NotionBlock, images: ImageReference[]): void {
    const img = (block as { image?: unknown }).image;
    if (block.type === 'image' && isRecord(img) && this.isNotionImage(img)) {
      const imageBlock = img;
      const url = imageBlock.type === 'external' ? imageBlock.external?.url : imageBlock.file?.url;
      const altText = this.toAltText(imageBlock.caption);
      if (url) images.push({ blockId: block.id, url, altText });
    }
    const typeList = ['column_list', 'column', 'toggle', 'synced_block', 'table'];
    const ableToHaveChildren : boolean = typeList.includes(block.type);
    if (ableToHaveChildren && isRecord(block)) {
      const children = (block as { children?: unknown }).children;
      if (Array.isArray(children)) {
        for (const child of children) {
          if (isRecord(child) && typeof (child as { type?: unknown }).type === 'string') {
            this.extractFromBlock(child as NotionBlock, images);
          }
        }
      }
    }
  }
}

export const contentConverter = new ContentConverter();

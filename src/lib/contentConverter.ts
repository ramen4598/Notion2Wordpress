// Description: Converts Notion page content to HTML and extracts image references.

import { Client, PartialBlockObjectResponse,BlockObjectResponse } from '@notionhq/client';
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
  placeholder: string;
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

      // Extract image references and replace url with placeholder
      const images = this.extractImages(blocks);

      // Convert to Markdown
      // TODO: children block에 대하여 주어진 blocks 뿐만 아니라 노션에서 다시 블록들을 불러오고 있음. 바로 html로 변환할 수 있는 다른 라이브러리 찾기
      const mdBlocks = await this.n2m.blocksToMarkdown(blocks as Array<PartialBlockObjectResponse | BlockObjectResponse>);
      const mdString = this.n2m.toMarkdownString(mdBlocks);

      const markdownContent = mdString.parent ?? ''; // Handle empty pages gracefully

      // Convert Markdown to HTML
      const html = marked.parse(markdownContent) as string;

      logger.info(`Converted page ${pageId} to HTML`, {
        htmlLength: html.length,
        imageCount: images.length,
      });
      logger.debug(`convertToHTML ${pageId} html : ${html}`);
      logger.debug(`convertToHTML ${pageId} images: ${JSON.stringify(images)}`);

      return { html, images };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to convert page ${pageId} to HTML`, { error: message });
      throw new Error(`Content conversion failed: ${message}`);
    }
  }

  private extractImages(blocks: NotionBlock[]): ImageReference[] {
    const images: ImageReference[] = [];
    logger.debug(`extractImages: before process - blocks: ${JSON.stringify(blocks)}, images: ${JSON.stringify(images)}`);
    for (const block of blocks) {
      this.extractFromBlock(block, images);
    }
    logger.debug(`extractImages: after proccess - blocks: ${JSON.stringify(blocks)}, images: ${JSON.stringify(images)}`);
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
    // block.url -> replace with placeholder -> convert later
    // image.url -> original url -> download later

    const placeholder = block.id; // use block id as placeholder
    const img = (block as { image?: unknown }).image;

    if (block.type === 'image' && isRecord(img) && this.isNotionImage(img)) {

      let originalUrl = undefined;
      switch (img.type) {
        case 'external':
          if (img.external) {
            originalUrl = img.external.url;
            img.external.url = placeholder; // replace with placeholder
          }
          break;
        case 'file':
          if (img.file) {
            originalUrl = img.file.url;
            img.file.url = placeholder; // replace with placeholder
          }
          break;
      }

      const altText = this.toAltText(img.caption);
      if (originalUrl) images.push({ blockId: block.id, url: originalUrl, altText, placeholder });
    }

    // Recursively check for child blocks
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

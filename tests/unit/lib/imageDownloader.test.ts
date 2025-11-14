// Description: Unit tests for image downloader

import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { imageDownloader } from '../../../src/lib/imageDownloader.js';

vi.mock('axios');
vi.mock('../../../src/lib/logger.js', () => ({
    logger: {
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

describe('ImageDownloader', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('getFilenameFromUrl (via download)', () => {
        const mockImageBuffer = Buffer.from('fake-image-data');

        beforeEach(() => {
            vi.mocked(axios.get).mockResolvedValue({
                data: mockImageBuffer,
                headers: { 'content-type': 'image/png' },
            });
        });

        it('should extract filename from simple URL', async () => {
            const result = await imageDownloader.download({
                url: 'https://example.com/my-image.png',
            });
            expect(result.filename).toBe('my-image');
        });

        it('should extract filename from URL with query parameters', async () => {
            const result = await imageDownloader.download({
                url: 'https://example.com/photo.jpg?size=large&format=png',
            });
            expect(result.filename).toBe('photo');
        });

        it('should extract filename from URL with fragments', async () => {
            const result = await imageDownloader.download({
                url: 'https://example.com/picture.jpeg#section',
            });
            expect(result.filename).toBe('picture');
        });

        it('should extract filename from URL with multiple dots', async () => {
            const result = await imageDownloader.download({
                url: 'https://example.com/my.awesome.image.png',
            });
            expect(result.filename).toBe('my.awesome.image');
        });

        it('should decode URL-encoded filename', async () => {
            const result = await imageDownloader.download({
                url: 'https://example.com/%ED%95%9C%EA%B8%80%20%EC%9D%B4%EB%AF%B8%EC%A7%80.png',
            });
            expect(result.filename).toBe('한글 이미지');
        });

        it('should handle URL with no extension', async () => {
            const result = await imageDownloader.download({
                url: 'https://example.com/image',
            });
            expect(result.filename).toBe('image');
        });

        it('should handle URL ending with slash. default filename is "image"', async () => {
            const result = await imageDownloader.download({
                url: 'https://example.com/path/',
            });
            expect(result.filename).toBe('image');
        });

        it('should handle complex URL with path and query', async () => {
            const result = await imageDownloader.download({
                url: 'https://cdn.example.com/uploads/2024/01/sunset-beach.jpg?v=2&quality=high',
            });
            expect(result.filename).toBe('sunset-beach');
        });

        it('should handle Notion-style image URLs', async () => {
            const result = await imageDownloader.download({
                url: 'https://prod-files-secure.s3.us-west-2.amazonaws.com/abc123/image-uuid.png?X-Amz-Algorithm=AWS4-HMAC-SHA256',
            });
            expect(result.filename).toBe('image-uuid');
        });
    });
});

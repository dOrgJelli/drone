import { describe, expect, test } from 'bun:test';
import { imageFilesFromClipboardData } from '../src/droneHub/chat/chat-input-attachments';

describe('chat input attachment helpers', () => {
  test('collects all image files exposed through clipboard files', () => {
    const one = new File(['one'], 'one.png', { type: 'image/png', lastModified: 1 });
    const two = new File(['two'], 'two.png', { type: 'image/png', lastModified: 2 });

    const files = imageFilesFromClipboardData({
      files: [one, two] as any,
      items: [
        {
          kind: 'file',
          getAsFile: () => one,
        },
      ] as any,
    });

    expect(files).toEqual([one, two]);
  });

  test('falls back to clipboard items when files are absent', () => {
    const one = new File(['one'], 'one.png', { type: 'image/png', lastModified: 1 });
    const text = new File(['text'], 'notes.txt', { type: 'text/plain', lastModified: 2 });

    const files = imageFilesFromClipboardData({
      files: [] as any,
      items: [
        {
          kind: 'file',
          getAsFile: () => one,
        },
        {
          kind: 'file',
          getAsFile: () => text,
        },
      ] as any,
    });

    expect(files).toEqual([one]);
  });
});

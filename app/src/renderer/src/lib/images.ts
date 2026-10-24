import { MAX_UPLOAD_BYTES } from './api';

const MAX_SIDE = 2560;
const REENCODE_OVER_BYTES = 1.5 * 1024 * 1024;

/**
 * Makes a picture ready to send: GIFs stay as they are so they keep moving;
 * big screenshots are scaled to 2560px and saved as WebP so they upload fast.
 */
export async function prepareImage(file: File): Promise<Blob> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('Only PNG, JPG, WebP and GIF pictures can be sent.');
  if (file.type !== 'image/gif') {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale < 1 || file.size > REENCODE_OVER_BYTES) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
      if (blob && blob.size < file.size) return blob;
    } else {
      bitmap.close();
    }
  }
  if (file.size > MAX_UPLOAD_BYTES.chat) throw new Error('That picture is too big. The limit is 8 MB.');
  return file;
}

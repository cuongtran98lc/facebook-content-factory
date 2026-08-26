import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { join, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

const execAsync = promisify(exec);

/**
 * ThumbnailService
 * Generates a thumbnail image for a vertical (9:16) video.
 * It extracts the first frame of the video and overlays the provided title
 * at the top center of the image. The resulting image can be used as a TikTok
 * cover thumbnail.
 */
export class ThumbnailService {
  /**
   * Generate a thumbnail for a given video.
   * @param videoPath   Absolute path to the source video.
   * @param title       The story title to overlay.
   * @param outputDir   Directory where the thumbnail will be saved. If omitted, a "thumbs" folder
   *                    next to the video is created.
   * @returns           Absolute path to the generated thumbnail image (PNG).
   */
  static async generate(videoPath: string, title: string, outputDir?: string): Promise<string> {
    // 1️⃣ Extract first frame using ffmpeg (must be available in the environment).
    const tempFramePath = videoPath + '.frame.jpg';
    const ffmpegCmd = `ffmpeg -y -i "${videoPath}" -frames:v 1 -q:v 2 "${tempFramePath}"`;
    await execAsync(ffmpegCmd);

    // 2️⃣ Determine output path.
    const baseDir = outputDir ?? join(dirname(videoPath), 'thumbs');
    mkdirSync(baseDir, { recursive: true });
    const thumbPath = join(baseDir, `${Date.now()}_${Math.random().toString(36).substring(2, 8)}.png`);

    // 3️⃣ Create an SVG overlay with the title text.
    const svgOverlay = `
    <svg width="720" height="1280" xmlns="http://www.w3.org/2000/svg">
      <style>
        .title { fill: #ffffff; font-size: 78px; font-weight: 600; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; text-anchor: middle; }
        .bg { fill: rgba(0,0,0,0.4); }
      </style>
      <rect x="0" y="0" width="720" height="200" class="bg" />
      <text x="50%" y="130" class="title">${ThumbnailService.escapeXml(title)}</text>
    </svg>`;

    // 4️⃣ Composite the frame and the SVG overlay.
    await sharp(tempFramePath)
      .resize(720, 1280, { fit: 'cover' }) // enforce 9:16 (720x1280) size
      .composite([{ input: Buffer.from(svgOverlay), top: 0, left: 0 }])
      .png()
      .toFile(thumbPath);

    // 5️⃣ Clean up temporary frame.
    try { await execAsync(`rm -f "${tempFramePath}"`); } catch (_) {}

    return thumbPath;
  }

  /** Escape characters that are unsafe in SVG text nodes. */
  private static escapeXml(str: string): string {
    return str.replace(/&/g, '&amp;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&apos;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;');
  }
}

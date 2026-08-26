import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

const execAsync = promisify(exec);

/**
 * VideoProcessor
 * Provides utilities to post‑process a rendered video before upload.
 * Currently supports overlaying a title text for the first 5 seconds.
 */
export class VideoProcessor {
  /**
   * Overlay `title` onto the video for the first 5 seconds.
   * The resulting video is saved next to the original file with a suffix
   * `.title.mp4` to avoid overwriting the source.
   * @param videoPath Absolute path to the source video.
   * @param title     Text to overlay (centered).
   * @returns          Path to the processed video.
   */
  static async overlayTitle(videoPath: string, title: string): Promise<string> {
    const outputPath = `${videoPath}.title.mp4`;
    // ffmpeg drawtext filter – enable for first 5 seconds
    const cmd = `ffmpeg -y -i "${videoPath}" -vf "drawtext=text='${title.replace(/'/g, "\\'")}'` +
      `:fontcolor=white:fontsize=48:box=1:boxcolor=black@0.5:boxborderw=5` +
      `:x=(w-text_w)/2:y=(h-text_h)/2:enable='lte(t,5)'" -c:a copy "${outputPath}"`;
    await execAsync(cmd);
    return outputPath;
  }
}

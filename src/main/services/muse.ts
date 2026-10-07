import { BrowserWindow, session } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { GoogleFlowCaptureStatus, VideoFormat } from '../../shared/types';
import { ProjectStorageService } from './storage';
import { probeDuration } from './ffmpeg';

export interface BuildMusePromptParams {
  narration?: string;
  action?: string;
  location?: string;
  visualDescription?: string;
  format?: 'SHORT' | 'LONG' | VideoFormat;
  duration?: number;
  characters?: Array<{ name?: string; action?: string; emotion?: string; outfit?: string; prop?: string }>;
}

export function buildMusePrompt(params: BuildMusePromptParams): string {
  const isVertical = params.format === 'SHORT' || params.format === 'REEL';
  const ratio = isVertical ? 'Vertical 9:16 video' : 'Widescreen 16:9 cinematic video';
  
  const charDetails = (params.characters || [])
    .map(c => `${c.name || 'Character'}${c.emotion ? ` looking ${c.emotion}` : ''}${c.action ? `, ${c.action}` : ''}${c.prop ? `, holding ${c.prop}` : ''}`)
    .join('. ');

  const elements: string[] = [
    `${ratio}, 2D minimalist explainer animation style with diverse character forms (expressive stickman with black tie, and solid black silhouette desk clerk with round glasses where relevant), flexible storytelling environment.`,
  ];

  if (params.visualDescription?.trim()) {
    elements.push(params.visualDescription.trim());
  }

  if (charDetails) {
    elements.push(`Characters: ${charDetails}.`);
  } else if (params.action?.trim()) {
    elements.push(`Action: ${params.action.trim()}.`);
  }

  if (params.location?.trim()) {
    elements.push(`Environment & Setting: ${params.location.trim()}.`);
  }

  if (params.narration?.trim()) {
    elements.push(`Scene context: "${params.narration.trim()}".`);
  }

  elements.push(
    'Camera motion: subtle dynamic tracking, natural depth of field, professional lighting and composition.',
    'High quality 4K render, realistic physics, continuous motion, no text, no captions, no watermarks, no split screen.'
  );

  return elements.filter(Boolean).join(' ');
}

export interface GenerateMuseVideoApiInput {
  apiUrl: string;
  apiKey?: string;
  prompt: string;
  duration?: number;
  format?: VideoFormat | 'SHORT' | 'LONG';
  signal?: AbortSignal;
}

export async function generateMuseVideoViaApi(input: GenerateMuseVideoApiInput): Promise<{ buffer: Buffer; duration: number }> {
  const cleanUrl = input.apiUrl.trim().replace(/\/$/, '');
  const isVertical = input.format === 'SHORT' || input.format === 'REEL';
  const targetRatio = isVertical ? '9:16' : '16:9';
  const targetSeconds = Math.max(3, Math.min(10, Math.round(input.duration || 5)));

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (input.apiKey?.trim()) {
    headers['Authorization'] = `Bearer ${input.apiKey.trim()}`;
  }

  // 1. Thử endpoint OpenAI-compatible /v1/video/generations hoặc /v1/videos/generations
  const candidateEndpoints = [
    `${cleanUrl}/v1/videos/generations`,
    `${cleanUrl}/v1/video/generations`,
    `${cleanUrl}/api/generate`,
    `${cleanUrl}/generate`,
  ];

  let videoBuffer: Buffer | null = null;
  let lastError: unknown = null;

  for (const endpoint of candidateEndpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          prompt: input.prompt,
          aspect_ratio: targetRatio,
          duration: targetSeconds,
          model: 'muse-video',
        }),
        signal: input.signal,
      });

      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status} from ${endpoint}: ${await response.text().catch(() => '')}`);
        continue;
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('video/') || contentType.includes('application/octet-stream')) {
        videoBuffer = Buffer.from(await response.arrayBuffer());
        break;
      }

      const data = await response.json();
      const videoUrl = data?.data?.[0]?.url || data?.video_url || data?.url;
      const b64 = data?.data?.[0]?.b64_json || data?.b64_video;

      if (videoUrl) {
        const downloadRes = await fetch(videoUrl, { signal: input.signal });
        if (downloadRes.ok) {
          videoBuffer = Buffer.from(await downloadRes.arrayBuffer());
          break;
        }
      } else if (b64) {
        videoBuffer = Buffer.from(b64, 'base64');
        break;
      }
    } catch (err) {
      lastError = err;
    }
  }

  if (!videoBuffer) {
    throw new Error(
      `Không thể tạo video từ Muse API Bridge tại ${cleanUrl}: ${lastError instanceof Error ? lastError.message : String(lastError)}. ` +
      'Hãy đảm bảo server bridge (như muse2api hoặc proxy video) đang chạy hoặc sử dụng tùy chọn mở Web Muse AI / chọn file đã tải.'
    );
  }

  return { buffer: videoBuffer, duration: targetSeconds };
}

export class MuseWindowManager {
  private window: BrowserWindow | null = null;
  private captureCleanup: (() => void) | null = null;
  private currentStatus: GoogleFlowCaptureStatus | null = null;

  async ensureWindow(webUrl = 'https://muse.ai'): Promise<BrowserWindow> {
    if (!this.window || this.window.isDestroyed()) {
      this.window = new BrowserWindow({
        width: 1320,
        height: 900,
        minWidth: 900,
        minHeight: 650,
        title: 'Muse AI Studio - Content Factory',
        backgroundColor: '#090d16',
        webPreferences: {
          partition: 'persist:muse-ai',
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      this.window.on('closed', () => {
        this.window = null;
      });
      await this.window.loadURL(webUrl);
    } else {
      this.window.show();
      this.window.focus();
    }
    return this.window;
  }

  async startCapture(
    projectId: string,
    scriptId: string,
    total: number,
    webUrl = 'https://muse.ai',
    onProgress?: (status: GoogleFlowCaptureStatus) => void,
  ): Promise<GoogleFlowCaptureStatus> {
    this.cancelCapture();
    const storage = new ProjectStorageService();
    const museDir = storage.getProjectPath(projectId, 'videos', 'muse-captures');
    await mkdir(museDir, { recursive: true });

    const baseStatus: GoogleFlowCaptureStatus = {
      projectId,
      scriptId,
      captured: 0,
      total,
      stage: 'CONNECTING',
      message: 'Đang mở phiên Muse AI...',
    };
    this.currentStatus = baseStatus;
    onProgress?.(baseStatus);

    await this.ensureWindow(webUrl);

    const museSession = session.fromPartition('persist:muse-ai');
    const captures: Array<{ path: string; done: boolean }> = [];

    const cleanup = () => {
      museSession.removeListener('will-download', downloadListener);
      if (this.captureCleanup === cleanup) this.captureCleanup = null;
    };

    const downloadListener = (_event: unknown, item: any) => {
      const filename = item.getFilename();
      const ext = filename.split('.').pop()?.toLowerCase();
      // Bắt file video mp4/webm/mov tải về
      if (!['mp4', 'webm', 'mov', 'm4v'].includes(ext || '')) return;

      const captureIndex = captures.length + 1;
      const targetFileName = `${Date.now()}-${String(captureIndex).padStart(3, '0')}.mp4`;
      const targetPath = join(museDir, targetFileName);

      item.setSavePath(targetPath);
      const captureEntry = { path: targetPath, done: false };
      captures.push(captureEntry);

      baseStatus.stage = 'GENERATING';
      baseStatus.message = `Đang tải video cảnh ${captureIndex}/${total}: ${filename}...`;
      onProgress?.({ ...baseStatus });

      item.once('done', async (_e: unknown, state: string) => {
        if (state !== 'completed') {
          baseStatus.message = `Tải video ${filename} không thành công (${state}).`;
          onProgress?.({ ...baseStatus });
          return;
        }

        captureEntry.done = true;
        const capturedCount = captures.filter(c => c.done).length;
        baseStatus.captured = capturedCount;
        baseStatus.stage = capturedCount >= total ? 'DONE' : 'GENERATING';
        baseStatus.message = capturedCount >= total
          ? `🎉 Đã nhận đủ ${total} video Muse AI theo phân đoạn!`
          : `Đã nhận video ${capturedCount}/${total} từ Muse AI. Tiếp tục tải cảnh tiếp theo...`;
        onProgress?.({ ...baseStatus });

        if (capturedCount >= total) {
          cleanup();
        }
      });
    };

    museSession.on('will-download', downloadListener);
    this.captureCleanup = cleanup;

    baseStatus.stage = 'CAPTURING';
    baseStatus.message = `Cửa sổ Muse AI đã mở. Hãy tạo và tải video cho ${total} phân đoạn theo thứ tự.`;
    onProgress?.({ ...baseStatus });

    return baseStatus;
  }

  cancelCapture(): void {
    if (this.captureCleanup) {
      this.captureCleanup();
      this.captureCleanup = null;
    }
    if (this.currentStatus) {
      this.currentStatus.stage = 'CANCELED';
      this.currentStatus.message = 'Đã dừng theo dõi video tải về từ Muse AI.';
    }
  }

  getCurrentStatus(): GoogleFlowCaptureStatus | null {
    return this.currentStatus;
  }
}

export const museWindowManager = new MuseWindowManager();

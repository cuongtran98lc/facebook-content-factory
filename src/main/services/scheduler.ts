import { BrowserWindow } from 'electron';
import { readFile } from 'node:fs/promises';
import type { Platform, PrivacyStatus, ScheduledPostDTO, SchedulePostInput, UploadProgress } from '../../shared/types';
import { getPrisma } from './database';
import type { YouTubeService } from './youtube';
import type { FacebookService } from './facebook';

type RenderRow = Awaited<ReturnType<typeof findRender>>;
type PostRow = Awaited<ReturnType<typeof findPostForRender>>;

async function findRender(renderId: string) {
  return getPrisma().render.findUniqueOrThrow({
    where: { id: renderId },
    include: { project: true },
  });
}

/** 1 render có thể có nhiều ScheduledPost độc lập — 1 dòng/platform (xem
 * @@unique([renderId, platform]) trong schema). Luôn tìm theo cặp
 * (renderId, platform), không bao giờ theo renderId một mình. */
async function findPostForRender(renderId: string, platform: Platform) {
  return getPrisma().scheduledPost.findUnique({ where: { renderId_platform: { renderId, platform } } });
}

async function readMeta(
  projectId: string,
  renderId: string,
  videoPath: string | null,
): Promise<{ title: string | null; description: string | null }> {
  // 1. Try to find the asset metadata from the DB first (most reliable)
  try {
    const assets = await getPrisma().asset.findMany({
      where: {
        projectId,
        type: 'VIDEO_PUBLISH_METADATA',
      },
    });
    for (const asset of assets) {
      if (asset.metadata) {
        const data = JSON.parse(asset.metadata);
        if (data.renderId === renderId) {
          return {
            title: data.title || null,
            description: data.description || null,
          };
        }
      }
    }
  } catch (error) {
    console.error('Failed to read metadata from database assets:', error);
  }

  // 2. Fallback to parsing sidecar file if available
  if (videoPath) {
    const metaPath = videoPath.replace(/\.[^.]+$/, '.metadata.txt');
    try {
      const text = await readFile(metaPath, 'utf8');

      // If it's JSON, parse it
      if (text.trim().startsWith('{')) {
        const data = JSON.parse(text) as Record<string, string>;
        return { title: data.title ?? null, description: data.description ?? null };
      }

      // Otherwise, parse it as a sidecar plain text file
      const lines = text.split('\n');
      let title: string | null = null;
      let description: string | null = null;

      const titleIndex = lines.findIndex((l) => l.startsWith('TIÊU ĐỀ'));
      if (titleIndex !== -1 && lines[titleIndex + 1]) {
        title = lines[titleIndex + 1].trim();
      }

      const descIndex = lines.findIndex((l) => l.startsWith('MÔ TẢ'));
      if (descIndex !== -1) {
        const descLines: string[] = [];
        for (let i = descIndex + 1; i < lines.length; i++) {
          if (lines[i].startsWith('VIDEO:')) break;
          descLines.push(lines[i]);
        }
        description = descLines.join('\n').trim();
      }

      return { title, description };
    } catch {
      // Ignore
    }
  }

  return { title: null, description: null };
}

function toDTO(
  render: RenderRow,
  post: PostRow | null,
  meta: { title: string | null; description: string | null },
): ScheduledPostDTO {
  return {
    id: post?.id ?? null,
    renderId: render.id,
    renderType: render.type,
    renderPath: render.path ?? null,
    projectId: render.project.id,
    projectName: render.project.name,
    platform: (post?.platform as Platform) ?? 'YOUTUBE',
    publishTitle: post?.titleOverride ?? meta.title,
    publishDescription: post?.descOverride ?? meta.description,
    status: (post?.status as ScheduledPostDTO['status']) ?? null,
    scheduledAt: post?.scheduledAt?.toISOString() ?? null,
    uploadedAt: post?.uploadedAt?.toISOString() ?? null,
    youtubeVideoId: post?.youtubeVideoId ?? null,
    youtubeUrl: post?.youtubeUrl ?? null,
    privacyStatus: (post?.privacyStatus as PrivacyStatus) ?? 'private',
    error: post?.error ?? null,
    renderCreatedAt: render.createdAt.toISOString(),
  };
}

function sendToRenderer(channel: string, data: unknown): void {
  const wins = BrowserWindow.getAllWindows();
  for (const win of wins) {
    if (!win.isDestroyed()) win.webContents.send(channel, data);
  }
}

export class SchedulerService {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly youtube: YouTubeService,
    private readonly facebook: FacebookService,
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.checkDuePosts(), 60_000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** `platform` mặc định 'YOUTUBE' (giữ nguyên hành vi cũ cho tab Scheduler).
   * Export Queue gọi với 'FACEBOOK'/'TIKTOK' để xem trạng thái đăng của
   * riêng nền tảng đó — mọi render DONE đều hiện ra (kể cả chưa có
   * ScheduledPost cho platform này, hiện "chưa lên lịch"). */
  async list(platform?: Platform): Promise<ScheduledPostDTO[]> {
    const targetPlatform = platform ?? 'YOUTUBE';
    const renders = await getPrisma().render.findMany({
      where: { status: 'DONE', path: { not: null } },
      include: { project: true, scheduledPosts: { where: { platform: targetPlatform } } },
      orderBy: { createdAt: 'desc' },
    });
    const dtos = await Promise.all(
      renders.map(async render => {
        const meta = await readMeta(render.projectId, render.id, render.path);
        const post = render.scheduledPosts[0] ?? null;
        return toDTO(render, post, meta);
      }),
    );
    return dtos;
  }

  async schedule(input: SchedulePostInput): Promise<ScheduledPostDTO> {
    // "PENDING" ở đây LUÔN có nghĩa "chờ YouTubeService tự động upload" —
    // Export Queue (Facebook/TikTok, đăng tay) dùng MANUAL_PENDING riêng,
    // không đi qua schedule()/checkDuePosts(). Xem TODOS.md T5 / Architecture #1.
    const platform = input.platform ?? 'YOUTUBE';
    await getPrisma().scheduledPost.upsert({
      where: { renderId_platform: { renderId: input.renderId, platform } },
      create: {
        renderId: input.renderId,
        platform,
        status: 'PENDING',
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
        privacyStatus: input.privacyStatus ?? 'private',
        titleOverride: input.titleOverride ?? null,
        descOverride: input.descOverride ?? null,
      },
      update: {
        status: 'PENDING',
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
        privacyStatus: input.privacyStatus ?? 'private',
        titleOverride: input.titleOverride ?? null,
        descOverride: input.descOverride ?? null,
      },
    });
    const render = await findRender(input.renderId);
    const meta = await readMeta(render.projectId, render.id, render.path);
    const post = await findPostForRender(input.renderId, platform);
    return toDTO(render, post, meta);
  }

  /** Đánh dấu đã đăng thủ công (Export Queue: Facebook/TikTok) — không đi
   * qua YouTubeService. Bỏ tick trong UI gọi lại `schedule()` với
   * status quay về MANUAL_PENDING thay vì cancel hẳn. */
  async markManualPosted(renderId: string, platform: Platform): Promise<ScheduledPostDTO> {
    await getPrisma().scheduledPost.upsert({
      where: { renderId_platform: { renderId, platform } },
      create: { renderId, platform, status: 'MANUAL_POSTED', uploadedAt: new Date(), privacyStatus: 'private' },
      update: { status: 'MANUAL_POSTED', uploadedAt: new Date(), error: null },
    });
    const render = await findRender(renderId);
    const meta = await readMeta(render.projectId, render.id, render.path);
    const post = await findPostForRender(renderId, platform);
    return toDTO(render, post, meta);
  }

  async markManualPending(renderId: string, platform: Platform): Promise<ScheduledPostDTO> {
    await getPrisma().scheduledPost.upsert({
      where: { renderId_platform: { renderId, platform } },
      create: { renderId, platform, status: 'MANUAL_PENDING', privacyStatus: 'private' },
      update: { status: 'MANUAL_PENDING', uploadedAt: null },
    });
    const render = await findRender(renderId);
    const meta = await readMeta(render.projectId, render.id, render.path);
    const post = await findPostForRender(renderId, platform);
    return toDTO(render, post, meta);
  }

  async cancel(id: string): Promise<ScheduledPostDTO> {
    const updated = await getPrisma().scheduledPost.update({ where: { id }, data: { status: 'CANCELLED' } });
    const render = await findRender(updated.renderId);
    const meta = await readMeta(render.projectId, render.id, render.path);
    return toDTO(render, updated, meta);
  }

  async uploadNow(renderId: string, platformInput?: Platform): Promise<ScheduledPostDTO> {
    const platform: Platform = platformInput ?? 'YOUTUBE';
    await getPrisma().scheduledPost.upsert({
      where: { renderId_platform: { renderId, platform } },
      create: { renderId, platform, status: 'UPLOADING', privacyStatus: 'private' },
      update: { status: 'UPLOADING', scheduledAt: null, error: null },
    });
    const render = await findRender(renderId);
    const meta = await readMeta(render.projectId, render.id, render.path);
    const post = await findPostForRender(renderId, platform);
    if (post) void this.doUpload(render, post, meta, platform);
    return toDTO(render, post, meta);
  }

  private async checkDuePosts(): Promise<void> {
    const due = await getPrisma().scheduledPost.findMany({
      where: {
        status: 'PENDING',
        platform: { in: ['YOUTUBE', 'FACEBOOK'] },
        OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }],
      },
      include: { render: { include: { project: true } } },
    });
    for (const post of due) {
      const meta = await readMeta(post.render.projectId, post.render.id, post.render.path);
      void this.doUpload(post.render, post, meta, post.platform as Platform);
    }
  }

  private async doUpload(
    render: { id: string; path: string | null; project: { name: string } },
    post: { id: string; titleOverride: string | null; descOverride: string | null; privacyStatus: string },
    meta: { title: string | null; description: string | null },
    platform: Platform
  ): Promise<void> {
    const renderId = render.id;
    if (!render.path) {
      await getPrisma().scheduledPost.update({
        where: { id: post.id },
        data: { status: 'FAILED', error: 'Video file path missing.' },
      });
      const updatedRender = await findRender(renderId);
      const updatedPost = await findPostForRender(renderId, platform);
      sendToRenderer('scheduler:post-updated', toDTO(updatedRender, updatedPost, meta));
      return;
    }

    await getPrisma().scheduledPost.update({ where: { id: post.id }, data: { status: 'UPLOADING', error: null } });

    const progressUpdate = (percent: number): void => {
      const progress: UploadProgress = { renderId, percent, stage: 'UPLOADING', message: `Đang upload ${percent}%...` };
      sendToRenderer('scheduler:upload-progress', progress);
    };

    try {
      const title = post.titleOverride ?? meta.title ?? render.project.name;
      const description = post.descOverride ?? meta.description ?? '';
      
      let videoId = '';
      let url = '';

      if (platform === 'FACEBOOK') {
        progressUpdate(10);
        const fbRes = await this.facebook.uploadVideo({
          videoPath: render.path,
          title,
          description
        });
        videoId = fbRes.videoId;
        url = fbRes.url;
        progressUpdate(100);
      } else {
        const ytRes = await this.youtube.uploadVideo({
          videoPath: render.path,
          title,
          description,
          privacyStatus: (post.privacyStatus as PrivacyStatus) ?? 'private',
          onProgress: progressUpdate,
        });
        videoId = ytRes.videoId;
        url = ytRes.url;
      }

      await getPrisma().scheduledPost.update({
        where: { id: post.id },
        data: { status: 'DONE', youtubeVideoId: videoId, youtubeUrl: url, uploadedAt: new Date(), error: null },
      });
      sendToRenderer('scheduler:upload-progress', {
        renderId,
        percent: 100,
        stage: 'DONE',
        message: 'Upload thành công!',
      } as UploadProgress);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await getPrisma().scheduledPost.update({ where: { id: post.id }, data: { status: 'FAILED', error: message } });
      sendToRenderer('scheduler:upload-progress', { renderId, percent: 0, stage: 'ERROR', message } as UploadProgress);
    }

    const updatedRender = await findRender(renderId);
    const updatedPost = await findPostForRender(renderId, platform);
    sendToRenderer('scheduler:post-updated', toDTO(updatedRender, updatedPost, meta));
  }
}

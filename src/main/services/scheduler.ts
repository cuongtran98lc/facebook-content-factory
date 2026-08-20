import { BrowserWindow } from 'electron';
import { readFile } from 'node:fs/promises';
import type { Platform, PrivacyStatus, ScheduledPostDTO, SchedulePostInput, UploadProgress } from '../../shared/types';
import { getPrisma } from './database';
import type { YouTubeService } from './youtube';

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

async function readMeta(videoPath: string | null): Promise<{ title: string | null; description: string | null }> {
  if (!videoPath) return { title: null, description: null };
  const metaPath = videoPath.replace(/\.[^.]+$/, '.metadata.txt');
  try {
    const text = await readFile(metaPath, 'utf8');
    const data = JSON.parse(text) as Record<string, string>;
    return { title: data.title ?? null, description: data.description ?? null };
  } catch {
    return { title: null, description: null };
  }
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

  constructor(private readonly youtube: YouTubeService) {}

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
        const meta = await readMeta(render.path);
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
    const meta = await readMeta(render.path);
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
    const meta = await readMeta(render.path);
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
    const meta = await readMeta(render.path);
    const post = await findPostForRender(renderId, platform);
    return toDTO(render, post, meta);
  }

  async cancel(id: string): Promise<ScheduledPostDTO> {
    const updated = await getPrisma().scheduledPost.update({ where: { id }, data: { status: 'CANCELLED' } });
    const render = await findRender(updated.renderId);
    const meta = await readMeta(render.path);
    return toDTO(render, updated, meta);
  }

  async uploadNow(renderId: string): Promise<ScheduledPostDTO> {
    const platform: Platform = 'YOUTUBE';
    await getPrisma().scheduledPost.upsert({
      where: { renderId_platform: { renderId, platform } },
      create: { renderId, platform, status: 'UPLOADING', privacyStatus: 'private' },
      update: { status: 'UPLOADING', scheduledAt: null, error: null },
    });
    const render = await findRender(renderId);
    const meta = await readMeta(render.path);
    const post = await findPostForRender(renderId, platform);
    if (post) void this.doUpload(render, post, meta);
    return toDTO(render, post, meta);
  }

  private async checkDuePosts(): Promise<void> {
    // Guard tường minh: vòng lặp tự động này CHỈ được đụng vào post YouTube.
    // Facebook/TikTok dùng status MANUAL_PENDING/MANUAL_POSTED (không bao giờ
    // bằng 'PENDING') nên về lý thuyết đã được loại trừ tự nhiên — nhưng
    // `platform: 'YOUTUBE'` ở đây là lớp phòng thủ thứ 2, phòng trường hợp
    // code sau này lỡ set status: 'PENDING' cho 1 dòng platform khác YouTube.
    // Đây là bug kiến trúc thật được tìm thấy ở /plan-eng-review (Architecture #1)
    // — xem test CRITICAL #1 trong Test Plan.
    const due = await getPrisma().scheduledPost.findMany({
      where: {
        status: 'PENDING',
        platform: 'YOUTUBE',
        OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }],
      },
      include: { render: { include: { project: true } } },
    });
    for (const post of due) {
      const meta = await readMeta(post.render.path);
      void this.doUpload(post.render, post, meta);
    }
  }

  private async doUpload(
    render: { id: string; path: string | null; project: { name: string } },
    post: { id: string; titleOverride: string | null; descOverride: string | null; privacyStatus: string },
    meta: { title: string | null; description: string | null },
  ): Promise<void> {
    const renderId = render.id;
    if (!render.path) {
      await getPrisma().scheduledPost.update({
        where: { id: post.id },
        data: { status: 'FAILED', error: 'Video file path missing.' },
      });
      const updatedRender = await findRender(renderId);
      const updatedPost = await findPostForRender(renderId, 'YOUTUBE');
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
      const { videoId, url } = await this.youtube.uploadVideo({
        videoPath: render.path,
        title,
        description,
        privacyStatus: (post.privacyStatus as PrivacyStatus) ?? 'private',
        onProgress: progressUpdate,
      });

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
    const updatedPost = await findPostForRender(renderId, 'YOUTUBE');
    sendToRenderer('scheduler:post-updated', toDTO(updatedRender, updatedPost, meta));
  }
}

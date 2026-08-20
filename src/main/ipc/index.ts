import { clipboard, dialog, ipcMain, shell } from 'electron';
import type {
  AIProviderName,
  BackgroundKind,
  CrawlStoryInput,
  CreatePillarInput,
  GenerateIdeasInput,
  GeneratePublishMetadataInput,
  GenerateReelsInput,
  GenerateReelVideosInput,
  GenerateStoryAudioInput,
  GenerateStoryInput,
  GenerateThumbnailInput,
  ImportStoryInput,
  Platform,
  PreviewVoiceInput,
  RenderStoryVideoInput,
  RewriteScriptInput,
  SaveAISettingsInput,
  SaveVoiceSettingsInput,
  SchedulePostInput,
  SelectVoiceInput,
  UpdatePillarInput,
  UpdateScriptInput,
  UpsertDailyMetricInput,
  YouTubeCredentialsInput,
} from '../../shared/types';
import { AIService } from '../services/ai';
import { getPrisma } from '../services/database';
import { hasFfmpeg } from '../services/ffmpeg';
import { IdeaService } from '../services/ideas';
import { MetricsService } from '../services/metrics';
import { getStorageRoot } from '../services/paths';
import { PillarService } from '../services/pillar';
import { PipelineService } from '../services/pipeline';
import { ProjectService } from '../services/projects';
import { RenderQueueService } from '../services/render-queue';
import { SchedulerService } from '../services/scheduler';
import { ScriptService } from '../services/scripts';
import { SeriesService } from '../services/series';
import { SettingsService } from '../services/settings';
import { ProjectStorageService } from '../services/storage';
import { StoryCrawlerService } from '../services/story-crawler';
import { StoryMediaService } from '../services/story-media';
import { VoiceService } from '../services/voices';
import { YouTubeService } from '../services/youtube';

const projects = new ProjectService();
const pipeline = new PipelineService();
const ideas = new IdeaService();
const pillars = new PillarService();
const series = new SeriesService();
const metrics = new MetricsService();
const settings = new SettingsService();
const ai = new AIService(settings);
const scripts = new ScriptService(ai);
const voices = new VoiceService(settings);
const storyMedia = new StoryMediaService(voices);
const storage = new ProjectStorageService();
const crawler = new StoryCrawlerService();
const youtube = new YouTubeService(settings);
export const scheduler = new SchedulerService(youtube);
export const renderQueue = new RenderQueueService(storyMedia);

async function openFolder(path: string, label: string): Promise<void> {
  const error = await shell.openPath(path);
  if (error) throw new Error(`Không thể mở ${label}: ${error}`);
}

export function registerIpcHandlers(): void {
  ipcMain.handle('app:health', async () => {
    let database = false;
    try {
      await getPrisma().$queryRawUnsafe('SELECT 1');
      database = true;
    } catch {
      database = false;
    }
    return {
      database,
      storagePath: getStorageRoot(),
      ffmpeg: await hasFfmpeg(),
      ttsProvider: process.env.TTS_PROVIDER?.trim().toLowerCase() === 'capcut' ? 'capcut' : 'elevenlabs',
    };
  });

  ipcMain.handle('app:open-storage', async () => {
    await openFolder(getStorageRoot(), 'storage nội bộ');
  });
  ipcMain.handle('app:open-external', (_event, url: string) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });
  ipcMain.handle('app:copy-text', (_event, value: string) => {
    const text = typeof value === 'string' ? value.slice(0, 20_000) : '';
    if (!text) throw new Error('Không có nội dung để copy.');
    clipboard.writeText(text);
  });
  ipcMain.handle('app:reveal-file', (_event, path: string) => {
    if (typeof path === 'string' && path) shell.showItemInFolder(path);
  });

  ipcMain.handle('projects:list', () => projects.list());
  ipcMain.handle('projects:create', (_event, input) => projects.create(input));
  ipcMain.handle('projects:remove', (_event, id: string) => projects.remove(id));

  ipcMain.handle('ideas:list', (_event, projectId: string) => ideas.list(projectId));
  ipcMain.handle('ideas:generate', (_event, input: GenerateIdeasInput) => ideas.generate(input));
  ipcMain.handle('ideas:select', (_event, ideaId: string) => ideas.select(ideaId));
  ipcMain.handle('ideas:assign-pillar', (_event, ideaId: string, pillarId: string | null) =>
    ideas.assignPillar(ideaId, pillarId),
  );

  ipcMain.handle('pillars:list', () => pillars.list());
  ipcMain.handle('pillars:get-next-in-rotation', () => pillars.getNextInRotation());
  ipcMain.handle('pillars:create', (_event, input: CreatePillarInput) => pillars.create(input));
  ipcMain.handle('pillars:update', (_event, id: string, input: UpdatePillarInput) => pillars.update(id, input));
  ipcMain.handle('pillars:remove', (_event, id: string) => pillars.remove(id));

  ipcMain.handle('series:list', () => series.list());
  ipcMain.handle('series:list-episodes', (_event, seriesId: string) => series.listEpisodes(seriesId));
  ipcMain.handle('series:continue-as-episode', (_event, prevIdeaId: string) => series.continueAsEpisode(prevIdeaId));

  ipcMain.handle('metrics:list', (_event, days?: number) => metrics.list(days));
  ipcMain.handle('metrics:upsert', (_event, input: UpsertDailyMetricInput) => metrics.upsert(input));

  ipcMain.handle('render-queue:enqueue', (_event, input: RenderStoryVideoInput) => renderQueue.enqueue(input));
  ipcMain.handle('render-queue:list', () => renderQueue.list());
  ipcMain.handle('render-queue:cancel', (_event, jobId: string) => renderQueue.cancel(jobId));

  ipcMain.handle('scripts:list', (_event, projectId: string) => scripts.list(projectId));
  ipcMain.handle('scripts:generate-story', (_event, input: GenerateStoryInput) => scripts.generateStory(input));
  ipcMain.handle('scripts:import-story', (_event, input: ImportStoryInput) => scripts.importStory(input));
  ipcMain.handle('scripts:review', (_event, scriptId: string) => scripts.review(scriptId));
  ipcMain.handle('scripts:rewrite', (_event, input: RewriteScriptInput) => scripts.rewrite(input));
  ipcMain.handle('scripts:update', (_event, input: UpdateScriptInput) => scripts.update(input));
  ipcMain.handle('scripts:remove', (_event, scriptId: string) => scripts.remove(scriptId));
  ipcMain.handle('scripts:approve', (_event, scriptId: string) => scripts.approve(scriptId));
  ipcMain.handle('scripts:generate-reels', (_event, input: GenerateReelsInput) => scripts.generateReels(input));

  ipcMain.handle('crawler:crawl', (event, input: CrawlStoryInput) =>
    crawler.crawl(input, progress => {
      if (!event.sender.isDestroyed()) event.sender.send('crawler:progress', progress);
    }),
  );

  ipcMain.handle('voices:list', (_event, search?: string) => voices.list(search));
  ipcMain.handle('voices:preview', (_event, input: PreviewVoiceInput) => voices.preview(input));
  ipcMain.handle('voices:select', (_event, input: SelectVoiceInput) => voices.select(input));

  ipcMain.handle('story-media:get', (_event, projectId: string) => storyMedia.get(projectId));
  ipcMain.handle('story-media:generate-thumbnail', (_event, input: GenerateThumbnailInput) =>
    storyMedia.generateThumbnail(input.projectId, input.scriptId, input.prompt),
  );
  ipcMain.handle('story-media:generate-reel-videos', (event, input: GenerateReelVideosInput) =>
    storyMedia.generateReelVideos(input.projectId, input.fitMode, input.soundEffect, progress => {
      if (!event.sender.isDestroyed()) event.sender.send('story-media:reel-progress', progress);
    }),
  );
  ipcMain.handle('story-media:resume-pending', event =>
    storyMedia.resumePending(progress => {
      if (!event.sender.isDestroyed()) event.sender.send('story-media:reel-progress', progress);
    }),
  );
  ipcMain.handle('story-media:generate-audio', (_event, input: GenerateStoryAudioInput) =>
    storyMedia.generateStoryAudio(input.projectId, input.scriptId),
  );
  ipcMain.handle('story-media:choose-background', async (_event, projectId: string, kind: BackgroundKind = 'VIDEO') => {
    const image = kind === 'IMAGE';
    const result = await dialog.showOpenDialog({
      title: image ? 'Chọn ảnh làm background' : 'Chọn background video',
      properties: ['openFile'],
      filters: image
        ? [{ name: 'Ảnh', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }]
        : [{ name: 'Video', extensions: ['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return storyMedia.setBackground(projectId, result.filePaths[0], kind);
  });
  ipcMain.handle('story-media:render', (event, input: RenderStoryVideoInput) =>
    storyMedia.render(input.projectId, input.format, input.fitMode, input.soundEffect, progress => {
      if (!event.sender.isDestroyed()) event.sender.send('story-media:story-progress', progress);
    }),
  );
  ipcMain.handle('story-media:generate-metadata', (event, input: GeneratePublishMetadataInput) =>
    storyMedia.generateMetadata(input.projectId, input.scope, progress => {
      if (!event.sender.isDestroyed()) event.sender.send('story-media:story-progress', progress);
    }),
  );
  ipcMain.handle('story-media:open-output', async (_event, projectId: string) => {
    const output = await storage.ensureOutputProject(projectId);
    await openFolder(output, 'output của truyện');
  });

  ipcMain.handle('settings:ai:get', () => settings.getAI());
  ipcMain.handle('settings:voice:get', () => settings.getVoice());
  ipcMain.handle('settings:voice:save', (_event, input: SaveVoiceSettingsInput) => settings.saveVoice(input));
  ipcMain.handle('settings:ai:save', (_event, input: SaveAISettingsInput) => settings.saveAI(input));
  ipcMain.handle('settings:ai:test', async (_event, provider?: AIProviderName) => {
    try {
      return await ai.test(provider);
    } catch (error) {
      return {
        ok: false,
        provider: provider ?? settings.getProvider(),
        message: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('pipeline:demo', (_event, projectId: string) => pipeline.generateDemo(projectId));

  // Scheduler
  ipcMain.handle('scheduler:list', (_event, platform?: Platform) => scheduler.list(platform));
  ipcMain.handle('scheduler:schedule', (_event, input: SchedulePostInput) => scheduler.schedule(input));
  ipcMain.handle('scheduler:cancel', (_event, id: string) => scheduler.cancel(id));
  ipcMain.handle('scheduler:upload-now', (_event, renderId: string) => scheduler.uploadNow(renderId));
  ipcMain.handle('scheduler:mark-manual-posted', (_event, renderId: string, platform: Platform) =>
    scheduler.markManualPosted(renderId, platform),
  );
  ipcMain.handle('scheduler:mark-manual-pending', (_event, renderId: string, platform: Platform) =>
    scheduler.markManualPending(renderId, platform),
  );

  // YouTube OAuth
  ipcMain.handle('youtube:save-credentials', (_event, input: YouTubeCredentialsInput) => {
    settings.saveYouTubeClientCredentials(input.clientId, input.clientSecret);
  });
  ipcMain.handle('youtube:begin-auth', () => youtube.beginAuth());
  ipcMain.handle('youtube:status', () => youtube.getStatus());
  ipcMain.handle('youtube:revoke', () => youtube.revokeAuth());
}

export type ProjectStatus =
  | 'DRAFT'
  | 'GENERATING_IDEAS'
  | 'IDEAS_READY'
  | 'GENERATING_SCRIPT'
  | 'SCRIPT_REVIEW'
  | 'SCRIPT_READY'
  | 'GENERATING_REELS'
  | 'REELS_READY'
  | 'GENERATING_MEDIA'
  | 'MEDIA_READY'
  | 'RENDERING'
  | 'READY'
  | 'FAILED'

export type AIProviderName = 'openai' | 'gemini'
export type ScriptType = 'LONG_STORY' | 'REEL'
export type VideoFormat = 'LANDSCAPE' | 'REEL' | 'SQUARE'
export type FitMode = 'CROP' | 'FIT'
export type BackgroundKind = 'VIDEO' | 'IMAGE'
export type SoundEffectPreset = 'DYNAMIC' | 'WHOOSH' | 'IMPACT' | 'CHIME'
export interface SoundEffectOptions {
  preset: SoundEffectPreset
  volume: number
}

export interface ProjectDTO {
  id: string
  name: string
  niche: string | null
  topic: string | null
  status: string
  voiceId: string | null
  voiceName: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateProjectInput { name: string; niche?: string; topic?: string }

export interface IdeaDTO {
  id: string; projectId: string; title: string; hook: string | null
  description: string | null; score: number | null; selected: boolean; createdAt: string
}
export interface GenerateIdeasInput { projectId: string; count?: number }

export interface ScriptDTO {
  id: string; projectId: string; type: ScriptType; title: string | null; content: string
  version: number; approved: boolean; score: number | null; review: string | null
  sourceScriptId: string | null; createdAt: string
}
export interface GenerateStoryInput { projectId: string; targetWords?: number }
export interface ImportStoryInput { projectId: string; title?: string; content: string }
export interface RewriteScriptInput { scriptId: string; instruction?: string }
export interface UpdateScriptInput { scriptId: string; title?: string; content: string }
export interface GenerateReelsInput { projectId: string; count?: number }
export interface CrawlStoryInput { projectId: string; url: string; maxEpisodes?: number }
export interface CrawlProgress {
  current: number
  total: number
  percent: number
  stage: 'DISCOVERING' | 'CRAWLING' | 'SAVING' | 'DONE'
  message: string
}
export interface CrawlStoryResult { story: ScriptDTO; episodes: ScriptDTO[]; sourceUrl: string }

export interface AISettingsDTO {
  provider: AIProviderName; openaiModel: string; geminiModel: string
  hasOpenAIKey: boolean; hasGeminiKey: boolean
}
export interface SaveAISettingsInput {
  provider: AIProviderName; openaiModel: string; geminiModel: string
  openaiApiKey?: string; geminiApiKey?: string
  clearOpenAIKey?: boolean; clearGeminiKey?: boolean
}
export interface AIConnectionResult { ok: boolean; provider: AIProviderName; message: string }

export interface VoiceSettingsDTO { elevenLabsModel: string; hasElevenLabsKey: boolean }
export interface SaveVoiceSettingsInput {
  elevenLabsModel: string
  elevenLabsApiKey?: string
  clearElevenLabsKey?: boolean
}
export interface VoiceDTO {
  id: string
  name: string
  category: string | null
  description: string | null
  previewUrl: string | null
  labels: Record<string, string>
}
export interface PreviewVoiceInput { voiceId: string; text: string }
export interface VoicePreviewResult { dataUrl: string; mimeType: string }
export interface SelectVoiceInput { projectId: string; voiceId: string; voiceName: string }


export interface StoryMediaDTO {
  thumbnailPath: string | null
  thumbnailUrl: string | null
  thumbnailPrompt: string | null
  thumbnailProvider: AIProviderName | null
  audioPath: string | null
  audioUrl: string | null
  audioDuration: number | null
  backgroundPath: string | null
  backgroundUrl: string | null
  backgroundName: string | null
  backgroundDuration: number | null
  backgroundKind: BackgroundKind | null
  renderPath: string | null
  renderUrl: string | null
  renderStatus: string | null
  storyVideoParts: StoryVideoPartDTO[]
  storyVideoOutputs: StoryVideoOutputDTO[]
  reels: ReelMediaDTO[]
}
export interface StoryVideoOutputDTO {
  format: VideoFormat
  status: string | null
  parts: StoryVideoPartDTO[]
}
export interface StoryVideoPartDTO {
  part: number
  totalParts: number
  format: VideoFormat
  startSeconds: number
  duration: number | null
  path: string | null
  url: string | null
  status: string | null
  publishTitle: string | null
  publishDescription: string | null
  publishMetadataPath: string | null
  publishSource: 'AI' | 'FALLBACK' | null
}
export interface ReelMediaDTO {
  reelId: string
  episode: number
  title: string | null
  audioPath: string | null
  videoPath: string | null
  videoUrl: string | null
  thumbnailPath: string | null
  thumbnailUrl: string | null
  status: string | null
  publishTitle: string | null
  publishDescription: string | null
  publishMetadataPath: string | null
  publishSource: 'AI' | 'FALLBACK' | null
}
export interface GenerateThumbnailInput { projectId: string; scriptId: string; prompt?: string }
export interface GenerateStoryAudioInput { projectId: string; scriptId: string }
export interface RenderStoryVideoInput { projectId: string; format: VideoFormat; fitMode: FitMode; soundEffect?: SoundEffectOptions }
export interface GenerateReelVideosInput { projectId: string; fitMode: FitMode; soundEffect?: SoundEffectOptions }
export interface GeneratePublishMetadataInput { projectId: string; scope?: 'ALL' | 'STORY' | 'REELS' }
export interface ReelVideoProgress {
  current: number
  total: number
  percent: number
  stage: 'STARTING' | 'AUDIO' | 'THUMBNAIL' | 'VIDEO' | 'METADATA' | 'DONE'
  message: string
}
export interface StoryVideoProgress {
  current: number
  total: number
  percent: number
  stage: 'STARTING' | 'VIDEO' | 'METADATA' | 'DONE'
  message: string
}

export interface AppHealth { database: boolean; storagePath: string; ffmpeg: boolean; ttsProvider: 'capcut' | 'elevenlabs' }

// --- Scheduler & YouTube ---
export type ScheduleStatus = 'PENDING' | 'UPLOADING' | 'DONE' | 'FAILED' | 'CANCELLED'
export type PrivacyStatus = 'public' | 'private' | 'unlisted'

export interface ScheduledPostDTO {
  id: string | null
  renderId: string
  renderType: string
  renderPath: string | null
  projectId: string
  projectName: string
  publishTitle: string | null
  publishDescription: string | null
  status: ScheduleStatus | null
  scheduledAt: string | null
  uploadedAt: string | null
  youtubeVideoId: string | null
  youtubeUrl: string | null
  privacyStatus: PrivacyStatus
  error: string | null
  renderCreatedAt: string
}

export interface YouTubeAuthStatus {
  connected: boolean
  channelId: string | null
  channelTitle: string | null
}

export interface YouTubeCredentialsInput { clientId: string; clientSecret: string }

export interface SchedulePostInput {
  renderId: string
  scheduledAt?: string | null
  privacyStatus?: PrivacyStatus
  titleOverride?: string
  descOverride?: string
}

export interface UploadProgress {
  renderId: string
  percent: number
  stage: 'UPLOADING' | 'DONE' | 'ERROR'
  message: string
}

export interface ContentFactoryAPI {
  app: { health(): Promise<AppHealth>; openStorageFolder(): Promise<void>; copyText(text: string): Promise<void>; openExternal(url: string): Promise<void> }
  projects: {
    list(): Promise<ProjectDTO[]>
    create(input: CreateProjectInput): Promise<ProjectDTO>
    remove(id: string): Promise<void>
  }
  ideas: {
    list(projectId: string): Promise<IdeaDTO[]>
    generate(input: GenerateIdeasInput): Promise<IdeaDTO[]>
    select(ideaId: string): Promise<IdeaDTO>
  }
  scripts: {
    list(projectId: string): Promise<ScriptDTO[]>
    generateStory(input: GenerateStoryInput): Promise<ScriptDTO>
    importStory(input: ImportStoryInput): Promise<ScriptDTO>
    review(scriptId: string): Promise<ScriptDTO>
    rewrite(input: RewriteScriptInput): Promise<ScriptDTO>
    update(input: UpdateScriptInput): Promise<ScriptDTO>
    remove(scriptId: string): Promise<void>
    approve(scriptId: string): Promise<ScriptDTO>
    generateReels(input: GenerateReelsInput): Promise<ScriptDTO[]>
  }
  crawler: {
    crawl(input: CrawlStoryInput): Promise<CrawlStoryResult>
    onProgress(callback: (progress: CrawlProgress) => void): () => void
  }
  voices: {
    list(search?: string): Promise<VoiceDTO[]>
    preview(input: PreviewVoiceInput): Promise<VoicePreviewResult>
    select(input: SelectVoiceInput): Promise<ProjectDTO>
  }
  storyMedia: {
    get(projectId: string): Promise<StoryMediaDTO>
    generateThumbnail(input: GenerateThumbnailInput): Promise<StoryMediaDTO>
    generateReelVideos(input: GenerateReelVideosInput): Promise<StoryMediaDTO>
    onReelVideoProgress(callback: (progress: ReelVideoProgress) => void): () => void
    onStoryVideoProgress(callback: (progress: StoryVideoProgress) => void): () => void
    resumePending(): Promise<StoryMediaDTO | null>
    generateAudio(input: GenerateStoryAudioInput): Promise<StoryMediaDTO>
    chooseBackground(projectId: string, kind?: BackgroundKind): Promise<StoryMediaDTO | null>
    render(input: RenderStoryVideoInput): Promise<StoryMediaDTO>
    generateMetadata(input: GeneratePublishMetadataInput): Promise<StoryMediaDTO>
    openOutput(projectId: string): Promise<void>
  }
  settings: {
    getAI(): Promise<AISettingsDTO>
    saveAI(input: SaveAISettingsInput): Promise<AISettingsDTO>
    testAI(provider?: AIProviderName): Promise<AIConnectionResult>
    getVoice(): Promise<VoiceSettingsDTO>
    saveVoice(input: SaveVoiceSettingsInput): Promise<VoiceSettingsDTO>
  }
  pipeline: { generateDemo(projectId: string): Promise<{ jobId: string }> }
  scheduler: {
    list(): Promise<ScheduledPostDTO[]>
    schedule(input: SchedulePostInput): Promise<ScheduledPostDTO>
    cancel(id: string): Promise<ScheduledPostDTO>
    uploadNow(renderId: string): Promise<ScheduledPostDTO>
    onUploadProgress(callback: (progress: UploadProgress) => void): () => void
    onPostUpdated(callback: (post: ScheduledPostDTO) => void): () => void
  }
  youtube: {
    saveCredentials(input: YouTubeCredentialsInput): Promise<void>
    beginAuth(): Promise<YouTubeAuthStatus>
    getStatus(): Promise<YouTubeAuthStatus>
    revoke(): Promise<void>
  }
}

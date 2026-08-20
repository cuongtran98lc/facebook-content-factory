import { contextBridge, ipcRenderer } from 'electron';
import type { ContentFactoryAPI, CrawlProgress, ReelVideoProgress, StoryVideoProgress } from '../shared/types';

const api: ContentFactoryAPI = {
  app: {
    health: () => ipcRenderer.invoke('app:health'),
    openStorageFolder: () => ipcRenderer.invoke('app:open-storage'),
    copyText: text => ipcRenderer.invoke('app:copy-text', text),
    openExternal: url => ipcRenderer.invoke('app:open-external', url),
    revealFile: path => ipcRenderer.invoke('app:reveal-file', path),
  },
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    create: input => ipcRenderer.invoke('projects:create', input),
    remove: id => ipcRenderer.invoke('projects:remove', id),
  },
  ideas: {
    list: projectId => ipcRenderer.invoke('ideas:list', projectId),
    generate: input => ipcRenderer.invoke('ideas:generate', input),
    select: ideaId => ipcRenderer.invoke('ideas:select', ideaId),
    assignPillar: (ideaId, pillarId) => ipcRenderer.invoke('ideas:assign-pillar', ideaId, pillarId),
  },
  pillars: {
    list: () => ipcRenderer.invoke('pillars:list'),
    getNextInRotation: () => ipcRenderer.invoke('pillars:get-next-in-rotation'),
    create: input => ipcRenderer.invoke('pillars:create', input),
    update: (id, input) => ipcRenderer.invoke('pillars:update', id, input),
    remove: id => ipcRenderer.invoke('pillars:remove', id),
  },
  series: {
    list: () => ipcRenderer.invoke('series:list'),
    listEpisodes: seriesId => ipcRenderer.invoke('series:list-episodes', seriesId),
    continueAsEpisode: prevIdeaId => ipcRenderer.invoke('series:continue-as-episode', prevIdeaId),
  },
  metrics: {
    list: days => ipcRenderer.invoke('metrics:list', days),
    upsert: input => ipcRenderer.invoke('metrics:upsert', input),
  },
  renderQueue: {
    enqueue: input => ipcRenderer.invoke('render-queue:enqueue', input),
    list: () => ipcRenderer.invoke('render-queue:list'),
    cancel: jobId => ipcRenderer.invoke('render-queue:cancel', jobId),
    onProgress: callback => {
      const listener = (_event: Electron.IpcRendererEvent, progress: unknown) =>
        callback(progress as Parameters<typeof callback>[0]);
      ipcRenderer.on('render-queue:progress', listener);
      return () => ipcRenderer.removeListener('render-queue:progress', listener);
    },
    onUpdated: callback => {
      const listener = () => callback();
      ipcRenderer.on('render-queue:updated', listener);
      return () => ipcRenderer.removeListener('render-queue:updated', listener);
    },
  },
  scripts: {
    list: projectId => ipcRenderer.invoke('scripts:list', projectId),
    generateStory: input => ipcRenderer.invoke('scripts:generate-story', input),
    importStory: input => ipcRenderer.invoke('scripts:import-story', input),
    review: scriptId => ipcRenderer.invoke('scripts:review', scriptId),
    rewrite: input => ipcRenderer.invoke('scripts:rewrite', input),
    update: input => ipcRenderer.invoke('scripts:update', input),
    remove: scriptId => ipcRenderer.invoke('scripts:remove', scriptId),
    approve: scriptId => ipcRenderer.invoke('scripts:approve', scriptId),
    generateReels: input => ipcRenderer.invoke('scripts:generate-reels', input),
  },
  crawler: {
    crawl: input => ipcRenderer.invoke('crawler:crawl', input),
    onProgress: callback => {
      const listener = (_event: Electron.IpcRendererEvent, progress: CrawlProgress) => callback(progress);
      ipcRenderer.on('crawler:progress', listener);
      return () => ipcRenderer.removeListener('crawler:progress', listener);
    },
  },
  voices: {
    list: search => ipcRenderer.invoke('voices:list', search),
    preview: input => ipcRenderer.invoke('voices:preview', input),
    select: input => ipcRenderer.invoke('voices:select', input),
  },
  storyMedia: {
    get: projectId => ipcRenderer.invoke('story-media:get', projectId),
    generateThumbnail: input => ipcRenderer.invoke('story-media:generate-thumbnail', input),
    generateReelVideos: input => ipcRenderer.invoke('story-media:generate-reel-videos', input),
    onReelVideoProgress: callback => {
      const listener = (_event: Electron.IpcRendererEvent, progress: ReelVideoProgress) => callback(progress);
      ipcRenderer.on('story-media:reel-progress', listener);
      return () => ipcRenderer.removeListener('story-media:reel-progress', listener);
    },
    onStoryVideoProgress: callback => {
      const listener = (_event: Electron.IpcRendererEvent, progress: StoryVideoProgress) => callback(progress);
      ipcRenderer.on('story-media:story-progress', listener);
      return () => ipcRenderer.removeListener('story-media:story-progress', listener);
    },
    resumePending: () => ipcRenderer.invoke('story-media:resume-pending'),
    generateAudio: input => ipcRenderer.invoke('story-media:generate-audio', input),
    chooseBackground: (projectId, kind) => ipcRenderer.invoke('story-media:choose-background', projectId, kind),
    render: input => ipcRenderer.invoke('story-media:render', input),
    generateMetadata: input => ipcRenderer.invoke('story-media:generate-metadata', input),
    openOutput: projectId => ipcRenderer.invoke('story-media:open-output', projectId),
  },
  settings: {
    getAI: () => ipcRenderer.invoke('settings:ai:get'),
    saveAI: input => ipcRenderer.invoke('settings:ai:save', input),
    testAI: provider => ipcRenderer.invoke('settings:ai:test', provider),
    getVoice: () => ipcRenderer.invoke('settings:voice:get'),
    saveVoice: input => ipcRenderer.invoke('settings:voice:save', input),
  },
  pipeline: {
    generateDemo: projectId => ipcRenderer.invoke('pipeline:demo', projectId),
  },
  scheduler: {
    list: platform => ipcRenderer.invoke('scheduler:list', platform),
    schedule: input => ipcRenderer.invoke('scheduler:schedule', input),
    cancel: id => ipcRenderer.invoke('scheduler:cancel', id),
    uploadNow: renderId => ipcRenderer.invoke('scheduler:upload-now', renderId),
    markManualPosted: (renderId, platform) => ipcRenderer.invoke('scheduler:mark-manual-posted', renderId, platform),
    markManualPending: (renderId, platform) => ipcRenderer.invoke('scheduler:mark-manual-pending', renderId, platform),
    onUploadProgress: callback => {
      const listener = (_event: Electron.IpcRendererEvent, progress: unknown) =>
        callback(progress as Parameters<typeof callback>[0]);
      ipcRenderer.on('scheduler:upload-progress', listener);
      return () => ipcRenderer.removeListener('scheduler:upload-progress', listener);
    },
    onPostUpdated: callback => {
      const listener = (_event: Electron.IpcRendererEvent, post: unknown) =>
        callback(post as Parameters<typeof callback>[0]);
      ipcRenderer.on('scheduler:post-updated', listener);
      return () => ipcRenderer.removeListener('scheduler:post-updated', listener);
    },
  },
  youtube: {
    saveCredentials: input => ipcRenderer.invoke('youtube:save-credentials', input),
    beginAuth: () => ipcRenderer.invoke('youtube:begin-auth'),
    getStatus: () => ipcRenderer.invoke('youtube:status'),
    revoke: () => ipcRenderer.invoke('youtube:revoke'),
  },
};

contextBridge.exposeInMainWorld('contentFactory', api);

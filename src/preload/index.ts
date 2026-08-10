import { contextBridge, ipcRenderer } from 'electron'
import type { ContentFactoryAPI } from '../shared/types'

const api: ContentFactoryAPI = {
  app: {
    health: () => ipcRenderer.invoke('app:health'),
    openStorageFolder: () => ipcRenderer.invoke('app:open-storage')
  },
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    create: (input) => ipcRenderer.invoke('projects:create', input),
    remove: (id) => ipcRenderer.invoke('projects:remove', id)
  },
  ideas: {
    list: (projectId) => ipcRenderer.invoke('ideas:list', projectId),
    generate: (input) => ipcRenderer.invoke('ideas:generate', input),
    select: (ideaId) => ipcRenderer.invoke('ideas:select', ideaId)
  },
  scripts: {
    list: (projectId) => ipcRenderer.invoke('scripts:list', projectId),
    generateStory: (input) => ipcRenderer.invoke('scripts:generate-story', input),
    review: (scriptId) => ipcRenderer.invoke('scripts:review', scriptId),
    rewrite: (input) => ipcRenderer.invoke('scripts:rewrite', input),
    update: (input) => ipcRenderer.invoke('scripts:update', input),
    approve: (scriptId) => ipcRenderer.invoke('scripts:approve', scriptId),
    generateReels: (input) => ipcRenderer.invoke('scripts:generate-reels', input)
  },
  voices: {
    list: (search) => ipcRenderer.invoke('voices:list', search),
    preview: (input) => ipcRenderer.invoke('voices:preview', input),
    select: (input) => ipcRenderer.invoke('voices:select', input)
  },
  storyMedia: {
    get: (projectId) => ipcRenderer.invoke('story-media:get', projectId),
    generateAudio: (input) => ipcRenderer.invoke('story-media:generate-audio', input),
    chooseBackground: (projectId) => ipcRenderer.invoke('story-media:choose-background', projectId),
    render: (input) => ipcRenderer.invoke('story-media:render', input),
    openOutput: (projectId) => ipcRenderer.invoke('story-media:open-output', projectId)
  },
  settings: {
    getAI: () => ipcRenderer.invoke('settings:ai:get'),
    saveAI: (input) => ipcRenderer.invoke('settings:ai:save', input),
    testAI: (provider) => ipcRenderer.invoke('settings:ai:test', provider),
    getVoice: () => ipcRenderer.invoke('settings:voice:get'),
    saveVoice: (input) => ipcRenderer.invoke('settings:voice:save', input)
  },
  pipeline: {
    generateDemo: (projectId) => ipcRenderer.invoke('pipeline:demo', projectId)
  }
}

contextBridge.exposeInMainWorld('contentFactory', api)

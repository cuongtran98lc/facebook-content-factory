import { dialog, ipcMain, shell } from 'electron'
import type { AIProviderName, GenerateIdeasInput, GenerateReelsInput, GenerateStoryAudioInput, GenerateStoryInput, PreviewVoiceInput, RenderStoryVideoInput, RewriteScriptInput, SaveAISettingsInput, SaveVoiceSettingsInput, SelectVoiceInput, UpdateScriptInput } from '../../shared/types'
import { AIService } from '../services/ai'
import { getPrisma } from '../services/database'
import { hasFfmpeg } from '../services/ffmpeg'
import { IdeaService } from '../services/ideas'
import { getStorageRoot } from '../services/paths'
import { PipelineService } from '../services/pipeline'
import { ProjectService } from '../services/projects'
import { SettingsService } from '../services/settings'
import { ScriptService } from '../services/scripts'
import { VoiceService } from '../services/voices'
import { StoryMediaService } from '../services/story-media'
import { ProjectStorageService } from '../services/storage'

const projects = new ProjectService()
const pipeline = new PipelineService()
const ideas = new IdeaService()
const settings = new SettingsService()
const ai = new AIService(settings)
const scripts = new ScriptService(ai)
const voices = new VoiceService(settings)
const storyMedia = new StoryMediaService(voices)
const storage = new ProjectStorageService()

export function registerIpcHandlers(): void {
  ipcMain.handle('app:health', async () => {
    let database = false
    try {
      await getPrisma().$queryRawUnsafe('SELECT 1')
      database = true
    } catch {
      database = false
    }
    return { database, storagePath: getStorageRoot(), ffmpeg: await hasFfmpeg() }
  })

  ipcMain.handle('app:open-storage', async () => {
    await shell.openPath(getStorageRoot())
  })

  ipcMain.handle('projects:list', () => projects.list())
  ipcMain.handle('projects:create', (_event, input) => projects.create(input))
  ipcMain.handle('projects:remove', (_event, id: string) => projects.remove(id))

  ipcMain.handle('ideas:list', (_event, projectId: string) => ideas.list(projectId))
  ipcMain.handle('ideas:generate', (_event, input: GenerateIdeasInput) => ideas.generate(input))
  ipcMain.handle('ideas:select', (_event, ideaId: string) => ideas.select(ideaId))

  ipcMain.handle('scripts:list', (_event, projectId: string) => scripts.list(projectId))
  ipcMain.handle('scripts:generate-story', (_event, input: GenerateStoryInput) => scripts.generateStory(input))
  ipcMain.handle('scripts:review', (_event, scriptId: string) => scripts.review(scriptId))
  ipcMain.handle('scripts:rewrite', (_event, input: RewriteScriptInput) => scripts.rewrite(input))
  ipcMain.handle('scripts:update', (_event, input: UpdateScriptInput) => scripts.update(input))
  ipcMain.handle('scripts:approve', (_event, scriptId: string) => scripts.approve(scriptId))
  ipcMain.handle('scripts:generate-reels', (_event, input: GenerateReelsInput) => scripts.generateReels(input))

  ipcMain.handle('voices:list', (_event, search?: string) => voices.list(search))
  ipcMain.handle('voices:preview', (_event, input: PreviewVoiceInput) => voices.preview(input))
  ipcMain.handle('voices:select', (_event, input: SelectVoiceInput) => voices.select(input))

  ipcMain.handle('story-media:get', (_event, projectId: string) => storyMedia.get(projectId))
  ipcMain.handle('story-media:generate-audio', (_event, input: GenerateStoryAudioInput) => storyMedia.generateStoryAudio(input.projectId, input.scriptId))
  ipcMain.handle('story-media:choose-background', async (_event, projectId: string) => {
    const result = await dialog.showOpenDialog({
      title: 'Chọn background video',
      properties: ['openFile'],
      filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    return storyMedia.setBackground(projectId, result.filePaths[0])
  })
  ipcMain.handle('story-media:render', (_event, input: RenderStoryVideoInput) => storyMedia.render(input.projectId, input.format, input.fitMode))
  ipcMain.handle('story-media:open-output', async (_event, projectId: string) => {
    await storage.ensureProject(projectId)
    await shell.openPath(storage.getProjectPath(projectId, 'videos'))
  })

  ipcMain.handle('settings:ai:get', () => settings.getAI())
  ipcMain.handle('settings:voice:get', () => settings.getVoice())
  ipcMain.handle('settings:voice:save', (_event, input: SaveVoiceSettingsInput) => settings.saveVoice(input))
  ipcMain.handle('settings:ai:save', (_event, input: SaveAISettingsInput) => settings.saveAI(input))
  ipcMain.handle('settings:ai:test', async (_event, provider?: AIProviderName) => {
    try {
      return await ai.test(provider)
    } catch (error) {
      return {
        ok: false,
        provider: provider ?? settings.getProvider(),
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  ipcMain.handle('pipeline:demo', (_event, projectId: string) => pipeline.generateDemo(projectId))
}

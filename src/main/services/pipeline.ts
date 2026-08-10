import { getPrisma } from './database'
import { ProjectStorageService } from './storage'

const storage = new ProjectStorageService()

export class PipelineService {
  async generateDemo(projectId: string): Promise<{ jobId: string }> {
    const prisma = getPrisma()
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } })
    const job = await prisma.job.create({
      data: { type: 'DEMO_PIPELINE', projectId, status: 'RUNNING', progress: 10 }
    })

    try {
      const script = [
        `# ${project.name}`,
        '',
        `Topic: ${project.topic ?? 'Chưa có topic'}`,
        `Niche: ${project.niche ?? 'general'}`,
        '',
        'Đây là script demo local. Module AI thật sẽ thay nội dung này ở bước tiếp theo.'
      ].join('\n')

      const path = await storage.writeText(projectId, 'scripts/demo-story.md', script)
      await prisma.script.create({
        data: { type: 'LONG_STORY', content: script, projectId, version: 1 }
      })
      await prisma.asset.create({
        data: { type: 'SCRIPT_FILE', path, projectId }
      })
      await prisma.job.update({ where: { id: job.id }, data: { status: 'DONE', progress: 100 } })
      await prisma.project.update({ where: { id: projectId }, data: { status: 'SCRIPT_READY' } })
      return { jobId: job.id }
    } catch (error) {
      await prisma.job.update({
        where: { id: job.id },
        data: { status: 'FAILED', error: error instanceof Error ? error.message : String(error) }
      })
      throw error
    }
  }
}

import type { CreateProjectInput, ProjectDTO } from '../../shared/types'
import { getPrisma } from './database'
import { ProjectStorageService } from './storage'

const storage = new ProjectStorageService()

type ProjectRow = {
  id: string; name: string; niche: string | null; topic: string | null; status: string
  voiceId: string | null; voiceName: string | null; createdAt: Date; updatedAt: Date
}

export function projectToDTO(project: ProjectRow): ProjectDTO {
  return { ...project, createdAt: project.createdAt.toISOString(), updatedAt: project.updatedAt.toISOString() }
}

export class ProjectService {
  async list(): Promise<ProjectDTO[]> {
    return (await getPrisma().project.findMany({ orderBy: { updatedAt: 'desc' } })).map(projectToDTO)
  }

  async create(input: CreateProjectInput): Promise<ProjectDTO> {
    const project = await getPrisma().project.create({
      data: { name: input.name.trim(), niche: input.niche?.trim() || null, topic: input.topic?.trim() || null }
    })
    await storage.ensureProject(project.id)
    return projectToDTO(project)
  }

  async remove(id: string): Promise<void> { await getPrisma().project.delete({ where: { id } }) }
}

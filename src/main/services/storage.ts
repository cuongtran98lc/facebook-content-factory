import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { getStorageRoot } from './paths'

export class ProjectStorageService {
  async ensureProject(projectId: string): Promise<string> {
    const root = join(getStorageRoot(), projectId)
    await Promise.all([
      mkdir(join(root, 'scripts'), { recursive: true }),
      mkdir(join(root, 'audio'), { recursive: true }),
      mkdir(join(root, 'audio', '.parts'), { recursive: true }),
      mkdir(join(root, 'background'), { recursive: true }),
      mkdir(join(root, 'images'), { recursive: true }),
      mkdir(join(root, 'subtitles'), { recursive: true }),
      mkdir(join(root, 'videos'), { recursive: true })
    ])
    return root
  }

  async writeText(projectId: string, relativePath: string, content: string): Promise<string> {
    const root = await this.ensureProject(projectId)
    const output = join(root, relativePath)
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, content, 'utf8')
    return output
  }

  async writeBuffer(projectId: string, relativePath: string, content: Buffer): Promise<string> {
    const root = await this.ensureProject(projectId)
    const output = join(root, relativePath)
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, content)
    return output
  }

  async copyBackgroundVideo(projectId: string, sourcePath: string): Promise<string> {
    const root = await this.ensureProject(projectId)
    const extension = extname(sourcePath).toLowerCase() || '.mp4'
    const output = join(root, 'background', `background${extension}`)
    await copyFile(sourcePath, output)
    return output
  }

  getProjectPath(projectId: string, ...segments: string[]): string {
    return join(getStorageRoot(), projectId, ...segments)
  }
}

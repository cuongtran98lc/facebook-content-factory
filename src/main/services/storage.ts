import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { getPrisma } from './database'
import { getOutputRoot, getStorageRoot } from './paths'

function slugifyStoryName(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, match => match === 'Đ' ? 'D' : 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '')
  return slug || 'story'
}

function safeChildPath(root: string, segments: string[]): string {
  const output = resolve(root, ...segments)
  const child = relative(resolve(root), output)
  if (child === '..' || child.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(child)) {
    throw new Error('Đường dẫn output không hợp lệ.')
  }
  return output
}

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

  async copyBackgroundMedia(projectId: string, sourcePath: string): Promise<string> {
    const root = await this.ensureProject(projectId)
    const extension = extname(sourcePath).toLowerCase() || '.mp4'
    const output = join(root, 'background', `background${extension}`)
    await copyFile(sourcePath, output)
    return output
  }

  getProjectPath(projectId: string, ...segments: string[]): string {
    return join(getStorageRoot(), projectId, ...segments)
  }

  async ensureOutputProject(projectId: string): Promise<string> {
    const project = await getPrisma().project.findUniqueOrThrow({
      where: { id: projectId },
      select: { id: true, name: true }
    })
    const shortId = project.id.replace(/[^a-z0-9]/gi, '').slice(-8) || 'project'
    const root = safeChildPath(getOutputRoot(), [`${slugifyStoryName(project.name)}--${shortId}`])
    await Promise.all([
      mkdir(join(root, 'audio'), { recursive: true }),
      mkdir(join(root, 'images'), { recursive: true }),
      mkdir(join(root, 'videos'), { recursive: true })
    ])
    return root
  }

  async getOutputPath(projectId: string, ...segments: string[]): Promise<string> {
    const root = await this.ensureOutputProject(projectId)
    const output = safeChildPath(root, segments)
    await mkdir(dirname(output), { recursive: true })
    return output
  }

  async writeOutputBuffer(projectId: string, relativePath: string, content: Buffer): Promise<string> {
    const output = await this.getOutputPath(projectId, relativePath)
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, content)
    return output
  }

  async copyToOutput(projectId: string, relativePath: string, sourcePath: string): Promise<string> {
    const output = await this.getOutputPath(projectId, relativePath)
    const source = resolve(sourcePath)
    if (source === resolve(output)) return output
    await mkdir(dirname(output), { recursive: true })
    await copyFile(source, output)
    return output
  }
}

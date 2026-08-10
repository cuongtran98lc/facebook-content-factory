import { PrismaClient } from '@prisma/client'
import { getDatabasePath } from './paths'

let prisma: PrismaClient | null = null

export function getPrisma(): PrismaClient {
  if (!prisma) {
    const dbPath = getDatabasePath().replace(/\\/g, '/')
    process.env.DATABASE_URL = `file:${dbPath}`
    prisma = new PrismaClient()
  }
  return prisma
}

export async function closePrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect()
    prisma = null
  }
}

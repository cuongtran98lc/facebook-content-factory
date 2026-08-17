# Phase 01 — Database Schema

## Files to Modify
- `prisma/schema.prisma` — add ScheduledPost model

## New Model: ScheduledPost

```prisma
model ScheduledPost {
  id             String   @id @default(cuid())
  renderId       String   @unique
  render         Render   @relation(fields: [renderId], references: [id], onDelete: Cascade)
  platform       String   @default("YOUTUBE")   // YOUTUBE only for now
  status         String   @default("PENDING")   // PENDING | UPLOADING | DONE | FAILED | CANCELLED
  scheduledAt    DateTime?
  uploadedAt     DateTime?
  youtubeVideoId String?
  youtubeUrl     String?
  privacyStatus  String   @default("PRIVATE")   // PUBLIC | PRIVATE | UNLISTED
  titleOverride  String?
  descOverride   String?
  error          String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}
```

Also add `scheduledPosts ScheduledPost[]` to `Render` model.

## Migration Command
```bash
npx prisma migrate dev --name add_scheduled_post
```

## Todo
- [ ] Add ScheduledPost model to schema.prisma
- [ ] Add relation to Render model
- [ ] Run migration
- [ ] Verify Prisma client regenerated

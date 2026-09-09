export const studioDraftKey = (projectId: string | null) => `content-factory:studio:v1:${projectId === null ? 'unassigned' : `project:${projectId}`}`;

export function readStudioDraft(storage: Pick<Storage, 'getItem'>, key: string): Record<string, unknown> {
  const raw = storage.getItem(key);
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  if (parsed?.version !== 1 || !parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
    throw new Error('Bản nháp Studio không đúng định dạng. Dữ liệu lưu cũ vẫn được giữ.');
  }
  const data = { ...parsed.data };
  for (const field of ['ideas', 'hooks', 'beats', 'scenes']) {
    if (data[field] !== undefined && (!Array.isArray(data[field]) || data[field].some((item: unknown) => !item || typeof item !== 'object'))) {
      throw new Error(`Dữ liệu ${field} trong bản nháp không hợp lệ.`);
    }
  }
  if (data.step !== undefined && !['ideas', 'hooks', 'script', 'scenes', 'assets', 'package'].includes(data.step)) {
    throw new Error('Bước làm việc trong bản nháp không hợp lệ.');
  }
  // A saved running state cannot prove that its old IPC request is still alive.
  if (data.workProgress && typeof data.workProgress === 'object') {
    data.workProgress = Object.fromEntries(Object.entries(data.workProgress).map(([id, value]) => {
      const progress = value as { status?: string; percent?: number } | null;
      return [id, progress?.status === 'running' ? { ...progress, status: 'interrupted' } : progress];
    }));
  }
  return data;
}

export function writeStudioDraft(storage: Pick<Storage, 'setItem'>, key: string, data: Record<string, unknown>): void {
  storage.setItem(key, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), data }));
}

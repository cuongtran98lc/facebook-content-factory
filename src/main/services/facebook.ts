import { statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import type { SettingsService } from './settings';

export class FacebookService {
 constructor(private readonly settings: SettingsService) {}

 async uploadVideo(params: {
  videoPath: string;
  title: string;
  description: string;
 }): Promise<{ videoId: string; url: string }> {
  const { pageId, accessToken } = this.settings.getFacebookCredentials();
  if (!pageId || !accessToken) {
   throw new Error('Chưa cấu hình Facebook Page ID hoặc Page Access Token.');
  }

  const fileSize = statSync(params.videoPath).size;

  // 1. Start phase: Khởi tạo session upload
  let startRes: Response;
  try {
   startRes = await fetch(`https://graph.facebook.com/v20.0/${pageId}/videos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
     upload_phase: 'start',
     file_size: fileSize,
     access_token: accessToken,
    }),
   });
  } catch (e) {
   console.error('[Facebook Upload Start Failed]:', e);
   throw new Error(
    `Kết nối đến Facebook thất bại ở bước khởi tạo (Start Phase): ${e instanceof Error ? e.message : String(e)}. Vui lòng kiểm tra mạng hoặc bật VPN.`,
   );
  }

  const startResText = await startRes.text();
  let startData: { upload_session_id?: string; video_id?: string; error?: { message: string } } = {};
  try {
   startData = JSON.parse(startResText);
  } catch {
   throw new Error(`Facebook API Start phase non-JSON (HTTP ${startRes.status}): ${startResText.slice(0, 300)}`);
  }
  if (!startRes.ok || startData.error || !startData.upload_session_id) {
   throw new Error(startData.error?.message || `Facebook API Start phase error: HTTP ${startRes.status}`);
  }

  const sessionId = startData.upload_session_id;

  // 2. Transfer phase: Tải lên từng chunk (mỗi chunk 10MB)
  const chunkSize = 10 * 1024 * 1024; // 10MB
  const fileHandle = await open(params.videoPath, 'r');
  let startOffset = 0;
  try {
   while (startOffset < fileSize) {
    const currentChunkSize = Math.min(chunkSize, fileSize - startOffset);
    const buffer = Buffer.alloc(currentChunkSize);
    await fileHandle.read(buffer, 0, currentChunkSize, startOffset);

    const blob = new Blob([buffer], { type: 'video/mp4' });
    const formData = new FormData();
    formData.append('upload_phase', 'transfer');
    formData.append('upload_session_id', sessionId);
    formData.append('start_offset', startOffset.toString());
    formData.append('video_file_chunk', blob, 'video_chunk.mp4');
    formData.append('access_token', accessToken);

    let transferRes: Response;
    try {
     transferRes = await fetch(`https://graph.facebook.com/v20.0/${pageId}/videos`, {
      method: 'POST',
      body: formData,
     });
    } catch (e) {
     console.error('[Facebook Upload Transfer Failed]:', e);
     throw new Error(
      `Kết nối đến Facebook thất bại ở bước tải lên chunk (Transfer Phase): ${e instanceof Error ? e.message : String(e)}. Vui lòng kiểm tra mạng hoặc bật VPN.`,
     );
    }

    const transferResText = await transferRes.text();
    let transferData: { error?: { message: string } } = {};
    try {
     transferData = JSON.parse(transferResText);
    } catch {
     throw new Error(
      `Facebook API Transfer phase non-JSON (HTTP ${transferRes.status}): ${transferResText.slice(0, 300)}`,
     );
    }
    if (!transferRes.ok || transferData.error) {
     throw new Error(transferData.error?.message || `Facebook API Transfer phase error: HTTP ${transferRes.status}`);
    }

    startOffset += currentChunkSize;
   }
  } finally {
   await fileHandle.close();
  }

  // 3. Finish phase: Hoàn thành upload và xuất bản video
  let finishRes: Response;
  try {
   finishRes = await fetch(`https://graph.facebook.com/v20.0/${pageId}/videos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
     upload_phase: 'finish',
     upload_session_id: sessionId,
     title: params.title,
     description: params.description,
     access_token: accessToken,
    }),
   });
  } catch (e) {
   console.error('[Facebook Upload Finish Failed]:', e);
   throw new Error(
    `Kết nối đến Facebook thất bại ở bước xuất bản (Finish Phase): ${e instanceof Error ? e.message : String(e)}. Vui lòng kiểm tra mạng hoặc bật VPN.`,
   );
  }

  const finishResText = await finishRes.text();
  let finishData: { success?: boolean; error?: { message: string } } = {};
  try {
   finishData = JSON.parse(finishResText);
  } catch {
   throw new Error(`Facebook API Finish phase non-JSON (HTTP ${finishRes.status}): ${finishResText.slice(0, 300)}`);
  }
  if (!finishRes.ok || finishData.error) {
   throw new Error(finishData.error?.message || `Facebook API Finish phase error: HTTP ${finishRes.status}`);
  }

  return {
   videoId: startData.video_id || '',
   url: `https://www.facebook.com/watch/?v=${startData.video_id || ''}`,
  };
 }

 async fetchPages(userAccessToken: string): Promise<{ id: string; name: string; accessToken: string }[]> {
  // Kiểm tra các quyền đã cấp cho token
  try {
   const permRes = await fetch(`https://graph.facebook.com/v20.0/me/permissions?access_token=${userAccessToken}`);
   const permText = await permRes.text();
   const permData = JSON.parse(permText) as { data?: Array<{ permission: string; status: string }> };
   if (permRes.ok && permData.data) {
    const granted = new Set(permData.data.filter(p => p.status === 'granted').map(p => p.permission));
    const required = ['pages_show_list', 'pages_manage_posts'];
    const missing = required.filter(p => !granted.has(p));
    if (missing.length > 0) {
     throw new Error(
      `Token của bạn thiếu các quyền bắt buộc: ${missing.join(', ')}. Vui lòng tích chọn các quyền này trên Graph API Explorer và tạo lại token.`,
     );
    }
   }
  } catch (e) {
   if (e instanceof Error && e.message.includes('thiếu các quyền bắt buộc')) {
    throw e;
   }
   console.warn('[Facebook Permission Check Fetch Failed]:', e);
   // Bỏ qua các lỗi mạng/phân tích khác để tiếp tục luồng chính
  }

  let res: Response;
  try {
   res = await fetch(`https://graph.facebook.com/v20.0/me/accounts?access_token=${userAccessToken}`);
  } catch (e) {
   console.error('[Facebook Accounts Fetch Failed]:', e);
   if (e && typeof e === 'object' && 'cause' in e) {
    console.error('[Facebook Accounts Fetch Failed Cause]:', e.cause);
   }
   throw new Error(
    `Không thể kết nối đến Facebook (fetch failed). Vui lòng kiểm tra lại kết nối Internet hoặc bật VPN (nếu nhà mạng chặn graph.facebook.com). Chi tiết: ${e instanceof Error ? e.message : String(e)}`,
   );
  }

  const text = await res.text();
  let data: { data?: Array<{ id: string; name: string; access_token: string }>; error?: { message: string } } = {};
  try {
   data = JSON.parse(text);
  } catch {
   throw new Error(`Facebook API response is not valid JSON (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }

  if (!res.ok || data.error) {
   throw new Error(data.error?.message || `Facebook API error: HTTP ${res.status}`);
  }

  if (!data.data) {
   return [];
  }

  return data.data.map(p => ({
   id: p.id,
   name: p.name,
   accessToken: p.access_token,
  }));
 }
}

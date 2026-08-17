import type { StoryMediaDTO } from '../../../shared/types'

type Props = {
  busy: boolean
  media: StoryMediaDTO | null
  prompt: string
  onPromptChange(value: string): void
  onGenerate(): void
}

export function ThumbnailGenerator({ busy, media, prompt, onPromptChange, onGenerate }: Props) {
  return <div className="thumbnail-card">
    <div className="media-flow-title">
      <div>
        <strong>Generate Thumbnail Truyện</strong>
        <span>AI đọc story và tạo ảnh ngang 16:9 · 1280×720.</span>
      </div>
      {media?.thumbnailProvider && <span className="thumbnail-provider">{media.thumbnailProvider}</span>}
    </div>
    <label className="thumbnail-direction">
      Mô tả thêm cho ảnh (không bắt buộc)
      <textarea rows={2} value={prompt} onChange={(event) => onPromptChange(event.target.value)} placeholder="Ví dụ: người mẹ đứng trước căn nhà cũ, ánh sáng điện ảnh, tông xanh lạnh..." />
    </label>
    <button className="primary full thumbnail-button" onClick={onGenerate} disabled={busy}>
      {busy ? 'Đang xử lý...' : media?.thumbnailPath ? 'Generate lại Thumbnail' : 'Generate Thumbnail'}
    </button>
    {media?.thumbnailUrl && <div className="thumbnail-result">
      <img src={media.thumbnailUrl} alt="Thumbnail của truyện" />
      <span>Đã lưu tại images/thumbnail.png trong project.</span>
    </div>}
  </div>
}

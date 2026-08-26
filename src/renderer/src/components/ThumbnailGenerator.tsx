import { useState, useEffect } from 'react'
import type { StoryMediaDTO } from '../../../shared/types'

type Props = {
  busy: boolean
  media: StoryMediaDTO | null
  prompt: string
  onPromptChange(value: string): void
  onGenerate(): void
  onExtractFromVideo(videoPath: string, timeSeconds: number): void
}

export function ThumbnailGenerator({
  busy,
  media,
  prompt,
  onPromptChange,
  onGenerate,
  onExtractFromVideo,
}: Props) {
  const [mode, setMode] = useState<'ai' | 'video'>('ai')

  // Determine default video source
  const hasBgVideo = !!(media?.backgroundPath && media?.backgroundKind === 'VIDEO')
  const hasRenderedVideo = !!media?.renderPath

  const [videoSource, setVideoSource] = useState<'background' | 'rendered' | 'custom'>('background')
  const [customVideoPath, setCustomVideoPath] = useState<string>('')
  const [timeSeconds, setTimeSeconds] = useState<number>(0)

  // Sync default video source when media updates
  useEffect(() => {
    if (hasBgVideo) {
      setVideoSource('background')
    } else if (hasRenderedVideo) {
      setVideoSource('rendered')
    } else {
      setVideoSource('custom')
    }
  }, [hasBgVideo, hasRenderedVideo])

  async function handleSelectCustomVideo() {
    try {
      const path = await window.contentFactory.storyMedia.chooseVideoFile()
      if (path) {
        setCustomVideoPath(path)
        setVideoSource('custom')
      }
    } catch (error) {
      console.error(error)
    }
  }

  function handleExtract() {
    let path = ''
    if (videoSource === 'background' && hasBgVideo) {
      path = media!.backgroundPath!
    } else if (videoSource === 'rendered' && hasRenderedVideo) {
      path = media!.renderPath!
    } else if (videoSource === 'custom') {
      path = customVideoPath
    }

    if (!path) {
      alert('Vui lòng chọn video trước khi trích xuất!')
      return
    }

    onExtractFromVideo(path, timeSeconds)
  }

  const getSourceFilename = (filePath: string) => {
    if (!filePath) return ''
    return filePath.split(/[/\\]/).pop() || filePath
  }

  return (
    <div className="thumbnail-card">
      <div className="media-flow-title">
        <div>
          <strong>Tạo Thumbnail Truyện</strong>
          <span>Chọn phương thức tạo ảnh ngang 16:9 · 1280×720.</span>
        </div>
        {media?.thumbnailProvider && <span className="thumbnail-provider">{media.thumbnailProvider}</span>}
      </div>

      <div className="thumbnail-tabs">
        <button
          type="button"
          className={mode === 'ai' ? 'active' : ''}
          onClick={() => setMode('ai')}
        >
          Dùng AI Tạo Ảnh
        </button>
        <button
          type="button"
          className={mode === 'video' ? 'active' : ''}
          onClick={() => setMode('video')}
        >
          Trích xuất từ Video
        </button>
      </div>

      {mode === 'ai' ? (
        <div className="thumbnail-ai-section">
          <label className="thumbnail-direction">
            Mô tả thêm cho ảnh (không bắt buộc)
            <textarea
              rows={2}
              value={prompt}
              onChange={(event) => onPromptChange(event.target.value)}
              placeholder="Ví dụ: người mẹ đứng trước căn nhà cũ, ánh sáng điện ảnh, tông xanh lạnh..."
            />
          </label>
          <button
            type="button"
            className="primary full thumbnail-button"
            onClick={onGenerate}
            disabled={busy}
          >
            {busy ? 'Đang xử lý...' : media?.thumbnailPath ? 'Generate lại Thumbnail bằng AI' : 'Generate Thumbnail bằng AI'}
          </button>
        </div>
      ) : (
        <div className="thumbnail-video-extractor">
          <div className="video-sources">
            {hasBgVideo && (
              <label className="video-source-option">
                <input
                  type="radio"
                  name="videoSource"
                  checked={videoSource === 'background'}
                  onChange={() => setVideoSource('background')}
                />
                <span>Background Video ({getSourceFilename(media!.backgroundPath!)})</span>
              </label>
            )}

            {hasRenderedVideo && (
              <label className="video-source-option">
                <input
                  type="radio"
                  name="videoSource"
                  checked={videoSource === 'rendered'}
                  onChange={() => setVideoSource('rendered')}
                />
                <span>Video Story đã render ({getSourceFilename(media!.renderPath!)})</span>
              </label>
            )}

            <label className="video-source-option">
              <input
                type="radio"
                name="videoSource"
                checked={videoSource === 'custom'}
                onChange={() => setVideoSource('custom')}
                disabled={!customVideoPath}
              />
              <span>
                Chọn video khác từ máy tính: {customVideoPath ? getSourceFilename(customVideoPath) : 'Chưa chọn'}
              </span>
            </label>
          </div>

          <button
            type="button"
            className="secondary custom-file-button"
            onClick={handleSelectCustomVideo}
            disabled={busy}
          >
            {customVideoPath ? 'Đổi video khác...' : 'Chọn video từ máy...'}
          </button>

          <label className="time-input-row">
            Thời điểm trích xuất (giây):
            <input
              type="number"
              min={0}
              step={0.1}
              value={timeSeconds}
              onChange={(e) => setTimeSeconds(Math.max(0, parseFloat(e.target.value) || 0))}
              disabled={busy}
            />
          </label>

          <button
            type="button"
            className="primary full thumbnail-button"
            onClick={handleExtract}
            disabled={busy || (videoSource === 'custom' && !customVideoPath)}
          >
            {busy ? 'Đang trích xuất...' : 'Trích xuất Thumbnail từ Video'}
          </button>
        </div>
      )}

      {media?.thumbnailUrl && (
        <div className="thumbnail-result">
          <img src={media.thumbnailUrl} alt="Thumbnail của truyện" />
          <span>Đã lưu tại images/thumbnail.png trong project.</span>
        </div>
      )}
    </div>
  )
}

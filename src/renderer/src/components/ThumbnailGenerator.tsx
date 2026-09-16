import { THUMBNAIL_CONCEPTS, type ThumbnailConcept } from '../../../shared/thumbnail-concepts'
import { useState, useEffect } from 'react'
import type { StoryMediaDTO } from '../../../shared/types'

type Props = {
  busy: boolean
  media: StoryMediaDTO | null
  prompt: string
  title: string
  onPromptChange(value: string): void
  onGenerate(title: string, concept: ThumbnailConcept, engine?: 'AI' | 'BUILTIN_2D'): void
  onExtractFromVideo(videoPath: string, timeSeconds: number): void
}

export function ThumbnailGenerator({
  busy,
  media,
  prompt,
  title,
  onPromptChange,
  onGenerate,
  onExtractFromVideo,
}: Props) {
  const [mode, setMode] = useState<'ai' | 'video'>('ai')
  const [engine, setEngine] = useState<'AI' | 'BUILTIN_2D'>('AI')
  const [concept, setConcept] = useState<ThumbnailConcept>(media?.thumbnailConcept ?? 'PROBLEM_STATE')
  useEffect(() => { if (media?.thumbnailConcept) setConcept(media.thumbnailConcept) }, [media?.thumbnailConcept])
  const [imageTitle, setImageTitle] = useState(title)
  useEffect(() => { setImageTitle(title) }, [title])

  // Determine default video source
  const hasBgVideo = !!(media?.backgroundPath && media?.backgroundKind === 'VIDEO')
  const hasRenderedVideo = !!media?.renderPath

  const [videoSource, setVideoSource] = useState<'background' | 'rendered' | 'custom'>('background')
  const [customVideoPath, setCustomVideoPath] = useState<string>('')
  const [timeSeconds, setTimeSeconds] = useState<number>(0)

  // Sync default video source when media updates
  useEffect(() => {
    if (media?.thumbnailProvider === 'video' && media.thumbnailSourceVideoPath) {
      setCustomVideoPath(media.thumbnailSourceVideoPath)
      setVideoSource(
        media.thumbnailSourceVideoPath === media.backgroundPath
          ? 'background'
          : media.thumbnailSourceVideoPath === media.renderPath
            ? 'rendered'
            : 'custom'
      )
      setTimeSeconds(media.thumbnailSourceTimeSeconds ?? 0)
      return
    }
    if (hasBgVideo) {
      setVideoSource('background')
    } else if (hasRenderedVideo) {
      setVideoSource('rendered')
    } else {
      setVideoSource('custom')
    }
  }, [hasBgVideo, hasRenderedVideo, media?.backgroundPath, media?.renderPath, media?.thumbnailProvider, media?.thumbnailSourceTimeSeconds, media?.thumbnailSourceVideoPath])

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

      <label className="thumbnail-title-box">
        <strong>Title · What if…?</strong>
        <textarea rows={2} value={imageTitle} disabled={busy} onChange={event => setImageTitle(event.target.value)} placeholder="What if…?" />
        <span>Nhân vật phóng lớn, biểu cảm và bối cảnh theo title này.</span>
      </label>

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
          <div className="thumbnail-style-badge" style={{ padding: '8px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '12px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '16px' }}>🎨</span>
            <span><strong>Phong cách: Google Flow 2D Stickman</strong> · Nét vẽ vector 2D tối giản, đầu tròn trắng viền đen, biểu cảm kịch tính, nền sáng tương phản cao.</span>
          </div>

          <label className="thumbnail-direction">
            Phương thức tạo ảnh
            <select value={engine} disabled={busy} onChange={e => setEngine(e.target.value as 'AI' | 'BUILTIN_2D')}>
              <option value="AI">Google Flow AI (Gemini / DALL-E 3)</option>
              <option value="BUILTIN_2D">Google Flow 2D Comic Art (Concept Art · Chuẩn 1280×720)</option>
            </select>
            <span>{engine === 'AI' ? 'Dùng AI vẽ ảnh minh họa người que 2D phong cách Google Flow.' : 'Dùng kho tranh vẽ 2D Google Flow Comic Art sắc nét chuẩn kích thước 1280×720.'}</span>
          </label>

          <label className="thumbnail-direction">
            Concept nhân vật
            <select value={concept} disabled={busy} onChange={event => setConcept(event.target.value as ThumbnailConcept)}>
              {Object.entries(THUMBNAIL_CONCEPTS).map(([key, value], index) => <option key={key} value={key}>Concept {index + 1}: {value.label}</option>)}
            </select>
            <span>{THUMBNAIL_CONCEPTS[concept].description}</span>
          </label>
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
            onClick={() => onGenerate(imageTitle.trim(), concept, engine)}
            disabled={busy || !imageTitle.trim()}
          >
            {busy ? 'Đang xử lý...' : media?.thumbnailPath ? `Generate lại Thumbnail (${engine === 'AI' ? 'Google Flow AI' : '2D Vector'})` : `Generate Thumbnail (${engine === 'AI' ? 'Google Flow AI' : '2D Vector'})`}
          </button>
        </div>
      ) : (
        <div className="thumbnail-video-extractor">
          <p>Trích nguyên khung hình video, giữ cả phụ đề và kích thước nhân vật. Để tạo nhân vật lớn theo title, chọn “Dùng AI Tạo Ảnh”.</p>
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
            {busy ? 'Đang trích xuất...' : media?.thumbnailProvider === 'video' ? 'Trích xuất lại Thumbnail theo thiết lập trước' : 'Trích xuất Thumbnail từ Video'}
          </button>
        </div>
      )}

      {media?.thumbnailUrl && (
        <div className="thumbnail-result">
          <img src={media.thumbnailUrl} alt="Thumbnail của truyện" />
          {media.thumbnailTitle && <strong>{media.thumbnailTitle}</strong>}
          <span>Đã lưu tại images/thumbnail.png trong project.</span>
        </div>
      )}
    </div>
  )
}

import type { FitMode, StoryMediaDTO, VideoFormat } from '../../../shared/types'

type Props = {
  busy: boolean
  ffmpegReady: boolean
  hasVoice: boolean
  media: StoryMediaDTO | null
  videoFormat: VideoFormat
  fitMode: FitMode
  onGenerateAudio(): void
  onChooseBackground(): void
  onRender(): void
  onOpenOutput(): void
  onVideoFormatChange(value: VideoFormat): void
  onFitModeChange(value: FitMode): void
}

function formatDuration(seconds?: number | null): string {
  if (!seconds || !Number.isFinite(seconds)) return '--:--'
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

export function StoryMediaFlow(props: Props) {
  const audioDone = Boolean(props.media?.audioPath)
  const backgroundDone = Boolean(props.media?.backgroundPath)
  const renderDone = Boolean(props.media?.renderPath && props.media?.renderStatus === 'DONE')
  const canGenerateAudio = props.hasVoice && props.ffmpegReady
  const canChooseBackground = audioDone
  const canRender = audioDone && backgroundDone && props.ffmpegReady

  const audioHint = !props.hasVoice
    ? 'Chọn voice trước để tạo MP3.'
    : !props.ffmpegReady
      ? 'Cần FFmpeg để ghép các đoạn MP3.'
      : audioDone ? 'MP3 đã sẵn sàng; có thể tạo lại từ story hiện tại.' : 'Sẵn sàng tạo MP3 từ story hiện tại.'
  const videoHint = audioDone
    ? (props.media?.backgroundName ?? 'Chọn một video nền từ máy.')
    : 'Hoàn tất Story MP3 trước.'

  return <div className="story-media-box">
    <div className="media-flow-title">
      <div><strong>Full Story MP3 + Loop Video</strong><span>Story hiện tại → MP3 → video nền → video hoàn chỉnh.</span></div>
      <div className="media-flow-progress">
        <span className={audioDone ? 'done' : 'active'}>1</span>
        <i />
        <span className={backgroundDone ? 'done' : audioDone ? 'active' : ''}>2</span>
        <i />
        <span className={renderDone ? 'done' : backgroundDone ? 'active' : ''}>3</span>
      </div>
    </div>

    <div className="media-step">
      <div><b>1</b><div><strong>Story MP3</strong><span>{audioHint}</span></div></div>
      <button className="secondary" onClick={props.onGenerateAudio} disabled={props.busy || !canGenerateAudio}>
        {audioDone ? 'Regenerate Story MP3' : 'Generate Story MP3'}
      </button>
    </div>
    {props.media?.audioUrl && <div className="media-preview compact"><audio className="voice-player" src={props.media.audioUrl} controls /><span>Duration: {formatDuration(props.media.audioDuration)}</span></div>}

    <div className="media-step">
      <div><b>2</b><div><strong>Background video</strong><span>{videoHint}</span></div></div>
      <button className="secondary" onClick={props.onChooseBackground} disabled={props.busy || !canChooseBackground}>
        {backgroundDone ? 'Change Video' : 'Select Video'}
      </button>
    </div>
    {props.media?.backgroundUrl && <div className="media-preview"><video src={props.media.backgroundUrl} controls muted /><span>Duration: {formatDuration(props.media.backgroundDuration)}</span></div>}

    <div className="media-step render-step">
      <div><b>3</b><div><strong>Story video</strong><span>{!props.ffmpegReady ? 'Cần FFmpeg để render.' : !backgroundDone ? 'Chọn background video trước.' : 'Chọn khung hình và cách fit.'}</span></div></div>
    </div>
    <div className="render-options">
      <label>Output<select value={props.videoFormat} onChange={(event) => props.onVideoFormatChange(event.target.value as VideoFormat)}><option value="LANDSCAPE">16:9 · 1920x1080</option><option value="REEL">9:16 · 1080x1920</option><option value="SQUARE">1:1 · 1080x1080</option></select></label>
      <label>Fit<select value={props.fitMode} onChange={(event) => props.onFitModeChange(event.target.value as FitMode)}><option value="CROP">Fill / Crop</option><option value="FIT">Fit / Pad</option></select></label>
      <button className="primary" onClick={props.onRender} disabled={props.busy || !canRender}>{renderDone ? 'Regenerate Story Video' : 'Generate Story Video'}</button>
    </div>
    {props.media?.renderUrl && <div className="render-result"><strong>Rendered Story Video</strong><video src={props.media.renderUrl} controls /><div className="button-row"><button className="secondary" onClick={props.onOpenOutput}>Open Output Folder</button></div></div>}
  </div>
}

import type { BackgroundKind, FitMode, ReelVideoProgress, SoundEffectOptions, SoundEffectPreset, StoryMediaDTO, VideoFormat } from '../../../shared/types'

type Props = {
  busy: boolean
  ffmpegReady: boolean
  hasVoice: boolean
  media: StoryMediaDTO | null
  videoFormat: VideoFormat
  fitMode: FitMode
  soundEffect: SoundEffectOptions
  reelProgress: ReelVideoProgress | null
  onGenerateAudio(): void
  onGenerateReelVideos(): void
  onChooseBackground(kind: BackgroundKind): void
  onRender(): void
  onVideoFormatChange(value: VideoFormat): void
  onFitModeChange(value: FitMode): void
  onSoundEffectChange(value: SoundEffectOptions): void
}

function formatDuration(seconds?: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '--:--'
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

const SOUND_EFFECT_LABELS: Record<SoundEffectPreset, string> = {
  DYNAMIC: 'Dynamic · tự đổi theo tập',
  WHOOSH: 'Whoosh · chuyển cảnh',
  IMPACT: 'Impact · nhấn kịch tính',
  CHIME: 'Chime · điểm nhấn'
}

export function StoryMediaFlow(props: Props) {
  const audioDone = Boolean(props.media?.audioPath)
  const backgroundDone = Boolean(props.media?.backgroundPath)
  const storyVideoParts = props.media?.storyVideoParts?.length
    ? props.media.storyVideoParts
    : props.media?.renderUrl ? [{ part: 1, totalParts: 1, startSeconds: 0, duration: null, path: props.media.renderPath, url: props.media.renderUrl, status: props.media.renderStatus }] : []
  const renderDone = Boolean(storyVideoParts.length && storyVideoParts.every(part => part.status === 'DONE'))
  const canGenerateAudio = props.hasVoice && props.ffmpegReady
  const canChooseBackground = audioDone
  const canRender = audioDone && backgroundDone && props.ffmpegReady
  const hasReelVideos = Boolean(props.media?.reels.some(reel => reel.videoUrl))

  const audioHint = !props.hasVoice
    ? 'Chọn voice trước để tạo MP3.'
    : !props.ffmpegReady
      ? 'Cần FFmpeg để ghép các đoạn MP3.'
      : audioDone ? 'MP3 đã sẵn sàng; có thể tạo lại từ story hiện tại.' : 'Sẵn sàng tạo MP3 từ story hiện tại.'
  const videoHint = audioDone
    ? (props.media?.backgroundName ?? 'Chọn video hoặc ảnh nền từ máy.')
    : 'Hoàn tất Story MP3 trước.'

  return <div className="story-media-box">
    <div className="media-flow-title">
      <div><strong>Full Story MP3 + Loop Video</strong><span>Story → MP3 → video nền → tự trộn dynamic sound effect → video hoàn chỉnh.</span></div>
      <div className="media-flow-progress">
        <span className={audioDone ? 'done' : 'active'}>1</span>
        <i />
        <span className={backgroundDone ? 'done' : audioDone ? 'active' : ''}>2</span>
        <i />
        <span className={backgroundDone ? 'done' : ''}>3</span>
        <i />
        <span className={renderDone ? 'done' : backgroundDone ? 'active' : ''}>4</span>
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
      <div><b>2</b><div><strong>Background video / ảnh</strong><span>{videoHint}</span></div></div>
      <div className="background-actions"><button className="secondary" onClick={()=>props.onChooseBackground('VIDEO')} disabled={props.busy || !canChooseBackground}>{backgroundDone && props.media?.backgroundKind === 'VIDEO' ? 'Đổi Video' : 'Chọn Video'}</button><button className="secondary" onClick={()=>props.onChooseBackground('IMAGE')} disabled={props.busy || !canChooseBackground}>{backgroundDone && props.media?.backgroundKind === 'IMAGE' ? 'Đổi Ảnh' : 'Chọn Ảnh'}</button></div>
    </div>
    {props.media?.backgroundUrl && <div className="media-preview">{props.media.backgroundKind === 'IMAGE' ? <img src={props.media.backgroundUrl} alt="Background" /> : <video src={props.media.backgroundUrl} controls muted />}<span>{props.media.backgroundKind === 'IMAGE' ? 'Ảnh tĩnh · tự kéo dài theo voice' : `Duration: ${formatDuration(props.media.backgroundDuration)}`}</span></div>}

    <div className="media-step sound-effect-step">
      <div><b>3</b><div><strong>Sound effect cho mỗi video</strong><span>SFX chỉ được trộn vào MP4 cuối; MP3 voice gốc không bị thay đổi.</span></div></div>
      <span className="sfx-required">LUÔN BẬT</span>
    </div>
    <div className="sound-effect-controls">
      <label>Kiểu SFX<select value={props.soundEffect.preset} disabled={props.busy} onChange={(event)=>props.onSoundEffectChange({ ...props.soundEffect, preset: event.target.value as SoundEffectPreset })}><option value="DYNAMIC">Dynamic · tự đổi theo tập</option><option value="WHOOSH">Whoosh · chuyển cảnh</option><option value="IMPACT">Impact · nhấn kịch tính</option><option value="CHIME">Chime · điểm nhấn</option></select></label>
      <label className="sfx-volume">Mức SFX<div><input type="range" min={10} max={100} step={5} value={props.soundEffect.volume} disabled={props.busy} onChange={(event)=>props.onSoundEffectChange({ ...props.soundEffect, volume: Number(event.target.value) })} /><output>{props.soundEffect.volume}%</output></div></label>
    </div>
    <div className="sfx-note"><strong>{SOUND_EFFECT_LABELS[props.soundEffect.preset]} · {props.soundEffect.volume}%</strong><span>Dynamic luân phiên Whoosh / Impact / Chime và thay đổi vị trí theo từng tập. Video cũ cần bấm Regenerate để có SFX mới.</span></div>

    <div className="media-step render-step">
      <div><b>4</b><div><strong>{props.videoFormat === 'REEL' ? 'Render các Short 9:16 + SFX' : 'Render Story video + SFX'}</strong><span>{!props.ffmpegReady ? 'Cần FFmpeg để render.' : !backgroundDone ? 'Chọn video hoặc ảnh background trước.' : props.videoFormat === 'REEL' ? `Tự chia liên tục thành các phần cân bằng, tối đa 3:00/phần; mỗi Short có ${SOUND_EFFECT_LABELS[props.soundEffect.preset]}.` : `Sẽ trộn ${SOUND_EFFECT_LABELS[props.soundEffect.preset]} ở mức ${props.soundEffect.volume}%, có ducking để không lấn giọng.`}</span></div></div>
    </div>
    <div className="render-options">
      <label>Output<select value={props.videoFormat} onChange={(event) => props.onVideoFormatChange(event.target.value as VideoFormat)}><option value="LANDSCAPE">16:9 · 1920x1080 · 1 video</option><option value="REEL">9:16 · tự chia Short ≈2:30–3:00</option><option value="SQUARE">1:1 · 1080x1080 · 1 video</option></select></label>
      <label>Fit<select value={props.fitMode} onChange={(event) => props.onFitModeChange(event.target.value as FitMode)}><option value="CROP">Fill / Crop</option><option value="FIT">Fit / Pad</option></select></label>
      <button className="primary" onClick={props.onRender} disabled={props.busy || !canRender}>{props.videoFormat === 'REEL' ? `${renderDone ? 'Regenerate' : 'Generate'} Short Videos + SFX` : `${renderDone ? 'Regenerate' : 'Generate'} Story Video + SFX`}</button>
    </div>
    {!!storyVideoParts.length && <div className="render-result"><div className="story-video-result-head"><strong>{storyVideoParts.length > 1 ? `${storyVideoParts.length} Short Videos 9:16` : 'Rendered Story Video'}</strong></div>{storyVideoParts.length > 1 ? <div className="story-short-grid">{storyVideoParts.map(part=><article key={part.part}><div><strong>SHORT {part.part}/{part.totalParts}</strong><span>{formatDuration(part.duration)} · bắt đầu {formatDuration(part.startSeconds)}</span></div>{part.url ? <video src={part.url} controls preload="metadata" /> : <div className="short-unavailable">{part.status ?? 'Đang chờ'}</div>}</article>)}</div> : storyVideoParts[0]?.url && <video src={storyVideoParts[0].url} controls />}</div>}
    <div className="reel-render-section">
      <div className="media-flow-title"><div><strong>Final · Reel Videos theo từng tập</strong><span>{props.media?.reels.length ? `${props.media.reels.length} video dọc + thumbnail số tập + 1 SFX riêng/video · ${SOUND_EFFECT_LABELS[props.soundEffect.preset]} ${props.soundEffect.volume}%.` : 'Generate Reel scripts trước.'}</span></div></div>
      <button className="primary full" onClick={props.onGenerateReelVideos} disabled={props.busy || !props.ffmpegReady || !props.hasVoice || !props.media?.backgroundPath || !props.media?.thumbnailPath || !props.media?.reels.length}>{hasReelVideos ? 'Regenerate' : 'Generate'} {props.media?.reels.length ?? 0} Reel Videos + SFX</button>
      {props.reelProgress && <div className={`reel-progress ${props.reelProgress.stage === 'DONE' ? 'done' : ''}`}>
        <div><strong>{props.reelProgress.percent}%</strong><span>{props.reelProgress.message}</span></div>
        <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={props.reelProgress.percent}><i style={{ width: `${props.reelProgress.percent}%` }} /></div>
      </div>}
      {!!props.media?.reels.some(reel => reel.videoUrl) && <div className="reel-output-grid">{props.media.reels.map(reel => reel.videoUrl && <article key={reel.reelId}><div><strong>TẬP {reel.episode}</strong><span>{reel.title}</span></div>{reel.thumbnailUrl && <img src={reel.thumbnailUrl} alt={`Thumbnail tập ${reel.episode}`} />}<video src={reel.videoUrl} controls /></article>)}</div>}
    </div>
  </div>
}

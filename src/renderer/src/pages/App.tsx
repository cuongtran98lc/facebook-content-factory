import { FormEvent, useEffect, useMemo, useState } from 'react';
import type {
  AIProviderName,
  AISettingsDTO,
  AppHealth,
  BackgroundKind,
  CrawlProgress,
  FitMode,
  IdeaDTO,
  ProjectDTO,
  ReelVideoProgress,
  ScriptDTO,
  SoundEffectOptions,
  StoryMediaDTO,
  StoryVideoProgress,
  VideoFormat,
  VoiceDTO,
  VoiceSettingsDTO,
} from '../../../shared/types';
import { SchedulerView } from '../components/SchedulerView';
import { StoryMediaFlow } from '../components/StoryMediaFlow';
import { ThumbnailGenerator } from '../components/ThumbnailGenerator';

type View = 'dashboard' | 'ideas' | 'scripts' | 'scheduler' | 'settings';

const DEFAULT_SETTINGS: AISettingsDTO = {
  provider: 'gemini',
  openaiModel: 'gpt-5.4-mini',
  geminiModel: 'gemini-2.5-flash',
  hasOpenAIKey: false,
  hasGeminiKey: false,
};

const DEFAULT_VOICE_SETTINGS: VoiceSettingsDTO = { elevenLabsModel: 'eleven_multilingual_v2', hasElevenLabsKey: false };

function reviewSummary(script?: ScriptDTO): string {
  if (!script?.review) return '';
  try {
    const parsed = JSON.parse(script.review) as { summary?: string };
    return parsed.summary ?? script.review;
  } catch {
    return script.review;
  }
}

function rewriteInstruction(script?: ScriptDTO): string {
  if (!script?.review) return '';
  try {
    const parsed = JSON.parse(script.review) as { rewriteInstruction?: string };
    return parsed.rewriteInstruction ?? '';
  } catch {
    return '';
  }
}

export default function App() {
  const [view, setView] = useState<View>('dashboard');
  const [projects, setProjects] = useState<ProjectDTO[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ideas, setIdeas] = useState<IdeaDTO[]>([]);
  const [scripts, setScripts] = useState<ScriptDTO[]>([]);
  const [activeScriptId, setActiveScriptId] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState('');
  const [health, setHealth] = useState<AppHealth | null>(null);
  const [name, setName] = useState('Story 001');
  const [topic, setTopic] = useState('Mẹ chia tài sản cho 3 người con');
  const [niche, setNiche] = useState('family');
  const [ideaCount, setIdeaCount] = useState(10);
  const [targetWords, setTargetWords] = useState(2200);
  const [importTitle, setImportTitle] = useState('');
  const [importContent, setImportContent] = useState('');
  const [storyUrl, setStoryUrl] = useState('');
  const [crawlEpisodeLimit, setCrawlEpisodeLimit] = useState(100);
  const [crawlProgress, setCrawlProgress] = useState<CrawlProgress | null>(null);
  const [crawlGenerating, setCrawlGenerating] = useState(false);
  const [reelCount, setReelCount] = useState(5);
  const [rewriteNote, setRewriteNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [settings, setSettings] = useState<AISettingsDTO>(DEFAULT_SETTINGS);
  const [openaiKey, setOpenaiKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [clearOpenAIKey, setClearOpenAIKey] = useState(false);
  const [clearGeminiKey, setClearGeminiKey] = useState(false);
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettingsDTO>(DEFAULT_VOICE_SETTINGS);
  const [elevenLabsKey, setElevenLabsKey] = useState('');
  const [clearElevenLabsKey, setClearElevenLabsKey] = useState(false);
  const [voices, setVoices] = useState<VoiceDTO[]>([]);
  const [voiceId, setVoiceId] = useState('');
  const [voiceTestText, setVoiceTestText] = useState(
    'Ngày hôm đó, tôi trở về căn nhà cũ và không ngờ điều đang chờ mình phía sau cánh cửa.',
  );
  const [voiceAudio, setVoiceAudio] = useState('');
  const [storyMedia, setStoryMedia] = useState<StoryMediaDTO | null>(null);
  const [videoFormat, setVideoFormat] = useState<VideoFormat>('LANDSCAPE');
  const [fitMode, setFitMode] = useState<FitMode>('CROP');
  const [soundEffect, setSoundEffect] = useState<SoundEffectOptions>({ preset: 'DYNAMIC', volume: 70 });
  const [thumbnailPrompt, setThumbnailPrompt] = useState('');
  const [reelProgress, setReelProgress] = useState<ReelVideoProgress | null>(null);
  const [reelGenerating, setReelGenerating] = useState(false);
  const [storyVideoProgress, setStoryVideoProgress] = useState<StoryVideoProgress | null>(null);
  const [storyVideoGenerating, setStoryVideoGenerating] = useState(false);
  const [estimatedProgress, setEstimatedProgress] = useState(0);

  const selected = useMemo(
    () => projects.find(project => project.id === selectedId) ?? projects[0],
    [projects, selectedId],
  );
  const stories = useMemo(
    () => scripts.filter(script => script.type === 'LONG_STORY').sort((a, b) => b.version - a.version),
    [scripts],
  );
  const reels = useMemo(
    () => scripts.filter(script => script.type === 'REEL').sort((a, b) => a.version - b.version),
    [scripts],
  );
  const activeScript = useMemo(() => scripts.find(script => script.id === activeScriptId), [scripts, activeScriptId]);

  async function loadProjectData(projectId: string) {
    const [ideaRows, scriptRows] = await Promise.all([
      window.contentFactory.ideas.list(projectId),
      window.contentFactory.scripts.list(projectId),
    ]);
    setIdeas(ideaRows);
    setScripts(scriptRows);
    setStoryMedia(await window.contentFactory.storyMedia.get(projectId));
    const preferred = scriptRows.filter(item => item.type === 'LONG_STORY').sort((a, b) => b.version - a.version)[0];
    setActiveScriptId(preferred?.id ?? null);
  }

  async function reloadProjects() {
    const list = await window.contentFactory.projects.list();
    setProjects(list);
    if (!selectedId && list[0]) setSelectedId(list[0].id);
    return list;
  }

  async function reloadAll() {
    const [list, appHealth, aiSettings, ttsSettings] = await Promise.all([
      window.contentFactory.projects.list(),
      window.contentFactory.app.health(),
      window.contentFactory.settings.getAI(),
      window.contentFactory.settings.getVoice(),
    ]);
    setProjects(list);
    setHealth(appHealth);
    setSettings(aiSettings);
    setVoiceSettings(ttsSettings);
    const nextId = selectedId ?? list[0]?.id ?? null;
    if (nextId) {
      setSelectedId(nextId);
      await loadProjectData(nextId);
    } else {
      setIdeas([]);
      setScripts([]);
    }
  }

  useEffect(() => {
    void (async () => {
      await reloadAll();
      setReelGenerating(true);
      setBusy(true);
      const resumed = await window.contentFactory.storyMedia.resumePending();
      if (resumed) {
        setStoryMedia(resumed);
        setMessage('✓ Đã tiếp tục và hoàn tất tác vụ Reel bị gián đoạn.');
        await reloadAll();
      }
      setReelGenerating(false);
      setBusy(false);
    })().catch(error => {
      setReelGenerating(false);
      setBusy(false);
      setMessage(error instanceof Error ? error.message : String(error));
    });
  }, []);
  useEffect(() => {
    if (selectedId) void loadProjectData(selectedId);
    else {
      setIdeas([]);
      setScripts([]);
    }
  }, [selectedId]);
  useEffect(() => {
    setEditorContent(activeScript?.content ?? '');
    setRewriteNote(rewriteInstruction(activeScript));
  }, [activeScript?.id]);
  useEffect(() => {
    setVoiceId(selected?.voiceId ?? '');
  }, [selected?.id, selected?.voiceId]);
  useEffect(() => window.contentFactory.storyMedia.onReelVideoProgress(setReelProgress), []);
  useEffect(() => window.contentFactory.storyMedia.onStoryVideoProgress(setStoryVideoProgress), []);
  useEffect(() => window.contentFactory.crawler.onProgress(setCrawlProgress), []);
  useEffect(() => {
    if (view !== 'scripts' || health?.ttsProvider !== 'capcut') return;
    let active = true;
    const refresh = async () => {
      try {
        const rows = await window.contentFactory.voices.list();
        if (!active) return;
        setVoices(rows);
        setVoiceId(current =>
          current && rows.some(voice => voice.id === current)
            ? current
            : selected?.voiceId && rows.some(voice => voice.id === selected.voiceId)
              ? selected.voiceId
              : (rows[0]?.id ?? ''),
        );
      } catch {
        // Keep the last successful catalog; explicit Load voices still reports errors.
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [view, health?.ttsProvider, selected?.id, selected?.voiceId]);
  useEffect(() => {
    if (!busy || reelGenerating || storyVideoGenerating) {
      if (!busy) setEstimatedProgress(0);
      return;
    }
    setEstimatedProgress(4);
    const timer = window.setInterval(
      () =>
        setEstimatedProgress(value => {
          if (value >= 92) return 92;
          if (value < 45) return Math.min(92, value + 4);
          if (value < 72) return Math.min(92, value + 2);
          return Math.min(92, value + 1);
        }),
      700,
    );
    return () => window.clearInterval(timer);
  }, [busy, reelGenerating, storyVideoGenerating]);

  async function createProject(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const created = await window.contentFactory.projects.create({ name, topic, niche });
      setSelectedId(created.id);
      await reloadProjects();
      setIdeas([]);
      setScripts([]);
      setMessage('Đã tạo project local.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function generateIdeas() {
    if (!selected) return;
    setBusy(true);
    setMessage(`Đang tạo ${ideaCount} idea bằng ${settings.provider}...`);
    try {
      const rows = await window.contentFactory.ideas.generate({ projectId: selected.id, count: ideaCount });
      setIdeas(rows);
      await reloadProjects();
      setView('ideas');
      setMessage(`Đã tạo ${rows.length} idea.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function selectIdea(id: string) {
    if (!selected) return;
    setBusy(true);
    try {
      const chosen = await window.contentFactory.ideas.select(id);
      await loadProjectData(selected.id);
      await reloadProjects();
      setActiveScriptId(null);
      setView('scripts');
      setMessage(`Đã chọn idea “${chosen.title}”. Hãy bấm Generate Story mới.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function generateStory() {
    if (!selected) return;
    setBusy(true);
    setMessage('Đang Generate Story...');
    try {
      const row = await window.contentFactory.scripts.generateStory({ projectId: selected.id, targetWords });
      await loadProjectData(selected.id);
      await reloadProjects();
      setActiveScriptId(row.id);
      setView('scripts');
      setMessage(`Đã tạo LONG_STORY v${row.version}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function importStory() {
    if (!selected) return;
    if (importContent.trim().length < 20) return setMessage('Hãy dán truyện hoặc chọn file .txt có ít nhất 20 ký tự.');
    setBusy(true);
    setMessage('Đang thêm truyện TXT thành một version mới...');
    try {
      const row = await window.contentFactory.scripts.importStory({
        projectId: selected.id,
        title: importTitle.trim() || undefined,
        content: importContent,
      });
      await loadProjectData(selected.id);
      await reloadProjects();
      setActiveScriptId(row.id);
      setImportTitle('');
      setImportContent('');
      setMessage(
        `✓ Đã nhập truyện thành LONG_STORY v${row.version}. Chọn voice rồi có thể generate MP3/Reels/Video như bình thường.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function crawlStory() {
    if (!selected) return;
    if (!/^https?:\/\//i.test(storyUrl.trim()))
      return setMessage('Hãy nhập link HTTP/HTTPS của trang chi tiết truyện.');
    setCrawlProgress({
      current: 0,
      total: crawlEpisodeLimit,
      percent: 0,
      stage: 'DISCOVERING',
      message: 'Đang kết nối website...',
    });
    setCrawlGenerating(true);
    setBusy(true);
    setMessage('Đang tìm danh sách chương từ link truyện...');
    try {
      const result = await window.contentFactory.crawler.crawl({
        projectId: selected.id,
        url: storyUrl.trim(),
        maxEpisodes: crawlEpisodeLimit,
      });
      await loadProjectData(selected.id);
      await reloadProjects();
      setActiveScriptId(result.story.id);
      setStoryMedia(await window.contentFactory.storyMedia.get(selected.id));
      setView('scripts');
      setMessage(
        `✓ Đã crawl ${result.episodes.length} tập từ ${new URL(result.sourceUrl).hostname}. Chọn voice, tạo thumbnail rồi Generate ${result.episodes.length} Reel Videos.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setCrawlGenerating(false);
      setBusy(false);
    }
  }

  async function reviewStory() {
    if (!activeScript) return;
    setBusy(true);
    setMessage('AI đang review story...');
    try {
      const row = await window.contentFactory.scripts.review(activeScript.id);
      await loadProjectData(row.projectId);
      setActiveScriptId(row.id);
      setMessage(`Review xong. Score: ${row.score?.toFixed(1) ?? '-'}/10`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveStory() {
    if (!activeScript) return;
    setBusy(true);
    try {
      const row = await window.contentFactory.scripts.update({
        scriptId: activeScript.id,
        title: activeScript.title ?? undefined,
        content: editorContent,
      });
      await loadProjectData(row.projectId);
      setActiveScriptId(row.id);
      setMessage('Đã lưu nội dung script.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function rewriteStory() {
    if (!activeScript) return;
    setBusy(true);
    setMessage('AI đang rewrite thành version mới...');
    try {
      const row = await window.contentFactory.scripts.rewrite({
        scriptId: activeScript.id,
        instruction: rewriteNote || undefined,
      });
      await loadProjectData(row.projectId);
      setActiveScriptId(row.id);
      setMessage(`Đã tạo LONG_STORY v${row.version}. Bản cũ vẫn được giữ lại.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function approveStory() {
    if (!activeScript) return;
    setBusy(true);
    try {
      const row = await window.contentFactory.scripts.approve(activeScript.id);
      await loadProjectData(row.projectId);
      setActiveScriptId(row.id);
      setMessage(`Đã approve LONG_STORY v${row.version}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function generateReels() {
    if (!selected) return;
    setBusy(true);
    setMessage(`Đang generate ${reelCount} Reel scripts...`);
    try {
      const rows = await window.contentFactory.scripts.generateReels({ projectId: selected.id, count: reelCount });
      await loadProjectData(selected.id);
      await reloadProjects();
      setMessage(`Đã tạo ${rows.length} Reel scripts.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function approveAndGenerateReels() {
    if (!selected || !activeScript || activeScript.type !== 'LONG_STORY') return;
    setBusy(true);
    setMessage(`Đang lưu LONG_STORY v${activeScript.version}, approve và generate ${reelCount} Reel scripts...`);
    try {
      const saved = await window.contentFactory.scripts.update({
        scriptId: activeScript.id,
        title: activeScript.title ?? undefined,
        content: editorContent,
      });
      const approved = await window.contentFactory.scripts.approve(saved.id);
      const rows = await window.contentFactory.scripts.generateReels({
        projectId: approved.projectId,
        count: reelCount,
      });
      await loadProjectData(approved.projectId);
      await reloadProjects();
      setActiveScriptId(approved.id);
      setMessage(`✓ LONG_STORY v${approved.version} đã được approve và tạo ${rows.length} Reel scripts.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function loadVoices() {
    setBusy(true);
    setMessage('Đang tải danh sách voice từ ElevenLabs...');
    try {
      const rows = await window.contentFactory.voices.list();
      setVoices(rows);
      if (!voiceId && rows[0]) setVoiceId(rows[0].id);
      setMessage(`Đã tải ${rows.length} voice.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function testVoice() {
    if (!voiceId) return setMessage('Hãy chọn voice trước.');
    setBusy(true);
    setMessage('Đang generate câu test bằng ElevenLabs...');
    setVoiceAudio('');
    try {
      const result = await window.contentFactory.voices.preview({ voiceId, text: voiceTestText });
      setVoiceAudio(result.dataUrl);
      setMessage('✓ Đã tạo voice test. Nghe thử bên dưới rồi chọn Use this voice.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function useVoice() {
    if (!selected || !voiceId) return;
    const voice = voices.find(v => v.id === voiceId);
    if (!voice) return setMessage('Voice chưa được load hoặc không còn trong danh sách.');
    setBusy(true);
    try {
      await window.contentFactory.voices.select({ projectId: selected.id, voiceId: voice.id, voiceName: voice.name });
      await reloadProjects();
      setStoryMedia(await window.contentFactory.storyMedia.get(selected.id));
      setReelProgress(null);
      setMessage(`✓ Đã đổi sang giọng ${voice.name}. MP3 và video của voice cũ đã được làm stale; hãy generate lại.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function generateStoryMp3() {
    if (!selected || !activeScript || activeScript.type !== 'LONG_STORY') return;
    if (!selected.voiceId) return setMessage('Hãy Test voice và chọn Use this voice trước khi tạo Story MP3.');
    if (!health?.ffmpeg) return setMessage('Chưa tìm thấy FFmpeg. Cài FFmpeg rồi khởi động lại app để tạo Story MP3.');
    if (!editorContent.trim()) return setMessage('Story hiện tại đang trống.');
    setBusy(true);
    setMessage('Đang generate full Story MP3. Story dài sẽ tự chia chunk...');
    try {
      const saved = await window.contentFactory.scripts.update({
        scriptId: activeScript.id,
        title: activeScript.title ?? undefined,
        content: editorContent,
      });
      const media = await window.contentFactory.storyMedia.generateAudio({
        projectId: selected.id,
        scriptId: saved.id,
      });
      setStoryMedia(media);
      await reloadProjects();
      setMessage('✓ Bước 1/4 hoàn tất: Story MP3 đã sẵn sàng. Tiếp theo hãy chọn Video hoặc Ảnh background.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function generateThumbnail() {
    if (!selected || !activeScript || activeScript.type !== 'LONG_STORY') return;
    if (!editorContent.trim()) return setMessage('Story hiện tại đang trống.');
    const hasKey = settings.provider === 'openai' ? settings.hasOpenAIKey : settings.hasGeminiKey;
    if (!hasKey) return setMessage(`Chưa có API key cho ${settings.provider}. Vào Settings để thêm key.`);
    setBusy(true);
    setMessage(`Đang tạo thumbnail 16:9 bằng ${settings.provider}...`);
    try {
      const saved = await window.contentFactory.scripts.update({
        scriptId: activeScript.id,
        title: activeScript.title ?? undefined,
        content: editorContent,
      });
      const media = await window.contentFactory.storyMedia.generateThumbnail({
        projectId: selected.id,
        scriptId: saved.id,
        prompt: thumbnailPrompt || undefined,
      });
      setStoryMedia(media);
      setMessage('✓ Thumbnail đã tạo xong và được lưu vào thư mục images của project.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function chooseBackground(kind: BackgroundKind) {
    if (!selected) return;
    if (!storyMedia?.audioPath) return setMessage('Hãy hoàn tất bước 1: Generate Story MP3 trước.');
    setBusy(true);
    setMessage(kind === 'IMAGE' ? 'Đang chọn ảnh background...' : 'Đang chọn background video...');
    try {
      const media = await window.contentFactory.storyMedia.chooseBackground(selected.id, kind);
      if (media) {
        setStoryMedia(media);
        setMessage(
          `✓ Bước 2/4 hoàn tất: ${kind === 'IMAGE' ? 'Ảnh' : 'Video'} background đã sẵn sàng. Chọn SFX rồi Generate Story Video.`,
        );
      } else setMessage(`Đã hủy chọn ${kind === 'IMAGE' ? 'ảnh' : 'video'}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function renderStoryVideo() {
    if (!selected) return;
    if (!health?.ffmpeg) return setMessage('FFmpeg/ffprobe chưa sẵn sàng trên máy.');
    if (!storyMedia?.audioPath) return setMessage('Hãy hoàn tất bước 1: Generate Story MP3 trước.');
    if (!storyMedia.backgroundPath) return setMessage('Hãy hoàn tất bước 2: chọn Video hoặc Ảnh background trước.');
    setStoryVideoProgress({
      current: 0,
      total: 1,
      percent: 0,
      stage: 'STARTING',
      message: videoFormat === 'REEL' ? 'Đang tính số video Short 9:16...' : 'Đang chuẩn bị Story video...',
    });
    setStoryVideoGenerating(true);
    setBusy(true);
    setMessage(
      videoFormat === 'REEL'
        ? 'Đang chia Story thành các Short 9:16 dài tối đa 3 phút...'
        : `Đang trộn ${soundEffect.preset.toLowerCase()} SFX ${soundEffect.volume}% và render video...`,
    );
    try {
      const media = await window.contentFactory.storyMedia.render({
        projectId: selected.id,
        format: videoFormat,
        fitMode,
        soundEffect,
      });
      setStoryMedia(media);
      await reloadProjects();
      const output = media.storyVideoOutputs.find(item => item.format === videoFormat);
      const metadataDone = Boolean(
        output?.parts.length && output.parts.every(part => part.publishTitle && part.publishDescription),
      );
      setMessage(
        metadataDone
          ? videoFormat === 'REEL'
            ? `✓ Đã tạo ${output?.parts.length ?? 0} video Short 9:16, mỗi phần có SFX + title/description riêng.`
            : '✓ Bước 4/4 hoàn tất: Story video đã có SFX + title/description.'
          : '✓ Video đã render xong. Metadata chưa hoàn tất; bấm Generate Titles & Descriptions để thử lại.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setStoryVideoGenerating(false);
      setBusy(false);
    }
  }

  async function generateReelVideos() {
    if (!selected) return;
    const count = storyMedia?.reels.length ?? 0;
    if (!count) return setMessage('Hãy Generate Reel scripts trước.');
    if (!storyMedia?.thumbnailPath)
      return setMessage('Hãy Generate Thumbnail Truyện trước; app sẽ thêm số TẬP cho từng Reel.');
    if (!storyMedia.backgroundPath) return setMessage('Hãy chọn Video hoặc Ảnh background trước.');
    setReelProgress({
      current: 0,
      total: count,
      percent: 0,
      stage: 'STARTING',
      message: `Đang chuẩn bị ${count} tập...`,
    });
    setReelGenerating(true);
    setBusy(true);
    setMessage(`Đang tạo ${count} MP3, thumbnail và Reel videos kèm SFX...`);
    try {
      const media = await window.contentFactory.storyMedia.generateReelVideos({
        projectId: selected.id,
        fitMode,
        soundEffect,
      });
      const renderedReels = media.reels.filter(reel => reel.videoPath);
      const metadataDone = Boolean(
        renderedReels.length && renderedReels.every(reel => reel.publishTitle && reel.publishDescription),
      );
      setStoryMedia(media);
      await reloadProjects();
      setMessage(
        metadataDone
          ? `✓ Đã tạo xong ${count} Reel videos, mỗi video có SFX, thumbnail và title/description riêng.`
          : `✓ Đã tạo xong ${count} Reel videos. Metadata chưa hoàn tất; bấm Generate Titles & Descriptions để thử lại.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setReelGenerating(false);
      setBusy(false);
    }
  }

  async function generateVideoMetadata() {
    if (!selected) return;
    const hasVideo = Boolean(
      storyMedia?.storyVideoOutputs.some(output => output.parts.some(part => part.status === 'DONE')) ||
      storyMedia?.reels.some(reel => reel.status === 'DONE'),
    );
    if (!hasVideo) return setMessage('Chưa có video hoàn chỉnh để tạo title và description.');
    setStoryVideoProgress({
      current: 0,
      total: 1,
      percent: 0,
      stage: 'METADATA',
      message: 'Đang chuẩn bị metadata video...',
    });
    setStoryVideoGenerating(true);
    setBusy(true);
    setMessage('Đang tạo title + description tương ứng cho từng video...');
    try {
      const media = await window.contentFactory.storyMedia.generateMetadata({ projectId: selected.id, scope: 'ALL' });
      setStoryMedia(media);
      setMessage('✓ Đã tạo xong title + description và lưu file metadata cạnh từng video.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setStoryVideoGenerating(false);
      setBusy(false);
    }
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const saved = await window.contentFactory.settings.saveAI({
        provider: settings.provider,
        openaiModel: settings.openaiModel,
        geminiModel: settings.geminiModel,
        openaiApiKey: openaiKey || undefined,
        geminiApiKey: geminiKey || undefined,
        clearOpenAIKey,
        clearGeminiKey,
      });
      setSettings(saved);
      setOpenaiKey('');
      setGeminiKey('');
      setClearOpenAIKey(false);
      setClearGeminiKey(false);
      setMessage('Đã lưu AI Settings.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveVoiceSettings() {
    setBusy(true);
    setMessage('');
    try {
      const saved = await window.contentFactory.settings.saveVoice({
        elevenLabsModel: voiceSettings.elevenLabsModel,
        elevenLabsApiKey: elevenLabsKey || undefined,
        clearElevenLabsKey,
      });
      setVoiceSettings(saved);
      setElevenLabsKey('');
      setClearElevenLabsKey(false);
      setMessage('Đã lưu ElevenLabs settings.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function testAI(provider: AIProviderName) {
    setBusy(true);
    setMessage(`Đang test ${provider}...`);
    try {
      const result = await window.contentFactory.settings.testAI(provider);
      setMessage(`${result.ok ? '✓' : '✕'} ${provider}: ${result.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function removeProject(id: string) {
    await window.contentFactory.projects.remove(id);
    if (selectedId === id) setSelectedId(null);
    await reloadAll();
  }

  async function removeScript(script: ScriptDTO) {
    if (!selected) return;
    const label =
      script.type === 'LONG_STORY' ? `Story v${script.version}` : (script.title ?? `Reel ${script.version}`);
    if (!window.confirm(`Xóa ${label}? Thao tác này không thể hoàn tác.`)) return;
    setBusy(true);
    setMessage(`Đang xóa ${label}...`);
    try {
      await window.contentFactory.scripts.remove(script.id);
      if (activeScriptId === script.id) setActiveScriptId(null);
      await loadProjectData(selected.id);
      await reloadProjects();
      setMessage(`Đã xóa ${label}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const stepsDone =
    selected?.status === 'READY'
      ? 6
      : ['MEDIA_READY', 'RENDERING'].includes(selected?.status ?? '')
        ? 5
        : selected?.status === 'REELS_READY'
          ? 4
          : ['SCRIPT_READY', 'SCRIPT_REVIEW', 'GENERATING_REELS'].includes(selected?.status ?? '')
            ? 3
            : selected?.status === 'IDEAS_READY'
              ? 2
              : 1;
  const isCapCut = health?.ttsProvider === 'capcut';

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <div className="brand">Content Factory</div>
          <div className="brand-sub">Desktop MVP v0.3.3</div>
        </div>
        <nav>
          <button className={`nav ${view === 'dashboard' ? 'active' : ''}`} onClick={() => setView('dashboard')}>
            Dashboard
          </button>
          <button className={`nav ${view === 'ideas' ? 'active' : ''}`} onClick={() => setView('ideas')}>
            Idea Bank
          </button>
          <button className={`nav ${view === 'scripts' ? 'active' : ''}`} onClick={() => setView('scripts')}>
            Scripts
          </button>
          <button className="nav" disabled>
            Media · v0.4
          </button>
          <button className={`nav ${view === 'scheduler' ? 'active' : ''}`} onClick={() => setView('scheduler')}>
            📅 Scheduler
          </button>
          <button className={`nav ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')}>
            Settings
          </button>
        </nav>
        <div className="health">
          <div>
            <span className={health?.database ? 'dot ok' : 'dot'} /> SQLite
          </div>
          <div>
            <span className={health?.ffmpeg ? 'dot ok' : 'dot warn'} /> FFmpeg
          </div>
          <div className="tiny">AI: {settings.provider}</div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>
              {view === 'dashboard'
                ? 'Local Content Factory'
                : view === 'ideas'
                  ? 'Idea Bank'
                  : view === 'scripts'
                    ? 'Story & Reels'
                    : view === 'scheduler'
                      ? '📅 Content Scheduler'
                      : 'Settings'}
            </h1>
            <p>
              {view === 'scripts'
                ? 'Selected Idea → Story → Review → Rewrite/Approve → Reels'
                : 'Local-first Facebook content workflow.'}
            </p>
          </div>
          <div className="topbar-actions">
            {selected && (
              <button className="primary" onClick={() => void window.contentFactory.storyMedia.openOutput(selected.id)}>
                Mở output truyện
              </button>
            )}
            <button className="secondary" onClick={() => void window.contentFactory.app.openStorageFolder()}>
              Mở storage nội bộ
            </button>
          </div>
        </header>
        {message && <div className="banner">{message}</div>}
        {busy && (
          <div className="global-progress-panel" role="status" aria-live="polite">
            <div>
              <strong>
                {crawlGenerating && crawlProgress
                  ? `${crawlProgress.percent}%`
                  : reelGenerating && reelProgress
                    ? `${reelProgress.percent}%`
                    : storyVideoGenerating && storyVideoProgress
                      ? `${storyVideoProgress.percent}%`
                      : `${estimatedProgress}%`}
              </strong>
              <span>
                {crawlGenerating && crawlProgress
                  ? crawlProgress.message
                  : reelGenerating && reelProgress
                    ? reelProgress.message
                    : storyVideoGenerating && storyVideoProgress
                      ? storyVideoProgress.message
                      : `${message || 'Đang xử lý...'} · ước tính`}
              </span>
            </div>
            <div className="global-progress-track">
              <i
                style={{
                  width: `${crawlGenerating && crawlProgress ? crawlProgress.percent : reelGenerating && reelProgress ? reelProgress.percent : storyVideoGenerating && storyVideoProgress ? storyVideoProgress.percent : estimatedProgress}%`,
                }}
              />
            </div>
          </div>
        )}

        {view === 'dashboard' && (
          <>
            <section className="card crawler-first-step">
              <div className="crawler-first-head">
                <span className="workflow-step-number">1</span>
                <div>
                  <h2>Crawl truyện theo từng chương</h2>
                  <p>
                    Dán link truyện; hệ thống sẽ tìm danh sách chương, mở chi tiết từng chương và tạo mỗi chương thành
                    một tập.
                  </p>
                </div>
                <span className="crawler-project-chip">{selected ? selected.name : 'Chưa chọn project'}</span>
              </div>
              {selected ? (
                <>
                  <div className="crawler-first-form">
                    <label className="grow">
                      Link trang danh sách / chi tiết truyện
                      <input
                        type="url"
                        value={storyUrl}
                        onChange={e => setStoryUrl(e.target.value)}
                        placeholder="https://website.com/ten-truyen"
                      />
                    </label>
                    <label>
                      Số chương tối đa
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={crawlEpisodeLimit}
                        onChange={e => setCrawlEpisodeLimit(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
                      />
                    </label>
                    <button
                      className="primary"
                      onClick={() => void crawlStory()}
                      disabled={busy || !/^https?:\/\//i.test(storyUrl.trim())}>
                      Tìm chương & crawl
                    </button>
                  </div>
                  <p className="crawler-note">
                    Trang tổng không được dùng làm tập. Mỗi link chương tạo đúng một script/video tập; xong sẽ tự chuyển
                    sang bước Scripts.
                  </p>
                  {crawlProgress && (
                    <div className={`reel-progress ${crawlProgress.stage === 'DONE' ? 'done' : ''}`}>
                      <div>
                        <strong>{crawlProgress.percent}%</strong>
                        <span>{crawlProgress.message}</span>
                      </div>
                      <div className="progress-track">
                        <i style={{ width: `${crawlProgress.percent}%` }} />
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="empty crawler-empty">Hãy tạo hoặc chọn project bên dưới trước khi crawl.</div>
              )}
            </section>
            <section className="grid">
              <div className="card">
                <h2>Create project</h2>
                <form onSubmit={createProject} className="form">
                  <label>
                    Project name
                    <input value={name} onChange={e => setName(e.target.value)} required />
                  </label>
                  <label>
                    Topic
                    <textarea value={topic} onChange={e => setTopic(e.target.value)} rows={4} />
                  </label>
                  <label>
                    Niche
                    <select value={niche} onChange={e => setNiche(e.target.value)}>
                      <option value="family">Family</option>
                      <option value="life">Life</option>
                      <option value="love">Love</option>
                      <option value="knowledge">Knowledge</option>
                    </select>
                  </label>
                  <button className="primary" disabled={busy}>
                    Create project
                  </button>
                </form>
              </div>
              <div className="card project-card">
                <h2>Current project</h2>
                {selected ? (
                  <>
                    <div className="project-title">{selected.name}</div>
                    <div className="meta">
                      {selected.niche ?? 'general'} · {selected.status}
                    </div>
                    <div className="topic">{selected.topic ?? 'No topic'}</div>
                    <div className="steps">
                      {['Project', 'Crawl / Ideas', 'Story', 'Reels', 'Media', 'Render'].map((step, index) => (
                        <div className="step" key={step}>
                          <span className={index < stepsDone ? 'step-dot done' : 'step-dot'} />
                          {step}
                        </div>
                      ))}
                    </div>
                    <div className="inline-controls">
                      <label>
                        Ideas
                        <input
                          type="number"
                          min={1}
                          max={30}
                          value={ideaCount}
                          onChange={e => setIdeaCount(Number(e.target.value))}
                        />
                      </label>
                      <button className="primary grow" onClick={generateIdeas} disabled={busy}>
                        Generate ideas
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="empty">Chưa có project.</div>
                )}
              </div>
            </section>
            <section className="card list-card">
              <div className="section-title">
                <h2>Projects</h2>
                <span>{projects.length} items</span>
              </div>
              <div className="project-list">
                {projects.map(project => (
                  <button
                    key={project.id}
                    className={`project-row ${selected?.id === project.id ? 'selected' : ''}`}
                    onClick={() => setSelectedId(project.id)}>
                    <div>
                      <strong>{project.name}</strong>
                      <small>{project.topic ?? 'No topic'}</small>
                    </div>
                    <span className="status">{project.status}</span>
                    <span
                      className="delete"
                      onClick={e => {
                        e.stopPropagation();
                        void removeProject(project.id);
                      }}>
                      Delete
                    </span>
                  </button>
                ))}
                {!projects.length && <div className="empty">Create project đầu tiên để bắt đầu.</div>}
              </div>
            </section>
          </>
        )}

        {view === 'ideas' && (
          <section className="card">
            <div className="section-title">
              <div>
                <h2>{selected?.name ?? 'No project'}</h2>
                <span>{ideas.length} ideas</span>
              </div>
              <button className="primary" onClick={generateIdeas} disabled={!selected || busy}>
                Regenerate {ideaCount}
              </button>
            </div>
            <div className="ideas-grid">
              {ideas.map(idea => (
                <article className={`idea-card ${idea.selected ? 'chosen' : ''}`} key={idea.id}>
                  <div className="idea-top">
                    <span className="score">{idea.score?.toFixed(1) ?? '-'}</span>
                    {idea.selected && <span className="chosen-label">SELECTED</span>}
                  </div>
                  <h3>{idea.title}</h3>
                  <p className="hook">{idea.hook}</p>
                  <p>{idea.description}</p>
                  <button
                    className={idea.selected ? 'secondary full' : 'primary full'}
                    disabled={busy || idea.selected}
                    onClick={() => selectIdea(idea.id)}>
                    {idea.selected ? 'Đang sử dụng' : 'Use this idea'}
                  </button>
                  {idea.selected && (
                    <button
                      className="secondary full top-gap"
                      onClick={() => {
                        setActiveScriptId(null);
                        setView('scripts');
                      }}>
                      Generate Story từ idea này →
                    </button>
                  )}
                </article>
              ))}
            </div>
            {selected && !ideas.length && <div className="empty">Chưa có idea.</div>}
          </section>
        )}

        {view === 'scripts' && (
          <section className="script-layout">
            <div className="card script-sidebar">
              <div className="section-title">
                <div>
                  <h2>Story versions</h2>
                  <span>{stories.length} versions</span>
                </div>
              </div>
              {!stories.length && <div className="empty">Chưa có story. Chọn Idea rồi Generate Story.</div>}
              {stories.map(story => (
                <button
                  key={story.id}
                  className={`script-version ${activeScript?.id === story.id ? 'selected' : ''}`}
                  onClick={() => setActiveScriptId(story.id)}>
                  <strong>
                    v{story.version} {story.approved ? '✓ Approved' : ''}
                  </strong>
                  <span>{story.score ? `${story.score.toFixed(1)}/10` : 'Not reviewed'}</span>
                  <span
                    className="script-delete"
                    onClick={event => {
                      event.stopPropagation();
                      void removeScript(story);
                    }}>
                    Xóa
                  </span>
                </button>
              ))}
              <hr />
              <h3>Reels ({reels.length})</h3>
              {reels.map(reel => (
                <button
                  key={reel.id}
                  className={`script-version ${activeScript?.id === reel.id ? 'selected' : ''}`}
                  onClick={() => setActiveScriptId(reel.id)}>
                  <strong>{reel.title ?? `Reel ${reel.version}`}</strong>
                  <span>Reel #{reel.version}</span>
                  <span
                    className="script-delete"
                    onClick={event => {
                      event.stopPropagation();
                      void removeScript(reel);
                    }}>
                    Xóa
                  </span>
                </button>
              ))}
            </div>
            <div className="card script-main">
              {selected && (
                <details className="story-import">
                  <summary>＋ Nhập truyện trực tiếp từ TXT hoặc dán nội dung</summary>
                  <div className="story-import-body">
                    <div className="story-import-fields">
                      <label>
                        Tiêu đề
                        <input
                          value={importTitle}
                          onChange={e => setImportTitle(e.target.value)}
                          placeholder="Tự lấy tên file nếu để trống"
                        />
                      </label>
                      <label className="txt-picker">
                        File .txt
                        <input
                          type="file"
                          accept=".txt,text/plain"
                          onChange={e => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            if (!file.name.toLowerCase().endsWith('.txt')) {
                              setMessage('Chỉ hỗ trợ file .txt.');
                              return;
                            }
                            void file
                              .text()
                              .then(text => {
                                setImportContent(text);
                                if (!importTitle) setImportTitle(file.name.replace(/\.txt$/i, ''));
                                setMessage(`Đã đọc ${file.name} · ${text.length.toLocaleString('vi-VN')} ký tự.`);
                              })
                              .catch(error => setMessage(error instanceof Error ? error.message : String(error)));
                          }}
                        />
                      </label>
                    </div>
                    <label>
                      Nội dung truyện
                      <textarea
                        value={importContent}
                        onChange={e => setImportContent(e.target.value)}
                        rows={8}
                        placeholder="Dán toàn bộ truyện vào đây hoặc chọn file .txt phía trên..."
                      />
                    </label>
                    <div className="story-import-footer">
                      <span>{importContent.length.toLocaleString('vi-VN')} ký tự · không dùng AI</span>
                      <button
                        className="primary"
                        onClick={() => void importStory()}
                        disabled={busy || importContent.trim().length < 20}>
                        Thêm truyện & tạo version mới
                      </button>
                    </div>
                  </div>
                </details>
              )}
              {!selected ? (
                <div className="empty">Chọn project trước.</div>
              ) : !activeScript ? (
                <div className="empty action-empty">
                  <p>Idea selected: {ideas.find(i => i.selected)?.title ?? 'chưa chọn'}</p>
                  <label>
                    Target words
                    <input
                      type="number"
                      min={800}
                      max={4500}
                      value={targetWords}
                      onChange={e => setTargetWords(Number(e.target.value))}
                    />
                  </label>
                  <button className="primary" onClick={generateStory} disabled={busy || !ideas.some(i => i.selected)}>
                    Generate Story
                  </button>
                </div>
              ) : (
                <>
                  <div className="script-toolbar">
                    <div>
                      <h2>{activeScript.title ?? activeScript.type}</h2>
                      <span>
                        {activeScript.type} · v{activeScript.version} {activeScript.approved ? '· APPROVED' : ''}
                      </span>
                    </div>
                    {activeScript.type === 'LONG_STORY' && (
                      <div className="button-row">
                        <button className="secondary" onClick={reviewStory} disabled={busy}>
                          AI Review
                        </button>
                        <button className="secondary" onClick={saveStory} disabled={busy}>
                          Save
                        </button>
                        <button
                          className="primary"
                          onClick={approveStory}
                          disabled={busy || activeScript.approved || !selected?.voiceId}>
                          Approve
                        </button>
                      </div>
                    )}
                  </div>
                  {activeScript.type === 'LONG_STORY' && activeScript.score && (
                    <div className="review-box">
                      <strong>AI Score: {activeScript.score.toFixed(1)}/10</strong>
                      <p>{reviewSummary(activeScript)}</p>
                    </div>
                  )}
                  <textarea
                    className="script-editor"
                    value={editorContent}
                    onChange={e => setEditorContent(e.target.value)}
                    readOnly={activeScript.type === 'REEL'}
                  />
                  {activeScript.type === 'LONG_STORY' && (
                    <ThumbnailGenerator
                      busy={busy}
                      media={storyMedia}
                      prompt={thumbnailPrompt}
                      onPromptChange={setThumbnailPrompt}
                      onGenerate={() => void generateThumbnail()}
                    />
                  )}
                  {activeScript.type === 'LONG_STORY' && (
                    <>
                      <div className="rewrite-row">
                        <input
                          placeholder="Rewrite instruction / dùng feedback AI nếu để trống"
                          value={rewriteNote}
                          onChange={e => setRewriteNote(e.target.value)}
                        />
                        <button className="secondary" onClick={rewriteStory} disabled={busy}>
                          Rewrite → new version
                        </button>
                      </div>
                      <div className="voice-gate">
                        <div className="voice-title">
                          <div>
                            <strong>Voice before approve</strong>
                            <span>
                              {selected?.voiceName
                                ? `Selected: ${selected.voiceName}`
                                : 'Test và chọn giọng trước khi approve'}
                            </span>
                          </div>
                          <button
                            className="secondary"
                            onClick={loadVoices}
                            disabled={busy || (!isCapCut && !voiceSettings.hasElevenLabsKey)}>
                            Load voices
                          </button>
                        </div>
                        {!isCapCut && !voiceSettings.hasElevenLabsKey && (
                          <p className="voice-warning">Chưa có ElevenLabs API key. Vào Settings → Voice/TTS.</p>
                        )}
                        {voices.length > 0 && (
                          <>
                            <div className="voice-controls">
                              <label>
                                Voice
                                <select
                                  value={voiceId}
                                  onChange={e => {
                                    setVoiceId(e.target.value);
                                    setVoiceAudio('');
                                  }}>
                                  {voices.map(v => (
                                    <option key={v.id} value={v.id}>
                                      {v.name}
                                      {v.labels.gender ? ` · ${v.labels.gender}` : ''}
                                      {v.labels.accent ? ` · ${v.labels.accent}` : ''}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                Test sentence
                                <input value={voiceTestText} onChange={e => setVoiceTestText(e.target.value)} />
                              </label>
                            </div>
                            <div className="button-row voice-actions">
                              <button className="secondary" onClick={testVoice} disabled={busy}>
                                Test voice
                              </button>
                              <button className="primary" onClick={useVoice} disabled={busy || !voiceId}>
                                Use this voice
                              </button>
                            </div>
                            {voiceAudio && <audio className="voice-player" src={voiceAudio} controls autoPlay />}
                          </>
                        )}
                      </div>
                      <StoryMediaFlow
                        busy={busy}
                        ffmpegReady={Boolean(health?.ffmpeg)}
                        hasVoice={Boolean(selected?.voiceId)}
                        media={storyMedia}
                        videoFormat={videoFormat}
                        fitMode={fitMode}
                        soundEffect={soundEffect}
                        reelProgress={reelProgress}
                        onGenerateAudio={() => void generateStoryMp3()}
                        onGenerateReelVideos={() => void generateReelVideos()}
                        onGenerateMetadata={() => void generateVideoMetadata()}
                        onChooseBackground={kind => void chooseBackground(kind)}
                        onRender={() => void renderStoryVideo()}
                        onVideoFormatChange={setVideoFormat}
                        onFitModeChange={setFitMode}
                        onSoundEffectChange={setSoundEffect}
                      />
                      <div className="generate-reels">
                        <label>
                          Reels
                          <input
                            type="number"
                            min={1}
                            max={10}
                            value={reelCount}
                            onChange={e => setReelCount(Number(e.target.value))}
                          />
                        </label>
                        <div className="button-row grow">
                          <button
                            className="primary"
                            onClick={approveAndGenerateReels}
                            disabled={busy || !selected?.voiceId}>
                            Approve Version & Generate Reels
                          </button>
                          <button
                            className="secondary"
                            onClick={generateReels}
                            disabled={busy || !stories.some(s => s.approved)}>
                            Generate Again
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </section>
        )}

        {view === 'scheduler' && <SchedulerView />}

        {view === 'settings' && (
          <section className="settings-grid">
            <form className="card form" onSubmit={saveSettings}>
              <h2>AI provider</h2>
              <label>
                Default provider
                <select
                  value={settings.provider}
                  onChange={e => setSettings({ ...settings, provider: e.target.value as AIProviderName })}>
                  <option value="gemini">Gemini</option>
                  <option value="openai">OpenAI</option>
                </select>
              </label>
              <label>
                Gemini model
                <input
                  value={settings.geminiModel}
                  onChange={e => setSettings({ ...settings, geminiModel: e.target.value })}
                />
              </label>
              <label>
                Gemini API key
                <input
                  type="password"
                  placeholder={settings.hasGeminiKey ? 'Saved — nhập key mới để thay thế' : 'Paste Gemini API key'}
                  value={geminiKey}
                  onChange={e => setGeminiKey(e.target.value)}
                />
              </label>
              <label className="check">
                <input type="checkbox" checked={clearGeminiKey} onChange={e => setClearGeminiKey(e.target.checked)} />{' '}
                Xóa Gemini key đã lưu
              </label>
              <button type="button" className="secondary" disabled={busy} onClick={() => testAI('gemini')}>
                Test Gemini
              </button>
              <label>
                OpenAI model
                <input
                  value={settings.openaiModel}
                  onChange={e => setSettings({ ...settings, openaiModel: e.target.value })}
                />
              </label>
              <label>
                OpenAI API key
                <input
                  type="password"
                  placeholder={settings.hasOpenAIKey ? 'Saved — nhập key mới để thay thế' : 'Paste OpenAI API key'}
                  value={openaiKey}
                  onChange={e => setOpenaiKey(e.target.value)}
                />
              </label>
              <label className="check">
                <input type="checkbox" checked={clearOpenAIKey} onChange={e => setClearOpenAIKey(e.target.checked)} />{' '}
                Xóa OpenAI key đã lưu
              </label>
              <button type="button" className="secondary" disabled={busy} onClick={() => testAI('openai')}>
                Test OpenAI
              </button>
              <button className="primary" disabled={busy}>
                Save settings
              </button>
            </form>
            <div className="stack-cards">
              <div className="card form">
                <h2>Voice / TTS · ElevenLabs</h2>
                <label>
                  TTS model
                  <input
                    value={voiceSettings.elevenLabsModel}
                    onChange={e => setVoiceSettings({ ...voiceSettings, elevenLabsModel: e.target.value })}
                  />
                </label>
                <label>
                  ElevenLabs API key
                  <input
                    type="password"
                    placeholder={
                      voiceSettings.hasElevenLabsKey ? 'Saved — nhập key mới để thay thế' : 'Paste ElevenLabs API key'
                    }
                    value={elevenLabsKey}
                    onChange={e => setElevenLabsKey(e.target.value)}
                  />
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={clearElevenLabsKey}
                    onChange={e => setClearElevenLabsKey(e.target.checked)}
                  />{' '}
                  Xóa ElevenLabs key đã lưu
                </label>
                <button type="button" className="primary" disabled={busy} onClick={saveVoiceSettings}>
                  Save Voice/TTS
                </button>
              </div>
              <div className="card help-card">
                <h2>v0.3.3 scope</h2>
                <p>Story → chọn/test voice → export full story.mp3 → chọn video nền → loop bằng FFmpeg → story.mp4.</p>
                <p>Background được copy vào project local để lần sau mở app vẫn dùng lại.</p>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

import { readStudioDraft, writeStudioDraft, studioDraftKey } from '../lib/studio-draft';
import castPreview from '../assets/stickman-cast-preview.webp';
import React, { useEffect, useRef, useState } from 'react';
import type {
  EngineScene,
  StudioReelEpisode,
  HookVariation,
  ScriptBeat,
  StickmanContentPackage,
  StickmanContentPillar,
  StickmanIdea,
} from '../../../shared/stickman-engine';
import { INITIAL_CONTENT_PILLARS, STORY_DIMENSIONS } from '../../../shared/stickman-engine';
import type { ProjectDTO, ScriptDTO, VideoFormat, VoiceDTO } from '../../../shared/types';

interface StickmanEngineViewProps {
  projects: ProjectDTO[];
  selectedProjectId: string | null;
  onSelectProject: (id: string) => void;
  onProjectUpdated?: (project: ProjectDTO) => void;
  onNavigateToScripts?: () => void;
}

type Step = 'ideas' | 'hooks' | 'script' | 'scenes' | 'assets' | 'package';
const WORK_STEPS = [
  ['ideas', 'Tạo ý tưởng'], ['hooks', 'Tạo hooks'], ['script', 'Viết kịch bản'],
  ['scenes', 'Phân cảnh'], ['package', 'Đóng gói nội dung'],
  ['save', 'Lưu kịch bản'], ['audio', 'Tạo Story MP3'], ['video', 'Dựng video'],
  ['reels', 'Chia và dựng Reel'], ['rewrite', 'Viết lại beat'], ['expand', 'Mở rộng truyện'],
] as const;
type WorkStep = typeof WORK_STEPS[number][0];
type WorkProgress = { status: 'running' | 'done' | 'error' | 'interrupted'; percent?: number; estimated?: boolean; message?: string };


// Keep visited project sessions mounted, so an IPC result still reaches its owner
// while the user navigates to another project or app page.
export function StickmanEngineView(props: StickmanEngineViewProps) {
  const [visited, setVisited] = useState<(string | null)[]>([props.selectedProjectId]);
  useEffect(() => {
    setVisited(previous => previous.includes(props.selectedProjectId) ? previous : [...previous, props.selectedProjectId]);
  }, [props.selectedProjectId]);
  return <>{visited.filter(id => id === null || props.projects.some(project => project.id === id)).map(id =>
    <div key={studioDraftKey(id)} hidden={id !== props.selectedProjectId}>
      <StickmanProjectSession {...props} selectedProjectId={id} />
    </div>
  )}</>;
}

function StickmanProjectSession({
  projects,
  selectedProjectId,
  onSelectProject,
  onProjectUpdated,
}: StickmanEngineViewProps) {
  const key = studioDraftKey(selectedProjectId);
  const [initial] = useState(() => {
    try { return { data: readStudioDraft(localStorage, key), error: '' }; }
    catch (error) { return { data: {} as Record<string, unknown>, error: `Không đọc được bản nháp: ${error instanceof Error ? error.message : String(error)}` }; }
  });
  const [draft, setDraft] = useState(initial.data);
  const [saveError, setSaveError] = useState(initial.error);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  function draftField<T,>(name: string, fallback: T): [T, React.Dispatch<React.SetStateAction<T>>] {
    const value = draft[name] === undefined ? fallback : draft[name] as T;
    return [value, next => setDraft(previous => ({ ...previous, [name]: typeof next === 'function'
      ? (next as (value: T) => T)(previous[name] === undefined ? fallback : previous[name] as T) : next }))];
  }
  useEffect(() => {
    // Do not overwrite a draft we could not read; report storage failures visibly.
    if (initial.error || Object.keys(draft).length === 0) return;
    try {
      writeStudioDraft(localStorage, key, draft);
      setSaveError('');
      setSavedAt(new Date().toLocaleTimeString());
    } catch (error) { setSaveError(`Chưa lưu được bản nháp: ${error instanceof Error ? error.message : String(error)}`); }
  }, [draft, key, initial.error]);
  const [step, setStep] = draftField<Step>('step', 'ideas');
  const [pillars] = useState<StickmanContentPillar[]>(INITIAL_CONTENT_PILLARS);
  const [selectedPillarId, setSelectedPillarId] = draftField<string>('selectedPillarId', 'betrayal');
  const [targetMarket, setTargetMarket] = draftField<string>('targetMarket', 'US');
  const [longMinutes, setLongMinutes] = draftField<number>('longMinutes', 8);
  const [format, setFormat] = draftField<'SHORT' | 'LONG'>('format', 'SHORT');
  const [seedPremise, setSeedPremise] = draftField<string>('seedPremise', '');
  const [selectedChar, setSelectedChar] = draftField<string>('selectedChar', '');
  const [selectedEnv, setSelectedEnv] = draftField<string>('selectedEnv', '');
  const [selectedConflict, setSelectedConflict] = draftField<string>('selectedConflict', '');

  // Generation state
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingMessage, setLoadingMessage] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [workProgress, setWorkProgress] = draftField<Partial<Record<WorkStep, WorkProgress>>>('workProgress', {});
  const activeWork = useRef<WorkStep | null>(null);
  useEffect(() => {
    if (!loading) return;
    const timer = window.setInterval(() => {
      const key = activeWork.current;
      if (!key) return;
      setDraft(previous => {
        const progress = previous.workProgress as Partial<Record<WorkStep, WorkProgress>> | undefined;
        const current = progress?.[key];
        if (current?.status !== 'running' || !current.estimated || (current.percent ?? 0) >= 90) return previous;
        const percent = Math.min(90, (current.percent ?? 1) + Math.max(1, Math.round((90 - (current.percent ?? 1)) / 20)));
        return { ...previous, workProgress: { ...progress, [key]: { ...current, percent } } };
      });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [loading]);

  function beginWork(key: WorkStep) {
    activeWork.current = key;
    setError(null);
    setWorkProgress(previous => {
      const next = { ...previous };
      const order = WORK_STEPS.slice(0, 8).map(([id]) => id as WorkStep);
      const index = order.indexOf(key);
      if (index >= 0) for (const later of order.slice(index + 1)) delete next[later];
      next[key] = { status: 'running', percent: 1, estimated: true };
      return next;
    });
  }
  function finishWork(key: WorkStep) {
    setWorkProgress(previous => ({ ...previous, [key]: { status: 'done', percent: 100 } }));
    activeWork.current = null;
  }
  function failWork() {
    const key = activeWork.current;
    if (key) setWorkProgress(previous => ({ ...previous, [key]: { ...previous[key], status: 'error' } }));
    activeWork.current = null;
  }


  // Workflow data
  const [ideas, setIdeas] = draftField<StickmanIdea[]>('ideas', []);
  const [selectedIdea, setSelectedIdea] = draftField<StickmanIdea | null>('selectedIdea', null);
  const [hooks, setHooks] = draftField<HookVariation[]>('hooks', []);
  const [selectedHook, setSelectedHook] = draftField<string>('selectedHook', '');
  const [beats, setBeats] = draftField<ScriptBeat[]>('beats', []);
  const [scenes, setScenes] = draftField<EngineScene[]>('scenes', []);
  const [pkg, setPkg] = draftField<StickmanContentPackage | null>('pkg', null);

  // Section regen modal
  const [regenBeatId, setRegenBeatId] = draftField<string | null>('regenBeatId', null);
  const [regenInstruction, setRegenInstruction] = draftField<string>('regenInstruction', '');

  // Video render state
  const projectVoice = projects.find(project => project.id === selectedProjectId);
  const [chosenVoice, setChosenVoice] = draftField<{ id: string; name: string } | null>('chosenVoice', null);
  const effectiveVoice = chosenVoice ?? (projectVoice?.voiceId ? { id: projectVoice.voiceId, name: projectVoice.voiceName ?? projectVoice.voiceId } : null);
  const [voiceCatalog, setVoiceCatalog] = useState<VoiceDTO[]>([]);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voicePreview, setVoicePreview] = useState('');
  const [voiceSearch, setVoiceSearch] = useState('');
  const [voiceSample, setVoiceSample] = draftField<string>('voiceSample', "Hey, I didn't expect to see you here. Can we talk for a minute? There's something I need to tell you.");
  async function loadStudioVoices() {
    if (voiceBusy || loading) return;
    setVoiceBusy(true);
    setError(null);
    try { setVoiceCatalog(await window.contentFactory.voices.list()); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setVoiceBusy(false); }
  }
  async function previewStudioVoice() {
    if (!effectiveVoice || !voiceSample.trim() || voiceBusy || loading) return;
    setVoiceBusy(true);
    setError(null);
    setVoicePreview('');
    try {
      const result = await window.contentFactory.voices.preview({ voiceId: effectiveVoice.id, text: voiceSample.trim() });
      setVoicePreview(result.dataUrl);
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setVoiceBusy(false); }
  }
  const visibleVoices = voiceCatalog.filter(voice => voice.id === effectiveVoice?.id ||
    `${voice.name} ${voice.description ?? ''} ${Object.values(voice.labels).join(' ')}`.toLowerCase().includes(voiceSearch.toLowerCase()));

  const [studioOutputDir, setStudioOutputDir] = draftField<string>('studioOutputDir', '');
  const [renderProgress, setRenderProgress] = useState<string | null>(null);
  const [importedScript, setImportedScript] = draftField<{ projectId: string; title: string; content: string; scriptId: string } | null>('importedScript', null);

  const activePillar = pillars.find(p => p.id === selectedPillarId) ?? pillars[0];

  // 1. Generate Ideas
  async function handleGenerateIdeas() {
    if (loading) return;
    beginWork('ideas');
    setLoading(true);
    setLoadingMessage('AI đang tạo ý tưởng theo Content Pillar… Nếu model quá tải, app sẽ tự thử lại tối đa 2 lần.');
    setError(null);
    try {
      const results = await window.contentFactory.stickmanEngine.generateIdeas({
        pillarId: selectedPillarId,
        targetMarket,
        format,
        seedPremise: seedPremise.trim() || undefined,
        selectedCharacter: selectedChar || undefined,
        selectedEnvironment: selectedEnv || undefined,
        selectedConflict: selectedConflict || undefined,
        count: 6,
      });
      setIdeas(results);
      if (results.length > 0) {
        setSelectedIdea(results[0]);
      }
      finishWork('ideas');
    } catch (err) {
      failWork();
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  // 2. Select Idea & Go to Hooks
  async function handleSelectIdea(idea: StickmanIdea) {
    setSelectedIdea(idea);
    setFormat(idea.recommendedFormat);
    setSelectedHook(idea.hook);
    setStep('hooks');
    if (loading) return;
    beginWork('hooks');
    setLoading(true);
    setLoadingMessage('Đang phân tích tâm lý & tạo 5 biến thể Hook mở đầu...');
    setError(null);
    try {
      const generatedHooks = await window.contentFactory.stickmanEngine.generateHooks({ idea });
      setHooks(generatedHooks);
      if (generatedHooks.length > 0) {
        setSelectedHook(generatedHooks[0].text);
      }
      finishWork('hooks');
    } catch (err) {
      failWork();
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  // 3. Generate Script
  async function handleGenerateScript() {
    if (!selectedIdea) return;
    if (loading) return;
    beginWork('script');
    setLoading(true);
    setLoadingMessage(`Đang biên kịch ${format === 'SHORT' ? '7 Beats cho Video Short' : '10 Chương cho Video Dài'}...`);
    setError(null);
    try {
      const generatedBeats = await window.contentFactory.stickmanEngine.generateScript({
        idea: selectedIdea,
        selectedHook,
        format,
        targetMinutes: format === 'LONG' ? longMinutes : undefined,
      });
      setBeats(generatedBeats);
      setStep('script');
      finishWork('script');
    } catch (err) {
      failWork();
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  // Toggle Lock Beat
  function toggleLockBeat(id: string) {
    setBeats(prev => prev.map(b => (b.id === id ? { ...b, locked: !b.locked } : b)));
  }

  // Update Beat Narration
  function updateBeatNarration(id: string, text: string) {
    setBeats(prev => prev.map(b => (b.id === id ? { ...b, narration: text } : b)));
  }

  // Regenerate Single Beat
  async function handleRegenBeat() {
    if (!selectedIdea || !regenBeatId) return;
    if (loading) return;
    beginWork('rewrite');
    setLoading(true);
    setLoadingMessage('Đang tái tạo phân đoạn theo chỉ dẫn...');
    try {
      const updated = await window.contentFactory.stickmanEngine.regenerateBeat({
        idea: selectedIdea,
        beats,
        targetBeatId: regenBeatId,
        instruction: regenInstruction.trim() || undefined,
      });
      setBeats(updated);
      setRegenBeatId(null);
      setRegenInstruction('');
      finishWork('rewrite');
    } catch (err) {
      failWork();
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  // 4. Generate Storyboard Scenes
  async function handleGenerateScenes() {
    if (!selectedIdea || beats.length === 0) return;
    if (loading) return;
    beginWork('scenes');
    setLoading(true);
    setLoadingMessage('Đang phân bổ Storyboard, Camera, tư thế Stickman & Sound Effects...');
    setError(null);
    try {
      const generatedScenes = await window.contentFactory.stickmanEngine.generateScenes({
        idea: selectedIdea,
        beats,
      });
      setScenes(generatedScenes);
      setStep('scenes');
      finishWork('scenes');
    } catch (err) {
      failWork();
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  // 5. Generate Package
  async function handleGeneratePackage() {
    if (!selectedIdea || beats.length === 0) return;
    if (loading) return;
    beginWork('package');
    setLoading(true);
    setLoadingMessage('Đang hoàn thiện Gói Xuất Bản: Tiêu đề, Thumbnail concept, SEO Hashtags...');
    setError(null);
    try {
      const generatedPackage = await window.contentFactory.stickmanEngine.generatePackage({
        idea: selectedIdea,
        selectedHook,
        beats,
        scenes,
      });
      setPkg(generatedPackage);
      setStep('package');
      finishWork('package');
    } catch (err) {
      failWork();
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  // 6. Expand Short to Long
  async function handleExpandToLong() {
    if (!pkg || !selectedIdea) return;
    if (loading) return;
    beginWork('expand');
    setLoading(true);
    setLoadingMessage('Đang mở rộng kịch bản Short thành cốt truyện dài 10-15 phút...');
    try {
      const expanded = await window.contentFactory.stickmanEngine.expandShortToLong({
        shortPackage: pkg,
        originalIdea: selectedIdea,
      });
      setSelectedIdea(expanded);
      setFormat('LONG');
      setStep('ideas');
      alert(`🎉 Đã mở rộng thành công sang bản dài: "${expanded.workingTitle}"! Bạn có thể xem và tạo kịch bản chi tiết ngay.`);
      finishWork('expand');
    } catch (err) {
      failWork();
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  // Copy Package
  function handleCopyPackage() {
    if (!pkg) return;
    const text = `=== ${pkg.title.toUpperCase()} ===\n\n` +
      `[HOOK]: ${pkg.selectedHook}\n\n` +
      `[CAPTION (REELS / TIKTOK / FB)]:\n${pkg.caption}\n\n` +
      `[THUMBNAIL TEXT]: ${pkg.thumbnailText}\n` +
      `[THUMBNAIL CONCEPT]: ${pkg.thumbnailConcept}\n` +
      `[THUMBNAIL PROMPT]: ${pkg.thumbnailPrompt}\n\n` +
      `[ALTERNATIVE TITLES]:\n${pkg.alternativeTitles.join('\n')}\n\n` +
      `[FULL SCRIPT]:\n${pkg.fullScript}\n\n` +
      `[DESCRIPTION]:\n${pkg.description}\n\n` +
      `[HASHTAGS]:\n${pkg.hashtags.join(' ')}\n\n` +
      `[CTA]: ${pkg.cta}`;
    void window.contentFactory.app.copyText(text);
    alert('✅ Đã sao chép toàn bộ Gói Nội Dung (kèm Caption) vào Clipboard!');
  }

  // Copy Caption
  function handleCopyCaption(captionText?: string) {
    const text = captionText || pkg?.caption;
    if (!text) return;
    void window.contentFactory.app.copyText(text);
    alert('✅ Đã sao chép Caption đăng bài vào Clipboard!');
  }

  const [reelCount, setReelCount] = draftField<number>('reelCount', 3);
  const [studioReels, setStudioReels] = draftField<StudioReelEpisode[]>('studioReels', []);
  const [completedReels, setCompletedReels] = draftField<string[]>('completedReels', []);
  async function splitStudioReels() {
    if (loading || !pkg || !selectedProjectId) return;
    if (typeof window.contentFactory.stickmanEngine.splitReels !== 'function') {
      setError('Hãy thoát và mở lại app để nạp chức năng chia Reel mới.'); return;
    }
    beginWork('reels'); setLoading(true); setLoadingMessage('Đang chia truyện thành từng tập Reel với hook và metadata riêng…');
    try {
      let saved = importedScript;
      if (!saved || saved.projectId !== selectedProjectId || saved.content !== pkg.fullScript || saved.title !== pkg.title) {
        const script = await window.contentFactory.scripts.importStory({ projectId: selectedProjectId, title: pkg.title, content: pkg.fullScript });
        saved = { projectId: selectedProjectId, title: pkg.title, content: pkg.fullScript, scriptId: script.id };
        setImportedScript(saved);
      }
      setStudioOutputDir(await window.contentFactory.stickmanEngine.saveOutput({ projectId: selectedProjectId, scriptId: saved.scriptId, pkg }));
      const episodes = await window.contentFactory.stickmanEngine.splitReels({ projectId: selectedProjectId, scriptId: saved.scriptId, count: reelCount });
      setStudioReels(episodes); setCompletedReels([]); finishWork('reels');
    } catch (error) { failWork(); setError(error instanceof Error ? error.message : String(error)); }
    finally { setLoading(false); }
  }
  async function renderStudioReels(episodes: StudioReelEpisode[]) {
    if (loading || voiceBusy || !selectedProjectId || episodes.length === 0) return;
    if (!effectiveVoice) { setError('Chọn voice trong Studio trước khi dựng các Reel.'); return; }
    beginWork('reels'); setLoading(true); setLoadingMessage('Đang dựng từng tập Reel 9:16…');
    try {
      const project = (await window.contentFactory.projects.list()).find(item => item.id === selectedProjectId);
      if (!project) throw new Error('Không tìm thấy project.');
      if (project.voiceId !== effectiveVoice.id) {
        onProjectUpdated?.(await window.contentFactory.voices.select({ projectId: selectedProjectId, voiceId: effectiveVoice.id, voiceName: effectiveVoice.name }));
        setCompletedReels([]);
      }
      for (const [index, episode] of episodes.entries()) {
        setRenderProgress(`Reel ${index + 1}/${episodes.length}: ${episode.title}`);
        const unsubscribe = window.contentFactory.storyMedia.onStoryVideoProgress(progress => {
          if (progress.projectId !== selectedProjectId || progress.scriptId !== episode.scriptId) return;
          setRenderProgress(`Reel ${index + 1}/${episodes.length}: ${progress.message}`);
          setWorkProgress(previous => ({ ...previous, reels: { status: 'running', percent: Math.min(99, Math.round((index + Math.max(0, Math.min(100, progress.percent)) / 100) / episodes.length * 100)) } }));
        });
        try {
          await window.contentFactory.storyMedia.generateStickVideo({ projectId: selectedProjectId, scriptId: episode.scriptId, format: 'REEL', studioOutput: true });
        } finally { unsubscribe(); }
        setCompletedReels(previous => [...new Set([...previous, episode.scriptId])]);
      }
      finishWork('reels');
    } catch (error) { failWork(); setError(error instanceof Error ? error.message : String(error)); }
    finally { setLoading(false); setRenderProgress(null); }
  }

  // Direct Render to Stickman Video
  async function handleRenderStickVideo() {
    if (loading) return;
    if (!selectedProjectId) {
      alert('Vui lòng chọn 1 Dự án (Project) ở thanh trên cùng để lưu video hoạt hình này.');
      return;
    }
    if (!pkg) return;
    if (format === 'LONG' && pkg.fullScript.trim().split(/\s+/).filter(Boolean).length < longMinutes * 120) {
      setError(`Kịch bản hiện tại quá ngắn cho video dài ${longMinutes} phút. Hãy vào bước Kịch bản, bấm Viết lại toàn bộ rồi Đóng gói lại trước khi dựng video.`);
      return;
    }

    if (typeof window.contentFactory?.stickmanEngine?.saveOutput !== 'function') {
      setError('App đang dùng preload cũ nên chưa có chức năng lưu output Studio. Hãy thoát hoàn toàn app rồi mở lại. Nếu chạy trong IDE, dừng và chạy lại npm run dev; chỉ reload giao diện chưa đủ. Bản nháp Studio vẫn được tự lưu.');
      return;
    }

    if (voiceBusy) return;
    if (!effectiveVoice) {
      setError('Hãy chọn giọng đọc ngay tại mục Voice trong Studio trước khi dựng video.');
      return;
    }

    setLoading(true);
    setError(null);
    setLoadingMessage('Đang chuẩn bị kịch bản, giọng đọc và hoạt hình…');
    beginWork('save');
    setRenderProgress('Bước 1/3: Đang lưu kịch bản...');
    try {
      // Apply the Studio selection before generating narration. Re-read the project
      // to avoid invalidating media when its voice has not changed.
      const currentProject = (await window.contentFactory.projects.list()).find(project => project.id === selectedProjectId);
      if (!currentProject) throw new Error('Không tìm thấy dự án Studio.');
      if (currentProject.voiceId !== effectiveVoice.id) {
        const updated = await window.contentFactory.voices.select({ projectId: selectedProjectId, voiceId: effectiveVoice.id, voiceName: effectiveVoice.name });
        onProjectUpdated?.(updated);
      }
      // Reuse the same imported script when retrying this package after a failure.
      let saved = importedScript;
      if (!saved || saved.projectId !== selectedProjectId || saved.title !== pkg.title || saved.content !== pkg.fullScript) {
        const createdScript: ScriptDTO = await window.contentFactory.scripts.importStory({
          projectId: selectedProjectId,
          title: pkg.title,
          content: pkg.fullScript,
        });
        saved = { projectId: selectedProjectId, title: pkg.title, content: pkg.fullScript, scriptId: createdScript.id };
        setImportedScript(saved);
      }

      setStudioOutputDir(await window.contentFactory.stickmanEngine.saveOutput({ projectId: selectedProjectId, scriptId: saved.scriptId, pkg }));
      finishWork('save');
      beginWork('audio');
      // The renderer requires narration generated from this exact script.
      setRenderProgress('Bước 2/3: Đang tạo Story MP3 bằng giọng đọc đã chọn...');
      await window.contentFactory.storyMedia.generateAudio({
        projectId: selectedProjectId,
        scriptId: saved.scriptId,
        studioOutput: true,
      });

      finishWork('audio');
      beginWork('video');
      setRenderProgress('Bước 3/3: Đang dựng hoạt hình Stickman 60fps...');
      const videoFormat: VideoFormat = format === 'SHORT' ? 'REEL' : 'LANDSCAPE';
      const unsubscribe = window.contentFactory.storyMedia.onStoryVideoProgress(progress => {
        if (progress.projectId !== selectedProjectId || progress.scriptId !== saved.scriptId) return;
        setRenderProgress(progress.message);
        if (Number.isFinite(progress.percent)) setWorkProgress(previous => ({ ...previous,
          video: { status: 'running', percent: Math.max(0, Math.min(99, progress.percent)), message: progress.message },
        }));
      });
      try {
      await window.contentFactory.storyMedia.generateStickVideo({
        projectId: selectedProjectId,
        scriptId: saved.scriptId,
        format: videoFormat,
        studioOutput: true,
      });
      } finally { unsubscribe(); }
      finishWork('video');

      alert(`🎉 Hoàn tất dựng ${format === 'SHORT' ? 'Reel 9:16' : 'video dài 16:9'} cho kịch bản "${pkg.title}"! Bạn có thể xem video trong tab Tổng quan hoặc Media.`);
    } catch (err) {
      failWork();
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setRenderProgress(null);
    }
  }

  return (
    <div className="stickman-engine-container">
      <p className={saveError ? 'engine-draft-warning' : 'engine-draft-status'} role="status">
        {saveError || (savedAt ? `Đã tự lưu bản nháp lúc ${savedAt}` : Object.keys(initial.data).length ? 'Đã khôi phục bản nháp của dự án.' : 'Bản nháp sẽ tự lưu trên máy này khi bạn làm việc.')}
      </p>
      {studioOutputDir && <p className="engine-draft-status">Output riêng của Studio: <code>{studioOutputDir}</code> <button type="button" className="engine-secondary-btn" onClick={() => void window.contentFactory.app.revealFile(`${studioOutputDir}/content-package.json`).catch(error => setError(String(error)))}>Mở output Studio</button></p>}
      {/* Top Header & Project Selector */}
      <div className="engine-header">
        <div className="engine-title-box">
          <span className="engine-badge">⚡ STICKMAN CONTENT ENGINE</span>
          <h2>Xưởng Sản Xuất Hoạt Hình Người Que Thông Minh</h2>
          <p className="engine-subtitle">
            Hệ thống sản xuất nội dung YouTube Shorts &amp; Long-Form đạt chuẩn quốc tế (US, UK, CA, AU) dựa trên Content Pillars &amp; Kích hoạt Tâm lý
          </p>
        </div>

        <div className="engine-top-controls">
          <div className="engine-control-group">
            <label>Dự án lưu trữ:</label>
            <select
              value={selectedProjectId ?? ''}
              disabled={loading}
              onChange={e => {
                const nextId = e.target.value;
                if (selectedProjectId === null && Object.keys(draft).length && !initial.error) {
                  try {
                    const nextKey = studioDraftKey(nextId);
                    if (!localStorage.getItem(nextKey)) writeStudioDraft(localStorage, nextKey, draft);
                  } catch (error) {
                    setSaveError(`Chưa chuyển được bản nháp: ${error instanceof Error ? error.message : String(error)}`);
                    return;
                  }
                }
                onSelectProject(nextId);
              }}
              className="engine-select"
            >
              <option value="" disabled>-- Chọn dự án --</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name} ({p.targetMarket})</option>
              ))}
            </select>
          </div>

          <div className="engine-control-group">
            <label>Thị trường mục tiêu:</label>
            <div className="engine-pill-group">
              {['US', 'UK', 'CA', 'AU', 'GLOBAL'].map(m => (
                <button
                  key={m}
                  type="button"
                  className={`engine-pill ${targetMarket === m ? 'active' : ''}`}
                  onClick={() => setTargetMarket(m)}
                >
                  {m === 'US' ? '🇺🇸 US' : m === 'UK' ? '🇬🇧 UK' : m === 'CA' ? '🇨🇦 CA' : m === 'AU' ? '🇦🇺 AU' : '🌐 Global'}
                </button>
              ))}
            </div>
          </div>

          <div className="engine-control-group">
            <label>Định dạng Video:</label>
            <div className="engine-pill-group">
              <button
                type="button"
                className={`engine-pill ${format === 'SHORT' ? 'active' : ''}`}
                onClick={() => setFormat('SHORT')}
              >
                📱 Short (30–60s)
              </button>
              <button
                type="button"
                className={`engine-pill ${format === 'LONG' ? 'active' : ''}`}
                onClick={() => setFormat('LONG')}
              >
                🎬 Dài (5–12 phút)
              </button>
            </div>
          </div>
        </div>
      </div>

      <section className="engine-sidebar-card studio-voice-picker" aria-label="Chọn voice để generate">
        <h3>🎙️ Voice dùng để generate MP3 / video</h3>
        <p>Chọn giọng và nghe thử tại đây. Khi bấm dựng video, Studio sẽ lưu giọng này cho project và dùng để tạo lời đọc.</p>
        <div className="voice-controls">
          <label>Tìm giọng (English, Mỹ, nam/nữ, tên…)
            <input value={voiceSearch} onChange={event => setVoiceSearch(event.target.value)} placeholder="English, Andrew, Emma…" />
          </label>
          <label>Giọng đọc
            <select value={effectiveVoice?.id ?? ''} disabled={loading || voiceBusy} onChange={event => {
              const voice = voiceCatalog.find(item => item.id === event.target.value);
              if (voice) { setChosenVoice({ id: voice.id, name: voice.name }); setVoicePreview(''); }
            }}>
              <option value="" disabled>Chọn giọng đọc — bấm Tải danh sách voice</option>
              {effectiveVoice && !voiceCatalog.some(voice => voice.id === effectiveVoice.id) && <option value={effectiveVoice.id}>{effectiveVoice.name} · đã chọn</option>}
              {visibleVoices.map(voice => <option key={voice.id} value={voice.id}>{voice.name} · {voice.labels.gender === 'male' ? 'Nam' : voice.labels.gender === 'female' ? 'Nữ' : voice.labels.gender ?? ''}</option>)}
            </select>
          </label>
        </div>
        <label>Câu nghe thử
          <textarea rows={2} maxLength={400} value={voiceSample} disabled={loading || voiceBusy} onChange={event => { setVoiceSample(event.target.value); setVoicePreview(''); }} />
        </label>
        <div className="button-row">
          <button type="button" className="engine-secondary-btn" disabled={loading || voiceBusy} onClick={() => void loadStudioVoices()}>{voiceBusy ? 'Đang xử lý voice…' : 'Tải danh sách voice'}</button>
          <button type="button" className="engine-secondary-btn" disabled={loading || voiceBusy || !effectiveVoice || !voiceSample.trim()} onClick={() => void previewStudioVoice()}>Nghe thử giọng đã chọn</button>
          <span>{effectiveVoice ? `Sẽ generate bằng: ${effectiveVoice.name}` : 'Chưa chọn giọng đọc'}</span>
        </div>
        {voiceCatalog.length > 0 && visibleVoices.length === 0 && <p>Không có giọng khớp từ khóa. Thử tên giọng hoặc English.</p>}
        {voicePreview && <audio key={voicePreview} controls src={voicePreview} />}
      </section>

      {format === 'LONG' && <label>Thời lượng truyện dài (ước tính theo 120–155 từ/phút)
        <select value={longMinutes} disabled={loading} onChange={event => setLongMinutes(Number(event.target.value))}>
          {[5, 8, 10, 12].map(minutes => <option key={minutes} value={minutes}>{minutes} phút</option>)}
        </select>
        <span> Kịch bản hiện tại: {beats.reduce((total, beat) => total + beat.narration.trim().split(/\s+/).filter(Boolean).length, 0)} từ</span>
      </label>}
      {/* Stepper Navigation */}
      <div className="engine-stepper">
        <button
          className={`step-btn ${step === 'ideas' ? 'active' : ''} ${ideas.length > 0 ? 'completed' : ''}`}
          onClick={() => setStep('ideas')}
        >
          <span className="step-num">1</span>
          <span className="step-label">💡 Ý Tưởng &amp; Trụ Cột</span>
        </button>

        <button
          className={`step-btn ${step === 'hooks' ? 'active' : ''} ${hooks.length > 0 ? 'completed' : ''}`}
          onClick={() => setStep('hooks')}
          disabled={!selectedIdea}
        >
          <span className="step-num">2</span>
          <span className="step-label">🎣 Móc Câu (Hooks)</span>
        </button>

        <button
          className={`step-btn ${step === 'script' ? 'active' : ''} ${beats.length > 0 ? 'completed' : ''}`}
          onClick={() => setStep('script')}
          disabled={beats.length === 0}
        >
          <span className="step-num">3</span>
          <span className="step-label">📜 Kịch Bản &amp; Khóa Beat</span>
        </button>

        <button
          className={`step-btn ${step === 'scenes' ? 'active' : ''} ${scenes.length > 0 ? 'completed' : ''}`}
          onClick={() => setStep('scenes')}
          disabled={scenes.length === 0}
        >
          <span className="step-num">4</span>
          <span className="step-label">🎬 Phân Cảnh Storyboard</span>
        </button>

        <button
          className={`step-btn ${step === 'assets' ? 'active' : ''}`}
          onClick={() => setStep('assets')}
        >
          <span className="step-num">5</span>
          <span className="step-label">🎭 Nhân Vật &amp; Tài Nguyên</span>
        </button>

        <button
          className={`step-btn ${step === 'package' ? 'active' : ''} ${pkg ? 'completed' : ''}`}
          onClick={() => setStep('package')}
          disabled={!pkg}
        >
          <span className="step-num">6</span>
          <span className="step-label">📦 Đóng Gói &amp; Xuất Video</span>
        </button>
      </div>

      <section className="engine-work-progress" aria-label="Tiến độ từng bước">
        {WORK_STEPS.filter(([key]) => !['rewrite', 'expand'].includes(key) || workProgress[key]).map(([key, label]) => {
          const progress = workProgress[key];
          const running = progress?.status === 'running';
          const percent = Math.max(0, Math.min(100, Math.round(progress?.percent ?? 0)));
          const percentLabel = `${percent}%${progress?.estimated ? ' (ước tính)' : ''}`;
          const status = progress?.status === 'done' ? '100% · Hoàn tất' : progress?.status === 'interrupted' ? `${percentLabel} · Gián đoạn` : progress?.status === 'error' ? `${percentLabel} · Lỗi, thử lại` : running ? `${percentLabel} · Đang xử lý` : '0% · Chưa chạy';
          return <div key={key} className={`engine-work-item ${progress?.status ?? 'idle'}`}>
            <div className="engine-work-label"><strong>{label}</strong><span>{status}</span></div>
            <div className="engine-work-track" role="progressbar"
              aria-label={label} aria-valuemin={0} aria-valuemax={100}
              aria-valuenow={percent} aria-valuetext={status}>
              <div style={{ width: `${percent}%` }} />
            </div>
          </div>;
        })}
      </section>
      {/* Global Status / Alert Banner */}
      {loading && (
        <div className="engine-loading-banner">
          <div className="spinner-small" />
          <span>{loadingMessage}</span>
        </div>
      )}
      {renderProgress && (
        <div className="engine-loading-banner render">
          <div className="spinner-small" />
          <span>{renderProgress}</span>
        </div>
      )}
      {error && (
        <div className="engine-error-banner">
          <span>⚠️ {error}</span>
          <button type="button" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* STEP 1: IDEAS & PILLARS */}
      {step === 'ideas' && (
        <div className="engine-step-content">
          <div className="engine-two-col">
            {/* Left: Pillar & Filters Selector */}
            <div className="engine-sidebar-card">
              <h3>12 Trụ Cột Nội Dung (Content Pillars)</h3>
              <p className="hint">Chọn trụ cột khơi dậy cảm xúc mạnh mẽ nhất cho khán giả mục tiêu:</p>

              <div className="pillars-grid">
                {pillars.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    className={`pillar-chip ${selectedPillarId === p.id ? 'active' : ''}`}
                    style={{ borderColor: selectedPillarId === p.id ? p.colorTag : undefined }}
                    onClick={() => setSelectedPillarId(p.id)}
                  >
                    <span className="pillar-dot" style={{ backgroundColor: p.colorTag }} />
                    <span className="pillar-name">{p.name}</span>
                    <span className="pillar-sub">{p.vietnameseName}</span>
                  </button>
                ))}
              </div>

              <div className="pillar-details-box">
                <h4>🎯 {activePillar.name}</h4>
                <p>{activePillar.description}</p>
                <div className="pillar-meta">
                  <span><strong>Cảm xúc:</strong> {activePillar.targetEmotion}</span>
                  <span><strong>Đối tượng:</strong> {activePillar.targetAudience}</span>
                </div>
              </div>

              <div className="filter-group">
                <label>Ý tưởng ban đầu (Tùy chọn):</label>
                <textarea
                  value={seedPremise}
                  onChange={e => setSeedPremise(e.target.value)}
                  placeholder="Ví dụ: Anh cả đòi bán nhà đuổi em gái đi, người em gái bí mật mở di chúc..."
                  rows={2}
                />
              </div>

              <div className="filter-group">
                <label>Nhân vật chính:</label>
                <select value={selectedChar} onChange={e => setSelectedChar(e.target.value)}>
                  <option value="">-- Mặc định AI chọn --</option>
                  {STORY_DIMENSIONS.characters.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <div className="filter-group">
                <label>Bối cảnh chính:</label>
                <select value={selectedEnv} onChange={e => setSelectedEnv(e.target.value)}>
                  <option value="">-- Mặc định AI chọn --</option>
                  {STORY_DIMENSIONS.environments.map(e => (
                    <option key={e} value={e}>{e}</option>
                  ))}
                </select>
              </div>

              <div className="filter-group">
                <label>Mâu thuẫn hạt nhân:</label>
                <select value={selectedConflict} onChange={e => setSelectedConflict(e.target.value)}>
                  <option value="">-- Mặc định AI chọn --</option>
                  {STORY_DIMENSIONS.conflicts.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                className="engine-primary-btn"
                onClick={handleGenerateIdeas}
                disabled={loading}
              >
                {loading ? 'Đang tạo ý tưởng...' : '🚀 Tạo Ý Tưởng Thông Minh (AI Generate)'}
              </button>
            </div>

            {/* Right: Ideas Results Grid */}
            <div className="engine-main-card">
              <div className="card-header-flex">
                <h3>Danh Sách Ý Tưởng ({ideas.length})</h3>
                {selectedIdea && (
                  <button
                    type="button"
                    className="engine-secondary-btn"
                    onClick={() => handleSelectIdea(selectedIdea)}
                  >
                    👉 Tiến hành với ý tưởng đang chọn
                  </button>
                )}
              </div>

              {ideas.length === 0 ? (
                <div className="engine-empty-state">
                  <span className="empty-icon">💡</span>
                  <h4>Chưa có ý tưởng nào được tạo</h4>
                  <p>Chọn trụ cột bên trái và bấm <strong>"Tạo Ý Tưởng Thông Minh"</strong> để AI phân tích tâm lý khán giả US/UK và tạo ra các concept người que độc đáo.</p>
                </div>
              ) : (
                <div className="ideas-scroll-list">
                  {ideas.map((item, idx) => {
                    const isSelected = selectedIdea?.id === item.id;
                    const score = item.score.overall;
                    const scoreColor = score >= 88 ? '#22c55e' : score >= 80 ? '#3b82f6' : '#eab308';

                    return (
                      <div
                        key={item.id}
                        className={`engine-idea-card ${isSelected ? 'selected' : ''}`}
                        onClick={() => setSelectedIdea(item)}
                      >
                        <div className="idea-card-top">
                          <span className="idea-index">#{idx + 1}</span>
                          <h4 className="idea-title">{item.workingTitle}</h4>
                          <div className="score-badge" style={{ backgroundColor: scoreColor }}>
                            ★ {score}/100
                          </div>
                        </div>

                        <p className="idea-premise"><strong>Premise:</strong> {item.premise}</p>

                        <div className="idea-hook-box">
                          <span className="hook-tag">HOOK:</span>
                          <em>"{item.hook}"</em>
                        </div>

                        <div className="idea-details-grid">
                          <div><strong>Nhân vật:</strong> {item.mainCharacter} vs {item.supportingCharacters.join(', ')}</div>
                          <div><strong>Bối cảnh:</strong> {item.setting}</div>
                          <div><strong>Mâu thuẫn:</strong> {item.conflict}</div>
                          <div><strong>Cú Twist:</strong> {item.twist}</div>
                          <div><strong>Kết cục:</strong> {item.ending}</div>
                          <div><strong>Độ phức tạp:</strong> {item.estimatedComplexity}</div>
                        </div>

                        {/* Scores breakdown bar */}
                        <div className="score-bars-container">
                          <div className="score-bar-item">
                            <span>Hook: <strong>{item.score.hookStrength}</strong></span>
                            <div className="bar-track"><div className="bar-fill" style={{ width: `${item.score.hookStrength}%` }} /></div>
                          </div>
                          <div className="score-bar-item">
                            <span>Tò mò: <strong>{item.score.curiosity}</strong></span>
                            <div className="bar-track"><div className="bar-fill" style={{ width: `${item.score.curiosity}%` }} /></div>
                          </div>
                          <div className="score-bar-item">
                            <span>Cảm xúc: <strong>{item.score.emotionalIntensity}</strong></span>
                            <div className="bar-track"><div className="bar-fill" style={{ width: `${item.score.emotionalIntensity}%` }} /></div>
                          </div>
                          <div className="score-bar-item">
                            <span>Đồng cảm: <strong>{item.score.relatability}</strong></span>
                            <div className="bar-track"><div className="bar-fill" style={{ width: `${item.score.relatability}%` }} /></div>
                          </div>
                        </div>

                        <div className="idea-actions-row">
                          <span className="why-it-works">💡 {item.whyItMayWork}</span>
                          <button
                            type="button"
                            className="select-idea-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectIdea(item);
                            }}
                          >
                            👉 Chọn Ý Tưởng &amp; Sang Móc Câu
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* STEP 2: HOOK STUDIO */}
      {step === 'hooks' && selectedIdea && (
        <div className="engine-step-content">
          <div className="selected-idea-banner">
            <div>
              <span className="banner-tag">Ý TƯỞNG ĐANG PHÁT TRIỂN</span>
              <h3>{selectedIdea.workingTitle}</h3>
              <p>{selectedIdea.premise}</p>
            </div>
            <button
              type="button"
              className="engine-secondary-btn"
              onClick={() => setStep('ideas')}
            >
              ↩ Đổi Ý Tưởng Khác
            </button>
          </div>

          <div className="hooks-container">
            <div className="hooks-header">
              <div>
                <h3>5 Biến Thể Móc Câu Tâm Lý (Hook Engine)</h3>
                <p>Khán giả quyết định xem tiếp hay vuốt đi trong 2 giây đầu. Hãy chọn câu mở đầu có lực giữ chân cao nhất:</p>
              </div>
              <button
                type="button"
                className="engine-secondary-btn"
                onClick={() => handleSelectIdea(selectedIdea)}
                disabled={loading}
              >
                🔄 Tạo lại 5 Hook khác
              </button>
            </div>

            <div className="hooks-grid">
              {hooks.map(h => {
                const isChosen = selectedHook === h.text;
                return (
                  <div
                    key={h.id}
                    className={`hook-card ${isChosen ? 'chosen' : ''}`}
                    onClick={() => setSelectedHook(h.text)}
                  >
                    <div className="hook-card-top">
                      <span className={`hook-type-badge ${h.type.toLowerCase()}`}>{h.label}</span>
                      <span className="hook-score">Lực hút: {h.score}/100</span>
                    </div>
                    <p className="hook-text">"{h.text}"</p>
                    <button
                      type="button"
                      className={`hook-select-btn ${isChosen ? 'active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedHook(h.text);
                      }}
                    >
                      {isChosen ? '✓ Đã chọn Hook này' : 'Chọn Hook'}
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Custom Hook editor */}
            <div className="custom-hook-box">
              <label><strong>Móc câu đang chọn (Có thể chỉnh sửa theo ý bạn):</strong></label>
              <textarea
                value={selectedHook}
                onChange={e => setSelectedHook(e.target.value)}
                rows={2}
                className="custom-hook-input"
              />
            </div>

            <div className="hooks-action-bar">
              <button
                type="button"
                className="engine-primary-btn large"
                onClick={handleGenerateScript}
                disabled={loading || !selectedHook.trim()}
              >
                {loading ? 'Đang viết kịch bản...' : `🚀 Tiếp Tục: Biên Kịch ${format === 'SHORT' ? 'Video Short (7 Beats)' : 'Video Dài (10 Chương)'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STEP 3: SCRIPT STUDIO & LOCK */}
      {step === 'script' && selectedIdea && (
        <div className="engine-step-content">
          <div className="script-header-bar">
            <div>
              <h3>Kịch Bản Đa Phân Đoạn ({beats.length} Beats)</h3>
              <p>Mỗi phân đoạn có thời lượng, hành động, biểu cảm riêng. Bạn có thể chỉnh sửa trực tiếp hoặc bấm 🔒 Khóa để AI không bao giờ ghi đè lên phân đoạn ưng ý.</p>
            </div>
            <div className="script-header-actions">
              <button
                type="button"
                className="engine-secondary-btn"
                onClick={handleGenerateScript}
                disabled={loading}
              >
                🔄 Viết lại toàn bộ
              </button>
              <button
                type="button"
                className="engine-primary-btn"
                onClick={handleGenerateScenes}
                disabled={loading}
              >
                👉 Phân Cảnh Storyboard (Bước 4)
              </button>
            </div>
          </div>

          <div className="beats-list">
            {beats.map((beat, idx) => (
              <div key={beat.id} className={`beat-card ${beat.locked ? 'locked' : ''}`}>
                <div className="beat-card-header">
                  <div className="beat-title-left">
                    <span className="beat-idx">#{idx + 1}</span>
                    <span className="beat-label">{beat.label}</span>
                    <span className="beat-timerange">⏱️ {beat.timeRange}</span>
                  </div>

                  <div className="beat-actions-right">
                    <button
                      type="button"
                      className={`lock-btn ${beat.locked ? 'active' : ''}`}
                      onClick={() => toggleLockBeat(beat.id)}
                      title={beat.locked ? 'Đang khóa (AI sẽ không sửa)' : 'Bấm để khóa phân đoạn này'}
                    >
                      {beat.locked ? '🔒 ĐÃ KHÓA' : '🔓 MỞ KHÓA'}
                    </button>
                    <button
                      type="button"
                      className="regen-beat-btn"
                      onClick={() => {
                        setRegenBeatId(beat.id);
                        setRegenInstruction('');
                      }}
                    >
                      🔄 Viết lại beat này
                    </button>
                  </div>
                </div>

                <div className="beat-narration-box">
                  <textarea
                    value={beat.narration}
                    onChange={e => updateBeatNarration(beat.id, e.target.value)}
                    rows={3}
                    placeholder="Lời thuyết minh của phân đoạn..."
                  />
                </div>

                <div className="beat-tags-row">
                  <span className="beat-tag">🎭 Tư thế: <strong>{beat.action}</strong></span>
                  <span className="beat-tag">😊 Biểu cảm: <strong>{beat.emotion}</strong></span>
                  <span className="beat-tag">📹 Góc máy: <strong>{beat.camera}</strong></span>
                  {beat.soundEffect && (
                    <span className="beat-tag sound">🔊 Âm thanh: <strong>{beat.soundEffect}</strong></span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Regenerate Single Beat Modal */}
          {regenBeatId && (
            <div className="modal-backdrop">
              <div className="modal-box">
                <h4>🔄 Viết lại phân đoạn #{beats.findIndex(b => b.id === regenBeatId) + 1}</h4>
                <p>Nhập yêu cầu điều chỉnh riêng cho phân đoạn này (AI sẽ tôn trọng các phân đoạn xung quanh):</p>
                <textarea
                  value={regenInstruction}
                  onChange={e => setRegenInstruction(e.target.value)}
                  placeholder="Ví dụ: Làm cho câu thoại gắt hơn, thêm chi tiết sếp tức tối đập bàn..."
                  rows={3}
                />
                <div className="modal-actions">
                  <button type="button" className="engine-secondary-btn" onClick={() => setRegenBeatId(null)}>Hủy</button>
                  <button type="button" className="engine-primary-btn" onClick={handleRegenBeat} disabled={loading}>
                    {loading ? 'Đang viết lại...' : 'Viết lại ngay'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* STEP 4: STORYBOARD SCENES */}
      {step === 'scenes' && selectedIdea && (
        <div className="engine-step-content">
          <div className="script-header-bar">
            <div>
              <h3>Phân Cảnh Storyboard Vector ({scenes.length} Cảnh)</h3>
              <p>Mỗi cảnh được ánh xạ chính xác với hệ thống 12 Bối cảnh và 29 Hành động người que, sẵn sàng render hình ảnh và video 60fps.</p>
            </div>
            <button
              type="button"
              className="engine-primary-btn"
              onClick={handleGeneratePackage}
              disabled={loading}
            >
              {format === 'SHORT' ? '👉 Đóng gói để Generate Reel (Bước 6)' : '👉 Đóng gói & Xuất bản (Bước 6)'}
            </button>
          </div>

          <div className="scenes-grid">
            {scenes.map(s => (
              <div key={s.sceneNumber} className="scene-card">
                <div className="scene-card-top">
                  <span className="scene-badge">Cảnh #{s.sceneNumber} ({s.duration}s)</span>
                  <span className="scene-location">📍 {s.location}</span>
                </div>

                <p className="scene-narration">"{s.narration}"</p>

                <div className="scene-cast-box">
                  <strong>Diễn viên Stickman:</strong>
                  {s.characters.map((c, i) => (
                    <span key={i} className="cast-chip">
                      👤 {c.name} ({c.action} / {c.emotion} {c.outfit ? `• ${c.outfit}` : ''} {c.prop ? `• cầm ${c.prop}` : ''})
                    </span>
                  ))}
                </div>

                <div className="scene-prompts-box">
                  <div className="prompt-item">
                    <span className="prompt-label">🖼️ Prompt Ảnh (Vector 2D):</span>
                    <code>{s.imagePrompt}</code>
                  </div>
                  <div className="prompt-item">
                    <span className="prompt-label">🎬 Prompt Chuyển Động:</span>
                    <code>{s.animationPrompt}</code>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* STEP 5: CHARACTERS & ASSETS */}
      {step === 'assets' && (
        <div className="engine-step-content">
          <div className="script-header-bar">
            <div>
              <h3>Thư Viện Tài Nguyên Hoạt Hình Stickman</h3>
              <p>Hệ thống quy chuẩn tạo hình nhất quán xuyên suốt mọi tập phim, giúp nhận diện thương hiệu mạnh trên YouTube Shorts và TikTok.</p>
            </div>
          </div>

          <div className="assets-section">
            <h4>🎭 Tạo hình &amp; chuyển động nhân vật</h4>
            <p>1. Chọn vai và giữ tên riêng → 2. Cố định tóc, trang phục, dấu hiệu nhận diện → 3. Chọn hành động theo lời kể → 4. Kiểm tra storyboard trước khi dựng video.</p>
            <img className="stickman-cast-preview" src={castPreview} alt="Mẫu chuyển động từ renderer: nhân vật chính vest đen cà vạt đỏ đi bộ, nữ chính tóc đuôi ngựa và bạn thân tóc ngắn" />
            <p>Mẫu chuyển động của bộ nhân vật mặc định. Nhân vật trong từng truyện sẽ có tên, biểu cảm và đạo cụ riêng theo phân cảnh.</p>
            <div className="roles-overview-grid">
              <div className="role-card main">
                <div className="role-avatar main" />
                <h5>MAIN (Nhân vật chính)</h5>
                <p>Đầu tròn trắng, mắt đơn giản, body que đen, mặc <strong>vest đen, cà vạt đỏ</strong>.</p>
              </div>
              <div className="role-card girlfriend">
                <div className="role-avatar girlfriend" />
                <h5>GIRLFRIEND (Bạn gái / Nữ chính)</h5>
                <p>Đầu tròn trắng, tóc đen đuôi ngựa, <strong>váy đen và tay chân thanh gọn</strong>.</p>
              </div>
              <div className="role-card bestfriend">
                <div className="role-avatar bestfriend" />
                <h5>BEST_FRIEND (Bạn thân / Đồng minh)</h5>
                <p>Đầu tròn trắng, body que đen, tóc ngắn, mặc <strong>áo đen đơn giản</strong>.</p>
              </div>
              <div className="role-card supporting">
                <div className="role-avatar supporting" />
                <h5>SUPPORTING (Nhân vật phụ)</h5>
                <p>Đa dạng kiểu tóc (xoăn, vuốt spiky, đuôi ngựa, mũ lưỡi trai) và trang phục (bác sĩ, cảnh sát, vest, tạp dề).</p>
              </div>
            </div>
          </div>

          <div className="assets-section">
            <h4>📍 12 Bối Cảnh Vector Sống Động (Settings)</h4>
            <div className="settings-tags-cloud">
              {['home (Nhà / Phòng khách)', 'street (Đường phố & Skyline)', 'park (Công viên & Cây cổ thụ)', 'office (Văn phòng & Bảng biểu đồ)', 'school (Trường học & Bảng đen)', 'hospital (Bệnh viện & Máy ECG)', 'restaurant (Nhà hàng & Đèn chùm)', 'cafe (Quán cà phê & Menu bảng)', 'bedroom (Phòng ngủ & Trăng sao)', 'car (Khoang buồng lái ô tô)', 'beach (Bãi biển & Cây dừa)', 'courtroom (Phòng xử án & Búa công lý)'].map(s => (
                <span key={s} className="setting-pill">🏛️ {s}</span>
              ))}
            </div>
          </div>

          <div className="assets-section">
            <h4>⚡ 29 Hành Động Stickman (Actions)</h4>
            <div className="actions-tags-cloud">
              {['shock (giật mình)', 'fight (thủ thế đấm đá)', 'dance (nhảy múa)', 'laugh (cười Haha)', 'cheer (ăn mừng)', 'beg (quỳ van xin)', 'fall (ngã nhào)', 'kneel (quỳ gối)', 'think (suy nghĩ ?)', 'shrug (nhún vai)', 'facepalm (che mặt)', 'drive (lái xe)', 'drink (uống nước)', 'type (gõ phím)', 'sleep (ngủ Zzz)', 'handshake (bắt tay)', 'sit', 'stand', 'walk', 'run', 'talk', 'cry', 'happy', 'angry', 'wave', 'read', 'phone', 'carry', 'point'].map(a => (
                <span key={a} className="action-pill">🏃 {a}</span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* STEP 6: PACKAGE & RENDER */}
      {step === 'package' && pkg && (
        <div className="engine-step-content">
          <div className="package-banner">
            <div>
              <span className="banner-tag">HOÀN TẤT ĐÓNG GÓI NỘI DUNG</span>
              <h2>{pkg.title}</h2>
              <p className="hook-highlight">Hook: "{pkg.selectedHook}"</p>
            </div>
            <div className="package-actions-top">
              <button type="button" className="engine-render-btn" disabled={loading || voiceBusy} onClick={() => void handleRenderStickVideo()}>
                {loading ? 'Đang xử lý…' : format === 'SHORT' ? '🎬 Generate Reel · 9:16' : '🎬 Generate Video dài · 16:9'}
              </button>
              <button type="button" className="engine-secondary-btn" onClick={handleCopyPackage}>
                📋 Sao chép Gói Nội Dung
              </button>
              {format === 'SHORT' && (
                <button type="button" className="engine-expand-btn" onClick={handleExpandToLong}>
                  🎬 Mở rộng Short → Long-Form (10m)
                </button>
              )}
            </div>
          </div>

          <section className="engine-sidebar-card">
            <h3>📱 Chia truyện thành nhiều YouTube Shorts</h3>
            <p>Mỗi tập có hook, câu chuyện, tiêu đề, mô tả và hashtags riêng. Mục tiêu 30–60 giây/tập; thời lượng thực tế phụ thuộc voice. Video và metadata được lưu trong output riêng từng tập.</p>
            <div className="button-row">
              <label>Số tập <select value={reelCount} disabled={loading} onChange={event => setReelCount(Number(event.target.value))}>
                {[2, 3, 4, 5, 6, 8, 10].map(count => <option key={count} value={count}>{count} Reel</option>)}
              </select></label>
              <button type="button" className="engine-primary-btn" disabled={loading || !selectedProjectId} onClick={() => void splitStudioReels()}>1. Chia thành {reelCount} Reel</button>
              <button type="button" className="engine-render-btn" disabled={loading || voiceBusy || !studioReels.length} onClick={() => void renderStudioReels(studioReels)}>2. Dựng tất cả Reel · 9:16</button>
            </div>
            {studioReels.map((episode, index) => <article key={episode.scriptId} className="package-card">
              <h4>Tập {index + 1}: {episode.title} {completedReels.includes(episode.scriptId) ? '✓ Đã dựng' : ''}</h4>
              <p>{episode.content}</p>
              <div className="caption-box-wrapper">
                <div className="caption-box-header">
                  <strong>💬 Caption Đăng Video (Reels / TikTok / FB)</strong>
                  <button type="button" className="engine-secondary-btn-sm" onClick={() => handleCopyCaption(episode.caption)}>📋 Copy Caption</button>
                </div>
                <textarea
                  value={episode.caption}
                  readOnly
                  rows={3}
                  className="package-textarea caption-field"
                />
              </div>
              <p><strong>Description:</strong> {episode.description}</p>
              <p>{episode.hashtags.join(' ')}</p>
              <div className="button-row">
                <button type="button" disabled={loading || voiceBusy} onClick={() => void renderStudioReels([episode])}>Dựng / thử lại tập này</button>
                <button type="button" onClick={() => void window.contentFactory.app.revealFile(`${episode.outputDir}/publish.txt`).catch(error => setError(String(error)))}>Mở output tập {index + 1}</button>
                <button type="button" onClick={() => void handleCopyCaption(episode.caption)}>Copy caption</button>
                <button type="button" onClick={() => void window.contentFactory.app.copyText([`=== ${episode.title} ===`, `[CAPTION (REELS / TIKTOK / FB)]:\n${episode.caption}`, `[DESCRIPTION]:\n${episode.description}`, `[HASHTAGS]:\n${episode.hashtags.join(' ')}`].join('\n\n')).catch(error => setError(String(error)))}>Copy tất cả</button>
              </div>
            </article>)}
          </section>
          <div className="package-grid">
            {/* Left: Thumbnail & Titles */}
            <div className="package-card">
              <h4>🖼️ Concept Thumbnail YouTube Thu Hút</h4>
              <div className="thumbnail-preview-box">
                <div className="thumb-mockup">
                  <div className="thumb-text-overlay">{pkg.thumbnailText}</div>
                  <div className="thumb-character-demo">🎭 Stickman Drama</div>
                </div>
                <div className="thumb-info">
                  <p><strong>Chữ nổi trên thumbnail (2–4 từ):</strong> <span className="highlight-text">{pkg.thumbnailText}</span></p>
                  <p><strong>Mô tả bố cục:</strong> {pkg.thumbnailConcept}</p>
                  <p><strong>Prompt sinh Thumbnail:</strong> <code>{pkg.thumbnailPrompt}</code></p>
                </div>
              </div>

              <h4 style={{ marginTop: '1.5rem' }}>🔤 5 Kiểu Tiêu Đề Thử Nghiệm A/B</h4>
              <ul className="titles-list">
                {pkg.alternativeTitles.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>

            {/* Right: Caption, Description & SEO */}
            <div className="package-card">
              <div className="caption-box-wrapper">
                <div className="caption-box-header">
                  <h4>💬 Caption Cho Video (Reels / TikTok / FB)</h4>
                  <button type="button" className="engine-secondary-btn-sm" onClick={() => handleCopyCaption(pkg.caption)}>
                    📋 Copy Caption
                  </button>
                </div>
                <textarea
                  value={pkg.caption}
                  readOnly
                  rows={4}
                  className="package-textarea caption-field highlight-caption"
                />
              </div>

              <h4 style={{ marginTop: '1.25rem' }}>📝 Mô Tả &amp; SEO YouTube</h4>
              <textarea
                value={pkg.description}
                readOnly
                rows={5}
                className="package-textarea"
              />

              <h4 style={{ marginTop: '1rem' }}>🏷️ Hashtags Đề Xuất</h4>
              <div className="hashtags-list">
                {pkg.hashtags.map((h, i) => (
                  <span key={i} className="hashtag-chip">{h}</span>
                ))}
              </div>

              <h4 style={{ marginTop: '1rem' }}>📣 Call To Action (Kêu gọi hành động)</h4>
              <p className="cta-box">"{pkg.cta}"</p>

              <h4 style={{ marginTop: '1rem' }}>🔗 Ý Tưởng Tập Nối Tiếp (Series Sequels)</h4>
              <ul className="sequels-list">
                {pkg.relatedVideoIdeas.map((idea, i) => (
                  <li key={i}>✨ {idea}</li>
                ))}
              </ul>
            </div>
          </div>

          {/* 1-Click Render Stickman Video Bar */}
          <div className="render-action-bar">
            <div className="render-info">
              <h4>{format === 'SHORT' ? '📱 Tạo Reel từ kịch bản Short · 9:16' : '🎥 Dựng Video Hoạt Hình Người Que 60fps'}</h4>
              <p>Hệ thống sẽ tự động ghép phân cảnh Storyboard, đồng bộ giọng đọc AI, gắn tự động Caption/Phụ đề 60fps và xuất video định dạng {format === 'SHORT' ? '9:16 Dọc (Short/Reel)' : '16:9 Ngang (YouTube Long)'}.</p>
            </div>
            <button
              type="button"
              className="engine-render-btn"
              onClick={handleRenderStickVideo}
              disabled={loading}
            >
              {loading ? 'Đang xử lý...' : format === 'SHORT' ? '🚀 GENERATE REEL · 9:16' : '🚀 GENERATE VIDEO DÀI · 16:9'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

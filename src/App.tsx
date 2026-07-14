import React, { useState, useEffect, useRef, ChangeEvent } from 'react';
import { 
  Play, Square, Layers, Sparkles, AlertCircle, Headphones, 
  HelpCircle, Volume2, Music, CheckCircle2, ChevronRight, BookOpen,
  FolderOpen, FileUp, Loader2, AlertTriangle
} from 'lucide-react';
import { KontaktSample, SynthParams } from './types';
import { KontaktEngine } from './audio/KontaktEngine';
import { KontaktSynth } from './components/KontaktSynth';
import { KontaktParser } from './utils/KontaktParser';

export interface Library {
  id: string;
  name: string;
  samples: KontaktSample[];
  type: 'preset' | 'custom';
  params: SynthParams;
  mappingMode?: 'chromatic' | 'oneshot' | 'hybrid';
}

const AUDIO_EXT_RE = /\.(wav|mp3|flac|ogg|aif|aiff|m4a)$/i;

export default function App() {
  const [audioCtx, setAudioCtx] = useState<AudioContext | null>(null);
  const [kontaktEngine, setKontaktEngine] = useState<KontaktEngine | null>(null);
  const [activeKeys, setActiveKeys] = useState<Set<number>>(new Set());
  const [engineActive, setEngineActive] = useState<boolean>(false);
  const [isInitializing, setIsInitializing] = useState<boolean>(false);

  // BUG FIX: guards against a double-AudioContext race. `audioCtx` state is only
  // committed on the next render, so two near-simultaneous callers (the global
  // window 'mousedown' auto-activation listener and an explicit upload-triggered
  // call from the SAME physical click) could both read audioCtx as null and each
  // construct their own AudioContext, leaking one. A synchronous ref closes that
  // window regardless of React's render/commit timing.
  const audioCtxPromiseRef = useRef<Promise<AudioContext | null> | null>(null);
  
  // Library manager states (Pre-populate Soulfi out of the box!)
  const [libraries, setLibraries] = useState<Library[]>([
    { 
      id: 'custom_init', 
      name: 'Custom Library (Empty)', 
      type: 'custom', 
      samples: [], 
      params: {
        attack: 0.05, decay: 0.1, sustain: 0.8, release: 0.3,
        volume: 0.8, pan: 0,
        filterType: 'lowpass', filterCutoff: 5000, filterReso: 1.0,
        lfoRate: 1, lfoDepth: 0, lfoType: 'sine', lfoTarget: 'none',
        fineTune: 0, transpose: 0, glide: 0,
        chipEmulation: 'none',
        bitDepth: 24,
        resamplingQuality: 'hifi',
        analogWarmth: 0,
        dacColor: 0,
        pitchEnvAttack: 0.1,
        pitchEnvDecay: 0.3,
        pitchEnvDepth: 0,
        sidechainGain: 50
      }, 
      mappingMode: 'chromatic' 
    }
  ]);
  const [activeLibId, setActiveLibId] = useState<string>('custom_init');

  // File loading progress states
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string>('');

  // Immersive UI hardware meter simulations
  const [cpu, setCpu] = useState<number>(12);
  const [disk, setDisk] = useState<number>(2);
  const [showManual, setShowManual] = useState<boolean>(false);
  const [savedPresets, setSavedPresets] = useState<string[]>([]);

  const zipInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Load saved presets on mount
  useEffect(() => {
    if (kontaktEngine) {
      setSavedPresets(kontaktEngine.getSavedPresets());
    }
  }, [kontaktEngine]);

  const handleSavePreset = () => {
    if (!kontaktEngine) return;
    const name = prompt("Enter preset name:", `Preset ${savedPresets.length + 1}`);
    if (name) {
      kontaktEngine.savePreset(name);
      setSavedPresets(kontaktEngine.getSavedPresets());
    }
  };

  const handleLoadPreset = (name: string) => {
    if (!kontaktEngine) return;
    const params = kontaktEngine.loadPreset(name);
    if (params) {
      // Update libraries state with new params
      setLibraries(libs => libs.map(l => l.id === activeLibId ? { ...l, params } : l));
      kontaktEngine.updateEffects(params);
    }
  };

  const handleCreateOneShot = async () => {
    if (!kontaktEngine || !audioCtx) return;
    setUploadStatus("Rendering One-Shot...");
    setUploadProgress(50);
    const buffer = await kontaktEngine.renderOneShot(60, 1.5);
    
    // Add to current library
    const newSample: KontaktSample = {
      id: `oneshot_${Date.now()}`,
      name: `OneShot_Render_${Date.now()}`,
      buffer,
      midiNote: 60,
      velocityLow: 0,
      velocityHigh: 127,
      velocity: 100,
      articulation: 'default',
      isDrum: false
    };

    setLibraries(libs => libs.map(l => l.id === activeLibId ? { ...l, samples: [...l.samples, newSample] } : l));
    setUploadStatus("One-Shot Created");
    setUploadProgress(100);
    setTimeout(() => setUploadProgress(null), 1500);
  };

  const activeLibrary = libraries.find(l => l.id === activeLibId) || libraries[0];

  // Real-time CPU & DISK calculation based on Web Audio state and engine activity
  useEffect(() => {
    const interval = setInterval(() => {
      if (!audioCtx || !kontaktEngine) {
        setCpu(0);
        setDisk(0);
        return;
      }

      if (audioCtx.state === 'suspended') {
        setCpu(0);
        setDisk(0);
        return;
      }

      // Calculate active voice count
      const activeVoicesCount = kontaktEngine.getActiveVoicesCount ? kontaktEngine.getActiveVoicesCount() : 0;
      
      // Real-time CPU calculation:
      // - Base idle engine overhead: 3-5%
      // - Voice load: ~2.1% per playing voice
      // - DSP Emulation multiplier: If chip emulation is on (ASR10, SP1200), increase CPU load
      const isEmulating = kontaktEngine.params?.chipEmulation !== 'none';
      const dacComplexity = (kontaktEngine.params?.dacColor ?? 0) / 100;
      const baseCpu = 3.5 + dacComplexity * 1.5;
      const voiceLoad = activeVoicesCount * (isEmulating ? 4.2 : 2.1);
      
      // Dynamic jitter to mimic authentic CPU fluctuation
      const cpuJitter = (Math.random() - 0.5) * 0.8;
      const finalCpu = Math.max(1, Math.min(99, Math.round(baseCpu + voiceLoad + cpuJitter)));
      
      // Real-time Disk stream load calculation:
      // - Spikes on sample loading / decoding or when active voices are playing (streaming samples from memory)
      let targetDisk = 0;
      if (uploadProgress !== null && uploadProgress > 0 && uploadProgress < 100) {
        targetDisk = Math.round(45 + Math.random() * 20);
      } else if (activeVoicesCount > 0) {
        targetDisk = Math.round(activeVoicesCount * 3.5 + Math.random() * 3);
      } else {
        targetDisk = Math.round(Math.random() * 0.8);
      }

      setCpu(finalCpu);
      setDisk(Math.min(100, Math.round(targetDisk)));
    }, 200);

    return () => clearInterval(interval);
  }, [audioCtx, kontaktEngine, uploadProgress]);

  // Initialize Web Audio Engine (either explicitly or transparently on first click)
  // BUG FIX: previously guarded only with `if (audioCtx) return audioCtx;`, which reads
  // React state that hasn't committed yet for any second caller that fires before the
  // first call's setAudioCtx() takes effect (e.g. a single click bubbling to both the
  // global auto-activation listener and an explicit button handler). Now shares a single
  // in-flight promise via a ref so concurrent callers all await the same initialization
  // instead of each constructing their own AudioContext.
  const handleActivateEngine = async (): Promise<AudioContext | null> => {
    if (audioCtx) return audioCtx;
    if (audioCtxPromiseRef.current) return audioCtxPromiseRef.current;

    const initPromise = (async () => {
      setIsInitializing(true);
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }

        const dest = ctx.destination;
        const kEngine = new KontaktEngine(ctx, dest);

        setAudioCtx(ctx);
        setKontaktEngine(kEngine);
        setEngineActive(true);
        return ctx;
      } catch (e) {
        console.error("Audio Context initialization failed:", e);
        return null;
      } finally {
        setIsInitializing(false);
        audioCtxPromiseRef.current = null;
      }
    })();

    audioCtxPromiseRef.current = initPromise;
    return initPromise;
  };

  // Automated background activation on any human click/press
  useEffect(() => {
    const handleFirstInteraction = async () => {
      if (!audioCtx) {
        await handleActivateEngine();
      } else if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }
      window.removeEventListener('mousedown', handleFirstInteraction);
      window.removeEventListener('keydown', handleFirstInteraction);
      window.removeEventListener('touchstart', handleFirstInteraction);
    };

    window.addEventListener('mousedown', handleFirstInteraction);
    window.addEventListener('keydown', handleFirstInteraction);
    window.addEventListener('touchstart', handleFirstInteraction);

    return () => {
      window.removeEventListener('mousedown', handleFirstInteraction);
      window.removeEventListener('keydown', handleFirstInteraction);
      window.removeEventListener('touchstart', handleFirstInteraction);
    };
  }, [audioCtx]);

  // Synchronize library samples when active library or its samples list changes
  useEffect(() => {
    if (!kontaktEngine || !activeLibrary) return;
    
    // 'hybrid' is a classification-report label (mixed drum/pitched library); the engine
    // handles that mix per-sample via each sample's isDrum flag, so only pass it a mode it
    // actually understands, falling back to 'chromatic' for anything else ('hybrid' included).
    const engineMappingMode: 'chromatic' | 'oneshot' =
      activeLibrary.mappingMode === 'oneshot' ? 'oneshot' : 'chromatic';
    kontaktEngine.mappingMode = engineMappingMode;
    kontaktEngine.loadLibrary(activeLibrary.name, activeLibrary.samples, engineMappingMode);
    
    activeLibrary.samples.forEach(sample => {
      if (sample.buffer) {
        kontaktEngine.setBuffer(sample.id, sample.buffer);
        kontaktEngine.setBuffer(sample.name, sample.buffer);
      }
    });
  }, [kontaktEngine, activeLibrary.id, activeLibrary.samples, activeLibrary.mappingMode]);

  // Synchronize real-time synth controls and effects when tweaked (drag knobs) without reloading samples!
  useEffect(() => {
    if (!kontaktEngine || !activeLibrary) return;
    
    kontaktEngine.params = activeLibrary.params;
    kontaktEngine.updateEffects(activeLibrary.params);
  }, [kontaktEngine, activeLibrary.params]);

  // Keyboard Play trigger helpers
  const handlePlayNote = (midiNote: number, velocity: number = 100) => {
    if (kontaktEngine) {
      kontaktEngine.playNote(midiNote, velocity);
    }

    setActiveKeys((prev) => {
      const copy = new Set(prev);
      copy.add(midiNote);
      return copy;
    });
  };

  const handleNoteOff = (midiNote: number) => {
    if (kontaktEngine) {
      kontaktEngine.noteOff(midiNote);
    }

    setActiveKeys((prev) => {
      const copy = new Set(prev);
      copy.delete(midiNote);
      return copy;
    });
  };

  const handleSystemPanic = () => {
    if (kontaktEngine) {
      kontaktEngine.panic();
    }
    setActiveKeys(new Set());
  };

  // File Importer Logic
  const handleFileLoad = async (e: ChangeEvent<HTMLInputElement>) => {
    const filesList = e.target.files ? Array.from(e.target.files) : [];
    if (filesList.length === 0) return;
    
    const files = filesList as File[];

    // Look for an NKI or retro hardware descriptor in the batch
    const nkiFile = files.find(f => /\.(nki|ninct)$/i.test(f.name));
    const zipFile = files.find(f => /\.zip$/i.test(f.name));
    const retroFile = files.find(f => /\.(sfz|sf2|akp|kmp|svd|krz|k25|efe|edm)$/i.test(f.name));
    const audioFile = files.find(f => AUDIO_EXT_RE.test(f.name));

    if (retroFile) {
      await handleFolderLoad(files);
    } else if (nkiFile) {
      try {
        await handleArchiveLoad(nkiFile, files);
      } catch (e) {
        console.warn("NKI load failed, falling back to folder analysis:", e);
        if (files.length > 1) {
          await handleFolderLoad(files);
        } else {
          // Re-throw if it's just a single NKI file that failed
          throw e;
        }
      }
    } else if (zipFile) {
      await handleArchiveLoad(zipFile, files);
    } else if (files.length > 1) {
      await handleFolderLoad(files);
    } else if (audioFile) {
      // BUG FIX: previously a single raw audio file (.wav/.mp3/.flac/etc) had no
      // matching branch and always fell through to the "Unsupported file type"
      // alert, even though handleFolderLoad's audioFiles filter explicitly
      // supports these extensions for multi-file uploads. A single sample/one-shot
      // upload is a normal use case, so route it through the same folder loader.
      await handleFolderLoad(files);
    } else {
      const file = files[0];
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext === 'zip' || ext === 'nki' || ext === 'ninct') {
        await handleArchiveLoad(file, files);
      } else {
        alert('Unsupported file type. Please upload a .zip, .nki, .ninct, a supported audio file (.wav, .mp3, .flac, .ogg, .aif, .aiff, .m4a), or a supported vintage hardware format (.sf2, .sfz, .akp, .kmp, .krz, .k25, .efe, .edm).');
      }
    }
  };

  const handleArchiveLoad = async (file: File, allFiles: File[] = []) => {
    let ctxToUse = audioCtx;
    if (!ctxToUse) {
      ctxToUse = await handleActivateEngine();
      if (!ctxToUse) {
        ctxToUse = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
    }

    setUploadProgress(0);
    setUploadStatus(`Processing ${file.name}...`);

    try {
      let result;
      const isNki = /\.(nki|ninct)$/i.test(file.name);
      if (isNki) {
        result = await KontaktParser.parseNkiFile(
          file,
          ctxToUse,
          (progress, current) => {
            setUploadProgress(Math.min(99, Math.floor(progress)));
            setUploadStatus(`Decoding ${current}`);
          }
        );

        // If it's a patch NKI (no samples yet), try matching against other files in the upload
        if (result.samples.length === 0 && allFiles.length > 1) {
          setUploadStatus(`Matching external samples for ${file.name}...`);
          const matchedSamples = await KontaktParser.matchExternalSamples(
            result.report,
            allFiles,
            ctxToUse,
            (progress, current) => {
              setUploadProgress(Math.min(99, Math.floor(progress)));
              setUploadStatus(`Matching ${current}`);
            }
          );
          result.samples = matchedSamples;
        }
      } else {
        result = await KontaktParser.unzipLibrary(
          file,
          ctxToUse,
          (progress, current) => {
            setUploadProgress(Math.min(99, Math.floor(progress)));
            setUploadStatus(`Decoding ${current}`);
          }
        );
      }

      if (result.samples.length === 0) {
        throw new Error(`No audio samples could be loaded for "${file.name}". Ensure you have included the associated audio files.`);
      }

      const defaultCustomParams: SynthParams = {
        attack: 0.05,
        decay: 0.3,
        sustain: 0.7,
        release: 0.4,
        filterType: 'lowpass',
        filterCutoff: 3000,
        filterReso: 1.0,
        lfoRate: 3.5,
        lfoDepth: 0.0,
        lfoType: 'sine',
        lfoTarget: 'none',
        fineTune: 0,
        transpose: 0,
        glide: 0.05,
        chipEmulation: 'none',
        bitDepth: 24,
        resamplingQuality: 'hifi',
        analogWarmth: 0,
        dacColor: 0,
        sidechainGain: 50
      };

      const newLib: Library = {
        id: `custom_${Date.now()}`,
        name: result.name,
        samples: result.samples,
        type: 'custom',
        params: defaultCustomParams,
        mappingMode: result.mappingMode
      };

      setLibraries(prev => [...prev, newLib]);
      setActiveLibId(newLib.id);
      setUploadStatus(`Loaded library "${result.name}" with ${result.samples.length} samples!`);
      setTimeout(() => {
        setUploadProgress(null);
        setUploadStatus('');
      }, 3000);
    } catch (err: any) {
      console.error(err);
      const ext = file.name.split('.').pop()?.toLowerCase();
      const typeStr = (ext === 'nki' || ext === 'ninct') ? 'NKI' : 'ZIP';
      setUploadStatus(`${typeStr} load failed: ${err.message}`);
      setTimeout(() => {
        setUploadProgress(null);
        setUploadStatus('');
      }, 5000);
      throw err;
    }
  };

  // Folder Direct Importer Logic
  const handleFolderSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const filesList = Array.from(e.target.files) as File[];
      await handleFolderLoad(filesList);
    }
  };

  const handleFolderLoad = async (files: File[]) => {
    let ctxToUse = audioCtx;
    if (!ctxToUse) {
      ctxToUse = await handleActivateEngine();
      if (!ctxToUse) {
        ctxToUse = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
    }

    // NEW: Intercept retro keymap descriptors (SFZ, AKP, SF2, SVD, etc.) in raw folder loads
    const retroFiles = files.filter(f => /\.(sfz|sf2|akp|kmp|svd|krz|k25|efe|edm)$/i.test(f.name));
    if (retroFiles.length > 0) {
      setUploadProgress(0);
      setUploadStatus(`Processing ${retroFiles[0].name}...`);
      try {
        const filesWithWrapper = files.map(f => ({ path: f.name, file: f }));
        const retroResult = await KontaktParser.parseRetroInstrument(filesWithWrapper, ctxToUse, (progress, current) => {
          setUploadProgress(Math.min(99, Math.floor(progress)));
          setUploadStatus(`Decoding ${current}`);
        });

        if (retroResult) {
          const defaultCustomParams: SynthParams = {
            attack: 0.05,
            decay: 0.3,
            sustain: 0.7,
            release: 0.4,
            filterType: 'lowpass',
            filterCutoff: 3000,
            filterReso: 1.0,
            lfoRate: 3.5,
            lfoDepth: 0.0,
            lfoType: 'sine',
            lfoTarget: 'none',
            fineTune: 0,
            transpose: 0,
            glide: 0.05,
            chipEmulation: 'none',
            bitDepth: 24,
            resamplingQuality: 'hifi',
            analogWarmth: 0,
            dacColor: 0,
            pitchEnvAttack: 0.1,
            pitchEnvDecay: 0.3,
            pitchEnvDepth: 0,
            sidechainGain: 50
          };

          const newLib: Library = {
            id: `custom_${Date.now()}`,
            name: retroResult.name,
            samples: retroResult.samples,
            type: 'custom',
            params: defaultCustomParams,
            mappingMode: 'chromatic'
          };

          setLibraries(prev => [...prev, newLib]);
          setActiveLibId(newLib.id);
          setUploadStatus(`Loaded retro library "${retroResult.name}"!`);
          setTimeout(() => {
            setUploadProgress(null);
            setUploadStatus('');
          }, 3000);
          return; // Success!
        }
      } catch (e: any) {
        console.warn("Retro keymap parsing failed, falling back to raw folder scan:", e);
      }
    }

    // NEW: Check if there are NKIs in this folder to guide the mapping
    const nkiFiles = files.filter(f => /\.(nki|ninct|nkc|nkx)$/i.test(f.name));
    if (nkiFiles.length > 0) {
      // Sort NKIs to pick the "best" one:
      // 1. Avoid files with "demo", "example", "lite", "preview" in name
      // 2. Prefer larger files (more likely to be the full patch)
      const sortedNkis = [...nkiFiles].sort((a, b) => {
        const aName = a.name.toLowerCase();
        const bName = b.name.toLowerCase();
        const aIsDemo = /demo|example|lite|preview|tutorial/i.test(aName);
        const bIsDemo = /demo|example|lite|preview|tutorial/i.test(bName);
        
        if (aIsDemo && !bIsDemo) return 1;
        if (!aIsDemo && bIsDemo) return -1;
        
        return b.size - a.size; // Larger first
      });

      const bestNki = sortedNkis[0];
      try {
        await handleArchiveLoad(bestNki, files);
        return; // Success!
      } catch (e) {
        console.warn("NKI metadata parsing failed, falling back to raw folder scan:", e);
      }
    }

    const audioFiles = files.filter(f => {
      const isAudio = AUDIO_EXT_RE.test(f.name);
      const isMetadata = f.size < 1024 * 5; // Ignore files smaller than 5KB (unlikely to be real samples)
      return isAudio && !isMetadata;
    });

    if (audioFiles.length === 0) {
      alert("No valid audio files (WAV, MP3, FLAC, OGG, AIF) detected in the selected directory.");
      return;
    }

    setUploadProgress(0);
    setUploadStatus("Scanning folder samples...");
    const filePaths = audioFiles.map(f => f.webkitRelativePath || f.name);
    const report = KontaktParser.analyzeLibrary(filePaths);

    try {
      let folderName = "Custom Folder Library";
      if (audioFiles[0].webkitRelativePath) {
        const parts = audioFiles[0].webkitRelativePath.split('/');
        if (parts.length > 1) {
          folderName = parts[0].replace(/_|-/g, ' ');
        }
      } else if (audioFiles.length === 1) {
        // Single loose audio file (no webkitRelativePath): name the library after the file itself.
        folderName = audioFiles[0].name.replace(/\.[^/.]+$/, '');
      }

      const decodedSamples: KontaktSample[] = [];
      const total = audioFiles.length;

      for (let i = 0; i < total; i++) {
        const file = audioFiles[i];
        const path = file.webkitRelativePath || file.name;
        const meta = report.entries.find(e => e.path === path);
        
        if (!meta) continue; // Filtered or skipped by analyzeLibrary

        setUploadProgress(Math.floor((i / total) * 95));
        setUploadStatus(`Decoding ${file.name}`);

        try {
          const arrayBuffer = await file.arrayBuffer();
          const buffer = await ctxToUse.decodeAudioData(arrayBuffer);
          
          const sample: KontaktSample = {
            id: `sample_${Math.random().toString(36).substring(7)}`,
            name: file.name,
            buffer,
            midiNote: meta.midiNote,
            velocityLow: meta.velocityLow,
            velocityHigh: meta.velocityHigh,
            velocity: meta.velocity,
            articulation: meta.articulation,
            size: file.size,
            isDrum: meta.isDrum,
            roundRobinIdx: meta.roundRobinIdx
          };
          
          decodedSamples.push(sample);
        } catch (err) {
          console.warn(`Failed decoding sample "${file.name}":`, err);
        }
      }

      if (decodedSamples.length === 0) {
        throw new Error("No samples were decoded. Check if files are valid audio or were filtered as noise.");
      }

      const mappingMode = report.classification.mode;
      // Use the smarter mapping results directly
      const mapped = decodedSamples;

      const defaultCustomParams: SynthParams = {
        attack: 0.05,
        decay: 0.3,
        sustain: 0.7,
        release: 0.4,
        filterType: 'lowpass',
        filterCutoff: 3000,
        filterReso: 1.0,
        lfoRate: 3.5,
        lfoDepth: 0.0,
        lfoType: 'sine',
        lfoTarget: 'none',
        fineTune: 0,
        transpose: 0,
        glide: 0.05,
        chipEmulation: 'none',
        bitDepth: 24,
        resamplingQuality: 'hifi',
        analogWarmth: 0,
        dacColor: 0,
        pitchEnvAttack: 0.1,
        pitchEnvDecay: 0.3,
        pitchEnvDepth: 0,
        sidechainGain: 50
      };

      const newLib: Library = {
        id: `custom_${Date.now()}`,
        name: folderName,
        samples: mapped,
        type: 'custom',
        params: defaultCustomParams,
        mappingMode
      };

      setLibraries(prev => [...prev, newLib]);
      setActiveLibId(newLib.id);
      setUploadStatus(`Loaded folder library "${folderName}"!`);
      setTimeout(() => {
        setUploadProgress(null);
        setUploadStatus('');
      }, 3000);
    } catch (err: any) {
      console.error(err);
      setUploadStatus(`Folder import failed: ${err.message}`);
      setTimeout(() => {
        setUploadProgress(null);
        setUploadStatus('');
      }, 4000);
    }
  };

  return (
    <div className="min-h-screen bg-[#080808] bg-immersive-radial text-[#e0e0e0] font-sans flex flex-col selection:bg-orange-500/30 selection:text-white select-none">
      
      {/* Studio Header: Hosts direct upload buttons and performance metrics */}
      <header className="h-14 border-b border-[#222] bg-[#0c0c0c] flex items-center justify-between px-6 sticky top-0 z-50 shadow-md">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2.5">
            <div className="w-3.5 h-3.5 bg-orange-500 rounded-full shadow-[0_0_12px_rgba(249,115,22,0.85)] animate-pulse"></div>
            <span className="text-xs font-bold tracking-[0.25em] uppercase text-white font-mono">MegaSynth</span>
          </div>
          
          {/* File Upload Controls directly in the Header */}
          <div className="hidden md:flex items-center gap-2 border-l border-[#222] pl-6">
            <button
              onClick={() => zipInputRef.current?.click()}
              className="px-3 py-1.5 bg-[#151515] border border-[#222] hover:border-orange-500/50 hover:text-orange-400 text-[#aaa] rounded text-[10px] font-mono tracking-widest uppercase transition-all duration-200 active:scale-95 flex items-center gap-1.5 cursor-pointer shadow-[0_2px_4px_rgba(0,0,0,0.2)]"
              title="Load standard virtual instrument containers, raw audio samples, or vintage hardware sample dumps"
            >
              <FileUp className="w-3 h-3 text-orange-500" />
              Ingest Instrument (.zip, .nki, .sf2, .akp, .sfz, .wav, etc.)
            </button>
            <button
              onClick={() => folderInputRef.current?.click()}
              className="px-3 py-1.5 bg-[#151515] border border-[#222] hover:border-orange-500/50 hover:text-orange-400 text-[#aaa] rounded text-[10px] font-mono tracking-widest uppercase transition-all duration-200 active:scale-95 flex items-center gap-1.5 cursor-pointer shadow-[0_2px_4px_rgba(0,0,0,0.2)]"
              title="Load directory containing raw audio samples or vintage system programs with files"
            >
              <FolderOpen className="w-3 h-3 text-orange-500" />
              Load Folder
            </button>
            
            {/* Hidden Input Selectors */}
            <input 
              type="file" 
              ref={zipInputRef} 
              accept=".zip,.nki,.ninct,.sf2,.sfz,.akp,.kmp,.svd,.krz,.k25,.efe,.edm,.wav,.mp3,.flac,.ogg,.aif,.aiff,.m4a" 
              multiple
              onChange={handleFileLoad} 
              className="hidden" 
            />
            <input 
              type="file" 
              ref={folderInputRef} 
              webkitdirectory="" 
              directory="" 
              multiple 
              onChange={handleFolderSelect} 
              className="hidden" 
            />
          </div>
        </div>

        {/* Dynamic Import Progress Status Overlay */}
        {uploadProgress !== null && (
          <div className="flex-1 max-w-sm mx-4 bg-[#111] border border-[#222] rounded-lg p-1 px-3 flex items-center gap-3 shadow-inner">
            <Loader2 className="w-4 h-4 text-orange-500 animate-spin shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex justify-between text-[9px] font-mono font-bold text-orange-400">
                <span className="truncate uppercase">{uploadStatus}</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="w-full bg-[#1c1c1c] h-1 rounded-full overflow-hidden mt-0.5">
                <div className="bg-orange-500 h-full transition-all duration-100" style={{ width: `${uploadProgress}%` }}></div>
              </div>
            </div>
          </div>
        )}

        {/* Engine Status Indicators */}
        <div className="flex items-center gap-4 text-[10px] font-mono">
          <div className="flex items-center gap-1.5 px-2 py-1 bg-[#121212] rounded border border-[#222]">
            <span className="text-[#555] font-bold">CPU</span>
            <span className="text-orange-400 font-bold">{cpu}%</span>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1 bg-[#121212] rounded border border-[#222]">
            <span className="text-[#555] font-bold">DISK</span>
            <span className="text-orange-400 font-bold">{disk}%</span>
          </div>

          <div className="flex items-center gap-3">
            {/* Live Indicator which activates when context starts */}
            {engineActive ? (
              <div className="bg-[#121212] border border-[#222] px-2.5 py-1 rounded flex items-center gap-1.5 text-[9px] font-mono text-orange-400 font-bold">
                <span className="w-2 h-2 rounded-full bg-orange-500 animate-ping"></span>
                <span>LIVE (44.1K)</span>
              </div>
            ) : (
              <div className="bg-[#151515] border border-[#222] px-2.5 py-1 rounded flex items-center gap-1.5 text-[9px] font-mono text-emerald-500 font-bold animate-pulse">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                <span>READY (CLICK TO ACTIVATE)</span>
              </div>
            )}
            
            <button
              onClick={handleSystemPanic}
              className="px-2.5 py-1 bg-[#151515] border border-[#222] hover:border-orange-500/50 hover:text-orange-400 text-[#888] rounded text-[10px] font-mono transition-all duration-200 active:scale-95 shadow-sm uppercase tracking-wider"
              title="Silence all notes"
            >
              Panic
            </button>

            <button
              onClick={() => setShowManual(!showManual)}
              className={`p-1.5 rounded border transition-all duration-200 ${showManual ? 'bg-orange-500 border-orange-600 text-white' : 'bg-[#151515] border-[#222] text-[#888] hover:text-orange-400'}`}
              title="Manual & Help"
            >
              <HelpCircle className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-1 border-l border-[#222] pl-3 ml-1">
              <button
                onClick={handleSavePreset}
                className="p-1.5 bg-[#151515] border border-[#222] hover:border-emerald-500/50 hover:text-emerald-400 text-[#888] rounded transition-all active:scale-95"
                title="Save Preset"
              >
                <Sparkles className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleCreateOneShot}
                className="p-1.5 bg-[#151515] border border-[#222] hover:border-orange-500/50 hover:text-orange-400 text-[#888] rounded transition-all active:scale-95"
                title="Render One-Shot"
              >
                <Square className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Manual Modal Overlay */}
      {showManual && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#0c0c0c] border border-[#222] rounded-xl shadow-2xl max-w-4xl w-full max-h-[85vh] overflow-hidden flex flex-col">
            <div className="p-4 border-b border-[#222] flex justify-between items-center bg-[#111]">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-orange-500" />
                <h3 className="text-xs font-bold font-mono text-white uppercase tracking-widest">REFERENCE MANUAL</h3>
              </div>
              <button onClick={() => setShowManual(false)} className="text-[#666] hover:text-white transition-colors">
                <Square className="w-4 h-4 rotate-45" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-8 font-mono">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-6">
                  <div className="p-4 bg-[#151515] rounded border border-[#222] relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
                      <Music className="w-12 h-12" />
                    </div>
                    <h4 className="text-white font-bold text-[10px] uppercase flex items-center gap-1 tracking-wider mb-2">
                      <ChevronRight className="w-3 h-3 text-orange-500" /> 01. Ingestion Engine
                    </h4>
                    <p className="text-[10px] text-[#666] leading-relaxed uppercase">
                      Load full instrument libraries, single audio samples, or raw sample folders via ZIP, Folder, or Native formats (.nki, .sfz, .akp, .wav). The engine automatically detects keyzones and velocity layers.
                    </p>
                  </div>

                  <div className="p-4 bg-[#151515] rounded border border-[#222] relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
                      <Layers className="w-12 h-12" />
                    </div>
                    <h4 className="text-white font-bold text-[10px] uppercase flex items-center gap-1 tracking-wider mb-2">
                      <ChevronRight className="w-3 h-3 text-orange-500" /> 02. Hybrid Synthesis
                    </h4>
                    <p className="text-[10px] text-[#666] leading-relaxed uppercase">
                      Mix your samples with a dual-oscillator synth engine. Use the <span className="text-orange-400">MIXER</span> to blend the <span className="text-emerald-400">ROMPLER</span> with <span className="text-amber-400">SYNTH</span> layers.
                    </p>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="p-4 bg-[#151515] rounded border border-[#222] relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
                      <Sparkles className="w-12 h-12" />
                    </div>
                    <h4 className="text-white font-bold text-[10px] uppercase flex items-center gap-1 tracking-wider mb-2">
                      <ChevronRight className="w-3 h-3 text-orange-500" /> 03. Chip Emulation
                    </h4>
                    <p className="text-[10px] text-[#666] leading-relaxed uppercase">
                      Select vintage hardware models (SP-1200, SID, NES) to apply authentic aliasing, bit-reduction, and analog saturation to the entire signal path.
                    </p>
                  </div>

                  <div className="p-4 bg-[#151515] rounded border border-[#222] relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
                      <Headphones className="w-12 h-12" />
                    </div>
                    <h4 className="text-white font-bold text-[10px] uppercase flex items-center gap-1 tracking-wider mb-2">
                      <ChevronRight className="w-3 h-3 text-orange-500" /> 04. Key Commands
                    </h4>
                    <div className="grid grid-cols-2 gap-2 text-[9px] text-orange-400 uppercase font-black">
                      <div className="flex justify-between border-b border-orange-500/10 pb-1">
                        <span>Z - M</span> <span>Notes</span>
                      </div>
                      <div className="flex justify-between border-b border-orange-500/10 pb-1">
                        <span>1 - 4</span> <span>Drums</span>
                      </div>
                      <div className="flex justify-between border-b border-orange-500/10 pb-1">
                        <span>SPACE</span> <span>Panic</span>
                      </div>
                      <div className="flex justify-between border-b border-orange-500/10 pb-1">
                        <span>ENTER</span> <span>Save</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-[#222] bg-[#090909] text-center">
              <span className="text-[9px] font-mono text-[#444] uppercase tracking-[0.3em]">K-LOADER HYBRID WORKSTATION v2.0 // SIGNAL OPERATIONAL</span>
            </div>
          </div>
        </div>
      )}

      {/* Main Studio Console Grid - Pre-populated & Functional Immediately */}
      <main className="flex-1 p-4 md:p-6 lg:p-8 max-w-7xl mx-auto w-full flex flex-col gap-6">
        
        {/* Mobile Upload Section Fallback */}
        <div className="md:hidden bg-[#0c0c0c] border border-[#222] rounded-xl p-4 flex flex-col gap-3">
          <span className="text-[10px] font-mono text-[#666] uppercase font-bold tracking-wider">Mobile Sound Loader:</span>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => zipInputRef.current?.click()}
              className="p-2.5 bg-[#151515] border border-[#222] hover:border-orange-500/40 text-xs font-mono text-white rounded flex items-center justify-center gap-2"
            >
              <FileUp className="w-4 h-4 text-orange-500" />
              Instrument / ZIP
            </button>
            <button
              onClick={() => folderInputRef.current?.click()}
              className="p-2.5 bg-[#151515] border border-[#222] hover:border-orange-500/40 text-xs font-mono text-white rounded flex items-center justify-center gap-2"
            >
              <FolderOpen className="w-4 h-4 text-orange-500" />
              Folder
            </button>
          </div>
        </div>

        {/* Full-Width Workspace Layout */}
        <div className="flex-1 flex flex-col gap-6">
          <KontaktSynth
            engine={kontaktEngine}
            libraries={libraries}
            setLibraries={setLibraries}
            activeLibId={activeLibId}
            setActiveLibId={setActiveLibId}
            activeKeys={activeKeys}
            onPlayNote={handlePlayNote}
            onNoteOff={handleNoteOff}
          />
        </div>

      </main>

      {/* Footer Status Bar: Minimal global info */}
      <footer className="h-10 bg-[#080808] border-t border-[#222] flex items-center justify-between px-6 text-[9px] font-mono text-[#555] uppercase tracking-widest shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
            <span>System: Optimal</span>
          </div>
          <span>Library: {activeLibrary.name}</span>
          <span>Voices: {kontaktEngine?.getActiveVoicesCount() ?? 0}</span>
        </div>
        <div className="flex items-center gap-4">
          <p className="opacity-80">Engine latency: ultra-low latency native buffer | 44.1K Stereo</p>
          {savedPresets.length > 0 && (
            <div className="flex items-center gap-2 border-l border-[#222] pl-4">
              <span>Quick Presets:</span>
              <div className="flex gap-1">
                {savedPresets.slice(-3).map(p => (
                  <button key={p} onClick={() => handleLoadPreset(p)} className="hover:text-orange-400 transition-colors">[{p}]</button>
                ))}
              </div>
            </div>
          )}
        </div>
      </footer>

    </div>
  );
}
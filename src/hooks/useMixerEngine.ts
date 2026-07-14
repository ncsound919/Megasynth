import { useEffect, useRef, useState, useCallback } from 'react';
import { ChannelStripEngine } from '../engine/ChannelStripEngine';
import { MasterBusEngine } from '../engine/MasterBusEngine';
import { ChannelState, MasterState } from '../types';

interface UseMixerEngineArgs {
  audioContext: AudioContext;
  channelSources: Record<string, AudioNode>; // real audio sources per channel id
  destination: AudioNode; // final output (e.g. audioContext.destination)
  channels: ChannelState[];
  master: MasterState;
}

/**
 * Drives the entire real audio graph for the mixer and returns MEASURED
 * meter data instead of arbitrary prop values. This is the missing link
 * between the UI (ProMixerConsole) and actual sound.
 */
export function useMixerEngine({
  audioContext,
  channelSources,
  destination,
  channels,
  master,
}: UseMixerEngineArgs) {
  const stripsRef = useRef<Map<string, ChannelStripEngine>>(new Map());
  const masterBusRef = useRef<MasterBusEngine | null>(null);
  const busGainsRef = useRef<Record<'bus1' | 'bus2' | 'bus3' | 'bus4', GainNode> | null>(null);
  const outputRoutesRef = useRef<Record<'master' | 'out2' | 'out3' | 'out4', AudioNode> | null>(null);

  const [peakLevels, setPeakLevels] = useState<Record<string, number>>({});
  const [peakLEDs, setPeakLEDs] = useState<Record<string, boolean>>({});
  const [masterGrDb, setMasterGrDb] = useState(0);
  const [masterOutput, setMasterOutput] = useState<AudioNode | null>(null);
  const [analysers, setAnalysers] = useState<Record<string, AnalyserNode>>({});

  // --- One-time graph construction ---
  useEffect(() => {
    if (!audioContext) return;
    const masterBus = new MasterBusEngine(audioContext, destination || null);
    masterBus.onGainReduction = (gr) => setMasterGrDb(gr);
    masterBusRef.current = masterBus;
    setMasterOutput(masterBus.masterOutput);

    // Real output route destinations (out2-4 are additional real gain nodes you can tap for monitoring/recording)
    outputRoutesRef.current = {
      master: audioContext.createGain(), // feeds into masterBus below
      out2: audioContext.createGain(),
      out3: audioContext.createGain(),
      out4: audioContext.createGain(),
    };
    (outputRoutesRef.current.master as GainNode).connect(masterBus.input ? masterBus.input : (destination || audioContext.destination));

    // Real bus send destinations (4 auxiliary buses, each summed independently)
    busGainsRef.current = {
      bus1: audioContext.createGain(),
      bus2: audioContext.createGain(),
      bus3: audioContext.createGain(),
      bus4: audioContext.createGain(),
    };

    return () => {
      stripsRef.current.forEach((s) => s.dispose());
      stripsRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioContext, destination]);

  // --- Create/update channel strips as channel list changes ---
  useEffect(() => {
    if (!outputRoutesRef.current || !busGainsRef.current) return;

    let updatedAnalysers = { ...analysers };
    let changed = false;

    channels.forEach((ch) => {
      const source = channelSources[ch.id];
      if (!source) return;

      if (!stripsRef.current.has(ch.id)) {
        const strip = new ChannelStripEngine(
          audioContext,
          ch.id,
          source,
          outputRoutesRef.current!,
          busGainsRef.current!
        );
        strip.enableGrMetering();
        strip.onMeter = (rms, peak, peakHold, clipping) => {
          setPeakLevels((prev) => ({ ...prev, [ch.id]: rms }));
          setPeakLEDs((prev) => ({ ...prev, [ch.id]: clipping }));
        };
        stripsRef.current.set(ch.id, strip);
        updatedAnalysers[ch.id] = strip.analyser;
        changed = true;
      }
    });

    if (changed) {
      setAnalysers(updatedAnalysers);
    }
  }, [channels, channelSources, audioContext, analysers]);

  // --- Apply real parameter updates whenever channel/master state changes ---
  useEffect(() => {
    channels.forEach((ch) => {
      stripsRef.current.get(ch.id)?.applyState(ch);
    });
  }, [channels]);

  useEffect(() => {
    masterBusRef.current?.applyState(master);

    // Real sidechain routing: connect/disconnect the selected channel's actual signal
    if (master.sidechainSource) {
      const source = channelSources[master.sidechainSource];
      if (source && masterBusRef.current) {
        masterBusRef.current.connectSidechain(source);
      }
    }
  }, [master, channelSources]);

  const getBusOutput = useCallback((bus: 'bus1' | 'bus2' | 'bus3' | 'bus4') => {
    return busGainsRef.current?.[bus] ?? null;
  }, []);

  return {
    peakLevels,     // REAL measured RMS per channel, from meter-processor.js
    peakLEDs,       // REAL clipping detection per channel
    masterGrDb,     // REAL bus compressor gain reduction in dB
    masterOutput,
    analysers,
    getBusOutput,
  };
}

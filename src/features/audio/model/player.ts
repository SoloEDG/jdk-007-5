import type { AudioClip } from "@/shared/types";
import { decodeClip } from "@/features/resample/lib/pcm";

type Source = {
  node: AudioBufferSourceNode;
  clip: AudioClip;
};
// 音频轨播放器：解码重采样波形，按循环拍点无缝循环，
// 并在 BPM 变化时用回放速率补偿，使波形始终与音符轨道共用同一拍点。
export function createAudioPlayer() {
  let ctx: AudioContext | null = null;
  let resolveChannel: ((id: string) => AudioNode) | null = null;
  const buffers = new Map<string, AudioBuffer>();
  const live = new Map<string, Source>();
  let bpm = 108;

  const decode = (clip: AudioClip): AudioBuffer => {
    const interleaved = decodeClip(clip);
    const buffer = new AudioBuffer({
      length: clip.frames,
      numberOfChannels: 2,
      sampleRate: clip.sampleRate,
    });
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    for (let i = 0; i < clip.frames; i++) {
      left[i] = interleaved[i * 2];
      right[i] = interleaved[i * 2 + 1];
    }
    return buffer;
  };

  const startOne = (
    id: string,
    clip: AudioClip,
    when: number,
    absolute: number,
  ) => {
    if (!ctx || !resolveChannel) return;
    let buffer = buffers.get(id);
    if (!buffer) {
      buffer = decode(clip);
      buffers.set(id, buffer);
    }
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    // 变速补偿：让实际循环周期始终对应 clip.beats 个当前拍点
    const rate = bpm / clip.sourceBpm;
    node.playbackRate.value = rate;
    node.loop = true;
    node.loopStart = 0;
    // 变速后，在 buffer 时间轴上把循环点折算回原始位置，保证整圈拍点对齐
    node.loopEnd = buffer.duration;
    const loopBeats = clip.beats;
    const phase = ((absolute % loopBeats) + loopBeats) % loopBeats;
    // 已播放的 buffer 偏移 = 拍点相位占比 × 原始 buffer 时长
    const offsetSec = (phase / loopBeats) * buffer.duration;
    node.connect(resolveChannel(id));
    node.start(Math.max(when, ctx.currentTime), offsetSec);
    live.set(id, { node, clip });
  };

  return {
    attach(context: AudioContext, channel: (id: string) => AudioNode) {
      ctx = context;
      resolveChannel = channel;
    },
    // 新增音频轨；若正在播放则在同一锚点上即时加入
    add(id: string, clip: AudioClip, view: {
      absolute: number;
      bpm: number;
      running: boolean;
    }, now: number) {
      bpm = view.bpm;
      if (!view.running || !ctx) return;
      startOne(id, clip, now + 0.02, view.absolute);
    },
    start(
      clips: ReadonlyMap<string, AudioClip>,
      when: number,
      beatAnchor: number,
      tempo: number,
    ) {
      if (!ctx) return;
      this.stop();
      bpm = tempo;
      for (const [id, clip] of clips) startOne(id, clip, when, beatAnchor);
    },
    stop() {
      for (const { node } of live.values()) {
        try {
          node.stop();
        } catch {}
        node.disconnect();
      }
      live.clear();
    },
    // 恢复/切换会话：停止播放并释放上一份会话的解码缓冲
    reset() {
      this.stop();
      buffers.clear();
    },
    remove(id: string) {
      const source = live.get(id);
      if (source) {
        try {
          source.node.stop();
        } catch {}
        source.node.disconnect();
        live.delete(id);
      }
      buffers.delete(id);
    },
    // 配置变更后回到起点，已解码缓冲仍可复用
    setTempo(tempo: number) {
      bpm = tempo;
      this.stop();
    },
    dispose() {
      this.stop();
      buffers.clear();
      ctx = null;
      resolveChannel = null;
    },
  };
}
export type AudioPlayer = ReturnType<typeof createAudioPlayer>;

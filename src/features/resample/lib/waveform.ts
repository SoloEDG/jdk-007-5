import type { AudioClip } from "@/shared/types";
import { decodeClip } from "./pcm";

// 把整段立体声折叠成固定数量的峰值柱，用于时间轴上的波形缩略图。
// 结果按列缓存，避免每次渲染都重新解码。
const cache = new WeakMap<AudioClip, number[]>();

export function waveformPeaks(clip: AudioClip, columns = 96): number[] {
  const cached = cache.get(clip);
  if (cached && cached.length === columns) return cached;
  const interleaved = decodeClip(clip);
  const peaks = new Array<number>(columns).fill(0);
  const per = Math.max(1, Math.floor(clip.frames / columns));
  for (let col = 0; col < columns; col++) {
    let peak = 0;
    const start = col * per;
    const end = Math.min(clip.frames, start + per);
    for (let f = start; f < end; f++) {
      const l = Math.abs(interleaved[f * 2]);
      const r = Math.abs(interleaved[f * 2 + 1]);
      if (l > peak) peak = l;
      if (r > peak) peak = r;
    }
    peaks[col] = peak;
  }
  cache.set(clip, peaks);
  return peaks;
}

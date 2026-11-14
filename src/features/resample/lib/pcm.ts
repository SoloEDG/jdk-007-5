import type { AudioClip } from "@/shared/types";

// 单块最多承载的采样帧数，控制 base64 字符串大小
const CHUNK_FRAMES = 16384;

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step)
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(binary);
};

const base64ToBytes = (text: string): Uint8Array => {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const clamp16 = (n: number) =>
  n >= 1 ? 32767 : n <= -1 ? -32768 : Math.round(n * 32768);

// 交错的双声道浮点采样 -> 分块 16-bit PCM base64
export function encodeClip(
  interleaved: Float32Array,
  sampleRate: number,
  beats: number,
  sourceBpm: number,
): AudioClip {
  const frames = Math.floor(interleaved.length / 2);
  const pcm: string[] = [];
  for (let start = 0; start < frames; start += CHUNK_FRAMES) {
    const count = Math.min(CHUNK_FRAMES, frames - start);
    const bytes = new Uint8Array(count * 4);
    for (let i = 0; i < count; i++) {
      const left = clamp16(interleaved[(start + i) * 2]);
      const right = clamp16(interleaved[(start + i) * 2 + 1]);
      const o = i * 4;
      bytes[o] = left & 0xff;
      bytes[o + 1] = (left >> 8) & 0xff;
      bytes[o + 2] = right & 0xff;
      bytes[o + 3] = (right >> 8) & 0xff;
    }
    pcm.push(bytesToBase64(bytes));
  }
  return { sampleRate, channels: 2, pcm, frames, beats, sourceBpm };
}

// 分块 PCM -> 交错双声道浮点（独立声道混回立体声）
export function decodeClip(clip: AudioClip): Float32Array {
  const out = new Float32Array(clip.frames * 2);
  let frame = 0;
  for (const text of clip.pcm) {
    const view = new DataView(base64ToBytes(text).buffer);
    const count = Math.min(view.byteLength / 4, clip.frames - frame);
    for (let i = 0; i < count; i++) {
      out[(frame + i) * 2] = view.getInt16(i * 4, true) / 32768;
      out[(frame + i) * 2 + 1] = view.getInt16(i * 4 + 2, true) / 32768;
    }
    frame += count;
  }
  return out;
}

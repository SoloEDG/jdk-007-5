export type Instrument = "drums" | "keys" | "audio";
export type Note = {
  id: string;
  pitch: number;
  beat: number;
  duration: number;
  velocity: number;
};
// 重采样得到的立体声音频块：16-bit PCM 经 base64 存储，按独立声道保存
export type AudioClip = {
  sampleRate: number;
  channels: 2;
  // 每个元素为一小段 base64，避免单个超大字符串带来的编解码开销
  pcm: string[];
  frames: number;
  // 该音频覆盖的拍数（通常等于采集时的循环长度），用于与音符轨道对齐
  beats: number;
  // 采集时的速度，回放速率据此补偿，保证 BPM 改变后仍与拍点对齐
  sourceBpm: number;
};
export type Track = {
  id: string;
  name: string;
  instrument: Instrument;
  color: string;
  notes: Note[];
  // 仅音频轨拥有：重采样生成的循环波形
  clip?: AudioClip;
};
export type Channel = { volume: number; muted: boolean };
export type Session = {
  version: 1;
  title: string;
  bpm: number;
  beats: number;
  tracks: Track[];
  channels: Record<string, Channel>;
  master: number;
};
export type NoteInput = {
  pitch: number;
  velocity: number;
  instrument: Instrument;
};
export type ScheduledNote = NoteInput & {
  duration: number;
  when: number;
  trackId: string;
};
export type Listener = () => void;

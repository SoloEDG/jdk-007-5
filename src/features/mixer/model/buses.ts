import type { Channel } from "@/shared/types";
export function createBuses() {
  let ctx: AudioContext | null = null,
    master: GainNode | null = null;
  const channels = new Map<string, GainNode>();
  // 重采样抽头：参与声道 -> 抽头增益，统一汇入 tapBus
  const taps = new Map<string, GainNode>();
  let tapBus: GainNode | null = null;
  const apply = (node: GainNode, value: number) => {
    if (!ctx) return;
    node.gain.cancelScheduledValues(ctx.currentTime);
    node.gain.setValueAtTime(value, ctx.currentTime);
  };
  const removeTap = (id: string) => {
    taps.get(id)?.disconnect();
    taps.delete(id);
  };
  return {
    attach(context: AudioContext) {
      if (ctx === context) return;
      ctx = context;
      master = context.createGain();
      master.connect(context.destination);
    },
    sync(states: Readonly<Record<string, Channel>>, volume: number) {
      if (!ctx || !master) return;
      apply(master, volume);
      for (const id of channels.keys())
        if (!states[id]) {
          removeTap(id);
          channels.get(id)?.disconnect();
          channels.delete(id);
        }
      for (const [id, state] of Object.entries(states)) {
        let bus = channels.get(id);
        if (!bus) {
          bus = ctx.createGain();
          bus.connect(master);
          channels.set(id, bus);
        }
        apply(bus, state.muted ? 0 : state.volume);
      }
    },
    channel(id: string) {
      const bus = channels.get(id);
      if (!bus) throw new Error("声道未初始化");
      return bus;
    },
    // 为参与重采样的声道建立抽头，返回汇合后的采集输入节点。
    // 抽头接在各声道音量/静音增益之后，因此实际音量与静音直接决定录入结果。
    beginResample(ids: readonly string[]): AudioNode {
      if (!ctx) throw new Error("音频尚未启动");
      this.endResample();
      tapBus = ctx.createGain();
      for (const id of ids) {
        const bus = channels.get(id);
        if (!bus) continue;
        const tap = ctx.createGain();
        tap.gain.value = 1;
        bus.connect(tap);
        tap.connect(tapBus);
        taps.set(id, tap);
      }
      return tapBus;
    },
    endResample() {
      for (const tap of taps.values()) tap.disconnect();
      taps.clear();
      tapBus?.disconnect();
      tapBus = null;
    },
    dispose() {
      this.endResample();
      for (const bus of channels.values()) bus.disconnect();
      channels.clear();
      master?.disconnect();
      master = null;
      ctx = null;
    },
  };
}

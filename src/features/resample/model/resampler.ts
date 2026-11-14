import { captureBoundary } from "@/features/recorder/lib/quantize";
import workletUrl from "../worklet/capture-worklet.js?url";

type Block = { time: number; samples: Float32Array };
export type BounceResult = {
  samples: Float32Array;
  sampleRate: number;
  beats: number;
  sourceBpm: number;
};
export type ResampleStatus = "idle" | "waiting" | "capturing";

// AudioWorklet 模块只需向每个 AudioContext 注册一次
const moduleReady = new WeakMap<BaseAudioContext, Promise<void>>();
async function ensureWorklet(ctx: AudioContext) {
  let ready = moduleReady.get(ctx);
  if (!ready) {
    ready = ctx.audioWorklet
      .addModule(workletUrl)
      .then(() => undefined)
      .catch((error) => {
        moduleReady.delete(ctx);
        throw error;
      });
    moduleReady.set(ctx, ready);
  }
  return ready;
}

export function createResampler() {
  let status: ResampleStatus = "idle";
  let chosen = new Set<string>();
  let start = 0;
  let length = 16;
  let startCtxTime = 0;
  let endCtxTime = 0;
  let sampleRate = 44100;
  let sourceBpm = 108;
  let node: AudioWorkletNode | null = null;
  let blocks: Block[] = [];
  let finishing = false;

  const reset = () => {
    if (node) {
      node.port.onmessage = null;
      node.disconnect();
    }
    node = null;
    blocks = [];
    finishing = false;
    status = "idle";
  };

  const assemble = (): Float32Array => {
    const total = Math.max(1, Math.round((endCtxTime - startCtxTime) * sampleRate));
    const out = new Float32Array(total * 2); // 未覆盖的尾部保持静音
    for (const block of blocks) {
      const frames = block.samples.length / 2;
      for (let i = 0; i < frames; i++) {
        const ctxTime = block.time + i / sampleRate;
        const idx = Math.round((ctxTime - startCtxTime) * sampleRate);
        if (idx < 0 || idx >= total) continue;
        out[idx * 2] = block.samples[i * 2];
        out[idx * 2 + 1] = block.samples[i * 2 + 1];
      }
    }
    return out;
  };

  return {
    snapshot() {
      return {
        status,
        participants: [...chosen],
        start,
        length,
        finishing,
      };
    },
    isActive() {
      return status !== "idle";
    },
    // 采集期间调整参与范围只记录选择，冻结到下一次生效
    toggle(id: string) {
      if (status !== "idle") return;
      const next = new Set(chosen);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      chosen = next;
    },
    prune(ids: readonly string[]) {
      const alive = new Set(ids);
      chosen = new Set([...chosen].filter((id) => alive.has(id)));
    },
    async arm(
      ctx: AudioContext,
      source: AudioNode,
      ids: readonly string[],
      absolute: number,
      beats: number,
      tempo: number,
      timeAt: (beat: number) => number,
    ) {
      if (status !== "idle") return;
      const participants = ids.filter((id) => chosen.has(id));
      if (participants.length === 0)
        throw new Error("请先勾选至少一条参与重采样的轨道");
      await ensureWorklet(ctx);
      length = beats;
      start = captureBoundary(absolute, beats);
      startCtxTime = timeAt(start);
      endCtxTime = timeAt(start + length);
      sampleRate = ctx.sampleRate;
      sourceBpm = tempo;
      blocks = [];
      finishing = false;
      const worklet = new AudioWorkletNode(ctx, "capture-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 2,
        channelInterpretation: "speakers",
      });
      worklet.port.onmessage = (event: MessageEvent<Block>) => {
        blocks.push(event.data);
      };
      source.connect(worklet);
      node = worklet;
      status = "waiting";
    },
    // 由演播心跳驱动：等待共同循环起点，采集满一整圈后产出结果
    advance(absolute: number, ctxNow: number): BounceResult | null {
      if (status === "idle") return null;
      if (status === "waiting" && absolute >= start) status = "capturing";
      if (status !== "capturing" || absolute < start + length) return null;
      if (!finishing) finishing = true;
      const covered = blocks.reduce(
        (max, b) => Math.max(max, b.time + b.samples.length / 2 / sampleRate),
        0,
      );
      // 等采样块覆盖整圈终点；给渲染线程留出短暂余量，否则尾部补静音
      if (covered < endCtxTime && ctxNow < endCtxTime + 0.08) return null;
      const samples = assemble();
      const result: BounceResult = {
        samples,
        sampleRate,
        beats: length,
        sourceBpm,
      };
      reset();
      return result;
    },
    // 暂停或取消：丢弃未完成音频，已生成片段不受影响
    cancel() {
      if (status === "idle") return;
      reset();
    },
    dispose() {
      reset();
      chosen.clear();
    },
  };
}
export type Resampler = ReturnType<typeof createResampler>;

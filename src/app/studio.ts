import { createEngine, bindPerformanceInput } from "@/features/instruments";
import { createTransport, scheduleWindow } from "@/features/transport";
import { createRecorder } from "@/features/recorder";
import {
  createArrangement,
  demoSession,
  saveSession,
  loadSession,
} from "@/features/arrangement";
import { createMixer } from "@/features/mixer";
import { createResampler } from "@/features/resample";
import { createAudioPlayer } from "@/features/audio";
import { encodeClip } from "@/features/resample/lib/pcm";
import type { NoteInput, Instrument, Session } from "@/shared/types";
export function createStudio(notify: () => void) {
  const engine = createEngine(),
    transport = createTransport(),
    recorder = createRecorder(),
    arrangement = createArrangement(),
    mixer = createMixer(),
    resampler = createResampler(),
    player = createAudioPlayer();
  const active = new Set<string>();
  // 最近一次重采样的源轨与生成的音频轨，用于监听切换时不叠加
  let lastBounce: { sources: string[]; audioId: string } | null = null;
  let message = "欢迎来到夜航。戴上耳机，试着敲下第一拍。",
    epoch = 0,
    disposed = false;
  const now = () => engine.context?.currentTime ?? 0;
  const feedback = (text: string) => {
    message = text;
    notify();
  };
  const guard = (fn: () => void) => {
    try {
      fn();
      notify();
    } catch (error) {
      feedback(
        error instanceof Error ? error.message : "操作失败，现有作品已保留",
      );
    }
  };
  const syncMixer = () =>
    mixer.ensure(arrangement.snapshot().tracks.map((t) => t.id));
  const cancelVoices = () => {
    engine.cancel();
    active.clear();
  };
  // 绝对拍点 -> AudioContext 时间，仅在播放时有意义
  const timeAtBeat = (beat: number) => {
    const view = transport.view(now());
    return now() + ((beat - view.absolute) * 60) / view.bpm;
  };
  const stop = () => {
    epoch++;
    transport.stop();
    recorder.cancel();
    resampler.cancel();
    mixer.endResample();
    player.stop();
    cancelVoices();
    notify();
  };
  const pause = () => {
    epoch++;
    transport.pause(now());
    recorder.cancel();
    resampler.cancel();
    mixer.endResample();
    player.stop();
    cancelVoices();
    feedback("播放已暂停；未完成的录音与重采样已取消，原片段保留。");
  };
  const unlock = async () => {
    const context = await engine.unlock();
    if (disposed) return null;
    mixer.attach(context);
    syncMixer();
    engine.route(mixer.channel);
    player.attach(context, mixer.channel);
    return context;
  };
  const play = async () => {
    const token = ++epoch;
    try {
      if (!(await unlock()) || token !== epoch) return;
      const startAt = now() + 0.02;
      const view = transport.view(now());
      transport.start(startAt);
      player.start(
        arrangement.audioClips(),
        startAt,
        view.absolute,
        view.bpm,
      );
      tick();
      notify();
    } catch {
      feedback("声音启动失败，请再次点击播放");
    }
  };
  const finishBounce = (
    samples: Float32Array,
    rate: number,
    beats: number,
    bpm: number,
    participants: readonly string[],
  ) => {
    const clip = encodeClip(samples, rate, beats, bpm);
    const track = arrangement.addAudioTrack(clip);
    syncMixer();
    // 默认压轨：源轨静音，新音频轨承担这一层，避免两份声音叠加
    for (const id of participants) mixer.setMuted(id, true);
    lastBounce = { sources: [...participants], audioId: track.id };
    const current = transport.view(now());
    player.add(track.id, clip, current, now());
    message = `重采样完成 · 已生成循环音频轨「${track.name}」，源轨已保留并静音`;
  };
  const tick = () => {
    const time = now(),
      view = transport.view(time);
    const take = recorder.advance(view.absolute);
    if (take)
      guard(() => {
        arrangement.commit(take.trackId, take.notes);
        message = `录制完成 · ${take.notes.length} 个音符`;
      });
    if (resampler.isActive()) {
      const participants = [...resampler.snapshot().participants];
      const bounce = resampler.advance(view.absolute, time);
      if (bounce)
        guard(() => {
          mixer.endResample();
          finishBounce(
            bounce.samples,
            bounce.sampleRate,
            bounce.beats,
            bounce.sourceBpm,
            participants,
          );
        });
    }
    const capture = recorder.snapshot();
    const ceiling =
      capture.status === "idle" ? Infinity : capture.start + capture.length;
    const window = transport.window(time, ceiling);
    if (window)
      scheduleWindow(
        arrangement.forPlayback(),
        window.from,
        window.to,
        view.beats,
        view.bpm,
        window.timeAt,
        (n) => engine.play(n),
      );
  };
  const down = async (id: string, note: NoteInput) => {
    if (active.has(id)) return;
    active.add(id);
    notify();
    try {
      if (!(await unlock()) || !active.has(id)) return;
      const target = arrangement.selected();
      if (!target || target.instrument !== note.instrument) {
        active.delete(id);
        feedback("请先选择对应乐器的轨道");
        return;
      }
      const abs = transport.view(now()).absolute;
      const take = recorder.advance(abs);
      if (take) arrangement.commit(take.trackId, take.notes);
      recorder.down(id, note, abs);
      engine.play(
        {
          ...note,
          trackId: target.id,
          duration: note.instrument === "keys" ? 6 : 0.3,
          when: now(),
        },
        id,
      );
    } catch {
      active.delete(id);
      feedback("请点击播放以启用声音");
    }
  };
  const up = (id: string) => {
    if (!active.delete(id)) return;
    recorder.up(id, transport.view(now()).absolute);
    engine.release(id);
    notify();
  };
  const install = (session: Session) => {
    stop();
    const valid = arrangement.restore(session);
    transport.configure(valid.bpm, valid.beats);
    mixer.restore(valid.channels, valid.master);
    resampler.prune(valid.tracks.map((t) => t.id));
    player.reset();
    lastBounce = null;
    notify();
  };
  const timer = window.setInterval(() => {
    tick();
    notify();
  }, 20);
  const unbind = bindPerformanceInput((id, note) => void down(id, note), up);
  const shortcut = (e: KeyboardEvent) => {
    if (
      e.code === "Space" &&
      !e.repeat &&
      !/INPUT|TEXTAREA|SELECT|BUTTON/.test((e.target as HTMLElement).tagName)
    ) {
      e.preventDefault();
      if (transport.view(now()).running) pause();
      else void play();
    }
  };
  const blur = () => {
    for (const id of [...active]) up(id);
  };
  window.addEventListener("keydown", shortcut);
  window.addEventListener("blur", blur);
  return {
    view() {
      return {
        transport: transport.view(now()),
        arrangement: arrangement.snapshot(),
        selected: arrangement.selected(),
        recorder: recorder.snapshot(),
        resample: resampler.snapshot(),
        mixer: mixer.snapshot(),
        active: new Set(active),
        message,
      };
    },
    play,
    pause,
    stop,
    down: (id: string, n: NoteInput) => void down(id, n),
    up,
    configure(bpm: number, beats: number) {
      stop();
      transport.configure(bpm, beats);
      arrangement.resizeLoop(transport.view(now()).beats);
      player.setTempo(transport.view(now()).bpm);
      feedback("速度或长度变更：播放回到起点；缩短时移除范围外音符。");
    },
    add(kind: Instrument) {
      guard(() => {
        arrangement.add(kind);
        syncMixer();
      });
    },
    select(id: string) {
      if (recorder.snapshot().status !== "idle") return;
      if (resampler.isActive()) return;
      engine.releaseHeld();
      active.clear();
      arrangement.select(id);
      notify();
    },
    remove() {
      guard(() => {
        const selected = arrangement.selected();
        if (selected) {
          stop();
          arrangement.remove(selected.id);
          player.remove(selected.id);
          syncMixer();
          resampler.prune(arrangement.snapshot().tracks.map((t) => t.id));
        }
      });
    },
    clear() {
      guard(() => {
        const t = arrangement.selected();
        if (t) {
          stop();
          arrangement.clear(t.id);
        }
      });
    },
    async record() {
      const selected = arrangement.selected();
      if (!selected) return;
      if (selected.instrument === "audio") {
        feedback("音频轨由波形构成，请选择鼓组或琴键轨道演奏");
        return;
      }
      if (resampler.isActive()) {
        feedback("正在重采样，请先完成或取消本次采集");
        return;
      }
      const token = ++epoch;
      try {
        if (!(await unlock()) || token !== epoch) return;
        const state = transport.view(now());
        if (!state.running) {
          const startAt = now() + 0.02;
          transport.start(startAt);
          player.start(
            arrangement.audioClips(),
            startAt,
            transport.view(now()).absolute,
            state.bpm,
          );
        }
        recorder.arm(
          selected.id,
          selected.instrument,
          transport.view(now()).absolute,
          state.beats,
        );
        tick();
        notify();
      } catch {
        feedback("录音启动失败，请重试");
      }
    },
    cancel() {
      if (resampler.isActive()) {
        resampler.cancel();
        mixer.endResample();
        feedback("本次重采样已取消，未完成音频丢弃，已有片段保留。");
        notify();
        return;
      }
      recorder.cancel();
      feedback("本次录音已取消，之前的片段仍然保留。");
    },
    grid(n: number) {
      recorder.grid(n);
      notify();
    },
    volume(id: string, n: number) {
      mixer.volume(id, n);
      notify();
    },
    mute(id: string) {
      mixer.mute(id);
      notify();
    },
    master(n: number) {
      mixer.master(n);
      notify();
    },
    toggleResampleSource(id: string) {
      // 采集期间调整参与范围会被忽略，冻结到下一次，保证同一圈来源一致
      if (resampler.isActive()) return;
      resampler.toggle(id);
      notify();
    },
    async resample() {
      if (resampler.isActive() || recorder.snapshot().status !== "idle") return;
      const chosen = resampler.snapshot().participants;
      if (chosen.length === 0) {
        feedback("请先勾选至少一条参与重采样的轨道");
        return;
      }
      if (arrangement.snapshot().tracks.length >= 8) {
        feedback("轨道已达 8 条上限，请先移除一条再压轨");
        return;
      }
      const token = ++epoch;
      try {
        const ctx = await unlock();
        if (!ctx || token !== epoch) return;
        let state = transport.view(now());
        if (!state.running) {
          const startAt = now() + 0.02;
          transport.start(startAt);
          player.start(
            arrangement.audioClips(),
            startAt,
            transport.view(now()).absolute,
            state.bpm,
          );
          state = transport.view(now());
        }
        // 抽头接在各声道音量/静音增益之后，实际电平决定录入结果
        const tap = mixer.beginResample(chosen);
        await resampler.arm(
          ctx,
          tap,
          arrangement.snapshot().tracks.map((t) => t.id),
          state.absolute,
          state.beats,
          state.bpm,
          timeAtBeat,
        );
        tick();
        notify();
      } catch (error) {
        mixer.endResample();
        resampler.cancel();
        feedback(
          error instanceof Error
            ? `重采样启动失败：${error.message}`
            : "重采样启动失败，请重试",
        );
      }
    },
    // 在「源轨」与「压轨结果」之间切换监听，互斥静音避免两份声音叠加
    toggleMonitor() {
      if (!lastBounce) return;
      const { sources, audioId } = lastBounce;
      const alive = new Set(arrangement.snapshot().tracks.map((t) => t.id));
      if (!alive.has(audioId)) {
        lastBounce = null;
        feedback("对应的压轨已删除，无法切换监听");
        return;
      }
      const channels = mixer.snapshot().channels;
      const audioMuted = channels[audioId]?.muted ?? false;
      if (audioMuted) {
        mixer.setMuted(audioId, false);
        for (const id of sources) if (alive.has(id)) mixer.setMuted(id, true);
        feedback("正在监听压轨结果，源轨保持静音");
      } else {
        mixer.setMuted(audioId, true);
        for (const id of sources) if (alive.has(id)) mixer.setMuted(id, false);
        feedback("正在监听源轨，压轨结果已静音，可继续叠加演奏");
      }
      notify();
    },
    demo() {
      guard(() => {
        install(demoSession());
        message = "示范已载入 · 点击播放，听听凌晨两点。";
      });
    },
    save() {
      guard(() => {
        if (recorder.snapshot().status !== "idle")
          throw new Error("请完成或取消录音后再保存");
        if (resampler.isActive())
          throw new Error("请完成或取消重采样后再保存");
        const a = arrangement.snapshot(),
          t = transport.view(now()),
          m = mixer.snapshot();
        saveSession({
          version: 1,
          title: a.title,
          bpm: t.bpm,
          beats: t.beats,
          tracks: a.tracks,
          channels: m.channels,
          master: m.master,
        });
        message = "作品已保存到本机浏览器";
      });
    },
    load() {
      guard(() => {
        const session = loadSession();
        install(session);
        message = "本地作品已恢复";
      });
    },
    dispose() {
      disposed = true;
      epoch++;
      clearInterval(timer);
      unbind();
      window.removeEventListener("keydown", shortcut);
      window.removeEventListener("blur", blur);
      resampler.dispose();
      player.dispose();
      mixer.dispose();
      engine.dispose();
    },
  };
}
export type Studio = ReturnType<typeof createStudio>;

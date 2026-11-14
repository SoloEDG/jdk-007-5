import type { Track } from "@/shared/types";
import type { Resampler } from "../model/resampler";

type ResampleView = ReturnType<Resampler["snapshot"]>;

export function ResamplePanel({
  tracks,
  view,
  absolute,
  canBounce,
  hasBounce,
  toggleSource,
  resample,
  toggleMonitor,
  cancel,
}: {
  tracks: readonly Track[];
  view: ResampleView;
  absolute: number;
  canBounce: boolean;
  hasBounce: boolean;
  toggleSource: (id: string) => void;
  resample: () => void;
  toggleMonitor: () => void;
  cancel: () => void;
}) {
  const active = view.status !== "idle";
  const chosen = new Set(view.participants);
  const remaining =
    view.status === "waiting"
      ? Math.max(0, view.start - absolute)
      : Math.max(0, view.start + view.length - absolute);
  return (
    <section className="panel resample-panel">
      <div className="section-heading">
        <div>
          <small>04 / BOUNCE</small>
          <h2>
            内部重采样
            <span>RE-SAMPLE LOOP</span>
          </h2>
        </div>
        <span className="tag">INTERNAL MIX</span>
      </div>
      {tracks.length === 0 ? (
        <p className="empty-small">先添加轨道，再把几条伴奏压成一层。</p>
      ) : (
        <>
          <div className="bounce-sources">
            {tracks.map((t) => (
              <label
                key={t.id}
                className={`bounce-source ${chosen.has(t.id) ? "chosen" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={chosen.has(t.id)}
                  disabled={active}
                  onChange={() => toggleSource(t.id)}
                />
                <span className="color-dot" style={{ background: t.color }} />
                <strong>{t.name}</strong>
                <small>
                  {t.instrument === "audio"
                    ? "AUDIO"
                    : t.instrument === "drums"
                      ? "DRUMS"
                      : "KEYS"}
                </small>
              </label>
            ))}
          </div>
          <div className="bounce-actions">
            <button
              className="bounce-btn"
              disabled={!canBounce || active || chosen.size === 0}
              onClick={resample}
            >
              ◉ 采集一整圈并生成音频轨
            </button>
            <button
              className="monitor-btn"
              disabled={!hasBounce || active}
              onClick={toggleMonitor}
            >
              切换监听 源轨 / 压轨
            </button>
          </div>
          {active ? (
            <div className="bounce-status" role="status">
              <span className="red-dot" />
              <span className="bounce-status-text">
                {view.status === "waiting"
                  ? `等待共同循环起点 · 还有 ${remaining.toFixed(1)} 拍`
                  : view.finishing
                    ? "正在收尾整圈波形…"
                    : `正在采集内部混音 · ${remaining.toFixed(1)} 拍后完成`}
              </span>
              <progress
                max={view.length}
                value={Math.max(
                  0,
                  Math.min(view.length, absolute - view.start),
                )}
              />
              <button className="bounce-cancel" onClick={cancel}>
                取消
              </button>
            </div>
          ) : (
            <p className="bounce-hint">
              勾选参与轨道后，从下一个循环起点录满一整圈 · 音量与静音按当前混音生效
              · 生成新轨并保留源轨
            </p>
          )}
        </>
      )}
    </section>
  );
}

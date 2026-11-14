// 运行在 AudioWorklet 全局作用域（纯 JS，由 ?url 原样加载，不经过打包转译）。
// 把进入节点的音频块原样回传主线程，并附上精确的 AudioContext 时间，
// 保证重采样在循环边界上做到采样级对齐。
class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const frames = input[0].length;
      const interleaved = new Float32Array(frames * 2);
      const left = input[0];
      // 单声道输入复制到两个声道，立体声取左右独立声道
      const right = input.length > 1 ? input[1] : input[0];
      for (let i = 0; i < frames; i++) {
        interleaved[i * 2] = left[i];
        interleaved[i * 2 + 1] = right[i];
      }
      this.port.postMessage(
        { time: currentTime, samples: interleaved },
        { transfer: [interleaved.buffer] },
      );
    }
    return true;
  }
}

registerProcessor("capture-processor", CaptureProcessor);

import type { Session } from "@/shared/types";
import { validateSession } from "../lib/validation";
const KEY = "nightshift-session-v1";
// localStorage 常见配额约 5MB，保守预留音符与元数据空间
const MAX_BYTES = 4_000_000;

export function saveSession(session: Session) {
  const safe = validateSession(session);
  const serialized = JSON.stringify(safe);
  if (serialized.length > MAX_BYTES)
    throw new Error("存档体积过大，请先移除部分音频轨；现有内容已保留");
  try {
    localStorage.setItem(KEY, serialized);
  } catch {
    // 空间不足：不覆盖、不删除任何源内容，原存档保持可恢复
    throw new Error("本机存储空间不足，源内容与原存档均已保留");
  }
}
export function loadSession() {
  const text = localStorage.getItem(KEY);
  if (!text) throw new Error("还没有本地存档，请先保存");
  if (text.length > MAX_BYTES) throw new Error("存档过大，已保留当前作品");
  return validateSession(JSON.parse(text));
}

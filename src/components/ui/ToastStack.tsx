import { useEffect } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { useChessStore } from '../../store/chessStore';
import type { Toast } from '../../types/chess';

const ICONS = {
  info: Info,
  success: CircleCheck,
  error: CircleAlert,
  warning: TriangleAlert,
};

function ToastItem({ toast }: { toast: Toast }) {
  const dismissToast = useChessStore((state) => state.dismissToast);
  const Icon = ICONS[toast.kind];

  useEffect(() => {
    const timer = window.setTimeout(() => dismissToast(toast.id), 5200);
    return () => window.clearTimeout(timer);
  }, [dismissToast, toast.id]);

  return (
    <div className={`toast toast-${toast.kind}`} role="status">
      <Icon size={17} className="toast-icon" />
      <span className="toast-message">{toast.message}</span>
      <button
        type="button"
        className="toast-dismiss"
        aria-label="Dismiss notification"
        onClick={() => dismissToast(toast.id)}
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function ToastStack() {
  const toasts = useChessStore((state) => state.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}

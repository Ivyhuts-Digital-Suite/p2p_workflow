import { FormEvent, useEffect, useState } from 'react';

interface Toast {
  id: number;
  message: string;
  tone: 'success' | 'info';
}

interface Dialog {
  title: string;
  message?: string;
  /** A text or number field; none makes it a plain confirmation */
  field?: { label: string; minLength?: number; type?: 'text' | 'number'; initial?: string };
  confirmLabel: string;
  danger?: boolean;
  resolve: (value: string | null) => void;
}

let toasts: Toast[] = [];
let dialog: Dialog | null = null;
let nextId = 1;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

/** A brief, non-blocking confirmation of something that just happened. */
export function toast(message: string, tone: Toast['tone'] = 'success') {
  const id = nextId++;
  toasts = [...toasts, { id, message, tone }];
  notify();
  window.setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    notify();
  }, 5000);
}

const open = (next: Omit<Dialog, 'resolve'>) =>
  new Promise<string | null>((resolve) => {
    dialog = { ...next, resolve };
    notify();
  });

/** Asks for a mandatory written reason. Resolves to null if the user cancels. */
export const askReason = (title: string, minLength = 3, confirmLabel = 'Confirm') =>
  open({ title, confirmLabel, field: { label: 'Reason', minLength } });

/** Asks for a number. Resolves to null if the user cancels. */
export const askNumber = async (title: string, initial: number, label = 'Amount') => {
  const value = await open({ title, confirmLabel: 'Save', field: { label, type: 'number', initial: String(initial) } });
  return value === null ? null : Number(value);
};

/** Asks the user to confirm. Resolves to false if they cancel. */
export const confirmAction = async (title: string, message: string, confirmLabel = 'Confirm', danger = true) =>
  (await open({ title, message, confirmLabel, danger })) !== null;

/** Renders whatever toasts and dialogs are open. Mounted once, at the top of the app. */
export function OverlayHost() {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const listener = () => setVersion((v) => v + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return (
    <>
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            {t.message}
          </div>
        ))}
      </div>
      {dialog && <DialogBox key={dialog.title} dialog={dialog} />}
    </>
  );
}

function DialogBox({ dialog: current }: { dialog: Dialog }) {
  const [value, setValue] = useState(current.field?.initial ?? '');

  const close = (result: string | null) => {
    dialog = null;
    current.resolve(result);
    notify();
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    close(current.field ? value.trim() : '');
  };

  return (
    <Modal title={current.title} onClose={() => close(null)}>
      <form className="form" onSubmit={onSubmit}>
        {current.message && <p>{current.message}</p>}
        {current.field && (
          <label>
            {current.field.label}
            {current.field.type === 'number' ? (
              <input type="number" min={0} step="any" value={value} onChange={(e) => setValue(e.target.value)} required autoFocus />
            ) : (
              <textarea rows={3} value={value} onChange={(e) => setValue(e.target.value)} required minLength={current.field.minLength} autoFocus />
            )}
          </label>
        )}
        <div className="form-footer">
          <div className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={() => close(null)}>
            Cancel
          </button>
          <button className={`btn ${current.danger ? 'btn-danger' : 'btn-primary'}`}>{current.confirmLabel}</button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * A dialog that leaves the page behind it in place. Escape or the backdrop closes it, except for a form
 * marked not dismissible, where a stray click must not throw away what was typed.
 */
export function Modal({
  title,
  onClose,
  children,
  wide,
  extraWide,
  dismissible = true,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  extraWide?: boolean;
  dismissible?: boolean;
}) {
  useEffect(() => {
    if (!dismissible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, dismissible]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => dismissible && e.target === e.currentTarget && onClose()}>
      <div className={`modal${extraWide ? ' modal-xl' : wide ? ' modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="link" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

import { FormEvent, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../api/client';
import { requisitionApi } from '../api/services';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks/useApi';
import { formatDateTime } from '../utils/format';
import { Empty, ErrorBanner } from './ui';

const REFRESH_MS = 5000;

/**
 * The conversation on one PR. Everyone who can see the PR can read and write here. One tick means sent;
 * a blue double tick means at least one other person has read it, and hovering shows who.
 */
export function PrChat({ prId, prNumber }: { prId: string; prNumber: string }) {
  const { user } = useAuth();
  const { data, error, reload } = useApi(() => requisitionApi.messages(prId), [prId]);
  const [text, setText] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const canWrite = user?.role !== 'AUDITOR';

  useEffect(() => {
    const timer = window.setInterval(() => void reload(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [reload]);
  // A block body: scrollIntoView returns a Promise in newer browsers, and React would take that for a cleanup.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'nearest' });
  }, [data?.length]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setSendError(null);
    try {
      await requisitionApi.sendMessage(prId, text.trim());
      setText('');
      await reload();
    } catch (err) {
      setSendError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="chat" aria-label={`Conversation on ${prNumber}`}>
      <h3>Conversation</h3>
      <ErrorBanner message={error ?? sendError} onClose={() => setSendError(null)} />
      <div className="chat-messages">
        {!data?.length && <Empty>No messages yet.</Empty>}
        {data?.map((m) => {
          const mine = m.sender === user?._id;
          const readers = m.readBy.filter((r) => r.user !== m.sender);
          return (
            <div key={m._id} className={`chat-message${mine ? ' chat-mine' : ''}`}>
              {!mine && (
                <div className="chat-sender">
                  {m.senderName} <span className="muted">· {m.senderRole}</span>
                </div>
              )}
              <div className="chat-text">{m.text}</div>
              <div className="chat-meta">
                {formatDateTime(m.createdAt)}
                {mine && (
                  <span
                    className={`chat-ticks${readers.length ? ' chat-read' : ''}`}
                    title={readers.length ? `Read by ${readers.map((r) => r.name).join(', ')}` : 'Sent'}
                    aria-label={readers.length ? `Read by ${readers.map((r) => r.name).join(', ')}` : 'Sent, not read yet'}
                  >
                    {readers.length ? '✓✓' : '✓'}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>
      {canWrite && (
        <form className="chat-form" onSubmit={onSubmit}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a message about this PR" maxLength={1000} aria-label="Message" />
          <button className="btn btn-primary" disabled={busy || !text.trim()}>
            Send
          </button>
        </form>
      )}
    </section>
  );
}

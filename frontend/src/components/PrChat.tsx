import { FormEvent, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../api/client';
import { chatApi, requisitionApi } from '../api/services';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks/useApi';
import type { PrMessage } from '../types';
import { formatDateTime } from '../utils/format';
import { Empty, ErrorBanner } from './ui';

const REFRESH_MS = 5000;

/** Fired once a conversation has been read, so unread badges can update straight away. */
export const CHAT_READ_EVENT = 'p2p:chat-read';

const readerList = (readers: { name: string; at: string }[]) => readers.map((r) => `${r.name} (${formatDateTime(r.at)})`).join(', ');

/**
 * One conversation. One tick means sent; a blue double tick means at least one other person has read it,
 * and hovering shows who and when. Loading it marks it read for the current user only.
 */
export function ChatThread({
  threadKey,
  label,
  placeholder,
  load,
  send,
  notice,
}: {
  /** Changes when the conversation changes, so the thread reloads */
  threadKey: string;
  label: string;
  placeholder: string;
  load: () => Promise<PrMessage[]>;
  send: (text: string) => Promise<unknown>;
  /** Who else can read this conversation, when staff should know before writing */
  notice?: string;
}) {
  const { user } = useAuth();
  const { data, error, reload } = useApi(load, [threadKey]);
  const [text, setText] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const canWrite = user?.role !== 'AUDITOR';

  // Loading the conversation marks it read on the server; tell the badges.
  useEffect(() => {
    if (data) window.dispatchEvent(new Event(CHAT_READ_EVENT));
  }, [data]);
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
      await send(text.trim());
      setText('');
      await reload();
    } catch (err) {
      setSendError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="chat" aria-label={label}>
      <h3>{label}</h3>
      {notice && (
        <div className="alert alert-info small" role="note">
          {notice}
        </div>
      )}
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
                    title={readers.length ? `Read by ${readerList(readers)}` : 'Sent'}
                    aria-label={readers.length ? `Read by ${readerList(readers)}` : 'Sent, not read yet'}
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
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} maxLength={1000} aria-label="Message" />
          <button className="btn btn-primary" disabled={busy || !text.trim()}>
            Send
          </button>
        </form>
      )}
    </section>
  );
}

/**
 * The conversation on one PR/PO: hospital staff, and the awarded vendor once their PO is issued.
 * `vendorCanRead` warns staff that the vendor reads what they write here.
 */
export function PrChat({ prId, prNumber, vendorCanRead = false }: { prId: string; prNumber: string; vendorCanRead?: boolean }) {
  const { user } = useAuth();
  const staff = user?.role !== 'VENDOR';
  return (
    <ChatThread
      threadKey={`pr:${prId}`}
      label={`Conversation on ${prNumber}`}
      placeholder={staff ? 'Write a message about this PR / PO' : 'Write a message about this order'}
      load={() => requisitionApi.messages(prId)}
      send={(text) => requisitionApi.sendMessage(prId, text)}
      notice={staff && vendorCanRead ? 'The selected vendor reads messages sent from the moment they were selected; everything earlier stays hidden from them. Use the vendor tabs on a card for private notes to one vendor.' : undefined}
    />
  );
}

/**
 * A vendor's private conversation with Procurement on an RFQ, carried on once it becomes their PO.
 * Without a vendorId it is the signed-in vendor's own conversation.
 */
export function VendorChat({ rfqId, vendorId, label }: { rfqId: string; vendorId?: string; label: string }) {
  return (
    <ChatThread
      threadKey={`rfq:${rfqId}:${vendorId ?? 'me'}`}
      label={label}
      placeholder={vendorId ? 'Write to this vendor' : 'Write to the buyer'}
      load={() => (vendorId ? chatApi.vendorMessages(rfqId, vendorId) : chatApi.myMessages(rfqId))}
      send={(text) => (vendorId ? chatApi.sendToVendor(rfqId, vendorId, text) : chatApi.sendToBuyer(rfqId, text))}
    />
  );
}

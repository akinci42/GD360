import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../store/authStore.js';

const SUGGESTIONS = [
  'Bu ay en aktif müşterilerim hangileri?',
  'Teklif hazırlama stratejisi öner',
  'Orta Asya pazarında satış teknikleri',
  'Rakip analizi nasıl yapılır?',
  'WhatsApp ile müşteri takibi için en iyi pratikler',
];

function Message({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm ${
        isUser ? 'bg-brand-600' : 'bg-dark-600 border border-dark-500'
      }`}>
        {isUser ? '👤' : '🤖'}
      </div>
      <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
        isUser
          ? 'bg-brand-600 text-white rounded-tr-sm'
          : 'bg-dark-700 text-slate-200 rounded-tl-sm'
      }`}>
        {msg.content.split('\n').map((line, i) => (
          <span key={i}>{line}{i < msg.content.split('\n').length - 1 && <br />}</span>
        ))}
        {msg.streaming && <span className="inline-block w-1.5 h-4 bg-current opacity-70 ml-0.5 animate-pulse align-middle" />}
      </div>
    </div>
  );
}

export default function UstaBotPage() {
  const { t } = useTranslation();
  const { token } = useAuthStore();

  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: 'Merhaba! Ben UstaBot, GDSales360.ai satış asistanınım. Müşterileriniz, teklifleriniz veya satış stratejileriniz hakkında size yardımcı olmaktan memnuniyet duyarım. Nasıl yardımcı olabilirim?',
    },
  ]);
  const [input,     setInput]     = useState('');
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send(text) {
    const content = (text || input).trim();
    if (!content || streaming) return;
    setInput('');

    const userMsg = { role: 'user', content };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setStreaming(true);

    const botId = Date.now();
    setMessages(prev => [...prev, { id: botId, role: 'assistant', content: '', streaming: true }]);

    try {
      const apiBase = import.meta.env.VITE_API_URL;
      const res = await fetch(`${apiBase}/ustabot/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Request failed');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') break;
          try {
            const parsed = JSON.parse(payload);
            if (parsed.text) {
              accumulated += parsed.text;
              setMessages(prev => prev.map(m =>
                m.id === botId ? { ...m, content: accumulated } : m
              ));
            }
          } catch { /* malformed chunk, skip */ }
        }
      }

      setMessages(prev => prev.map(m =>
        m.id === botId ? { ...m, streaming: false } : m
      ));
    } catch (err) {
      setMessages(prev => prev.map(m =>
        m.id === botId
          ? { ...m, content: err.message.includes('not configured')
              ? 'UstaBot henüz yapılandırılmadı. Lütfen ANTHROPIC_API_KEY ortam değişkenini ayarlayın.'
              : `Hata: ${err.message}`, streaming: false }
          : m
      ));
    } finally {
      setStreaming(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  return (
    <div className="flex flex-col h-full max-h-screen">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-dark-700 bg-dark-800 flex-shrink-0">
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-600 to-purple-600 flex items-center justify-center text-lg">
          🤖
        </div>
        <div>
          <h1 className="text-base font-semibold text-slate-100">UstaBot</h1>
          <p className="text-xs text-slate-500">{t('ustabot.subtitle')}</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs text-slate-500">{t('ustabot.online')}</span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
        {messages.map((msg, i) => <Message key={msg.id || i} msg={msg} />)}
        <div ref={bottomRef} />
      </div>

      {/* Suggestions (show only at start) */}
      {messages.length <= 1 && (
        <div className="px-6 pb-3 flex-shrink-0">
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map(s => (
              <button
                key={s}
                onClick={() => send(s)}
                className="text-xs px-3 py-1.5 rounded-full border border-dark-600 text-slate-400 hover:text-slate-200 hover:border-brand-500 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="px-6 pb-5 flex-shrink-0">
        <div className="flex gap-2 bg-dark-800 border border-dark-700 rounded-2xl px-4 py-2.5 focus-within:border-brand-500 transition-colors">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder={t('ustabot.placeholder')}
            rows={1}
            disabled={streaming}
            className="flex-1 bg-transparent text-sm text-slate-200 placeholder-slate-600 resize-none focus:outline-none leading-5 max-h-32"
            style={{ lineHeight: '1.5rem' }}
          />
          <button
            onClick={() => send()}
            disabled={!input.trim() || streaming}
            className="w-8 h-8 rounded-xl bg-brand-600 text-white flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:bg-brand-500 transition-colors flex-shrink-0 self-end"
          >
            {streaming ? (
              <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            )}
          </button>
        </div>
        <p className="text-xs text-slate-600 text-center mt-2">{t('ustabot.hint')}</p>
      </div>
    </div>
  );
}

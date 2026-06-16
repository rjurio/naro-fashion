'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Sparkles, Loader2, AlertCircle, Wrench, Trash2, User, Bot } from 'lucide-react';
import { adminApi } from '@/lib/api';

const STORAGE_KEY = 'naro_ai_assistant_history';
const MAX_HISTORY = 50; // bound localStorage growth

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: Array<{ tool: string; input: any; ok: boolean; error?: string }>;
  ts?: number;
}

function loadHistory(): ChatMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(-MAX_HISTORY) : [];
  } catch {
    return [];
  }
}

function saveHistory(messages: ChatMessage[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_HISTORY)));
  } catch {
    // localStorage full or unavailable — silent
  }
}

// Minimal markdown rendering: bold, italics, inline code, code blocks, links, headings.
// Renders the assistant's markdown-formatted responses without pulling in a parser dep.
function renderMarkdown(text: string): string {
  // Escape HTML first
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks ``` ... ```
  html = html.replace(/```([a-z]*)\n([\s\S]*?)```/g, (_, lang, code) =>
    `<pre class="bg-[hsl(var(--muted))] border border-[hsl(var(--border))] rounded p-3 my-2 text-xs overflow-x-auto"><code>${code.trim()}</code></pre>`,
  );

  // Headings
  html = html.replace(/^### (.+)$/gm, '<h3 class="font-semibold text-sm mt-3 mb-1">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="font-semibold text-base mt-3 mb-1">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 class="font-semibold text-lg mt-3 mb-1">$1</h1>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="bg-[hsl(var(--muted))] px-1 py-0.5 rounded text-xs">$1</code>');

  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');

  // Links — allowlist http(s) + relative URLs only; reject javascript:, data:,
  // and other schemes that would fire JS when clicked. The href value goes
  // through dangerouslySetInnerHTML so an LLM-emitted `[click](javascript:alert(1))`
  // would otherwise execute on click.
  const isSafeHref = (href: string): boolean => {
    const trimmed = href.trim();
    if (!trimmed) return false;
    if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../') || trimmed.startsWith('#')) return true;
    try {
      const u = new URL(trimmed);
      return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:';
    } catch {
      return false;
    }
  };
  const escapeHtmlAttr = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, href) => {
    if (!isSafeHref(href)) return label; // strip the link, keep the label text
    const safeHref = escapeHtmlAttr(href);
    return `<a href="${safeHref}" class="text-brand-gold underline hover:no-underline" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  // Tables — pipe-separated. Detect and convert blocks.
  html = html.replace(/(?:^\|.+\|\n)+/gm, (match) => {
    const lines = match.trim().split('\n');
    if (lines.length < 2) return match;
    const headerCells = lines[0].split('|').slice(1, -1).map((s) => s.trim());
    const bodyLines = lines.slice(2); // skip separator line
    let table = '<table class="my-2 border-collapse text-xs w-full"><thead><tr>';
    for (const h of headerCells) {
      table += `<th class="border border-[hsl(var(--border))] px-2 py-1 text-left bg-[hsl(var(--muted))]">${h}</th>`;
    }
    table += '</tr></thead><tbody>';
    for (const row of bodyLines) {
      const cells = row.split('|').slice(1, -1).map((s) => s.trim());
      table += '<tr>';
      for (const c of cells) {
        table += `<td class="border border-[hsl(var(--border))] px-2 py-1">${c}</td>`;
      }
      table += '</tr>';
    }
    table += '</tbody></table>';
    return table;
  });

  // Bullets — lines starting with - or *
  html = html.replace(/(?:^[-*] .+\n?)+/gm, (match) => {
    const items = match.trim().split('\n').map((l) => l.replace(/^[-*] /, ''));
    return '<ul class="list-disc pl-5 my-2 space-y-0.5">' +
      items.map((i) => `<li>${i}</li>`).join('') + '</ul>';
  });

  // Paragraphs — convert double newlines, then single newlines to <br>
  html = html.split(/\n\n+/).map((p) => {
    if (p.startsWith('<') && (p.endsWith('>') || p.includes('</'))) return p;
    return `<p class="my-2">${p.replace(/\n/g, '<br>')}</p>`;
  }).join('');

  return html;
}

const STARTER_PROMPTS = [
  "List the products with low stock",
  "What rentals are overdue?",
  "Show me sales for this month",
  "How many pending orders do we have?",
  "What's in the recycle bin?",
  "Draft a new wedding gown product under Wedding Dresses",
];

export default function AiAssistantPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [configStatus, setConfigStatus] = useState<{ configured: boolean; message: string } | null>(null);
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setMessages(loadHistory());
    adminApi.aiAssistantStatus()
      .then(setConfigStatus)
      .catch(() => setConfigStatus({ configured: false, message: 'Could not reach the AI assistant endpoint.' }));
  }, []);

  useEffect(() => {
    saveHistory(messages);
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg: ChatMessage = { role: 'user', content: trimmed, ts: Date.now() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);
    setError('');

    try {
      // Send full conversation history so the assistant has context.
      const apiMessages = newMessages.map((m) => ({ role: m.role, content: m.content }));
      const result = await adminApi.aiAssistantChat(apiMessages);
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: result.reply || '(empty response)',
        toolCalls: result.toolCalls,
        ts: Date.now(),
      };
      setMessages([...newMessages, assistantMsg]);
    } catch (err: any) {
      const msg = err?.message || 'Failed to send message';
      setError(msg);
      // Drop the in-flight user message? No — keep it; the user can retry.
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
    }
  }, [messages, loading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const clearHistory = () => {
    if (!confirm('Clear chat history? This only clears your browser — server-side audit logs are kept.')) return;
    setMessages([]);
    setError('');
  };

  const notConfigured = configStatus && !configStatus.configured;

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-[hsl(var(--border))]">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-brand-gold/10">
            <Sparkles className="w-5 h-5 text-brand-gold" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[hsl(var(--foreground))]">AI Assistant</h1>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              Ask about products, orders, rentals, inventory, or reports.
            </p>
          </div>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={clearHistory}
            className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))] hover:text-red-600 transition-colors px-2 py-1 rounded"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear
          </button>
        )}
      </div>

      {/* Not-configured banner */}
      {notConfigured && (
        <div className="mt-4 p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900 dark:text-amber-200">
            <p className="font-medium">AI Assistant not configured</p>
            <p className="text-xs mt-1">{configStatus?.message}</p>
          </div>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-4 space-y-4">
        {messages.length === 0 && !notConfigured && (
          <div className="text-center py-12">
            <Sparkles className="w-10 h-10 mx-auto text-brand-gold/40 mb-3" />
            <p className="text-sm text-[hsl(var(--muted-foreground))] mb-6">
              Ask me anything about your store. I can search, summarise, and create drafts.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-xl mx-auto">
              {STARTER_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => sendMessage(p)}
                  className="text-left text-xs px-3 py-2 rounded-lg border border-[hsl(var(--border))] hover:border-brand-gold hover:bg-brand-gold/5 transition-colors cursor-pointer"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`p-2 rounded-full flex-shrink-0 h-8 w-8 flex items-center justify-center ${
              msg.role === 'user' ? 'bg-brand-gold/20' : 'bg-[hsl(var(--muted))]'
            }`}>
              {msg.role === 'user'
                ? <User className="w-4 h-4 text-brand-gold" />
                : <Bot className="w-4 h-4 text-[hsl(var(--foreground))]" />}
            </div>
            <div className={`flex-1 min-w-0 max-w-[85%] ${msg.role === 'user' ? 'flex justify-end' : ''}`}>
              <div className={`rounded-2xl px-4 py-2.5 text-sm ${
                msg.role === 'user'
                  ? 'bg-brand-gold/10 text-[hsl(var(--foreground))]'
                  : 'bg-[hsl(var(--muted))]/50 text-[hsl(var(--foreground))]'
              }`}>
                {msg.role === 'assistant' ? (
                  <div
                    className="prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                  />
                ) : (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                )}

                {/* Tool calls trace (collapsible-style under assistant messages) */}
                {msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0 && (
                  <details className="mt-3 pt-3 border-t border-[hsl(var(--border))]/40">
                    <summary className="text-xs text-[hsl(var(--muted-foreground))] cursor-pointer flex items-center gap-1.5 hover:text-[hsl(var(--foreground))]">
                      <Wrench className="w-3 h-3" />
                      {msg.toolCalls.length} tool call{msg.toolCalls.length === 1 ? '' : 's'}
                    </summary>
                    <ul className="mt-2 space-y-1">
                      {msg.toolCalls.map((tc, j) => (
                        <li key={j} className="text-xs font-mono text-[hsl(var(--muted-foreground))]">
                          <span className={tc.ok ? 'text-emerald-600' : 'text-red-500'}>
                            {tc.ok ? '✓' : '✗'}
                          </span>{' '}
                          {tc.tool}
                          {tc.error && <span className="text-red-500"> — {tc.error}</span>}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex gap-3">
            <div className="p-2 rounded-full bg-[hsl(var(--muted))] h-8 w-8 flex items-center justify-center">
              <Bot className="w-4 h-4 text-[hsl(var(--foreground))]" />
            </div>
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-[hsl(var(--muted))]/50">
              <Loader2 className="w-4 h-4 animate-spin text-brand-gold" />
              <span className="text-xs text-[hsl(var(--muted-foreground))]">Thinking…</span>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-sm text-red-700 dark:text-red-400 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Composer */}
      <form onSubmit={handleSubmit} className="border-t border-[hsl(var(--border))] pt-4">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={notConfigured ? 'AI Assistant is not configured' : 'Ask anything… (Enter to send, Shift+Enter for new line)'}
            disabled={loading || !!notConfigured}
            rows={2}
            className="flex-1 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none focus:ring-2 focus:ring-brand-gold/50 resize-none disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <button
            type="submit"
            disabled={loading || !input.trim() || !!notConfigured}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-gold text-white text-sm font-medium hover:bg-brand-gold-dark hover:shadow-md transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Send
          </button>
        </div>
        <p className="text-xs text-[hsl(var(--muted-foreground))] mt-2 text-center">
          AI can make mistakes — verify important results in the admin UI.
        </p>
      </form>
    </div>
  );
}

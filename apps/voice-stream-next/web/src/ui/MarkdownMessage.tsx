import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { cn } from './cn.js';

export function MarkdownMessage({ text, className = '' }: { text: string; className?: string }) {
  return (
    <div className={cn('assistant-markdown', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{text}</ReactMarkdown>
    </div>
  );
}

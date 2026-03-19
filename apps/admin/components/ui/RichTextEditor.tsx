'use client';

import dynamic from 'next/dynamic';
import { useMemo } from 'react';
import 'react-quill-new/dist/quill.snow.css';

const ReactQuill = dynamic(() => import('react-quill-new'), { ssr: false });

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: string;
}

export default function RichTextEditor({
  value,
  onChange,
  placeholder = 'Start writing...',
  minHeight = '300px',
}: RichTextEditorProps) {
  const modules = useMemo(
    () => ({
      toolbar: [
        [{ header: [2, 3, 4, false] }],
        ['bold', 'italic', 'underline', 'strike'],
        [{ color: [] }, { background: [] }],
        [{ list: 'ordered' }, { list: 'bullet' }],
        [{ align: [] }],
        ['link', 'image'],
        ['blockquote', 'code-block'],
        ['clean'],
      ],
    }),
    [],
  );

  const formats = [
    'header',
    'bold', 'italic', 'underline', 'strike',
    'color', 'background',
    'list',
    'align',
    'link', 'image',
    'blockquote', 'code-block',
  ];

  return (
    <div className="rich-editor-wrapper" style={{ ['--editor-min-height' as string]: minHeight }}>
      <style>{`
        .rich-editor-wrapper .ql-toolbar {
          border-color: hsl(var(--border)) !important;
          border-radius: 0.5rem 0.5rem 0 0;
          background: hsl(var(--muted));
        }
        .rich-editor-wrapper .ql-container {
          border-color: hsl(var(--border)) !important;
          border-radius: 0 0 0.5rem 0.5rem;
          font-size: 14px;
          font-family: inherit;
          min-height: var(--editor-min-height, 300px);
        }
        .rich-editor-wrapper .ql-editor {
          min-height: var(--editor-min-height, 300px);
          color: hsl(var(--foreground));
        }
        .rich-editor-wrapper .ql-editor.ql-blank::before {
          color: hsl(var(--muted-foreground));
          font-style: normal;
        }
        .rich-editor-wrapper .ql-snow .ql-stroke {
          stroke: hsl(var(--muted-foreground));
        }
        .rich-editor-wrapper .ql-snow .ql-fill {
          fill: hsl(var(--muted-foreground));
        }
        .rich-editor-wrapper .ql-snow .ql-picker-label {
          color: hsl(var(--muted-foreground));
        }
        .rich-editor-wrapper .ql-editor h2 { font-size: 1.25rem; font-weight: 700; margin-top: 1.5rem; margin-bottom: 0.75rem; }
        .rich-editor-wrapper .ql-editor h3 { font-size: 1.1rem; font-weight: 600; margin-top: 1rem; margin-bottom: 0.5rem; }
        .rich-editor-wrapper .ql-editor table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
        .rich-editor-wrapper .ql-editor th, .rich-editor-wrapper .ql-editor td { border: 1px solid hsl(var(--border)); padding: 0.5rem 0.75rem; text-align: left; font-size: 0.875rem; }
        .rich-editor-wrapper .ql-editor th { background: hsl(var(--muted)); font-weight: 600; }
      `}</style>
      <ReactQuill
        theme="snow"
        value={value}
        onChange={onChange}
        modules={modules}
        formats={formats}
        placeholder={placeholder}
      />
    </div>
  );
}

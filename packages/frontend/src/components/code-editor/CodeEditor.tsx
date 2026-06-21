import {
  useCallback,
  useMemo,
  useRef,
  type ChangeEvent,
  type KeyboardEvent,
  type UIEvent,
} from 'react';
import { getLanguageFromPath } from './language-map';

interface CodeEditorProps {
  path: string;
  value: string;
  onChange?: (value: string) => void;
  onSave?: () => void;
  readOnly?: boolean;
}

export function CodeEditor({ path, value, onChange, onSave, readOnly = false }: CodeEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const language = getLanguageFromPath(path);
  const lineNumbers = useMemo(() => {
    const lineCount = Math.max(1, value.split('\n').length);
    return Array.from({ length: lineCount }, (_, index) => index + 1);
  }, [value]);

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      onChange?.(event.target.value);
    },
    [onChange]
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        onSave?.();
        return;
      }

      if (event.key === 'Tab' && !readOnly) {
        event.preventDefault();
        const target = event.currentTarget;
        const start = target.selectionStart;
        const end = target.selectionEnd;
        const nextValue = `${value.slice(0, start)}  ${value.slice(end)}`;
        onChange?.(nextValue);
        window.requestAnimationFrame(() => {
          target.selectionStart = start + 2;
          target.selectionEnd = start + 2;
        });
      }
    },
    [onChange, onSave, readOnly, value]
  );

  const handleScroll = useCallback((event: UIEvent<HTMLTextAreaElement>) => {
    if (gutterRef.current) {
      gutterRef.current.scrollTop = event.currentTarget.scrollTop;
    }
  }, []);

  return (
    <div className="code-editor-shell" data-language={language}>
      <div ref={gutterRef} className="code-editor-gutter" aria-hidden="true">
        {lineNumbers.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onScroll={handleScroll}
        readOnly={readOnly}
        spellCheck={false}
        className="code-editor-textarea"
        aria-label={`Editing ${path}`}
      />
    </div>
  );
}

export default CodeEditor;

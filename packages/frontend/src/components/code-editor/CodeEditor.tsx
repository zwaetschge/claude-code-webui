import { useRef, useCallback } from 'react';
import Editor, { OnMount, OnChange } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { Loader2 } from 'lucide-react';
import { getLanguageFromPath } from './language-map';

interface CodeEditorProps {
  path: string;
  value: string;
  onChange?: (value: string) => void;
  onSave?: () => void;
  readOnly?: boolean;
}

export function CodeEditor({
  path,
  value,
  onChange,
  onSave,
  readOnly = false,
}: CodeEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const language = getLanguageFromPath(path);

  const handleMount: OnMount = useCallback((editor) => {
    editorRef.current = editor;

    // Add Ctrl+S save shortcut
    editor.addCommand(
      // Monaco.KeyMod.CtrlCmd | Monaco.KeyCode.KeyS
      2048 | 49, // CtrlCmd + S
      () => {
        onSave?.();
      }
    );

    // Focus the editor
    editor.focus();
  }, [onSave]);

  const handleChange: OnChange = useCallback((value) => {
    if (value !== undefined) {
      onChange?.(value);
    }
  }, [onChange]);

  return (
    <Editor
      height="100%"
      language={language}
      value={value}
      theme="vs-dark"
      onMount={handleMount}
      onChange={handleChange}
      loading={
        <div className="flex items-center justify-center h-full">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
      options={{
        readOnly,
        minimap: { enabled: false },
        fontSize: 13,
        lineNumbers: 'on',
        wordWrap: 'on',
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        insertSpaces: true,
        folding: true,
        glyphMargin: false,
        lineDecorationsWidth: 10,
        lineNumbersMinChars: 3,
        renderLineHighlight: 'line',
        cursorBlinking: 'smooth',
        cursorSmoothCaretAnimation: 'on',
        smoothScrolling: true,
        padding: { top: 8, bottom: 8 },
      }}
    />
  );
}

export default CodeEditor;

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import BulletList from '@tiptap/extension-bullet-list';
import OrderedList from '@tiptap/extension-ordered-list';
import ListItem from '@tiptap/extension-list-item';
import {
  FiBold,
  FiItalic,
  FiUnderline,
  FiLink,
  FiList,
} from 'react-icons/fi';
import { LuListOrdered } from 'react-icons/lu';

interface RichTextEditorProps {
  content: string;
  onChange: (content: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function RichTextEditor({
  content,
  onChange,
  placeholder = 'Start typing...',
  className = '',
  disabled = false,
}: RichTextEditorProps) {
  const editor = useEditor({
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        bulletList: false, // Disable default to use custom
        orderedList: false, // Disable default to use custom
        listItem: false, // Disable default to use custom
        codeBlock: false, // Often causes issues if not needed or duplicated
      }),
      BulletList.configure({
        HTMLAttributes: {
          class: 'list-disc ml-6 my-2',
        },
      }),
      OrderedList.configure({
        HTMLAttributes: {
          class: 'list-decimal ml-6 my-2',
        },
      }),
      ListItem.configure({
        HTMLAttributes: {
          class: 'ml-2',
        },
      }),
      Link.configure({
        openOnClick: false,
      }),
      Placeholder.configure({
        placeholder,
      }),
    ],
    content,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  // Update editable state if disabled prop changes
  if (editor && editor.isEditable === disabled) {
    editor.setEditable(!disabled);
  }

  if (!editor) {
    return null;
  }

  const toggleBold = () => editor.chain().focus().toggleBold().run();
  const toggleItalic = () => editor.chain().focus().toggleItalic().run();
  const toggleUnderline = () => editor.chain().focus().toggleStrike().run();
  const toggleBulletList = () => editor.chain().focus().toggleBulletList().run();
  const toggleOrderedList = () => editor.chain().focus().toggleOrderedList().run();

  const addLink = () => {
    const url = window.prompt('Enter URL:');
    if (url) {
      editor.chain().focus().setLink({ href: url }).run();
    }
  };

  return (
    <div className={`border border-gray-300 dark:border-gray-600 rounded-md ${className} ${disabled ? 'opacity-60 cursor-not-allowed bg-gray-50 dark:bg-gray-900' : ''}`}>
      {/* Toolbar */}
      <div className={`border-b border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 p-2 flex flex-wrap gap-1 ${disabled ? 'pointer-events-none' : ''}`}>
        {/* Style Dropdown */}
        <select
          disabled={disabled}
          onChange={(e) => {
            const level = e.target.value;
            if (level === 'normal') {
              editor.chain().focus().setParagraph().run();
            } else {
              const levelNum = parseInt(level) as 1 | 2 | 3 | 4 | 5 | 6;
              editor.chain().focus().toggleHeading({ level: levelNum }).run();
            }
          }}
          className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 dark:text-white"
        >
          <option value="normal">Normal</option>
          <option value="1">Heading 1</option>
          <option value="2">Heading 2</option>
          <option value="3">Heading 3</option>
        </select>

        <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1" />

        {/* Text Formatting */}
        <button
          type="button"
          disabled={disabled}
          onClick={toggleBold}
          className={`p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 ${
            editor.isActive('bold') ? 'bg-gray-300 dark:bg-gray-600' : ''
          }`}
          title="Bold"
        >
          <FiBold className="w-4 h-4 dark:text-white" />
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={toggleItalic}
          className={`p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 ${
            editor.isActive('italic') ? 'bg-gray-300 dark:bg-gray-600' : ''
          }`}
          title="Italic"
        >
          <FiItalic className="w-4 h-4 dark:text-white" />
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={toggleUnderline}
          className={`p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 ${
            editor.isActive('strike') ? 'bg-gray-300 dark:bg-gray-600' : ''
          }`}
          title="Underline"
        >
          <FiUnderline className="w-4 h-4 dark:text-white" />
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={addLink}
          className={`p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 ${
            editor.isActive('link') ? 'bg-gray-300 dark:bg-gray-600' : ''
          }`}
          title="Insert Link"
        >
          <FiLink className="w-4 h-4 dark:text-white" />
        </button>

        <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1" />

        {/* Lists */}
        <button
          type="button"
          disabled={disabled}
          onClick={toggleBulletList}
          className={`p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 ${
            editor.isActive('bulletList') ? 'bg-gray-300 dark:bg-gray-600' : ''
          }`}
          title="Bullet List"
        >
          <FiList className="w-4 h-4 dark:text-white" />
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={toggleOrderedList}
          className={`p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 ${
            editor.isActive('orderedList') ? 'bg-gray-300 dark:bg-gray-600' : ''
          }`}
          title="Numbered List"
        >
          <LuListOrdered className="w-4 h-4 dark:text-white" />
        </button>
      </div>

      {/* Editor Content */}
      <div
        onClick={() => !disabled && editor?.chain().focus().run()}
        className={`cursor-text min-h-[150px] flex-1 ${disabled ? 'cursor-not-allowed' : ''}`}
      >
        <EditorContent
          editor={editor}
          className="prose prose-sm dark:prose-invert max-w-none p-4 h-full
            prose-headings:font-dmmono prose-p:font-worksans prose-li:font-worksans
            prose-ul:my-2 prose-ol:my-2
            dark:prose-headings:text-white dark:prose-p:text-gray-300 dark:prose-li:text-gray-300
            [&_.ProseMirror]:min-h-[120px] [&_.ProseMirror]:outline-none [&_.ProseMirror]:h-full"
        />
      </div>
    </div>
  );
}

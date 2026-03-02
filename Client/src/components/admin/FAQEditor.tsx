
import { useState, useEffect, useRef } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { RichTextEditor } from '../ui/RichTextEditor';
import { Trash2, Plus } from 'lucide-react';
import { usePermissions } from '../../hooks/usePermissions';
import {
  parseFAQ,
  renderFAQ,
  generateFAQHtml,
  DEFAULT_FAQ_TEMPLATE,
  type FAQItem
} from '../../utils/faqTemplate';

interface FAQEditorProps {
  initialContent?: string;
  gameTitle?: string;
  categoryName?: string;
  onChange: (html: string) => void;
  isReadOnly?: boolean;
}

export function FAQEditor({
  initialContent,
  gameTitle = 'Game',
  categoryName = 'Game',
  onChange,
  isReadOnly = false
}: FAQEditorProps) {
  const permissions = usePermissions();
  const [items, setItems] = useState<FAQItem[]>([]);
  // Track which item is currently being edited (expanded). -1 means none.
  const [expandedIndex, setExpandedIndex] = useState<number>(-1);

  // Ref to track if the update comes from internal edit to prevent circular overrides
  const isInternalUpdate = useRef(false);

  // Initialize/Sync content
  useEffect(() => {
    // If we just updated the parent, don't re-parse and overwrite our local state
    // This prevents cursor jumps and data loss from normalization
    if (isInternalUpdate.current) {
        isInternalUpdate.current = false;
        return;
    }

    // Determine raw content: Use initialContent, or default if it's missing OR empty string
    // This fixes the issue where "stripped" plain text (which is non-empty but parses to 0 items)
    // was preventing defaults from loading.
    // We strictly assume: If we parse the content and find 0 items, we SHOULD show defaults.
    // Unless the user explicitly wants an empty FAQ? In that case they can delete all items manually.

    const rawContent = initialContent || DEFAULT_FAQ_TEMPLATE;

    const renderedContent = renderFAQ(rawContent, {
      title: gameTitle,
      category: { name: categoryName }
    });

    let parsed = parseFAQ(renderedContent);

    // If parsing resulted in NO items (e.g. because of stripped tags or empty string),
    // forcibly fallback to the Default Template.
    if (parsed.length === 0) {
        const defaultRendered = renderFAQ(DEFAULT_FAQ_TEMPLATE, {
            title: gameTitle,
            category: { name: categoryName }
        });
        parsed = parseFAQ(defaultRendered);
    }

    // Only update state if different to prevent loops
    if (JSON.stringify(parsed) !== JSON.stringify(items)) {
        setItems(parsed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialContent, gameTitle, categoryName]);

  const handleUpdate = (newItems: FAQItem[]) => {
    isInternalUpdate.current = true;
    setItems(newItems);
    const html = generateFAQHtml(newItems);
    onChange(html);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
            <h3 className="text-lg font-semibold dark:text-gray-200">
                FAQ / Q&A Editor
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
                Manage questions and answers. {(permissions.isSuperAdmin || permissions.isAdmin) ? "Admins can edit everything." : "Editors can only edit answers."}
            </p>
        </div>
        {(permissions.isSuperAdmin || permissions.isAdmin) && !isReadOnly && (
            <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                    const newItem: FAQItem = {
                        question: `New Question?`,
                        answer: `<p>Answer here...</p>`
                    };
                    const newItems = [...items, newItem];
                    handleUpdate(newItems);
                    setExpandedIndex(newItems.length - 1); // Auto-expand new item
                }}
                className="gap-2"
            >
                <Plus className="w-4 h-4" />
                Add Question
            </Button>
        )}
      </div>

      <div className="space-y-4">
        {items.map((item, index) => {
            const isExpanded = expandedIndex === index;
            return (
                <div
                key={index}
                className={`border rounded-lg bg-white dark:bg-[#1A2634] dark:border-gray-700 shadow-sm transition-all duration-200 ${isExpanded ? 'ring-2 ring-blue-500/20' : ''}`}
                >
                    {/* Header: Always visible, clickable to toggle */}
                    <div
                        className="flex justify-between items-center p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-lg"
                        onClick={() => setExpandedIndex(isExpanded ? -1 : index)}
                    >
                        <div className="flex-1 font-medium text-gray-900 dark:text-gray-100">
                            {item.question || "Empty Question"}
                        </div>

                        <div className="flex items-center gap-2">
                             {(permissions.isSuperAdmin || permissions.isAdmin) && !isReadOnly && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={(e) => {
                                        e.stopPropagation(); // Prevent collapse
                                        const newItems = items.filter((_, i) => i !== index);
                                        handleUpdate(newItems);
                                        if (isExpanded) setExpandedIndex(-1);
                                    }}
                                    className="text-red-500 hover:text-red-700 hover:bg-red-100 dark:hover:bg-red-900/20 h-8 w-8"
                                    title="Delete Question"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                             )}
                             <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="text-gray-500"
                            >
                                {isExpanded ? 'Collapse' : 'Edit'}
                            </Button>
                        </div>
                    </div>

                    {/* Body: Visible only when expanded */}
                    {isExpanded && (
                        <div className="p-4 pt-0 border-t dark:border-gray-700">
                            <div className="space-y-4 mt-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Question
                                    </label>
                                    <Input
                                        value={item.question}
                                        onChange={(e) => {
                                            const newItems = [...items];
                                            newItems[index].question = e.target.value;
                                            handleUpdate(newItems);
                                        }}
                                        disabled={(!permissions.isSuperAdmin && !permissions.isAdmin) || isReadOnly}
                                        className="font-semibold"
                                        placeholder="e.g. Is this game free?"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Answer
                                    </label>
                                    <RichTextEditor
                                        content={item.answer}
                                        onChange={(html) => {
                                            const newItems = [...items];
                                            newItems[index].answer = html;
                                            handleUpdate(newItems);
                                        }}
                                        placeholder="Detailed answer..."
                                        disabled={!permissions.canWrite || isReadOnly}
                                    />
                                </div>

                                <div className="flex justify-end">
                                    <Button
                                        type="button"
                                        size="sm"
                                        onClick={() => setExpandedIndex(-1)}
                                    >
                                        Done
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            );
        })}

        {items.length === 0 && (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400 border-2 border-dashed rounded-lg">
            No FAQ items found.
            {(permissions.isSuperAdmin || permissions.isAdmin) && " Click 'Add Question' to create one."}
          </div>
        )}
      </div>
    </div>
  );
}

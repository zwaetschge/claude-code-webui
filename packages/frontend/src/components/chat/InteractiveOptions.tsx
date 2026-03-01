import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Option {
  number: string;
  text: string;
}

interface InteractiveOptionsProps {
  options: Option[];
  onSelect: (option: string) => void;
  disabled?: boolean;
}

// Detect if message contains numbered options that could be interactive
export function detectOptions(content: string): Option[] | null {
  // Look for patterns like:
  // 1. Option text
  // 2. Another option
  // or: 1) Option text
  // or: (1) Option text
  const lines = content.split('\n');
  const options: Option[] = [];

  // Pattern: starts with number followed by . or ) or .) and text
  const optionPattern = /^\s*(?:\()?(\d+)[.)]\)?\.?\s+(.+)$/;

  for (const line of lines) {
    const match = line.match(optionPattern);
    if (match && match[1] && match[2]) {
      const num = parseInt(match[1], 10);
      // Only consider if it looks like sequential options (1, 2, 3...)
      if (options.length === 0 && num === 1) {
        options.push({ number: match[1], text: match[2].trim() });
      } else if (options.length > 0 && num === options.length + 1) {
        options.push({ number: match[1], text: match[2].trim() });
      }
    }
  }

  // Return options only if we found at least 2 sequential options
  return options.length >= 2 ? options : null;
}

// Check if content asks for a choice
export function isChoicePrompt(content: string): boolean {
  const lowerContent = content.toLowerCase();
  return (
    lowerContent.includes('please choose') ||
    lowerContent.includes('please select') ||
    lowerContent.includes('which option') ||
    lowerContent.includes('would you like') ||
    lowerContent.includes('choose one') ||
    lowerContent.includes('select one') ||
    lowerContent.includes('pick one') ||
    lowerContent.includes('which would you') ||
    lowerContent.includes('your choice')
  );
}

export function InteractiveOptions({ options, onSelect, disabled }: InteractiveOptionsProps) {
  const [selected, setSelected] = useState<string | null>(null);

  const handleSelect = (number: string) => {
    if (disabled || selected) return;
    setSelected(number);
    onSelect(number);
  };

  return (
    <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-border/50">
      {options.map((option) => (
        <Button
          key={option.number}
          variant={selected === option.number ? 'default' : 'outline'}
          size="sm"
          className={cn(
            'gap-2 h-auto py-2 px-3',
            selected === option.number && 'ring-2 ring-primary',
            selected && selected !== option.number && 'opacity-50'
          )}
          onClick={() => handleSelect(option.number)}
          disabled={disabled || (selected !== null && selected !== option.number)}
        >
          <span className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-xs font-mono shrink-0">
            {option.number}
          </span>
          <span className="text-left">{option.text}</span>
        </Button>
      ))}
    </div>
  );
}

export default InteractiveOptions;

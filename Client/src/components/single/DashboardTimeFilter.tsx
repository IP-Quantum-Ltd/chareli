import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../ui/popover";
import { Calendar } from "../ui/calendar";
import { Button } from "../ui/button";
import type { DashboardTimeRange } from "../../backend/analytics.service";

interface DashboardTimeFilterProps {
  value: DashboardTimeRange;
  onChange: (timeRange: DashboardTimeRange) => void;
}

const timeRangeOptions = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7days', label: '7 days' },
  { value: 'last30days', label: '30 days' },
  { value: 'custom', label: 'Custom range' },
] as const;

// Parse "YYYY-MM-DD" as local-midnight, not UTC, so re-opening the picker
// with a previously selected range highlights the same calendar days the user
// originally clicked.
function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function valueToRange(v: DashboardTimeRange): DateRange | undefined {
  return v.startDate && v.endDate
    ? { from: parseLocalDate(v.startDate), to: parseLocalDate(v.endDate) }
    : undefined;
}

export function DashboardTimeFilter({ value, onChange }: DashboardTimeFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showCalendar, setShowCalendar] = useState(value.period === 'custom');
  const [range, setRange] = useState<DateRange | undefined>(() => valueToRange(value));

  useEffect(() => {
    if (isOpen) {
      setShowCalendar(value.period === 'custom');
      setRange(valueToRange(value));
    }
  }, [isOpen, value]);

  const getCurrentLabel = () => {
    if (value.period === 'custom' && value.startDate && value.endDate) {
      const start = parseLocalDate(value.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const end = parseLocalDate(value.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `${start} - ${end}`;
    }
    return timeRangeOptions.find(option => option.value === value.period)?.label || 'Today';
  };

  const handlePresetSelect = (period: Exclude<DashboardTimeRange['period'], 'custom'>) => {
    onChange({ period });
    setIsOpen(false);
  };

  const handleApply = () => {
    if (range?.from && range?.to) {
      onChange({
        period: 'custom',
        startDate: format(range.from, 'yyyy-MM-dd'),
        endDate: format(range.to, 'yyyy-MM-dd'),
      });
      setIsOpen(false);
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button className="inline-flex items-center gap-2 px-4 py-2 bg-white dark:bg-[#334154] border border-gray-200 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#334155] transition-colors cursor-pointer">
          <span className="text-gray-600 dark:text-gray-400">Filter</span>
          <span className="text-[#6A7282] dark:text-white font-medium">
            {getCurrentLabel()}
          </span>
          <ChevronDown className="h-4 w-4 text-gray-500" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 dark:bg-[#334154]" align="start">
        <div className="flex">
          <div className="flex flex-col p-2 border-r border-gray-200 dark:border-gray-600 min-w-[140px]">
            {timeRangeOptions.map((option) => {
              const isActive =
                option.value === 'custom'
                  ? showCalendar
                  : value.period === option.value && !showCalendar;
              return (
                <button
                  key={option.value}
                  onClick={() => {
                    if (option.value === 'custom') {
                      setShowCalendar(true);
                    } else {
                      handlePresetSelect(option.value);
                    }
                  }}
                  className={`text-left px-3 py-2 text-sm rounded cursor-pointer transition-colors ${
                    isActive
                      ? 'bg-[#6A7282] text-white'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#3f4b5e]'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          {showCalendar && (
            <div className="flex flex-col">
              <Calendar
                mode="range"
                selected={range}
                onSelect={setRange}
                numberOfMonths={2}
                defaultMonth={range?.from ?? new Date()}
                disabled={{ after: new Date() }}
              />
              <div className="flex justify-end gap-2 p-3 border-t border-gray-200 dark:border-gray-600">
                <Button variant="outline" onClick={() => setIsOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleApply}
                  disabled={!range?.from || !range?.to}
                  className="bg-[#6A7282] hover:bg-[#5A626F] text-white"
                >
                  Apply
                </Button>
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

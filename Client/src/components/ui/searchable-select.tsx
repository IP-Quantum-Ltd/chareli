"use client";

import * as React from "react";
import Select from "react-select";
import "../../styles/react-select-theme.css";

export interface SearchableSelectProps {
  value?: string | string[];
  onValueChange?: (value: string | string[]) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  disabled?: boolean;
  isMulti?: boolean;
}

const SearchableSelect = React.forwardRef<any, SearchableSelectProps>( // eslint-disable-line @typescript-eslint/no-explicit-any
  (
    {
      value,
      onValueChange,
      options,
      placeholder = "Select option...",
      // searchPlaceholder, // Unused
      emptyText = "No options found",
      className,
      disabled = false,
      isMulti = false,
      ...props
    },
    ref
  ) => {
    const selectedOption = isMulti
      ? options.filter((option) => (Array.isArray(value) ? value : []).includes(option.value))
      : options.find((option) => option.value === value);

    return (
      <Select
        ref={ref}
        value={selectedOption || (isMulti ? [] : null)}
        onChange={(newValue: unknown) => {
          if (isMulti) {
            const values = (newValue as Array<{ value: string }>).map((option) => option.value);
            onValueChange?.(values);
          } else {
            onValueChange?.((newValue as { value: string })?.value || "");
          }
        }}
        options={options}
        isMulti={isMulti}
        placeholder={placeholder}
        isSearchable={true}
        isClearable={true}
        isDisabled={disabled}
        noOptionsMessage={() => emptyText}
        className={`react-select-container ${className || ""}`}
        classNamePrefix="react-select"
        theme={(theme) => ({
          ...theme,
          colors: {
            ...theme.colors,
            primary: '#D946EF',
            primary75: '#D946EF',
            primary50: '#F3E8FF',
            primary25: '#F3E8FF',
          },
        })}
        {...props}
      />
    );
  }
);

SearchableSelect.displayName = "SearchableSelect";

export { SearchableSelect };

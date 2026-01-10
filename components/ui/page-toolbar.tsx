'use client';

/**
 * PageToolbar - Unified page header component
 *
 * A reusable toolbar that sits directly beneath the global navbar.
 * Consolidates title, search, and action buttons into a single compact row
 * to maximize vertical space for data content.
 *
 * Features:
 * - Minimal vertical padding (py-2) for space efficiency
 * - Flexbox layout: title left, search center, actions right
 * - Consistent height for search input and buttons (h-9)
 * - Uses semantic color variables from globals.css
 * - Responsive: stacks on mobile, horizontal on desktop
 */

import { ReactNode, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, X, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface PageToolbarAction {
  /** Button label text */
  label: string;
  /** Click handler */
  onClick: () => void;
  /** Optional icon component */
  icon?: ReactNode;
  /** Button variant - defaults to 'default' for primary styling */
  variant?: 'default' | 'outline' | 'secondary' | 'ghost';
  /** Whether the action is disabled */
  disabled?: boolean;
}

export interface PageToolbarProps {
  /** Page title displayed on the left */
  title: string;
  /** Optional subtitle/description - renders as tooltip on info icon if provided */
  subtitle?: string;
  /** Placeholder text for search input - omit to hide search */
  searchPlaceholder?: string;
  /** Callback when search value changes - omit to hide search */
  onSearchChange?: (value: string) => void;
  /** Current search value for controlled input */
  searchValue?: string;
  /** Array of action buttons to render on the right */
  actions?: (PageToolbarAction | ReactNode)[];
  /** Optional className for custom styling */
  className?: string;
  /** Optional children to render between search and actions */
  children?: ReactNode;
}

export function PageToolbar({
  title,
  subtitle,
  searchPlaceholder,
  onSearchChange,
  searchValue,
  actions = [],
  className,
  children,
}: PageToolbarProps) {
  // Internal search state for uncontrolled mode
  const [internalSearch, setInternalSearch] = useState('');
  const currentSearch = searchValue !== undefined ? searchValue : internalSearch;

  const handleSearchChange = (value: string) => {
    if (searchValue === undefined) {
      setInternalSearch(value);
    }
    onSearchChange?.(value);
  };

  const clearSearch = () => {
    handleSearchChange('');
  };

  // Check if search should be shown
  const showSearch = searchPlaceholder !== undefined && onSearchChange !== undefined;

  // Render action buttons
  const renderAction = (action: PageToolbarAction | ReactNode, index: number) => {
    // If it's a ReactNode (custom element), render it directly
    if (!action || typeof action !== 'object' || !('label' in action)) {
      return <div key={index}>{action}</div>;
    }

    // Otherwise, render using our action interface
    const { label, onClick, icon, variant = 'default', disabled } = action;
    return (
      <Button
        key={index}
        variant={variant}
        size="sm"
        className={cn(
          'h-9 px-4',
          // Primary button uses semantic primary color
          variant === 'default' && 'bg-primary hover:bg-primary/90 text-primary-foreground'
        )}
        onClick={onClick}
        disabled={disabled}
      >
        {icon && <span className="mr-2">{icon}</span>}
        {label}
      </Button>
    );
  };

  return (
    <div
      className={cn(
        // Minimal vertical padding for space efficiency
        'py-2 px-0',
        // Flexbox layout with responsive behavior
        'flex flex-col gap-3 md:flex-row md:items-center md:justify-between',
        // Bottom border for visual separation from content
        'border-b border-border/50',
        // Margin bottom to create space before content
        'mb-4',
        className
      )}
    >
      {/* Left section: Title */}
      <div className="flex items-center gap-3 shrink-0">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {subtitle && (
          <span className="hidden lg:inline text-sm text-muted-foreground">
            {subtitle}
          </span>
        )}
      </div>

      {/* Center/Right section: Search, custom children, and actions */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
        {/* Search input - only rendered if searchPlaceholder and onSearchChange are provided */}
        {showSearch && (
          <div className="relative w-full md:w-64 lg:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder={searchPlaceholder}
              value={currentSearch}
              onChange={(e) => handleSearchChange(e.target.value)}
              className={cn(
                'h-9 pl-9 pr-9',
                // Focus ring uses primary color
                'focus:ring-2 focus:ring-primary/20 focus:border-primary'
              )}
            />
            {currentSearch && (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 inline-flex items-center justify-center rounded hover:bg-muted"
                aria-label="Clear search"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            )}
          </div>
        )}

        {/* Custom children (e.g., additional filters) */}
        {children}

        {/* Action buttons - desktop view */}
        {actions.length > 0 && (
          <>
            {/* Desktop: show all actions */}
            <div className="hidden md:flex items-center gap-2">
              {actions.map(renderAction)}
            </div>

            {/* Mobile: show actions in a row, or dropdown if more than 2 */}
            <div className="flex md:hidden items-center gap-2">
              {actions.length <= 2 ? (
                actions.map(renderAction)
              ) : (
                <>
                  {/* Show first action as primary */}
                  {renderAction(actions[0], 0)}
                  {/* Collapse rest into dropdown */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-9 px-3">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {actions.slice(1).map((action, index) => {
                        if (!action || typeof action !== 'object' || !('label' in action)) {
                          return null;
                        }
                        return (
                          <DropdownMenuItem
                            key={index}
                            onClick={action.onClick}
                            disabled={action.disabled}
                          >
                            {action.icon && <span className="mr-2">{action.icon}</span>}
                            {action.label}
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

import * as React from 'react';
import { cn } from './cn.js';
import { useDropdownDismiss } from './dropdown.js';

type UiMenuSelectVariant = 'form' | 'toolbar';

type UiMenuSelectOptionEntry = {
  kind?: 'option';
  value: string;
  label: React.ReactNode;
  title?: string;
  searchText?: string;
  disabled?: boolean;
  className?: string;
};

type UiMenuSelectSeparatorEntry = {
  kind: 'separator';
  key?: string;
  className?: string;
};

export type UiMenuSelectEntry = UiMenuSelectOptionEntry | UiMenuSelectSeparatorEntry;

type UiMenuSelectProps = {
  value: string;
  onValueChange: (next: string) => void;
  entries: UiMenuSelectEntry[];
  variant?: UiMenuSelectVariant;
  disabled?: boolean;
  title?: string;
  triggerClassName?: string;
  panelClassName?: string;
  menuClassName?: string;
  header?: React.ReactNode;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptySearchLabel?: React.ReactNode;
  triggerLabel?: React.ReactNode;
  role?: 'menu' | 'listbox';
  itemRole?: 'menuitem' | 'option';
};

function isOptionEntry(entry: UiMenuSelectEntry): entry is UiMenuSelectOptionEntry {
  return entry.kind !== 'separator';
}

function DefaultChevron({ open }: { open: boolean }) {
  return (
    <svg className={open ? 'ui-menu-select-chevron open' : 'ui-menu-select-chevron'} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.427 7.427l3.396 3.396a.25.25 0 0 0 .354 0l3.396-3.396A.25.25 0 0 0 11.396 7H4.604a.25.25 0 0 0-.177.427Z" />
    </svg>
  );
}

export function UiMenuSelect({
  value,
  onValueChange,
  entries,
  variant = 'form',
  disabled = false,
  title,
  triggerClassName,
  panelClassName,
  menuClassName,
  header,
  searchable = false,
  searchPlaceholder = 'Search...',
  emptySearchLabel = 'No matches',
  triggerLabel,
  role = 'menu',
  itemRole = 'menuitem',
}: UiMenuSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState('');
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  useDropdownDismiss(menuRef, open, setOpen);

  React.useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const selectedEntry = React.useMemo(
    () => entries.find((entry) => isOptionEntry(entry) && entry.value === value) as UiMenuSelectOptionEntry | undefined,
    [entries, value],
  );
  const filteredEntries = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!searchable || !query) return entries;
    return entries.filter((entry) => {
      if (!isOptionEntry(entry)) return true;
      const haystack = [entry.searchText, entry.title, entry.value]
        .map((part) => String(part ?? '').trim().toLowerCase())
        .filter(Boolean);
      return haystack.some((part) => part.includes(query));
    });
  }, [entries, searchQuery, searchable]);
  const hasOptions = filteredEntries.some((entry) => isOptionEntry(entry));

  return (
    <div ref={menuRef} className={cn('ui-menu-select', `ui-menu-select-${variant}`, open && 'open')}>
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          setOpen((current) => !current);
        }}
        disabled={disabled}
        title={title}
        aria-haspopup={role}
        aria-expanded={open}
        className={cn('ui-menu-select-trigger', triggerClassName)}
      >
        <span>{triggerLabel ?? selectedEntry?.label ?? ''}</span>
        <DefaultChevron open={open} />
      </button>

      {open ? (
        <div className={cn('ui-menu-select-panel', panelClassName)} role={role}>
          {header ? <div className="ui-menu-select-header">{header}</div> : null}
          {searchable ? (
            <div className="ui-menu-select-search">
              <input
                autoFocus
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.currentTarget.value)}
                placeholder={searchPlaceholder}
              />
            </div>
          ) : null}
          <div className={cn('ui-menu-select-menu', menuClassName)}>
            {filteredEntries.map((entry, index) => {
              if (!isOptionEntry(entry)) {
                return <div key={entry.key ?? `separator-${index}`} className={cn('ui-menu-select-separator', entry.className)} />;
              }
              const active = entry.value === value;
              return (
                <button
                  key={entry.value}
                  type="button"
                  role={itemRole}
                  aria-selected={itemRole === 'option' ? active : undefined}
                  disabled={entry.disabled}
                  title={entry.title}
                  className={cn(active && 'active', entry.className)}
                  onClick={() => {
                    if (entry.disabled) return;
                    setOpen(false);
                    setSearchQuery('');
                    onValueChange(entry.value);
                  }}
                >
                  {entry.label}
                </button>
              );
            })}
            {!hasOptions ? <div className="ui-menu-select-empty">{emptySearchLabel}</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

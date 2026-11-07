import { useEffect, useRef, useState } from 'react';
import { catalogApi } from '../api/services';
import type { CatalogItem } from '../types';
import { formatMoney } from '../utils/format';

/**
 * A description field that suggests items the hospital already stocks or buys. Picking one hands back its
 * item code, unit and usual price; typing something new is still allowed.
 */
export function ItemSearch({ value, onChange, onPick }: { value: string; onChange: (text: string) => void; onPick: (item: CatalogItem) => void }) {
  const [matches, setMatches] = useState<CatalogItem[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const typed = useRef(false);

  useEffect(() => {
    if (!typed.current || value.trim().length < 2) {
      setMatches([]);
      return;
    }
    let current = true;
    const timer = window.setTimeout(() => {
      catalogApi
        .search(value.trim())
        .then((items) => {
          if (!current) return;
          setMatches(items);
          setActive(-1);
          setOpen(items.length > 0);
        })
        .catch(() => current && setMatches([]));
    }, 250);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [value]);

  const pick = (item: CatalogItem) => {
    typed.current = false;
    setOpen(false);
    onPick(item);
  };

  return (
    <div className="combobox">
      <input
        value={value}
        required
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        placeholder="Type to search items"
        onChange={(e) => {
          typed.current = true;
          onChange(e.target.value);
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onFocus={() => matches.length && setOpen(true)}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, matches.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter' && active >= 0) {
            e.preventDefault();
            pick(matches[active]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {open && (
        <ul className="combobox-list" role="listbox">
          {matches.map((item, index) => (
            <li
              key={item.description}
              role="option"
              aria-selected={index === active}
              className={index === active ? 'combobox-active' : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(item);
              }}
            >
              <span>{item.description}</span>
              <span className="muted small">
                {[item.itemCode, item.uom, item.estimatedUnitPrice !== undefined ? formatMoney(item.estimatedUnitPrice) : null].filter(Boolean).join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

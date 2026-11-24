interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  compact?: boolean;
}

export function Toggle({ checked, onChange, label, disabled = false, compact = false }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`toggle ${checked ? 'is-on' : ''} ${compact ? 'toggle-compact' : ''}`}
      onClick={() => onChange(!checked)}
      disabled={disabled}
    >
      <span className="toggle-thumb" />
    </button>
  );
}

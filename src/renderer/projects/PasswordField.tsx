import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEventHandler,
} from 'react';

import eyeOffIcon from '../../../public/images/icons/actions/eye-off.svg';
import eyeIcon from '../../../public/images/icons/actions/eye.svg';
import { PROJECT_PASSWORD_MAX_BYTES } from '../../shared/contracts';
import { MaskedIcon } from '../components/MaskedIcon';
import { getTooltipTargetProps } from '../components/tooltip';
import type { Translate } from '../pages/page-types';

interface PasswordFieldProps {
  autoComplete: 'current-password' | 'new-password';
  autoFocus?: boolean;
  disabled?: boolean;
  label: string;
  translate: Translate;
  value: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
}

interface InputSelection {
  end: number | null;
  start: number | null;
}

export function PasswordField({
  autoComplete,
  autoFocus = false,
  disabled = false,
  label,
  onChange,
  translate,
  value,
}: PasswordFieldProps) {
  const inputId = `${useId()}-password`;
  const inputRef = useRef<HTMLInputElement>(null);
  const selectionRef = useRef<InputSelection | undefined>(undefined);
  const [visible, setVisible] = useState(false);
  const toggleLabel = translate(
    visible ? 'projects.hidePassword' : 'projects.showPassword',
  );

  useLayoutEffect(() => {
    const selection = selectionRef.current;
    const input = inputRef.current;
    if (!selection || !input) {
      return;
    }

    selectionRef.current = undefined;
    input.focus({ preventScroll: true });
    if (selection.start !== null && selection.end !== null) {
      input.setSelectionRange(selection.start, selection.end);
    }
  }, [visible]);

  return (
    <div className="project-password-field">
      <label htmlFor={inputId}>{label}</label>
      <div className="project-password-field__control">
        <input
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          disabled={disabled}
          id={inputId}
          maxLength={PROJECT_PASSWORD_MAX_BYTES}
          minLength={1}
          onChange={onChange}
          ref={inputRef}
          required
          type={visible ? 'text' : 'password'}
          value={value}
        />
        <button
          aria-label={toggleLabel}
          aria-pressed={visible}
          className="project-password-field__toggle"
          disabled={disabled}
          onClick={() => {
            const input = inputRef.current;
            selectionRef.current =
              input && input.ownerDocument.activeElement === input
                ? {
                    end: input.selectionEnd,
                    start: input.selectionStart,
                  }
                : undefined;
            setVisible((current) => !current);
          }}
          onPointerDown={(event) => event.preventDefault()}
          type="button"
          {...getTooltipTargetProps(toggleLabel, 'bottom')}
        >
          <MaskedIcon
            className="project-password-field__icon"
            icon={visible ? eyeOffIcon : eyeIcon}
          />
        </button>
      </div>
    </div>
  );
}

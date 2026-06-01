import React from 'react';
import { NumberFormatBase } from 'react-number-format';

interface FormattedInputProps {
  id: string;
  value: string; // raw value
  onChange: (val: string) => void;
  format: (val: string) => string;
  clean: (val: string) => string;
  placeholder?: string;
  className?: string;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  type?: 'text' | 'password' | 'tel';
}

const calculateCursorPos = (domValue: string, selectionStart: number, formattedValue: string) => {
  let nonSpaceCount = 0;
  for (let i = 0; i < selectionStart; i++) {
    if (domValue[i] !== ' ') {
      nonSpaceCount++;
    }
  }

  let formattedIndex = 0;
  let count = 0;
  while (count < nonSpaceCount && formattedIndex < formattedValue.length) {
    if (formattedValue[formattedIndex] !== ' ') {
      count++;
    }
    formattedIndex++;
  }
  return formattedIndex;
};

export const FormattedInput: React.FC<FormattedInputProps> = ({
  id,
  value,
  onChange,
  format,
  clean,
  placeholder,
  className = '',
  required,
  disabled,
  readOnly,
  type = 'text'
}) => {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [cursor, setCursor] = React.useState<number | null>(null);
  const [isInvalid, setIsInvalid] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState('');

  React.useLayoutEffect(() => {
    if (inputRef.current && cursor !== null) {
      inputRef.current.setSelectionRange(cursor, cursor);
    }
  }, [value, cursor]);

  const validateValue = (val: string) => {
    const cleanVal = clean(val);
    if (!cleanVal) {
      if (required) {
        setIsInvalid(true);
        setErrorMessage('This field is required.');
      } else {
        setIsInvalid(false);
        setErrorMessage('');
      }
      return;
    }

    if (id.includes('postal')) {
      const postalPattern = /^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/i;
      const formatted = format(cleanVal);
      if (!postalPattern.test(formatted)) {
        setIsInvalid(true);
        setErrorMessage('Invalid Canadian Postal Code format (e.g. A1A 1A1).');
      } else {
        setIsInvalid(false);
        setErrorMessage('');
      }
    } else if (id.includes('business') || id.includes('bn')) {
      const bnPattern = /^\d{9}RP\d{4}$/i;
      if (!bnPattern.test(cleanVal)) {
        setIsInvalid(true);
        setErrorMessage('Invalid CRA Business Number format (must be 15 chars: 123456789RP0001).');
      } else {
        setIsInvalid(false);
        setErrorMessage('');
      }
    } else if (id.includes('sin')) {
      if (cleanVal.length !== 9) {
        setIsInvalid(true);
        setErrorMessage('SIN must be exactly 9 digits.');
      } else {
        setIsInvalid(false);
        setErrorMessage('');
      }
    } else if (id.includes('phone') || id.includes('contact_phone')) {
      if (cleanVal.length !== 10 && cleanVal.length !== 11) {
        setIsInvalid(true);
        setErrorMessage('Phone number must be 10 or 11 digits.');
      } else {
        setIsInvalid(false);
        setErrorMessage('');
      }
    }
  };

  const handleCopy = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const { selectionStart, selectionEnd } = input;
    if (selectionStart === null || selectionEnd === null) return;
    if (selectionStart === selectionEnd) return;

    const selectedText = input.value.slice(selectionStart, selectionEnd);
    const cleanedText = clean(selectedText);

    if (e.clipboardData) {
      e.clipboardData.setData('text/plain', cleanedText);
      e.preventDefault();
    }
  };

  const handleCut = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const { selectionStart, selectionEnd } = input;
    if (selectionStart === null || selectionEnd === null) return;
    if (selectionStart === selectionEnd) return;

    const selectedText = input.value.slice(selectionStart, selectionEnd);
    const cleanedText = clean(selectedText);

    if (e.clipboardData) {
      e.clipboardData.setData('text/plain', cleanedText);
      e.preventDefault();

      const formattedVal = input.value;
      const beforeSelection = formattedVal.slice(0, selectionStart);
      const afterSelection = formattedVal.slice(selectionEnd);
      const newRaw = clean(beforeSelection + afterSelection);
      onChange(newRaw);
    }
  };

  const isPostalCode = id.includes('postal');
  const isBusinessNumber = id.includes('business') || id.includes('bn');

  const errorClassName = isInvalid
    ? className
        .replace(/border-outline-variant/g, 'border-red-500')
        .replace(/border-outline/g, 'border-red-500')
        .replace(/focus:ring-highlight/g, 'focus:ring-red-500') + ' !border-red-500 !focus:ring-red-500'
    : className;

  const formattedValue = format(value);

  return (
    <div className="flex flex-col w-full gap-1">
      {isPostalCode || isBusinessNumber ? (
        <input
          ref={inputRef}
          id={id}
          type={type}
          value={formattedValue}
          onChange={(e) => {
            const domValue = e.target.value;
            const selStart = e.target.selectionStart || 0;
            const raw = clean(domValue).toUpperCase();
            const newFormatted = format(raw);
            const newCursor = calculateCursorPos(domValue, selStart, newFormatted);

            onChange(raw);
            setCursor(newCursor);

            if (isInvalid) {
              validateValue(raw);
            }
          }}
          onBlur={() => validateValue(value)}
          placeholder={placeholder}
          className={errorClassName}
          required={required}
          disabled={disabled}
          readOnly={readOnly}
          onCopy={handleCopy}
          onCut={handleCut}
        />
      ) : (
        <NumberFormatBase
          id={id}
          value={value}
          format={format}
          removeFormatting={clean}
          onValueChange={(values) => {
            onChange(values.value);
            if (isInvalid) {
              validateValue(values.value);
            }
          }}
          onBlur={() => validateValue(value)}
          placeholder={placeholder}
          className={errorClassName}
          required={required}
          disabled={disabled}
          readOnly={readOnly}
          type={type}
          onCopy={handleCopy}
          onCut={handleCut}
        />
      )}
      {isInvalid && errorMessage && (
        <span className="text-red-500 text-xs font-semibold px-1 mt-0.5 animate-pulse-light">
          {errorMessage}
        </span>
      )}
    </div>
  );
};

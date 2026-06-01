import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { FormattedInput } from './FormattedInput';
import { formatSIN, cleanSIN, formatPostalCode, cleanPostalCode } from '../utils/helpers';

const TestWrapper: React.FC = () => {
  const [value, setValue] = useState('123456789');
  return (
    <FormattedInput
      id="test-sin"
      value={value}
      onChange={setValue}
      format={formatSIN}
      clean={cleanSIN}
      placeholder="123-456-789"
      className="test-class"
    />
  );
};

describe('FormattedInput Component', () => {
  it('renders with formatted value initially', () => {
    render(<TestWrapper />);
    const input = screen.getByPlaceholderText('123-456-789') as HTMLInputElement;
    expect(input.value).toBe('123-456-789');
  });

  it('updates raw state and propagates clean values', () => {
    render(<TestWrapper />);
    const input = screen.getByPlaceholderText('123-456-789') as HTMLInputElement;
    
    // Simulate change
    fireEvent.change(input, { target: { value: '987654321' } });
    expect(input.value).toBe('987-654-321');
  });

  it('intercepts copy event and writes raw value to clipboard', () => {
    render(<TestWrapper />);
    const input = screen.getByPlaceholderText('123-456-789') as HTMLInputElement;
    
    // Set selection range
    input.focus();
    input.selectionStart = 0;
    input.selectionEnd = 11; // select the whole "123-456-789"
    
    const clipboardData: any = {
      setData: vi.fn(),
    };
    
    fireEvent.copy(input, { clipboardData });
    
    expect(clipboardData.setData).toHaveBeenCalledWith('text/plain', '123456789');
  });

  it('retains cursor position correctly when a digit is deleted', () => {
    render(<TestWrapper />);
    const input = screen.getByPlaceholderText('123-456-789') as HTMLInputElement;
    
    // Initial value is "123-456-789"
    // Place cursor before '4' (index 4)
    input.focus();
    input.selectionStart = 4;
    input.selectionEnd = 4;
    
    // Simulate user pressing Delete (digit '4' is removed)
    // The browser's native change event would see input value "123-56-789" with cursor at 4
    fireEvent.change(input, {
      target: {
        value: '123-56-789',
        selectionStart: 4,
        selectionEnd: 4
      }
    });
    
    // After React state updates and formatted value is computed:
    // Raw: "12356789", Formatted: "123-567-89"
    // Cursor should remain before '5' (index 4)
    expect(input.value).toBe('123-567-89');
    expect(input.selectionStart).toBe(4);
    expect(input.selectionEnd).toBe(4);
  });
});

const PostalCodeWrapper: React.FC = () => {
  const [value, setValue] = useState('');
  return (
    <FormattedInput
      id="postal_code"
      value={value}
      onChange={setValue}
      format={formatPostalCode}
      clean={cleanPostalCode}
      placeholder="M5H 2Y2"
    />
  );
};

describe('FormattedInput Postal Code Soft Formatting', () => {
  it('formats postal codes with a space and converts to uppercase, allowing soft entries', () => {
    render(<PostalCodeWrapper />);
    const input = screen.getByPlaceholderText('M5H 2Y2') as HTMLInputElement;

    // Typing lowercase 'm5h2y2' converts to uppercase and adds space
    fireEvent.change(input, { target: { value: 'm5h2y2' } });
    expect(input.value).toBe('M5H 2Y2');
  });

  it('allows editing and deleting in the middle without deleting other letters due to hard mask rules', () => {
    render(<PostalCodeWrapper />);
    const input = screen.getByPlaceholderText('M5H 2Y2') as HTMLInputElement;

    // Type initial valid postal code 'M5H 2Y2'
    fireEvent.change(input, { target: { value: 'M5H2Y2' } });
    expect(input.value).toBe('M5H 2Y2');

    // Simulate deleting '2' (index 4 in 'M5H 2Y2').
    // The string after deleting '2' becomes 'M5H Y2'.
    // Under soft rules, 'Y' is not deleted.
    fireEvent.change(input, { target: { value: 'M5H Y2' } });
    expect(input.value).toBe('M5H Y2');
  });

  it('displays validation error on blur and clears on change when valid', () => {
    render(<PostalCodeWrapper />);
    const input = screen.getByPlaceholderText('M5H 2Y2') as HTMLInputElement;

    // Type invalid postal code
    fireEvent.change(input, { target: { value: 'm111mm' } });
    expect(screen.queryByText(/Invalid Canadian Postal Code/)).toBeNull();

    // Blur input to trigger validation
    fireEvent.blur(input);
    expect(screen.getByText(/Invalid Canadian Postal Code/)).toBeInTheDocument();

    // Correct the input to a valid postal code
    fireEvent.change(input, { target: { value: 'M5H2Y2' } });
    // Should immediately clear the validation error
    expect(screen.queryByText(/Invalid Canadian Postal Code/)).toBeNull();
  });
});


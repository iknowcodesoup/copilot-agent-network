import React from 'react';
import { render, screen } from '@testing-library/react';
import { PhaseBadge } from '../src/app/features/voices/phase_badge';
import { voiceRunPhases, isActive } from '../src/app/features/voices/voice_api';

describe('PhaseBadge', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<PhaseBadge phase="training" />);
    expect(baseElement).toBeTruthy();
  });

  it('should label every phase in plain words', () => {
    for (const phase of voiceRunPhases) {
      const { unmount } = render(<PhaseBadge phase={phase} />);
      // the raw enum value must never reach the screen
      expect(screen.queryByText(phase)).toBeNull();
      unmount();
    }
  });

  it('should treat only in-flight phases as active', () => {
    expect(isActive('training')).toBe(true);
    expect(isActive('downloading')).toBe(true);
    expect(isActive('awaiting_review')).toBe(false);
    expect(isActive('ready')).toBe(false);
    expect(isActive('failed')).toBe(false);
  });
});

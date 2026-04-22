/**
 * Tests for the in-tree Tour module that replaced `react-native-spotlight-tour`.
 *
 * We exercise the real TourProvider / AttachStep / useSpotlightTour here —
 * the jest.setup.ts default mock is bypassed by re-importing the real module
 * under a different specifier.
 */

import React from 'react';
import { Text, View } from 'react-native';
import { act, render } from '@testing-library/react-native';

// Override the default auto-mock with the real implementation.
jest.unmock('../../../../../src/components/onboarding/tour');
jest.unmock('../../../../../src/components/onboarding/tour/TourProvider');

import {
  AttachStep,
  SpotlightTourProvider,
  useSpotlightTour,
  type TourStep,
} from '../../../../../src/components/onboarding/tour/TourProvider';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildSteps(count: number): TourStep[] {
  return Array.from({ length: count }, (_, i) => ({
    render: ({ stop }) => (
      <View testID={`tooltip-${i}`}>
        <Text>Step {i}</Text>
        <Text testID={`stop-trigger-${i}`} onPress={stop}>
          stop
        </Text>
      </View>
    ),
    onBackdropPress: 'stop' as const,
    shape: { type: 'rectangle' as const, padding: 4 },
  }));
}

type Handle = ReturnType<typeof useSpotlightTour>;

function HandleExposer({ onReady }: { onReady: (h: Handle) => void }) {
  const handle = useSpotlightTour();
  React.useEffect(() => { onReady(handle); }, [handle, onReady]);
  return null;
}

// Return the most recently mounted handle so each test can call goTo/stop.
function renderTour(steps: TourStep[], children: React.ReactNode) {
  let latest: Handle | null = null;
  const utils = render(
    <SpotlightTourProvider steps={steps}>
      <HandleExposer onReady={(h) => { latest = h; }} />
      {children}
    </SpotlightTourProvider>,
  );
  return {
    ...utils,
    getHandle: () => {
      if (!latest) throw new Error('tour handle not ready');
      return latest;
    },
  };
}

// Stub measureInWindow on every View instance so goTo can resolve.
type MeasureCb = (x: number, y: number, w: number, h: number) => void;
function stubMeasure(layout: { x: number; y: number; width: number; height: number }) {
  const proto = (View.prototype as unknown) as { measureInWindow?: (cb: MeasureCb) => void };
  const original = proto.measureInWindow;
  proto.measureInWindow = (cb: MeasureCb) => {
    cb(layout.x, layout.y, layout.width, layout.height);
  };
  return () => {
    proto.measureInWindow = original;
  };
}

describe('TourProvider', () => {
  const restoreFns: Array<() => void> = [];
  afterEach(() => {
    while (restoreFns.length) restoreFns.pop()?.();
    jest.restoreAllMocks();
  });
  const useStub = (layout: { x: number; y: number; width: number; height: number }) => {
    restoreFns.push(stubMeasure(layout));
  };

  it('renders children without the overlay when idle', () => {
    const { queryByTestId, getByTestId } = renderTour(
      buildSteps(1),
      <AttachStep index={0}><Text testID="child">child</Text></AttachStep>,
    );

    expect(getByTestId('child')).toBeTruthy();
    expect(queryByTestId('tour-overlay')).toBeNull();
    expect(queryByTestId('tour-tooltip')).toBeNull();
  });

  it('shows the overlay and tooltip when goTo is called with a matching index', () => {
    useStub({ x: 10, y: 20, width: 100, height: 40 });

    const { getHandle, getByTestId } = renderTour(
      buildSteps(2),
      <AttachStep index={1}><Text testID="child">child</Text></AttachStep>,
    );

    act(() => { getHandle().goTo(1); });

    expect(getByTestId('tour-overlay')).toBeTruthy();
    expect(getByTestId('tooltip-1')).toBeTruthy();
    expect(getHandle().current).toBe(1);
  });

  it('stop() hides the overlay and resets current to null', () => {
    useStub({ x: 10, y: 20, width: 100, height: 40 });

    const { getHandle, queryByTestId } = renderTour(
      buildSteps(1),
      <AttachStep index={0}><Text testID="child">child</Text></AttachStep>,
    );

    act(() => { getHandle().goTo(0); });
    expect(queryByTestId('tour-overlay')).toBeTruthy();

    act(() => { getHandle().stop(); });
    expect(queryByTestId('tour-overlay')).toBeNull();
    expect(getHandle().current).toBeNull();
  });

  it('tooltip stop callback stops the tour', () => {
    useStub({ x: 10, y: 20, width: 100, height: 40 });

    const { getHandle, getByTestId, queryByTestId } = renderTour(
      buildSteps(1),
      <AttachStep index={0}><Text testID="child">child</Text></AttachStep>,
    );

    act(() => { getHandle().goTo(0); });
    const stopTrigger = getByTestId('stop-trigger-0');
    act(() => { stopTrigger.props.onPress(); });

    expect(queryByTestId('tour-overlay')).toBeNull();
  });

  it('no-ops silently when goTo targets an unregistered index', () => {
    const { getHandle, queryByTestId } = renderTour(
      buildSteps(2),
      <AttachStep index={0}><Text testID="child">child</Text></AttachStep>,
    );

    act(() => { getHandle().goTo(99); });

    expect(queryByTestId('tour-overlay')).toBeNull();
    expect(getHandle().current).toBeNull();
  });

  it('registers multiple indices from a single AttachStep', () => {
    useStub({ x: 0, y: 0, width: 50, height: 50 });

    const { getHandle, getByTestId } = renderTour(
      buildSteps(5),
      <AttachStep index={[2, 4]}><Text testID="child">child</Text></AttachStep>,
    );

    act(() => { getHandle().goTo(2); });
    expect(getByTestId('tooltip-2')).toBeTruthy();

    act(() => { getHandle().goTo(4); });
    expect(getByTestId('tooltip-4')).toBeTruthy();
  });

  it('unregisters indices when the AttachStep unmounts', () => {
    useStub({ x: 0, y: 0, width: 50, height: 50 });
    const Wrapper: React.FC<{ show: boolean }> = ({ show }) => (
      <SpotlightTourProvider steps={buildSteps(1)}>
        {show ? (
          <AttachStep index={0}><Text>visible</Text></AttachStep>
        ) : null}
        <ExternalTrigger />
      </SpotlightTourProvider>
    );

    let exposedHandle: Handle | null = null;
    const ExternalTrigger: React.FC = () => {
      exposedHandle = useSpotlightTour();
      return null;
    };

    const utils = render(<Wrapper show />);
    // Unmount the attach step.
    utils.rerender(<Wrapper show={false} />);

    act(() => { exposedHandle?.goTo(0); });
    // No overlay should appear because the target was unregistered.
    expect(utils.queryByTestId('tour-overlay')).toBeNull();
  });

  it('useSpotlightTour outside a provider returns a no-op handle', () => {
    const captured: { handle?: Handle } = {};
    const Consumer: React.FC = () => {
      captured.handle = useSpotlightTour();
      return null;
    };
    render(<Consumer />);
    const handle = captured.handle;
    if (!handle) throw new Error('handle not captured');

    expect(handle.current).toBeNull();
    expect(handle.status).toBe('idle');
    expect(() => handle.goTo(0)).not.toThrow();
    expect(() => handle.stop()).not.toThrow();
    expect(() => handle.next()).not.toThrow();
    expect(() => handle.previous()).not.toThrow();
  });
});

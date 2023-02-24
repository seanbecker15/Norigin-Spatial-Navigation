import {
  RefObject,
  useCallback,
  useMemo,
  useRef,
  useEffect,
  useState
} from 'react';
import noop from 'lodash/noop';
import uniqueId from 'lodash/uniqueId';
import { SpatialNavigation } from './SpatialNavigation';
import { useFocusContext } from './useFocusedContext';
import useEffectOnce from './useEffectOnce';
import {
  FocusableComponentLayout,
  FocusDetails,
  KeyPressDetails,
  SpatialNavigationService
} from './types';
import { smartNavigate } from './helpers';

export type EnterPressHandler<P = object> = (
  props: P,
  details: KeyPressDetails
) => void;

export type EnterReleaseHandler<P = object> = (props: P) => void;

export type ArrowPressHandler<P = object> = (
  direction: string,
  props: P,
  details: KeyPressDetails
) => boolean;

export type FocusHandler<P = object> = (
  layout: FocusableComponentLayout,
  props: P,
  details: FocusDetails
) => void;

export type BlurHandler<P = object> = (
  layout: FocusableComponentLayout,
  props: P,
  details: FocusDetails
) => void;

export type NavigateHandler = (
  currentFocusKey: string,
  direction: string,
  details: FocusDetails,
  svc: SpatialNavigationService
) => void;

export interface UseFocusableConfig<P = object> {
  focusable?: boolean;
  saveLastFocusedChild?: boolean;
  trackChildren?: boolean;
  autoRestoreFocus?: boolean;
  isFocusBoundary?: boolean;
  pointerSupport?: boolean;
  focusKey?: string;
  preferredChildFocusKey?: string;
  onEnterPress?: EnterPressHandler<P>;
  onEnterRelease?: EnterReleaseHandler<P>;
  onArrowPress?: ArrowPressHandler<P>;
  onFocus?: FocusHandler<P>;
  onBlur?: BlurHandler<P>;
  onNavigate?: NavigateHandler;
  extraProps?: P;
}

export interface UseFocusableResult {
  ref: RefObject<any>; // <any> since we don't know which HTML tag is passed here
  focusSelf: (focusDetails?: FocusDetails) => void;
  focused: boolean;
  hasFocusedChild: boolean;
  focusKey: string;
  setFocus: (focusKey: string, focusDetails?: FocusDetails) => void;
  pause: () => void;
  resume: () => void;
  updateAllLayouts: () => void;
  getCurrentFocusKey: () => string;
}

const useFocusableHook = <P>({
  focusable = true,
  saveLastFocusedChild = true,
  trackChildren = false,
  autoRestoreFocus = true,
  isFocusBoundary = false,
  pointerSupport = true,
  focusKey: propFocusKey,
  preferredChildFocusKey,
  onEnterPress = noop,
  onEnterRelease = noop,
  onArrowPress = () => true,
  onNavigate = smartNavigate,
  onFocus = noop,
  onBlur = noop,
  extraProps
}: UseFocusableConfig<P> = {}): UseFocusableResult => {
  const onEnterPressHandler = useCallback(
    (details: KeyPressDetails) => {
      onEnterPress(extraProps, details);
    },
    [onEnterPress, extraProps]
  );

  const onEnterReleaseHandler = useCallback(() => {
    onEnterRelease(extraProps);
  }, [onEnterRelease, extraProps]);

  const onArrowPressHandler = useCallback(
    (direction: string, details: KeyPressDetails) =>
      onArrowPress(direction, extraProps, details),
    [extraProps, onArrowPress]
  );

  const onFocusHandler = useCallback(
    (layout: FocusableComponentLayout, details: FocusDetails) => {
      onFocus(layout, extraProps, details);
    },
    [extraProps, onFocus]
  );

  const onBlurHandler = useCallback(
    (layout: FocusableComponentLayout, details: FocusDetails) => {
      onBlur(layout, extraProps, details);
    },
    [extraProps, onBlur]
  );

  const onNavigateHandler = useCallback(onNavigate, [onNavigate]);

  const ref = useRef(null);

  const [focused, setFocused] = useState(false);
  const [hasFocusedChild, setHasFocusedChild] = useState(false);

  const parentFocusKey = useFocusContext();

  /**
   * Either using the propFocusKey passed in, or generating a random one
   */
  const focusKey = useMemo(
    () => propFocusKey || uniqueId('sn:focusable-item-'),
    [propFocusKey]
  );

  const focusSelf = useCallback(
    (focusDetails: FocusDetails = {}) => {
      SpatialNavigation.focus(focusKey, focusDetails);
    },
    [focusKey]
  );

  useEffectOnce(() => {
    const node = ref.current;

    SpatialNavigation.addFocusable({
      focusKey,
      node,
      parentFocusKey,
      preferredChildFocusKey,
      onEnterPress: onEnterPressHandler,
      onEnterRelease: onEnterReleaseHandler,
      onArrowPress: onArrowPressHandler,
      onFocus: onFocusHandler,
      onBlur: onBlurHandler,
      onUpdateFocus: (isFocused = false) => setFocused(isFocused),
      onUpdateHasFocusedChild: (isFocused = false) =>
        setHasFocusedChild(isFocused),
      onNavigate: () => {},
      saveLastFocusedChild,
      trackChildren,
      isFocusBoundary,
      pointerSupport,
      autoRestoreFocus,
      focusable
    });

    return () => {
      SpatialNavigation.removeFocusable({
        focusKey
      });
    };
  });

  useEffect(() => {
    const node = ref.current;

    SpatialNavigation.updateFocusable(focusKey, {
      node,
      preferredChildFocusKey,
      focusable,
      isFocusBoundary,
      pointerSupport,
      onEnterPress: onEnterPressHandler,
      onEnterRelease: onEnterReleaseHandler,
      onArrowPress: onArrowPressHandler,
      onFocus: onFocusHandler,
      onBlur: onBlurHandler,
      onNavigate: onNavigateHandler
    });
  }, [
    focusKey,
    preferredChildFocusKey,
    focusable,
    isFocusBoundary,
    pointerSupport,
    onEnterPressHandler,
    onEnterReleaseHandler,
    onArrowPressHandler,
    onFocusHandler,
    onBlurHandler,
    onNavigateHandler
  ]);

  return {
    ref,
    focusSelf,
    focused,
    hasFocusedChild,
    focusKey, // returns either the same focusKey as passed in, or generated one
    setFocus: SpatialNavigation.focus,
    pause: SpatialNavigation.pause,
    resume: SpatialNavigation.resume,
    updateAllLayouts: SpatialNavigation.updateAllLayouts,
    getCurrentFocusKey: SpatialNavigation.getCurrentFocusKey
  };
};

export const useFocusable = useFocusableHook;

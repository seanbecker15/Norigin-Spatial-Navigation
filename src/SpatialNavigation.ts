import { DebouncedFunc } from 'lodash';
import filter from 'lodash/filter';
import first from 'lodash/first';
import sortBy from 'lodash/sortBy';
import findKey from 'lodash/findKey';
import forEach from 'lodash/forEach';
import forOwn from 'lodash/forOwn';
import throttle from 'lodash/throttle';
import difference from 'lodash/difference';
import measureLayout from './measureLayout';
import VisualDebugger from './VisualDebugger';

const DIRECTION_LEFT = 'left';
const DIRECTION_RIGHT = 'right';
const DIRECTION_UP = 'up';
const DIRECTION_DOWN = 'down';
const KEY_ENTER = 'enter';

const DEFAULT_KEY_MAP = {
  [DIRECTION_LEFT]: [37],
  [DIRECTION_UP]: [38],
  [DIRECTION_RIGHT]: [39],
  [DIRECTION_DOWN]: [40],
  [KEY_ENTER]: [13]
};

export const ROOT_FOCUS_KEY = 'SN:ROOT';

const ADJACENT_SLICE_THRESHOLD = 0.2;

/**
 * Adjacent slice is 5 times more important than diagonal
 */
const ADJACENT_SLICE_WEIGHT = 5;
const DIAGONAL_SLICE_WEIGHT = 1;

/**
 * Main coordinate distance is 5 times more important
 */
const MAIN_COORDINATE_WEIGHT = 5;

const DEBUG_FN_COLORS = ['#0FF', '#FF0', '#F0F'];

const THROTTLE_OPTIONS = {
  leading: true,
  trailing: false
};

export interface FocusableComponentLayout {
  left: number;
  top: number;
  width: number;
  height: number;
  x: number;
  y: number;
  node: HTMLElement;
}

interface FocusableComponent {
  focusKey: string;
  node: HTMLElement;
  parentFocusKey: string;
  onEnterPress: (details?: KeyPressDetails) => void;
  onEnterRelease: () => void;
  onArrowPress: (direction: string, details: KeyPressDetails) => boolean;
  onFocus: (layout: FocusableComponentLayout, details: FocusDetails) => void;
  onBlur: (layout: FocusableComponentLayout, details: FocusDetails) => void;
  onUpdateFocus: (focused: boolean) => void;
  onUpdateHasFocusedChild: (hasFocusedChild: boolean) => void;
  saveLastFocusedChild: boolean;
  trackChildren: boolean;
  preferredChildFocusKey?: string;
  focusable: boolean;
  isFocusBoundary: boolean;
  autoRestoreFocus: boolean;
  lastFocusedChildKey?: string;
  layout?: FocusableComponentLayout;
  layoutUpdated?: boolean;
}

interface FocusableComponentUpdatePayload {
  node: HTMLElement;
  preferredChildFocusKey?: string;
  focusable: boolean;
  isFocusBoundary: boolean;
  onEnterPress: (details?: KeyPressDetails) => void;
  onEnterRelease: () => void;
  onArrowPress: (direction: string, details: KeyPressDetails) => boolean;
  onFocus: (layout: FocusableComponentLayout, details: FocusDetails) => void;
  onBlur: (layout: FocusableComponentLayout, details: FocusDetails) => void;
}

interface FocusableComponentRemovePayload {
  focusKey: string;
}

interface CornerCoordinates {
  x: number;
  y: number;
}

interface Corners {
  a: CornerCoordinates;
  b: CornerCoordinates;
}

export type PressedKeys = { [index: string]: number };

/**
 * Extra details about pressed keys passed on the key events
 */
export interface KeyPressDetails {
  pressedKeys: PressedKeys;
}

/**
 * Extra details passed from outside to be bounced back on other callbacks
 */
export interface FocusDetails {
  event?: Event;
  nativeEvent?: Event;
  [key: string]: any;
}

export type BackwardsCompatibleKeyMap = { [index: string]: number | number[] };

export type KeyMap = { [index: string]: number[] };

const getChildClosestToOrigin = (children: FocusableComponent[]) => {
  const childrenClosestToOrigin = sortBy(
    children,
    ({ layout }) => Math.abs(layout.left) + Math.abs(layout.top)
  );

  return first(childrenClosestToOrigin);
};

/**
 * Takes either a BackwardsCompatibleKeyMap and transforms it into a the new KeyMap format
 * to ensure backwards compatibility.
 */
const normalizeKeyMap = (keyMap: BackwardsCompatibleKeyMap) => {
  const newKeyMap: KeyMap = {};

  Object.entries(keyMap).forEach(([key, value]) => {
    if (typeof value === 'number') {
      newKeyMap[key] = [value];
    } else if (Array.isArray(value)) {
      newKeyMap[key] = value;
    }
  });

  return newKeyMap;
};

class SpatialNavigationService {
  private focusableComponents: { [index: string]: FocusableComponent };

  private visualDebugger: VisualDebugger;

  /**
   * Focus key of the currently focused element
   */
  private focusKey: string;

  /**
   * This collection contains focus keys of the elements that are having a child focused
   * Might be handy for styling of certain parent components if their child is focused.
   */
  private parentsHavingFocusedChild: string[];

  private enabled: boolean;

  /**
   * Throttling delay for key presses in milliseconds
   */
  private throttle: number;

  /**
   * Enables/disables throttling feature
   */
  private throttleKeypresses: boolean;

  /**
   * Storing pressed keys counter by the eventType
   */
  private pressedKeys: PressedKeys;

  /**
   * Flag used to block key events from this service
   */
  private paused: boolean;

  private keyDownEventListener: (event: KeyboardEvent) => void;

  private keyDownEventListenerThrottled: DebouncedFunc<
    (event: KeyboardEvent) => void
  >;

  private keyUpEventListener: (event: KeyboardEvent) => void;

  private keyMap: KeyMap;

  private debug: boolean;

  private logIndex: number;

  /**
   * Returns two corners (a and b) coordinates that are used as a reference points
   * Where "a" is always leftmost and topmost corner, and "b" is rightmost bottommost corner
   */
  static getRefCorners(
    direction: string,
    isSibling: boolean,
    layout: FocusableComponentLayout
  ) {
    const itemX = layout.left;
    const itemY = layout.top;
    const itemWidth = layout.width;
    const itemHeight = layout.height;

    const result = {
      a: {
        x: 0,
        y: 0
      },
      b: {
        x: 0,
        y: 0
      }
    };

    switch (direction) {
      case DIRECTION_UP: {
        const y = isSibling ? itemY + itemHeight : itemY;

        result.a = {
          x: itemX,
          y
        };

        result.b = {
          x: itemX + itemWidth,
          y
        };

        break;
      }

      case DIRECTION_DOWN: {
        const y = isSibling ? itemY : itemY + itemHeight;

        result.a = {
          x: itemX,
          y
        };

        result.b = {
          x: itemX + itemWidth,
          y
        };

        break;
      }

      case DIRECTION_LEFT: {
        const x = isSibling ? itemX + itemWidth : itemX;

        result.a = {
          x,
          y: itemY
        };

        result.b = {
          x,
          y: itemY + itemHeight
        };

        break;
      }

      case DIRECTION_RIGHT: {
        const x = isSibling ? itemX : itemX + itemWidth;

        result.a = {
          x,
          y: itemY
        };

        result.b = {
          x,
          y: itemY + itemHeight
        };

        break;
      }

      default:
        break;
    }

    return result;
  }

  /**
   * Calculates if the sibling node is intersecting enough with the ref node by the secondary coordinate
   */
  static isAdjacentSlice(
    refCorners: Corners,
    siblingCorners: Corners,
    isVerticalDirection: boolean
  ) {
    const { a: refA, b: refB } = refCorners;
    const { a: siblingA, b: siblingB } = siblingCorners;
    const coordinate = isVerticalDirection ? 'x' : 'y';

    const refCoordinateA = refA[coordinate];
    const refCoordinateB = refB[coordinate];
    const siblingCoordinateA = siblingA[coordinate];
    const siblingCoordinateB = siblingB[coordinate];

    const thresholdDistance =
      (refCoordinateB - refCoordinateA) * ADJACENT_SLICE_THRESHOLD;

    const intersectionLength = Math.max(
      0,
      Math.min(refCoordinateB, siblingCoordinateB) -
        Math.max(refCoordinateA, siblingCoordinateA)
    );

    return intersectionLength >= thresholdDistance;
  }

  static getPrimaryAxisDistance(
    refCorners: Corners,
    siblingCorners: Corners,
    isVerticalDirection: boolean
  ) {
    const { a: refA } = refCorners;
    const { a: siblingA } = siblingCorners;
    const coordinate = isVerticalDirection ? 'y' : 'x';

    return Math.abs(siblingA[coordinate] - refA[coordinate]);
  }

  static getSecondaryAxisDistance(
    refCorners: Corners,
    siblingCorners: Corners,
    isVerticalDirection: boolean
  ) {
    const { a: refA, b: refB } = refCorners;
    const { a: siblingA, b: siblingB } = siblingCorners;
    const coordinate = isVerticalDirection ? 'x' : 'y';

    const refCoordinateA = refA[coordinate];
    const refCoordinateB = refB[coordinate];
    const siblingCoordinateA = siblingA[coordinate];
    const siblingCoordinateB = siblingB[coordinate];

    const distancesToCompare = [];

    distancesToCompare.push(Math.abs(siblingCoordinateA - refCoordinateA));
    distancesToCompare.push(Math.abs(siblingCoordinateA - refCoordinateB));
    distancesToCompare.push(Math.abs(siblingCoordinateB - refCoordinateA));
    distancesToCompare.push(Math.abs(siblingCoordinateB - refCoordinateB));

    return Math.min(...distancesToCompare);
  }

  /**
   * Inspired by: https://developer.mozilla.org/en-US/docs/Mozilla/Firefox_OS_for_TV/TV_remote_control_navigation#Algorithm_design
   * Ref Corners are the 2 corners of the current component in the direction of navigation
   * They used as a base to measure adjacent slices
   */
  sortSiblingsByPriority(
    siblings: FocusableComponent[],
    currentLayout: FocusableComponentLayout,
    direction: string,
    focusKey: string
  ) {
    const isVerticalDirection =
      direction === DIRECTION_DOWN || direction === DIRECTION_UP;

    const refCorners = SpatialNavigationService.getRefCorners(
      direction,
      false,
      currentLayout
    );

    return sortBy(siblings, (sibling) => {
      const siblingCorners = SpatialNavigationService.getRefCorners(
        direction,
        true,
        sibling.layout
      );

      const isAdjacentSlice = SpatialNavigationService.isAdjacentSlice(
        refCorners,
        siblingCorners,
        isVerticalDirection
      );

      const primaryAxisFunction = isAdjacentSlice
        ? SpatialNavigationService.getPrimaryAxisDistance
        : SpatialNavigationService.getSecondaryAxisDistance;

      const secondaryAxisFunction = isAdjacentSlice
        ? SpatialNavigationService.getSecondaryAxisDistance
        : SpatialNavigationService.getPrimaryAxisDistance;

      const primaryAxisDistance = primaryAxisFunction(
        refCorners,
        siblingCorners,
        isVerticalDirection
      );
      const secondaryAxisDistance = secondaryAxisFunction(
        refCorners,
        siblingCorners,
        isVerticalDirection
      );

      /**
       * The higher this value is, the less prioritised the candidate is
       */
      const totalDistancePoints =
        primaryAxisDistance * MAIN_COORDINATE_WEIGHT + secondaryAxisDistance;

      /**
       * + 1 here is in case of distance is zero, but we still want to apply Adjacent priority weight
       */
      const priority =
        (totalDistancePoints + 1) /
        (isAdjacentSlice ? ADJACENT_SLICE_WEIGHT : DIAGONAL_SLICE_WEIGHT);

      this.log(
        'smartNavigate',
        `distance (primary, secondary, total weighted) for ${sibling.focusKey} relative to ${focusKey} is`,
        primaryAxisDistance,
        secondaryAxisDistance,
        totalDistancePoints
      );

      this.log(
        'smartNavigate',
        `priority for ${sibling.focusKey} relative to ${focusKey} is`,
        priority
      );

      if (this.visualDebugger) {
        this.visualDebugger.drawPoint(
          siblingCorners.a.x,
          siblingCorners.a.y,
          'yellow',
          6
        );
        this.visualDebugger.drawPoint(
          siblingCorners.b.x,
          siblingCorners.b.y,
          'yellow',
          6
        );
      }

      return priority;
    });
  }

  constructor() {
    /**
     * Storage for all focusable components
     */
    this.focusableComponents = {};

    /**
     * Storing current focused key
     */
    this.focusKey = null;

    /**
     * This collection contains focus keys of the elements that are having a child focused
     * Might be handy for styling of certain parent components if their child is focused.
     */
    this.parentsHavingFocusedChild = [];

    this.enabled = false;
    this.throttle = 0;
    this.throttleKeypresses = false;

    this.pressedKeys = {};

    /**
     * Flag used to block key events from this service
     * @type {boolean}
     */
    this.paused = false;

    this.keyDownEventListener = null;
    this.keyUpEventListener = null;
    this.keyMap = DEFAULT_KEY_MAP;

    this.onKeyEvent = this.onKeyEvent.bind(this);
    this.pause = this.pause.bind(this);
    this.resume = this.resume.bind(this);
    this.setFocus = this.setFocus.bind(this);
    this.updateAllLayouts = this.updateAllLayouts.bind(this);
    this.navigateByDirection = this.navigateByDirection.bind(this);
    this.init = this.init.bind(this);
    this.setThrottle = this.setThrottle.bind(this);
    this.destroy = this.destroy.bind(this);
    this.setKeyMap = this.setKeyMap.bind(this);
    this.getCurrentFocusKey = this.getCurrentFocusKey.bind(this);

    this.debug = false;
    this.visualDebugger = null;

    this.logIndex = 0;
  }

  init({
    debug = false,
    visualDebug = false,
    throttle: throttleParam = 0,
    throttleKeypresses = false
  } = {}) {
    if (!this.enabled) {
      this.enabled = true;
      this.throttleKeypresses = throttleKeypresses;

      this.debug = debug;

      if (Number.isInteger(throttleParam) && throttleParam > 0) {
        this.throttle = throttleParam;
      }
      this.bindEventHandlers();
      if (visualDebug) {
        this.visualDebugger = new VisualDebugger();
        this.startDrawLayouts();
      }
    }
  }

  setThrottle({
    throttle: throttleParam = 0,
    throttleKeypresses = false
  } = {}) {
    this.throttleKeypresses = throttleKeypresses;

    this.unbindEventHandlers();
    if (Number.isInteger(throttleParam)) {
      this.throttle = throttleParam;
    }
    this.bindEventHandlers();
  }

  startDrawLayouts() {
    const draw = () => {
      requestAnimationFrame(() => {
        this.visualDebugger.clearLayouts();
        forOwn(this.focusableComponents, (component, focusKey) => {
          this.visualDebugger.drawLayout(
            component.layout,
            focusKey,
            component.parentFocusKey
          );
        });
        draw();
      });
    };

    draw();
  }

  drawComponentCorners(focusKey: string, color: string) {
    const component = this.focusableComponents[focusKey];
    const { layout } = component;
    if (layout) {
      const { left, top, width, height } = layout;
      const leftEdge = left;
      const topEdge = top;
      const rightEdge = leftEdge + width;
      const bottomEdge = topEdge + height;

      const corners = [
        { x: leftEdge, y: topEdge },
        { x: rightEdge, y: topEdge },
        { x: leftEdge, y: bottomEdge },
        { x: rightEdge, y: bottomEdge }
      ];

      corners.forEach((corner) => {
        this.visualDebugger.drawPoint(corner.x, corner.y, color, 6);
      });
    }
  }

  destroy() {
    if (this.enabled) {
      this.enabled = false;
      this.throttle = 0;
      this.throttleKeypresses = false;
      this.focusKey = null;
      this.parentsHavingFocusedChild = [];
      this.focusableComponents = {};
      this.paused = false;
      this.keyMap = DEFAULT_KEY_MAP;

      this.unbindEventHandlers();
    }
  }

  getEventType(keyCode: number) {
    return findKey(this.getKeyMap(), (codeList) => codeList.includes(keyCode));
  }

  bindEventHandlers() {
    // We check both because the React Native remote debugger implements window, but not window.addEventListener.
    if (typeof window !== 'undefined' && window.addEventListener) {
      this.keyDownEventListener = (event: KeyboardEvent) => {
        if (this.paused === true) {
          return;
        }

        if (this.debug) {
          this.logIndex += 1;
        }

        const eventType = this.getEventType(event.keyCode);

        if (!eventType) {
          return;
        }

        this.pressedKeys[eventType] = this.pressedKeys[eventType]
          ? this.pressedKeys[eventType] + 1
          : 1;

        event.preventDefault();
        event.stopPropagation();

        const keysDetails = {
          pressedKeys: this.pressedKeys
        };

        if (eventType === KEY_ENTER && this.focusKey) {
          this.onEnterPress(keysDetails);

          return;
        }

        const preventDefaultNavigation =
          this.onArrowPress(eventType, keysDetails) === false;

        if (preventDefaultNavigation) {
          this.log('keyDownEventListener', 'default navigation prevented');

          if (this.visualDebugger) {
            this.visualDebugger.clear();
          }
        } else {
          this.onKeyEvent(event);
        }
      };

      // Apply throttle only if the option we got is > 0 to avoid limiting the listener to every animation frame
      if (this.throttle) {
        this.keyDownEventListenerThrottled = throttle(
          this.keyDownEventListener.bind(this),
          this.throttle,
          THROTTLE_OPTIONS
        );
      }

      // When throttling then make sure to only throttle key down and cancel any queued functions in case of key up
      this.keyUpEventListener = (event: KeyboardEvent) => {
        const eventType = this.getEventType(event.keyCode);

        delete this.pressedKeys[eventType];

        if (this.throttle && !this.throttleKeypresses) {
          this.keyDownEventListenerThrottled.cancel();
        }

        if (eventType === KEY_ENTER && this.focusKey) {
          this.onEnterRelease();
        }
      };

      window.addEventListener('keyup', this.keyUpEventListener);
      window.addEventListener(
        'keydown',
        this.throttle
          ? this.keyDownEventListenerThrottled
          : this.keyDownEventListener
      );
    }
  }

  unbindEventHandlers() {
    // We check both because the React Native remote debugger implements window, but not window.removeEventListener.
    if (typeof window !== 'undefined' && window.removeEventListener) {
      window.removeEventListener('keyup', this.keyUpEventListener);
      this.keyUpEventListener = null;

      const listener = this.throttle
        ? this.keyDownEventListenerThrottled
        : this.keyDownEventListener;

      window.removeEventListener('keydown', listener);
      this.keyDownEventListener = null;
    }
  }

  onEnterPress(keysDetails: KeyPressDetails) {
    const component = this.focusableComponents[this.focusKey];

    /* Guard against last-focused component being unmounted at time of onEnterPress (e.g due to UI fading out) */
    if (!component) {
      this.log('onEnterPress', 'noComponent');

      return;
    }

    /* Suppress onEnterPress if the last-focused item happens to lose its 'focused' status. */
    if (!component.focusable) {
      this.log('onEnterPress', 'componentNotFocusable');

      return;
    }

    if (component.onEnterPress) {
      component.onEnterPress(keysDetails);
    }
  }

  onEnterRelease() {
    const component = this.focusableComponents[this.focusKey];

    /* Guard against last-focused component being unmounted at time of onEnterRelease (e.g due to UI fading out) */
    if (!component) {
      this.log('onEnterRelease', 'noComponent');

      return;
    }

    /* Suppress onEnterRelease if the last-focused item happens to lose its 'focused' status. */
    if (!component.focusable) {
      this.log('onEnterRelease', 'componentNotFocusable');

      return;
    }

    if (this.visualDebugger) {
      this.drawComponentCorners(this.focusKey, 'green');

      this.updateLayout(this.focusKey);

      this.drawComponentCorners(this.focusKey, 'red');
    }

    this.log('onEnterRelease', 'layout', component);

    if (component.onEnterRelease) {
      component.onEnterRelease();
    }
  }

  onArrowPress(direction: string, keysDetails: KeyPressDetails) {
    const component = this.focusableComponents[this.focusKey];

    /* Guard against last-focused component being unmounted at time of onArrowPress (e.g due to UI fading out) */
    if (!component) {
      this.log('onArrowPress', 'noComponent');

      return undefined;
    }

    /* It's okay to navigate AWAY from an item that has lost its 'focused' status, so we don't inspect
     * component.focusable. */

    return (
      component &&
      component.onArrowPress &&
      component.onArrowPress(direction, keysDetails)
    );
  }

  /**
   * Move focus by direction, if you can't use buttons or focusing by key.
   *
   * @example
   * navigateByDirection('right') // The focus is moved to right
   */
  navigateByDirection(direction: string, focusDetails: FocusDetails) {
    if (this.paused === true) {
      return;
    }

    const validDirections = [
      DIRECTION_DOWN,
      DIRECTION_UP,
      DIRECTION_LEFT,
      DIRECTION_RIGHT
    ];

    if (validDirections.includes(direction)) {
      this.log('navigateByDirection', 'direction', direction);
      this.smartNavigate(direction, this.focusKey, focusDetails);
    } else {
      this.log(
        'navigateByDirection',
        `Invalid direction. You passed: \`${direction}\`, but you can use only these: `,
        validDirections
      );
    }
  }

  onKeyEvent(event: KeyboardEvent) {
    if (this.visualDebugger) {
      this.visualDebugger.clear();
    }

    const direction = findKey(this.getKeyMap(), (codeList) =>
      codeList.includes(event.keyCode)
    );

    this.smartNavigate(direction, this.focusKey, { event });
    this.updateAllLayouts();
  }

  /**
   * This function navigates between siblings OR goes up by the Tree
   * Based on the Direction
   */
  smartNavigate(
    direction: string,
    focusKey: string,
    focusDetails: FocusDetails
  ) {
    this.log('smartNavigate', 'direction', direction);
    this.log('smartNavigate', 'focusKey', focusKey);

    // Optimization:
    // The only case we have an override key is when we recursively call this function.
    // In this case we don't need to refresh the location of all of our nodes because
    // we already did so in the previous call stack.
    // if (!overrideFocusKey) {
    //   forOwn(this.focusableComponents, (component) => {
    //     // eslint-disable-next-line no-param-reassign
    //     component.layoutUpdated = false;
    //   });
    // }

    const fromComponent =
      this.focusableComponents[focusKey];

    this.log(
      'smartNavigate',
      'currentComponent',
      fromComponent?.focusKey,
      fromComponent?.node
    );

    if (!fromComponent || fromComponent.isFocusBoundary) {
      return;
    }

    // Optimization
    // this.updateLayout(currentComponent.focusKey);

    // @todo allow this logic to be overwritten for each "context" and export logic below as default.
    // This is definitely testable without a browser.
    const isNodeFocusable = (
      dir: string,
      from: FocusableComponent,
      to: FocusableComponent
    ) => {
      if (!to.focusable) {
        return false;
      }
      if (from.focusKey === to.focusKey) {
        return false;
      }
      if (from.parentFocusKey !== to.parentFocusKey) {
        return false;
      }

      // Check that the next component is in the direction of the current component.
      // For example, if direction is "left" we check that the next component is to the left of current.
      let isValidDirectionally;

      // This is a simple algo that only works in a grid
      switch (dir) {
        case DIRECTION_LEFT: {
          // Check that the right edge of the next is to the left of the left edge of the current
          const rightEdgeNext = to.layout.left + to.layout.width;
          const leftEdgeCurrent = from.layout.left;
          if (leftEdgeCurrent >= rightEdgeNext) {
            isValidDirectionally = true;
          }
          break;
        }
        case DIRECTION_RIGHT: {
          const leftEdgeNext = to.layout.left;
          const rightEdgeCurrent = from.layout.left + from.layout.width;
          this.log('isNodeFocusable', 'right', { leftEdgeNext, rightEdgeCurrent })
          if (rightEdgeCurrent <= leftEdgeNext) {
            isValidDirectionally = true;
          }
          break;
        }
        case DIRECTION_DOWN: {
          const topEdgeNext = to.layout.top;
          const bottomEdgeCurrent = from.layout.top + from.layout.height;
          if (topEdgeNext >= bottomEdgeCurrent) {
            isValidDirectionally = true;
          }
          break;
        }
        case DIRECTION_UP: {
          const bottomEdgeNext = to.layout.top + to.layout.height;
          const topEdgeCurrent = from.layout.top;
          if (topEdgeCurrent >= bottomEdgeNext) {
            isValidDirectionally = true;
          }
          break;
        }
        default:
          isValidDirectionally = false;
      }

      return isValidDirectionally;
    };

    const siblings = filter(this.focusableComponents, (nextComponent) =>
      isNodeFocusable(direction, fromComponent, nextComponent)
    );

    if (this.debug) {
      this.log(
        'smartNavigate',
        'siblings',
        `${siblings.length} elements:`,
        siblings.map((sibling) => sibling.focusKey).join(', '),
        siblings.map((sibling) => sibling.node)
      );
    }

    if (this.visualDebugger) {
      const refCorners = SpatialNavigationService.getRefCorners(
        direction,
        false,
        fromComponent.layout
      );

      this.visualDebugger.drawPoint(refCorners.a.x, refCorners.a.y);
      this.visualDebugger.drawPoint(refCorners.b.x, refCorners.b.y);
    }

    const sortedSiblingsInCurrentDirection = this.sortSiblingsByPriority(
      siblings,
      fromComponent.layout,
      direction,
      fromComponent.focusKey
    );

    const nextComponent = first(sortedSiblingsInCurrentDirection);

    this.log(
      'smartNavigate',
      'nextComponent',
      nextComponent?.focusKey,
      nextComponent?.node
    );

    if (nextComponent) {
      this.setFocus(nextComponent.focusKey, focusDetails);
      return;
    }

    const parentComponent =
      this.focusableComponents[fromComponent.parentFocusKey];

    this.saveLastFocusedChildKey(parentComponent, fromComponent.focusKey);

    this.smartNavigate(
      direction,
      fromComponent.parentFocusKey,
      focusDetails
    );
  }

  saveLastFocusedChildKey(component: FocusableComponent, focusKey: string) {
    if (component) {
      this.log(
        'saveLastFocusedChildKey',
        `${component.focusKey} lastFocusedChildKey set`,
        focusKey
      );

      // eslint-disable-next-line no-param-reassign
      component.lastFocusedChildKey = focusKey;
    }
  }

  log(functionName: string, debugString: string, ...rest: any[]) {
    if (this.debug) {
      // eslint-disable-next-line no-console
      console.log(
        `%c${functionName}%c${debugString}`,
        `background: ${
          DEBUG_FN_COLORS[this.logIndex % DEBUG_FN_COLORS.length]
        }; color: black; padding: 1px 5px;`,
        'background: #333; color: #BADA55; padding: 1px 5px;',
        ...rest
      );
    }
  }

  /**
   * Returns the current focus key
   */
  getCurrentFocusKey(): string {
    return this.focusKey;
  }

  /**
   * This function tries to determine the next component to Focus
   * It's either the target node OR the one down by the Tree if node has children components
   * Based on "targetFocusKey" which means the "intended component to focus"
   */
  getNextFocusKey(targetFocusKey: string): string {
    const targetComponent = this.focusableComponents[targetFocusKey];

    /**
     * Security check, if component doesn't exist, stay on the same focusKey
     */
    if (!targetComponent) {
      return targetFocusKey;
    }

    const children = filter(
      this.focusableComponents,
      (component) =>
        component.parentFocusKey === targetFocusKey && component.focusable
    );

    if (children.length > 0) {
      const { lastFocusedChildKey, preferredChildFocusKey } = targetComponent;

      this.log(
        'getNextFocusKey',
        'lastFocusedChildKey is',
        lastFocusedChildKey
      );
      this.log(
        'getNextFocusKey',
        'preferredChildFocusKey is',
        preferredChildFocusKey
      );

      /**
       * First of all trying to focus last focused child
       */
      if (
        lastFocusedChildKey &&
        targetComponent.saveLastFocusedChild &&
        this.isParticipatingFocusableComponent(lastFocusedChildKey)
      ) {
        this.log(
          'getNextFocusKey',
          'lastFocusedChildKey will be focused',
          lastFocusedChildKey
        );

        return this.getNextFocusKey(lastFocusedChildKey);
      }

      /**
       * If there is no lastFocusedChild, trying to focus the preferred focused key
       */
      if (
        preferredChildFocusKey &&
        this.isParticipatingFocusableComponent(preferredChildFocusKey)
      ) {
        this.log(
          'getNextFocusKey',
          'preferredChildFocusKey will be focused',
          preferredChildFocusKey
        );

        return this.getNextFocusKey(preferredChildFocusKey);
      }

      /**
       * Otherwise, trying to focus something by coordinates
       */
      children.forEach((component) => this.updateLayout(component.focusKey));
      const { focusKey: childKey } = getChildClosestToOrigin(children);

      this.log('getNextFocusKey', 'childKey will be focused', childKey);

      return this.getNextFocusKey(childKey);
    }

    /**
     * If no children, just return targetFocusKey back
     */
    this.log('getNextFocusKey', 'targetFocusKey', targetFocusKey);

    return targetFocusKey;
  }

  addFocusable({
    focusKey,
    node,
    parentFocusKey,
    onEnterPress,
    onEnterRelease,
    onArrowPress,
    onFocus,
    onBlur,
    saveLastFocusedChild,
    trackChildren,
    onUpdateFocus,
    onUpdateHasFocusedChild,
    preferredChildFocusKey,
    autoRestoreFocus,
    focusable,
    isFocusBoundary
  }: FocusableComponent) {
    this.focusableComponents[focusKey] = {
      focusKey,
      node,
      parentFocusKey,
      onEnterPress,
      onEnterRelease,
      onArrowPress,
      onFocus,
      onBlur,
      onUpdateFocus,
      onUpdateHasFocusedChild,
      saveLastFocusedChild,
      trackChildren,
      preferredChildFocusKey,
      focusable,
      isFocusBoundary,
      autoRestoreFocus,
      lastFocusedChildKey: null,
      layout: {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        left: 0,
        top: 0,

        /**
         * Node ref is also duplicated in layout to be reported in onFocus callback
         */
        node
      },
      layoutUpdated: false
    };

    this.updateLayout(focusKey);

    /**
     * If for some reason this component was already focused before it was added, call the update
     */
    if (focusKey === this.focusKey) {
      this.setFocus(focusKey);
    }
  }

  removeFocusable({ focusKey }: FocusableComponentRemovePayload) {
    const componentToRemove = this.focusableComponents[focusKey];

    if (componentToRemove) {
      const { parentFocusKey } = componentToRemove;

      delete this.focusableComponents[focusKey];

      const parentComponent = this.focusableComponents[parentFocusKey];
      const isFocused = focusKey === this.focusKey;

      /**
       * If the component was stored as lastFocusedChild, clear lastFocusedChildKey from parent
       */
      if (parentComponent && parentComponent.lastFocusedChildKey === focusKey) {
        parentComponent.lastFocusedChildKey = null;
      }

      forEach(this.focusableComponents, (component) => {
        if (component.parentFocusKey === focusKey && component.focusable) {
          // eslint-disable-next-line no-param-reassign
          component.parentFocusKey = parentFocusKey;
        }
      });

      /**
       * If the component was also focused at this time, focus another one
       */
      if (isFocused && parentComponent && parentComponent.autoRestoreFocus) {
        this.setFocus(parentFocusKey);
      }
    }
  }

  getNodeLayoutByFocusKey(focusKey: string) {
    const component = this.focusableComponents[focusKey];

    if (component) {
      this.updateLayout(component.focusKey);

      return component.layout;
    }

    return null;
  }

  setCurrentFocusedKey(newFocusKey: string, focusDetails: FocusDetails) {
    if (
      this.isFocusableComponent(this.focusKey) &&
      newFocusKey !== this.focusKey
    ) {
      const oldComponent = this.focusableComponents[this.focusKey];
      const parentComponent =
        this.focusableComponents[oldComponent.parentFocusKey];

      this.saveLastFocusedChildKey(parentComponent, this.focusKey);

      oldComponent.onUpdateFocus(false);
      oldComponent.onBlur(
        this.getNodeLayoutByFocusKey(this.focusKey),
        focusDetails
      );
    }

    this.focusKey = newFocusKey;

    if (this.isFocusableComponent(this.focusKey)) {
      const newComponent = this.focusableComponents[this.focusKey];

      newComponent.onUpdateFocus(true);
      newComponent.onFocus(
        this.getNodeLayoutByFocusKey(this.focusKey),
        focusDetails
      );
    }
  }

  updateParentsHasFocusedChild(focusKey: string, focusDetails: FocusDetails) {
    const parents = [];

    let currentComponent = this.focusableComponents[focusKey];

    /**
     * Recursively iterate the tree up and find all the parents' focus keys
     */
    while (currentComponent) {
      const { parentFocusKey } = currentComponent;

      const parentComponent = this.focusableComponents[parentFocusKey];

      if (parentComponent) {
        const { focusKey: currentParentFocusKey } = parentComponent;

        parents.push(currentParentFocusKey);
      }

      currentComponent = parentComponent;
    }

    const parentsToRemoveFlag = difference(
      this.parentsHavingFocusedChild,
      parents
    );
    const parentsToAddFlag = difference(
      parents,
      this.parentsHavingFocusedChild
    );

    forEach(parentsToRemoveFlag, (parentFocusKey) => {
      const parentComponent = this.focusableComponents[parentFocusKey];

      if (parentComponent && parentComponent.trackChildren) {
        parentComponent.onUpdateHasFocusedChild(false);
      }
      this.onIntermediateNodeBecameBlurred(parentFocusKey, focusDetails);
    });

    forEach(parentsToAddFlag, (parentFocusKey) => {
      const parentComponent = this.focusableComponents[parentFocusKey];

      if (parentComponent && parentComponent.trackChildren) {
        parentComponent.onUpdateHasFocusedChild(true);
      }
      this.onIntermediateNodeBecameFocused(parentFocusKey, focusDetails);
    });

    this.parentsHavingFocusedChild = parents;
  }

  updateParentsLastFocusedChild(focusKey: string) {
    let currentComponent = this.focusableComponents[focusKey];

    /**
     * Recursively iterate the tree up and update all the parent's lastFocusedChild
     */
    while (currentComponent) {
      const { parentFocusKey } = currentComponent;

      const parentComponent = this.focusableComponents[parentFocusKey];

      if (parentComponent) {
        this.saveLastFocusedChildKey(
          parentComponent,
          currentComponent.focusKey
        );
      }

      currentComponent = parentComponent;
    }
  }

  getKeyMap() {
    return this.keyMap;
  }

  setKeyMap(keyMap: BackwardsCompatibleKeyMap) {
    this.keyMap = {
      ...this.getKeyMap(),
      ...normalizeKeyMap(keyMap)
    };
  }

  isFocusableComponent(focusKey: string) {
    return !!this.focusableComponents[focusKey];
  }

  /**
   * Checks whether the focusableComponent is actually participating in spatial navigation (in other words, is a
   * 'focusable' focusableComponent). Seems less confusing than calling it isFocusableFocusableComponent()
   */
  isParticipatingFocusableComponent(focusKey: string) {
    return (
      this.isFocusableComponent(focusKey) &&
      this.focusableComponents[focusKey].focusable
    );
  }

  onIntermediateNodeBecameFocused(
    focusKey: string,
    focusDetails: FocusDetails
  ) {
    if (this.isParticipatingFocusableComponent(focusKey)) {
      this.focusableComponents[focusKey].onFocus(
        this.getNodeLayoutByFocusKey(focusKey),
        focusDetails
      );
    }
  }

  onIntermediateNodeBecameBlurred(
    focusKey: string,
    focusDetails: FocusDetails
  ) {
    if (this.isParticipatingFocusableComponent(focusKey)) {
      this.focusableComponents[focusKey].onBlur(
        this.getNodeLayoutByFocusKey(focusKey),
        focusDetails
      );
    }
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  setFocus(focusKey: string, focusDetails: FocusDetails = {}) {
    if (!this.enabled) {
      return;
    }

    this.log('setFocus', 'focusKey', focusKey);

    const lastFocusedKey = this.focusKey;
    const newFocusKey = this.getNextFocusKey(focusKey);

    this.log('setFocus', 'newFocusKey', newFocusKey);

    this.setCurrentFocusedKey(newFocusKey, focusDetails);
    this.updateParentsHasFocusedChild(newFocusKey, focusDetails);
    this.updateParentsLastFocusedChild(lastFocusedKey);
  }

  updateAllLayouts() {
    forOwn(this.focusableComponents, (component, focusKey) => {
      this.updateLayout(focusKey);
    });
  }

  updateLayout(focusKey: string) {
    const component = this.focusableComponents[focusKey];

    if (!component || component.layoutUpdated) {
      return;
    }

    const { node } = component;

    component.layout = {
      ...measureLayout(node),
      node
    };
  }

  updateFocusable(
    focusKey: string,
    {
      node,
      preferredChildFocusKey,
      focusable,
      isFocusBoundary,
      onEnterPress,
      onEnterRelease,
      onArrowPress,
      onFocus,
      onBlur
    }: FocusableComponentUpdatePayload
  ) {
    const component = this.focusableComponents[focusKey];

    if (component) {
      component.preferredChildFocusKey = preferredChildFocusKey;
      component.focusable = focusable;
      component.isFocusBoundary = isFocusBoundary;
      component.onEnterPress = onEnterPress;
      component.onEnterRelease = onEnterRelease;
      component.onArrowPress = onArrowPress;
      component.onFocus = onFocus;
      component.onBlur = onBlur;

      if (node) {
        component.node = node;
      }
    }
  }
}

/**
 * Export singleton
 */
/** @internal */
export const SpatialNavigation = new SpatialNavigationService();

export const { init, setThrottle, destroy, setKeyMap } = SpatialNavigation;
